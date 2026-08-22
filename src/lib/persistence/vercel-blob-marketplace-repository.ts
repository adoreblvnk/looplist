import "server-only";
import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  head,
  list,
  put,
} from "@vercel/blob";
import { z } from "zod";
import {
  ActiveListingSchema,
  MediaReferenceSchema,
  ReconciliationFailureSchema,
  SettlementReceiptSchema,
  deterministicPurchaseId,
  type ActiveListing,
  type MediaReference,
  type ReconciliationFailure,
  type SettlementReceipt,
} from "../domain/marketplace";
import {
  DurableRunPathSchema,
  PublishedListingPathSchema,
  durableRunPath,
  publishedListingPath,
  reconciliationRecordPath,
  settlementReceiptPath,
} from "./paths";
import {
  DurableRunSnapshotSchema,
  MarketplaceListingSchema,
  PrivateMediaContentSchema,
  PrivateMediaMetadataSchema,
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  assertReceiptMatchesPublishedActiveListing,
  type DurableRunSnapshot,
  type MarketplaceListing,
  type MarketplaceRepository,
  type PrivateMediaContent,
  type PrivateMediaMetadata,
} from "./repository";

const MAX_JSON_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_LIST_CURSOR_LENGTH = 1024;
const MAX_LIST_PAGES = 25;
const MAX_LISTING_RECORDS = 500;
const LISTING_READ_CONCURRENCY = 8;
const PUBLISHED_LISTING_PREFIX = "records/listings/";
const PUBLISHED_LISTING_SUFFIX = "/published.json";

const BlobListPageSchema = z.object({
  blobs: z.array(z.unknown()),
  hasMore: z.boolean(),
  cursor: z.unknown().optional(),
});
const BlobListCursorSchema = z
  .string()
  .max(MAX_LIST_CURSOR_LENGTH)
  .refine((cursor) => cursor.trim().length > 0);

const BlobObjectMetadataSchema = z.object({
  pathname: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedAt: z.date(),
});
const BlobReadResultSchema = z.object({
  stream: z.custom<ReadableStream<Uint8Array>>(
    (value) => value instanceof ReadableStream,
    "Blob content stream is invalid"
  ),
  blob: BlobObjectMetadataSchema,
});
type BlobReadResult = z.infer<typeof BlobReadResultSchema>;
const BlobPutResultSchema = z.object({ pathname: z.string() }).passthrough();
const ProviderErrorShapeSchema = z.object({
  code: z.unknown().optional(),
  status: z.unknown().optional(),
  statusCode: z.unknown().optional(),
}).passthrough();

export interface PrivateBlobTransport {
  put(
    pathname: string,
    body: string,
    options: {
      access: "private";
      addRandomSuffix: false;
      allowOverwrite: boolean;
      contentType: string;
    }
  ): Promise<unknown>;
  get(pathname: string, options: { access: "private"; useCache: false }): Promise<unknown>;
  head(pathname: string): Promise<unknown>;
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<unknown>;
}

export const vercelPrivateBlobTransport: PrivateBlobTransport = {
  async put(pathname, body, options) {
    return put(pathname, body, options);
  },
  async get(pathname, options) {
    const result = await get(pathname, options);
    return result?.statusCode === 200 ? result : null;
  },
  async head(pathname) {
    return head(pathname);
  },
  async list(options) {
    return list(options);
  },
};

function isProviderNotFound(error: unknown): boolean {
  if (error instanceof BlobNotFoundError) return true;
  const candidate = ProviderErrorShapeSchema.safeParse(error);
  if (!candidate.success) return false;
  return (
    candidate.data.code === "not_found" ||
    candidate.data.code === "blob_not_found" ||
    candidate.data.status === 404 ||
    candidate.data.statusCode === 404
  );
}

function isProviderConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  const candidate = ProviderErrorShapeSchema.safeParse(error);
  if (!candidate.success) return false;
  return (
    candidate.data.code === "blob_already_exists" ||
    candidate.data.code === "already_exists" ||
    candidate.data.code === "conflict" ||
    candidate.data.status === 409 ||
    candidate.data.statusCode === 409
  );
}

