import "server-only";
import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  get,
  head,
  list,
  put,
} from "@vercel/blob";
import { z } from "zod";
import {
  BuyerSearchClaimSchema,
  BuyerSearchSelectionRecordSchema,
  type BuyerSearchClaim,
  type BuyerSearchSelectionRecord,
} from "../domain/buyer-search";
import {
  ActiveListingSchema,
  MediaReferenceSchema,
  ReconciliationFailureSchema,
  SettlementReceiptSchema,
  SoldComparableSchema,
  deterministicPurchaseId,
  type ActiveListing,
  type MediaReference,
  type ReconciliationFailure,
  type SettlementReceipt,
  type SoldComparable,
} from "../domain/marketplace";
import {
  DurableRunPathSchema,
  analysisStartClaimPath,
  analysisStartConfirmationPath,
  buyerSearchClaimPath,
  buyerSearchSelectionPath,
  deletedListingPath,
  publicationRequestPath,
  PublishedListingPathSchema,
  SoldComparablePathSchema,
  durableRunPath,
  publishedListingPath,
  reconciliationRecordPath,
  settlementReceiptPath,
  soldComparablePath,
} from "./paths";
import {
  AnalysisStartClaimSchema,
  AnalysisStartConfirmationSchema,
  DurableRunSnapshotSchema,
  DeletedListingRecordSchema,
  MarketplaceListingSchema,
  MAX_SOLD_COMPARABLES,
  PrivateMediaContentSchema,
  PrivateMediaMetadataSchema,
  PublicationRequestRecordSchema,
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  assertReceiptMatchesPublishedActiveListing,
  bindSeedListingRecipient,
  normalizeDemoListingPrice,
  normalizeSeedComparablePrice,
  type AnalysisStartClaim,
  type AnalysisStartConfirmation,
  type DurableRunSnapshot,
  type MarketplaceListing,
  type MarketplaceRepository,
  type PrivateMediaContent,
  type PrivateMediaMetadata,
  type PublicationRequestRecord,
  type QueuedAnalysisRun,
  type QueuedPurchaseRun,
} from "./repository";

const MAX_JSON_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_LIST_CURSOR_LENGTH = 1024;
const MAX_LIST_PAGES = 25;
const MAX_LISTING_RECORDS = 500;
const LISTING_READ_CONCURRENCY = 8;
const PUBLISHED_LISTING_PREFIX = "records/listings/";
const PUBLISHED_LISTING_SUFFIX = "/published.json";
const SOLD_COMPARABLE_PREFIX = "records/comparables/sold/";
const SOLD_COMPARABLE_SUFFIX = ".json";

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
    body: string | Uint8Array,
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
  del(pathname: string): Promise<void>;
}