function mapProviderError(error: unknown): never {
  if (
    error instanceof RepositoryConflictError ||
    error instanceof RepositoryNotFoundError ||
    error instanceof RepositoryDataError ||
    error instanceof RepositoryUnavailableError
  ) {
    throw error;
  }
  if (isProviderConflict(error)) throw new RepositoryConflictError();
  if (isProviderNotFound(error)) throw new RepositoryNotFoundError();
  throw new RepositoryUnavailableError();
}

async function readBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > limit) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the authoritative byte-limit classification if stream cancellation also fails.
      }
      throw new RepositoryDataError("Private Blob object exceeded its permitted size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function encodeJson(value: unknown): string {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new RepositoryDataError("Repository JSON snapshot exceeded 512 KiB");
  }
  return body;
}

export class VercelBlobMarketplaceRepository implements MarketplaceRepository {
  constructor(private readonly transport: PrivateBlobTransport = vercelPrivateBlobTransport) {}

  async publishSellerListing(candidate: ActiveListing): Promise<MarketplaceListing> {
    const listing = ActiveListingSchema.parse(structuredClone(candidate));
    if (listing.source !== "seller") throw new TypeError("publishSellerListing accepts seller-created listings only");
    await this.putJson(publishedListingPath(listing.listingId), listing, false);
    return MarketplaceListingSchema.parse({ listing, visibility: "active", receiptId: null });
  }

  async getListing(listingId: string): Promise<MarketplaceListing> {
    const listing = await this.readJson(publishedListingPath(listingId), ActiveListingSchema);
    return this.marketplaceListingForStoredListing(listingId, listing);
  }

  private async marketplaceListingForStoredListing(
    requestedListingId: string,
    listing: ActiveListing
  ): Promise<MarketplaceListing> {
    if (listing.listingId !== requestedListingId) {
      throw new RepositoryDataError("Stored listing does not match its deterministic path");
    }
    const purchaseId = deterministicPurchaseId(requestedListingId);
    const receipt = await this.readOptionalJson(settlementReceiptPath(purchaseId), SettlementReceiptSchema);
    if (receipt) assertReceiptMatchesPublishedActiveListing(receipt, listing, "stored");
    return MarketplaceListingSchema.parse({
      listing,
      visibility: receipt ? "sold" : "active",
      receiptId: receipt?.receiptId ?? null,
    });
  }

  async listMarketplaceListings(): Promise<MarketplaceListing[]> {
    const pathnames: string[] = [];
    const seenPathnames = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      pageCount += 1;
      let candidatePage: unknown;
      try {
        candidatePage = await this.transport.list({ prefix: PUBLISHED_LISTING_PREFIX, limit: 1000, cursor });
      } catch (error) {
        mapProviderError(error);
      }
      const parsedPage = BlobListPageSchema.safeParse(candidatePage);
      if (!parsedPage.success) {
        throw new RepositoryDataError("Blob listing provider returned malformed pagination data");
      }
      const page = parsedPage.data;
      for (const blob of page.blobs) {
        const parsedPath = PublishedListingPathSchema.safeParse(
          typeof blob === "object" && blob !== null && "pathname" in blob ? blob.pathname : undefined
        );
        if (!parsedPath.success) {
          throw new RepositoryDataError("Blob listing provider returned a malformed stored path");
        }
        if (seenPathnames.has(parsedPath.data)) {
          throw new RepositoryDataError("Blob listing provider returned a duplicate stored path");
        }
        seenPathnames.add(parsedPath.data);
        pathnames.push(parsedPath.data);
        if (pathnames.length > MAX_LISTING_RECORDS) {
          throw new RepositoryDataError("Blob listing enumeration exceeded its record limit");
        }
      }
      const parsedCursor = page.cursor === undefined ? undefined : BlobListCursorSchema.safeParse(page.cursor);
      if (parsedCursor !== undefined && !parsedCursor.success) {
        throw new RepositoryDataError("Blob listing provider returned a malformed pagination cursor");
      }
      if (!page.hasMore) {
        cursor = undefined;
        continue;
      }
      if (pageCount >= MAX_LIST_PAGES) {
        throw new RepositoryDataError("Blob listing enumeration exceeded its page limit");
      }
      if (parsedCursor === undefined) {
        throw new RepositoryDataError("Blob listing pagination omitted its cursor");
      }
      cursor = parsedCursor.data;
      if (seenCursors.has(cursor)) {
        throw new RepositoryDataError("Blob listing pagination repeated its cursor");
      }
      seenCursors.add(cursor);
    } while (cursor);

    return mapWithConcurrency(
      pathnames.sort(),
      LISTING_READ_CONCURRENCY,
      async (pathname) => {
        const listingId = pathname.slice(PUBLISHED_LISTING_PREFIX.length, -PUBLISHED_LISTING_SUFFIX.length);
        const listing = await this.readJson(pathname, ActiveListingSchema);
        return this.marketplaceListingForStoredListing(listingId, listing);
      }
    );
  }

  async saveRunSnapshot(candidate: DurableRunSnapshot): Promise<DurableRunSnapshot> {
    const run = DurableRunSnapshotSchema.parse(structuredClone(candidate));
    await this.putJson(durableRunPath(run.kind, run.runId), run, true);
    return DurableRunSnapshotSchema.parse(structuredClone(run));
  }

  async readRunSnapshot(kind: DurableRunSnapshot["kind"], runId: string): Promise<DurableRunSnapshot> {
    const pathname = DurableRunPathSchema.parse(durableRunPath(kind, runId));
    const run = await this.readJson(pathname, DurableRunSnapshotSchema);
    if (run.kind !== kind || run.runId !== runId) {
      throw new RepositoryDataError("Durable run snapshot does not match its deterministic path");
    }
    return run;
  }

  async createSettlementReceipt(candidate: SettlementReceipt): Promise<SettlementReceipt> {
    const receipt = SettlementReceiptSchema.parse(structuredClone(candidate));
    const published = await this.readJson(publishedListingPath(receipt.listingId), ActiveListingSchema);
    if (published.listingId !== receipt.listingId) {
      throw new RepositoryDataError("Stored published listing does not match its deterministic path");
    }
    assertReceiptMatchesPublishedActiveListing(receipt, published, "input");
    await this.putJson(settlementReceiptPath(receipt.purchaseId), receipt, false);
    return SettlementReceiptSchema.parse(structuredClone(receipt));
  }

  async readSettlementReceipt(purchaseId: string): Promise<SettlementReceipt> {
    settlementReceiptPath(purchaseId);
    const receipt = await this.readJson(settlementReceiptPath(purchaseId), SettlementReceiptSchema);
    if (receipt.purchaseId !== purchaseId) {
      throw new RepositoryDataError("Stored settlement receipt does not match its deterministic path");
    }
    const listingId = purchaseId.slice("purchase:".length);
    let listing: ActiveListing;
    try {
      listing = await this.readJson(publishedListingPath(listingId), ActiveListingSchema);
    } catch (error) {
      if (error instanceof RepositoryNotFoundError) {
        throw new RepositoryDataError("Stored settlement receipt has no published listing");
      }
      throw error;
    }
    assertReceiptMatchesPublishedActiveListing(receipt, listing, "stored");
    return SettlementReceiptSchema.parse(structuredClone(receipt));
  }

  async createReconciliationRecord(reconciliationId: string, candidate: ReconciliationFailure): Promise<ReconciliationFailure> {
    const failure = ReconciliationFailureSchema.parse(structuredClone(candidate));
    await this.putJson(reconciliationRecordPath(failure.purchaseId, reconciliationId), failure, false);
    return ReconciliationFailureSchema.parse(structuredClone(failure));
  }

  async readReconciliationRecord(purchaseId: string, reconciliationId: string): Promise<ReconciliationFailure> {
    const failure = await this.readJson(
      reconciliationRecordPath(purchaseId, reconciliationId),
      ReconciliationFailureSchema
    );
    if (failure.purchaseId !== purchaseId) {
      throw new RepositoryDataError("Stored reconciliation record does not match its deterministic path");
    }
    return failure;
  }

  async readPrivateMediaMetadata(candidate: MediaReference): Promise<PrivateMediaMetadata> {
    const media = MediaReferenceSchema.parse(structuredClone(candidate));
    let providerResult: unknown;
    try {
      providerResult = await this.transport.head(media.pathname);
    } catch (error) {
      mapProviderError(error);
    }
    const parsedResult = BlobObjectMetadataSchema.safeParse(providerResult);
    if (!parsedResult.success) {
      throw new RepositoryDataError("Stored private media metadata envelope is invalid");
    }
    const result = parsedResult.data;
    if (result.pathname !== media.pathname || result.contentType !== media.mimeType) {
      throw new RepositoryDataError("Private media metadata does not match its authoritative reference");
    }
    try {
      const uploadedAt = result.uploadedAt.toISOString();
      return PrivateMediaMetadataSchema.parse({ media, size: result.size, uploadedAt });
    } catch (error) {
      if (error instanceof RepositoryDataError) throw error;
      throw new RepositoryDataError("Stored private media metadata failed validation");
    }
  }

  async readPrivateMediaContent(candidate: MediaReference): Promise<PrivateMediaContent> {
    const media = MediaReferenceSchema.parse(structuredClone(candidate));
    let providerResult: unknown;
    try {
      providerResult = await this.transport.get(media.pathname, { access: "private", useCache: false });
    } catch (error) {
      mapProviderError(error);
    }
    if (providerResult === null) throw new RepositoryNotFoundError("Private media was not found");
    const parsedResult = BlobReadResultSchema.safeParse(providerResult);
    if (!parsedResult.success) {
      throw new RepositoryDataError("Stored private media content envelope is invalid");
    }
    const result = parsedResult.data;
    if (result.blob.pathname !== media.pathname || result.blob.contentType !== media.mimeType) {
      throw new RepositoryDataError("Private media content does not match its authoritative reference");
    }

    let uploadedAt: string;
    try {
      uploadedAt = result.blob.uploadedAt.toISOString();
      PrivateMediaMetadataSchema.parse({ media, size: result.blob.size, uploadedAt });
    } catch {
      throw new RepositoryDataError("Stored private media metadata failed validation");
    }

    let bytes: Uint8Array;
    try {
      bytes = await readBytes(result.stream, MAX_MEDIA_BYTES);
    } catch (error) {
      if (error instanceof RepositoryDataError) throw error;
      throw new RepositoryUnavailableError();
    }
    try {
      return PrivateMediaContentSchema.parse({
        metadata: { media, size: result.blob.size, uploadedAt },
        bytes,
      });
    } catch {
      throw new RepositoryDataError("Stored private media content failed validation");
    }
  }

  private async putJson(pathname: string, value: unknown, allowOverwrite: boolean): Promise<void> {
    const body = encodeJson(value);
    try {
      const providerResult = await this.transport.put(pathname, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite,
        contentType: "application/json",
      });
      const parsedResult = BlobPutResultSchema.safeParse(providerResult);
      if (!parsedResult.success) {
        throw new RepositoryDataError("Blob provider returned an invalid write acknowledgement");
      }
      if (parsedResult.data.pathname !== pathname) {
        throw new RepositoryDataError("Blob provider changed a deterministic pathname");
      }
    } catch (error) {
      mapProviderError(error);
    }
  }

  private async readJson<T>(pathname: string, schema: z.ZodType<T>): Promise<T> {
    const result = await this.getBlob(pathname);
    if (!result) throw new RepositoryNotFoundError();
    if (result.blob.pathname !== pathname || !/^application\/json(?:\s*;|$)/i.test(result.blob.contentType)) {
      throw new RepositoryDataError("Stored repository object has invalid metadata");
    }
    const bytes = await this.readJsonBytes(result.stream);
    try {
      return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw new RepositoryDataError();
    }
  }

  private async readOptionalJson<T>(pathname: string, schema: z.ZodType<T>): Promise<T | null> {
    const result = await this.getBlob(pathname);
    if (!result) return null;
    if (result.blob.pathname !== pathname || !/^application\/json(?:\s*;|$)/i.test(result.blob.contentType)) {
      throw new RepositoryDataError("Stored repository object has invalid metadata");
    }
    const bytes = await this.readJsonBytes(result.stream);
    try {
      return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw new RepositoryDataError();
    }
  }

  private async readJsonBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    try {
      return await readBytes(stream, MAX_JSON_BYTES);
    } catch (error) {
      if (error instanceof RepositoryDataError) throw error;
      throw new RepositoryUnavailableError();
    }
  }

  private async getBlob(pathname: string): Promise<BlobReadResult | null> {
    try {
      const providerResult = await this.transport.get(pathname, { access: "private", useCache: false });
      if (providerResult === null) return null;
      const parsedResult = BlobReadResultSchema.safeParse(providerResult);
      if (!parsedResult.success) {
        throw new RepositoryDataError("Stored Blob content envelope is invalid");
      }
      return parsedResult.data;
    } catch (error) {
      if (isProviderNotFound(error)) return null;
      mapProviderError(error);
    }
  }
}