export const vercelPrivateBlobTransport: PrivateBlobTransport = {
  async put(pathname, body, options) {
    return put(pathname, typeof body === "string" ? body : Buffer.from(body), options);
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
  async del(pathname) {
    await del(pathname);
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
  if (
    error instanceof Error &&
    error.message.startsWith("Vercel Blob: This blob already exists,")
  ) {
    return true;
  }
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
  constructor(
    private readonly transport: PrivateBlobTransport = vercelPrivateBlobTransport,
    private readonly seedRecipientAddress?: string,
  ) {}

  private hydrateListing(listing: ActiveListing): ActiveListing {
    const normalized = normalizeDemoListingPrice(listing);
    if (normalized.source !== "seed" || !this.seedRecipientAddress) return normalized;
    return bindSeedListingRecipient(normalized, this.seedRecipientAddress);
  }

  async createAnalysisRun(candidate: QueuedAnalysisRun): Promise<QueuedAnalysisRun> {
    const run = DurableRunSnapshotSchema.parse(structuredClone(candidate));
    if (run.kind !== "analysis" || run.status !== "queued") {
      throw new TypeError("createAnalysisRun accepts queued analysis runs only");
    }
    await this.putJson(durableRunPath("analysis", run.runId), run, false);
    return DurableRunSnapshotSchema.parse(structuredClone(run)) as QueuedAnalysisRun;
  }

  async createPurchaseRun(candidate: QueuedPurchaseRun): Promise<QueuedPurchaseRun> {
    const run = DurableRunSnapshotSchema.parse(structuredClone(candidate));
    if (run.kind !== "purchase" || run.status !== "queued") {
      throw new TypeError("createPurchaseRun accepts queued purchase runs only");
    }
    await this.putJson(durableRunPath("purchase", run.runId), run, false);
    return DurableRunSnapshotSchema.parse(structuredClone(run)) as QueuedPurchaseRun;
  }

  async createAnalysisStartClaim(candidate: AnalysisStartClaim): Promise<AnalysisStartClaim> {
    const claim = AnalysisStartClaimSchema.parse(structuredClone(candidate));
    await this.putJson(analysisStartClaimPath(claim.runId), claim, false);
    return AnalysisStartClaimSchema.parse(structuredClone(claim));
  }

  async readAnalysisStartClaim(runId: string): Promise<AnalysisStartClaim> {
    const claim = await this.readJson(analysisStartClaimPath(runId), AnalysisStartClaimSchema);
    if (claim.runId !== runId) throw new RepositoryDataError("Stored analysis-start claim does not match its path");
    return claim;
  }

  async createAnalysisStartConfirmation(candidate: AnalysisStartConfirmation): Promise<AnalysisStartConfirmation> {
    const confirmation = AnalysisStartConfirmationSchema.parse(structuredClone(candidate));
    await this.putJson(analysisStartConfirmationPath(confirmation.runId), confirmation, false);
    return AnalysisStartConfirmationSchema.parse(structuredClone(confirmation));
  }

  async readAnalysisStartConfirmation(runId: string): Promise<AnalysisStartConfirmation> {
    const confirmation = await this.readJson(analysisStartConfirmationPath(runId), AnalysisStartConfirmationSchema);
    if (confirmation.runId !== runId) throw new RepositoryDataError("Stored analysis-start confirmation does not match its path");
    return confirmation;
  }

  async createPublicationRequest(candidate: PublicationRequestRecord): Promise<PublicationRequestRecord> {
    const request = PublicationRequestRecordSchema.parse(structuredClone(candidate));
    await this.putJson(publicationRequestPath(request.runId), request, false);
    return PublicationRequestRecordSchema.parse(structuredClone(request));
  }

  async readPublicationRequest(runId: string): Promise<PublicationRequestRecord> {
    const request = await this.readJson(publicationRequestPath(runId), PublicationRequestRecordSchema);
    if (request.runId !== runId) throw new RepositoryDataError("Stored publication request does not match its path");
    return request;
  }

  async createBuyerSearchClaim(candidate: BuyerSearchClaim): Promise<BuyerSearchClaim> {
    const claim = BuyerSearchClaimSchema.parse(structuredClone(candidate));
    await this.putJson(buyerSearchClaimPath(claim.searchId), claim, false);
    return BuyerSearchClaimSchema.parse(structuredClone(claim));
  }

  async readBuyerSearchClaim(searchId: string): Promise<BuyerSearchClaim> {
    const claim = await this.readJson(buyerSearchClaimPath(searchId), BuyerSearchClaimSchema);
    if (claim.searchId !== searchId) throw new RepositoryDataError("Stored buyer-search claim does not match its path");
    return claim;
  }

  async createBuyerSearchSelection(candidate: BuyerSearchSelectionRecord): Promise<BuyerSearchSelectionRecord> {
    const selection = BuyerSearchSelectionRecordSchema.parse(structuredClone(candidate));
    const claim = await this.readBuyerSearchClaim(selection.searchId);
    if (claim.query !== selection.query) throw new TypeError("Buyer-search selection must match its immutable claim");
    await this.putJson(buyerSearchSelectionPath(selection.searchId), selection, false);
    return BuyerSearchSelectionRecordSchema.parse(structuredClone(selection));
  }

  async readBuyerSearchSelection(searchId: string): Promise<BuyerSearchSelectionRecord> {
    const selection = await this.readJson(buyerSearchSelectionPath(searchId), BuyerSearchSelectionRecordSchema);
    if (selection.searchId !== searchId) throw new RepositoryDataError("Stored buyer-search selection does not match its path");
    const claim = await this.readBuyerSearchClaim(searchId);
    if (claim.query !== selection.query) throw new RepositoryDataError("Stored buyer-search selection does not match its claim");
    return selection;
  }

  async publishSellerListing(candidate: ActiveListing): Promise<MarketplaceListing> {
    const listing = ActiveListingSchema.parse(structuredClone(candidate));
    if (listing.source !== "seller") throw new TypeError("publishSellerListing accepts seller-created listings only");
    if (await this.readDeletedListing(listing.listingId)) {
      throw new RepositoryConflictError("Deleted listings cannot be republished");
    }
    await this.putJson(publishedListingPath(listing.listingId), listing, false);
    return MarketplaceListingSchema.parse({ listing, visibility: "active", receiptId: null });
  }

  async createSeedListing(candidate: ActiveListing): Promise<MarketplaceListing> {
    const listing = this.hydrateListing(ActiveListingSchema.parse(structuredClone(candidate)));
    if (listing.source !== "seed") throw new TypeError("createSeedListing accepts seed listings only");
    if (await this.readDeletedListing(listing.listingId)) {
      throw new RepositoryConflictError("Deleted listing IDs cannot be reused");
    }
    await this.putJson(publishedListingPath(listing.listingId), listing, false);
    return MarketplaceListingSchema.parse({ listing, visibility: "active", receiptId: null });
  }

  async deleteSellerListing(listingId: string, deletedAt: string): Promise<void> {
    const record = await this.getListing(listingId);
    if (record.listing.source !== "seller") {
      throw new RepositoryConflictError("Seed listings cannot be deleted");
    }
    if (record.visibility !== "active") {
      throw new RepositoryConflictError("Sold listings cannot be deleted");
    }
    if (await this.readOptionalJson(durableRunPath("purchase", listingId), DurableRunSnapshotSchema)) {
      throw new RepositoryConflictError("Listings with a purchase attempt cannot be deleted");
    }
    const deletion = DeletedListingRecordSchema.parse({ listingId, deletedAt });
    await this.putJson(deletedListingPath(listingId), deletion, false);
    try {
      await this.transport.del(publishedListingPath(listingId));
    } catch {
      // The immutable tombstone is authoritative; payload removal is best-effort cleanup.
    }
  }

  async getListing(listingId: string): Promise<MarketplaceListing> {
    const listing = await this.readJson(publishedListingPath(listingId), ActiveListingSchema);
    const record = await this.marketplaceListingForStoredListing(listingId, listing);
    if (!record) throw new RepositoryNotFoundError("Listing was deleted");
    return record;
  }

  private async marketplaceListingForStoredListing(
    requestedListingId: string,
    storedListing: ActiveListing
  ): Promise<MarketplaceListing | null> {
    if (await this.readDeletedListing(requestedListingId)) {
      return null;
    }
    const listing = this.hydrateListing(storedListing);
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

    const records = await mapWithConcurrency(
      pathnames.sort(),
      LISTING_READ_CONCURRENCY,
      async (pathname) => {
        const listingId = pathname.slice(PUBLISHED_LISTING_PREFIX.length, -PUBLISHED_LISTING_SUFFIX.length);
        const listing = await this.readJson(pathname, ActiveListingSchema);
        return this.marketplaceListingForStoredListing(listingId, listing);
      }
    );
    return records.filter((record): record is MarketplaceListing => record !== null);
  }

  /**
   * Capacity enforcement is a single-writer preflight, not CAS: concurrent creators can race
   * between enumeration and immutable put. Workflows must serialize comparable creation.
   */
  async createSoldComparable(candidate: SoldComparable): Promise<SoldComparable> {
    const comparable = SoldComparableSchema.parse(structuredClone(candidate));
    const pathname = soldComparablePath(comparable.comparableId);
    const existingPathnames = await this.listSoldComparablePathnames();
    if (!existingPathnames.includes(pathname) && existingPathnames.length >= MAX_SOLD_COMPARABLES) {
      throw new RepositoryDataError("Sold comparable corpus exceeded its record limit");
    }
    await this.putJson(pathname, comparable, false);
    return SoldComparableSchema.parse(structuredClone(comparable));
  }

  async listSoldComparables(): Promise<SoldComparable[]> {
    const pathnames = await this.listSoldComparablePathnames();
    return mapWithConcurrency(
      pathnames,
      LISTING_READ_CONCURRENCY,
      async (pathname) => {
        const comparableId = pathname.slice(SOLD_COMPARABLE_PREFIX.length, -SOLD_COMPARABLE_SUFFIX.length);
        const comparable = await this.readJson(pathname, SoldComparableSchema);
        if (comparable.comparableId !== comparableId) {
          throw new RepositoryDataError("Stored sold comparable does not match its deterministic path");
        }
        return normalizeSeedComparablePrice(comparable);
      }
    );
  }

  private async listSoldComparablePathnames(): Promise<string[]> {
    const pathnames: string[] = [];
    const seenPathnames = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      pageCount += 1;
      let candidatePage: unknown;
      try {
        candidatePage = await this.transport.list({
          prefix: SOLD_COMPARABLE_PREFIX,
          limit: 1000,
          cursor,
        });
      } catch (error) {
        mapProviderError(error);
      }
      const parsedPage = BlobListPageSchema.safeParse(candidatePage);
      if (!parsedPage.success) {
        throw new RepositoryDataError("Blob comparable provider returned malformed pagination data");
      }
      const page = parsedPage.data;
      for (const blob of page.blobs) {
        const parsedPath = SoldComparablePathSchema.safeParse(
          typeof blob === "object" && blob !== null && "pathname" in blob ? blob.pathname : undefined
        );
        if (!parsedPath.success || seenPathnames.has(parsedPath.data)) {
          throw new RepositoryDataError("Blob comparable provider returned a malformed stored path");
        }
        seenPathnames.add(parsedPath.data);
        pathnames.push(parsedPath.data);
        if (pathnames.length > MAX_SOLD_COMPARABLES) {
          throw new RepositoryDataError("Blob comparable enumeration exceeded its record limit");
        }
      }
      const parsedCursor = page.cursor === undefined ? undefined : BlobListCursorSchema.safeParse(page.cursor);
      if (parsedCursor !== undefined && !parsedCursor.success) {
        throw new RepositoryDataError("Blob comparable provider returned a malformed pagination cursor");
      }
      if (!page.hasMore) {
        cursor = undefined;
        continue;
      }
      if (pageCount >= MAX_LIST_PAGES) {
        throw new RepositoryDataError("Blob comparable enumeration exceeded its page limit");
      }
      if (parsedCursor === undefined) {
        throw new RepositoryDataError("Blob comparable pagination omitted its cursor");
      }
      cursor = parsedCursor.data;
      if (seenCursors.has(cursor)) {
        throw new RepositoryDataError("Blob comparable pagination repeated its cursor");
      }
      seenCursors.add(cursor);
    } while (cursor);
    return pathnames.sort();
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
    const published = this.hydrateListing(
      await this.readJson(publishedListingPath(receipt.listingId), ActiveListingSchema)
    );
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
      listing = this.hydrateListing(
        await this.readJson(publishedListingPath(listingId), ActiveListingSchema)
      );
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

  async createPrivateMedia(candidate: MediaReference, source: Uint8Array, uploadedAt: string): Promise<PrivateMediaMetadata> {
    const media = MediaReferenceSchema.parse(structuredClone(candidate));
    const metadata = PrivateMediaMetadataSchema.parse({ media, size: source.byteLength, uploadedAt });
    try {
      const providerResult = await this.transport.put(media.pathname, new Uint8Array(source), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: media.mimeType,
      });
      const parsedResult = BlobPutResultSchema.safeParse(providerResult);
      if (!parsedResult.success) throw new RepositoryDataError("Blob provider returned an invalid media write acknowledgement");
      if (parsedResult.data.pathname !== media.pathname) throw new RepositoryDataError("Blob provider changed a deterministic media pathname");
    } catch (error) {
      mapProviderError(error);
    }
    return PrivateMediaMetadataSchema.parse(structuredClone(metadata));
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

  private async readDeletedListing(listingId: string) {
    const deletion = await this.readOptionalJson(deletedListingPath(listingId), DeletedListingRecordSchema);
    if (deletion && deletion.listingId !== listingId) {
      throw new RepositoryDataError("Stored listing deletion does not match its deterministic path");
    }
    return deletion;
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
