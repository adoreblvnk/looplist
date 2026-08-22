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
import { durableRunPath, publishedListingPath, reconciliationRecordPath, settlementReceiptPath } from "./paths";
import {
  DurableRunSnapshotSchema,
  MarketplaceListingSchema,
  PrivateMediaContentSchema,
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  assertReceiptMatchesPublishedActiveListing,
  type DurableRunSnapshot,
  type MarketplaceListing,
  type MarketplaceRepository,
  type PrivateMediaContent,
  type PrivateMediaMetadata,
} from "./repository";

type SeedMedia = { media: MediaReference; bytes: Uint8Array; uploadedAt?: string };

type StoredCollection = "listings" | "runs" | "receipts" | "reconciliations" | "media";
export const IN_MEMORY_REPOSITORY_TEST_HOOK: unique symbol = Symbol("in-memory-repository-test-hook");
export interface InMemoryMarketplaceRepositoryOptions {
  listings?: ActiveListing[];
  media?: SeedMedia[];
  /** @internal Test-only constructor-time corruption injection; not a production mutation API. */
  [IN_MEMORY_REPOSITORY_TEST_HOOK]?: readonly {
    collection: StoredCollection;
    key: string;
    value: unknown;
  }[];
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  try {
    const parsed = schema.safeParse(cloneRecord(value));
    if (!parsed.success) throw new Error("invalid stored data");
    return parsed.data;
  } catch {
    throw new RepositoryDataError(message);
  }
}

function mediaReferencesMatch(left: MediaReference, right: MediaReference): boolean {
  return (
    left.id === right.id &&
    left.pathname === right.pathname &&
    left.mediaType === right.mediaType &&
    left.mimeType === right.mimeType &&
    left.alt === right.alt &&
    left.width === right.width &&
    left.height === right.height
  );
}

export class InMemoryMarketplaceRepository implements MarketplaceRepository {
  private readonly listings = new Map<string, ActiveListing>();
  private readonly runs = new Map<string, DurableRunSnapshot>();
  private readonly receipts = new Map<string, SettlementReceipt>();
  private readonly reconciliations = new Map<string, ReconciliationFailure>();
  private readonly media = new Map<string, PrivateMediaContent>();

  constructor(options: InMemoryMarketplaceRepositoryOptions = {}) {
    for (const candidate of options.listings ?? []) {
      const listing = ActiveListingSchema.parse(cloneRecord(candidate));
      if (this.listings.has(listing.listingId)) {
        throw new RepositoryConflictError("Duplicate initial listing ID");
      }
      this.listings.set(listing.listingId, cloneRecord(listing));
    }
    for (const candidate of options.media ?? []) {
      const media = MediaReferenceSchema.parse(cloneRecord(candidate.media));
      if (this.media.has(media.pathname)) {
        throw new RepositoryConflictError("Duplicate initial media pathname");
      }
      const bytes = new Uint8Array(candidate.bytes);
      const content = PrivateMediaContentSchema.parse({
        metadata: {
          media,
          size: bytes.byteLength,
          uploadedAt: candidate.uploadedAt ?? "2026-08-21T00:00:00.000Z",
        },
        bytes,
      });
      this.media.set(media.pathname, cloneRecord(content));
    }
    for (const injection of options[IN_MEMORY_REPOSITORY_TEST_HOOK] ?? []) {
      const value = cloneRecord(injection.value);
      switch (injection.collection) {
        case "listings": (this.listings as Map<string, unknown>).set(injection.key, value); break;
        case "runs": (this.runs as Map<string, unknown>).set(injection.key, value); break;
        case "receipts": (this.receipts as Map<string, unknown>).set(injection.key, value); break;
        case "reconciliations": (this.reconciliations as Map<string, unknown>).set(injection.key, value); break;
        case "media": (this.media as Map<string, unknown>).set(injection.key, value); break;
      }
    }
  }

  async publishSellerListing(candidate: ActiveListing): Promise<MarketplaceListing> {
    const listing = ActiveListingSchema.parse(cloneRecord(candidate));
    if (listing.source !== "seller") {
      throw new TypeError("publishSellerListing accepts seller-created listings only");
    }
    if (this.listings.has(listing.listingId)) {
      throw new RepositoryConflictError();
    }
    this.listings.set(listing.listingId, cloneRecord(listing));
    return this.marketplaceRecord(listing);
  }

  async getListing(listingId: string): Promise<MarketplaceListing> {
    publishedListingPath(listingId);
    if (!this.listings.has(listingId)) throw new RepositoryNotFoundError("Listing was not found");
    const stored = this.listings.get(listingId);
    const listing = parseStored(ActiveListingSchema, stored, "Stored listing failed validation");
    if (listing.listingId !== listingId) {
      throw new RepositoryDataError("Stored listing does not match its deterministic path");
    }
    return this.marketplaceRecord(listing);
  }

  async listMarketplaceListings(): Promise<MarketplaceListing[]> {
    return [...this.listings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([listingId, stored]) => {
        const listing = parseStored(ActiveListingSchema, stored, "Stored listing failed validation");
        if (listing.listingId !== listingId) {
          throw new RepositoryDataError("Stored listing does not match its deterministic path");
        }
        return this.marketplaceRecord(listing);
      });
  }

  async saveRunSnapshot(candidate: DurableRunSnapshot): Promise<DurableRunSnapshot> {
    const run = DurableRunSnapshotSchema.parse(cloneRecord(candidate));
    this.runs.set(`${run.kind}:${run.runId}`, cloneRecord(run));
    return DurableRunSnapshotSchema.parse(cloneRecord(run));
  }

  async readRunSnapshot(kind: DurableRunSnapshot["kind"], runId: string): Promise<DurableRunSnapshot> {
    durableRunPath(kind, runId);
    const key = `${kind}:${runId}`;
    if (!this.runs.has(key)) throw new RepositoryNotFoundError("Durable run snapshot was not found");
    const stored = this.runs.get(key);
    const parsed = parseStored(DurableRunSnapshotSchema, stored, "Stored durable run snapshot failed validation");
    if (parsed.kind !== kind || parsed.runId !== runId) {
      throw new RepositoryDataError("Durable run snapshot does not match its deterministic path");
    }
    return cloneRecord(parsed);
  }

  async createSettlementReceipt(candidate: SettlementReceipt): Promise<SettlementReceipt> {
    const receipt = SettlementReceiptSchema.parse(cloneRecord(candidate));
    if (!this.listings.has(receipt.listingId)) throw new RepositoryNotFoundError("Receipt listing was not found");
    const storedListing = this.listings.get(receipt.listingId);
    const listing = parseStored(ActiveListingSchema, storedListing, "Stored listing failed validation");
    if (listing.listingId !== receipt.listingId) {
      throw new RepositoryDataError("Stored listing does not match its deterministic path");
    }
    assertReceiptMatchesPublishedActiveListing(receipt, listing, "input");
    if (this.receipts.has(receipt.purchaseId)) {
      throw new RepositoryConflictError("A settlement receipt already exists for this listing");
    }
    this.receipts.set(receipt.purchaseId, cloneRecord(receipt));
    return SettlementReceiptSchema.parse(cloneRecord(receipt));
  }

  async readSettlementReceipt(purchaseId: string): Promise<SettlementReceipt> {
    settlementReceiptPath(purchaseId);
    if (!this.receipts.has(purchaseId)) throw new RepositoryNotFoundError("Settlement receipt was not found");
    const stored = this.receipts.get(purchaseId);
    const parsed = parseStored(SettlementReceiptSchema, stored, "Stored settlement receipt failed validation");
    if (parsed.purchaseId !== purchaseId) {
      throw new RepositoryDataError("Stored settlement receipt failed validation");
    }
    const listingId = purchaseId.slice("purchase:".length);
    if (!this.listings.has(listingId)) {
      throw new RepositoryDataError("Stored settlement receipt has no published listing");
    }
    const storedListing = this.listings.get(listingId);
    const listing = parseStored(ActiveListingSchema, storedListing, "Stored listing failed validation");
    if (listing.listingId !== listingId) {
      throw new RepositoryDataError("Stored listing does not match its deterministic path");
    }
    assertReceiptMatchesPublishedActiveListing(parsed, listing, "stored");
    return cloneRecord(parsed);
  }

  async createReconciliationRecord(reconciliationId: string, candidate: ReconciliationFailure): Promise<ReconciliationFailure> {
    const failure = ReconciliationFailureSchema.parse(cloneRecord(candidate));
    reconciliationRecordPath(failure.purchaseId, reconciliationId);
    const key = `${failure.purchaseId}:${reconciliationId}`;
    if (this.reconciliations.has(key)) throw new RepositoryConflictError("Reconciliation record already exists");
    this.reconciliations.set(key, cloneRecord(failure));
    return ReconciliationFailureSchema.parse(cloneRecord(failure));
  }

  async readReconciliationRecord(purchaseId: string, reconciliationId: string): Promise<ReconciliationFailure> {
    reconciliationRecordPath(purchaseId, reconciliationId);
    const key = `${purchaseId}:${reconciliationId}`;
    if (!this.reconciliations.has(key)) throw new RepositoryNotFoundError("Reconciliation record was not found");
    const stored = this.reconciliations.get(key);
    const parsed = parseStored(ReconciliationFailureSchema, stored, "Stored reconciliation record failed validation");
    if (parsed.purchaseId !== purchaseId) {
      throw new RepositoryDataError("Stored reconciliation record failed validation");
    }
    return cloneRecord(parsed);
  }

  async readPrivateMediaMetadata(candidate: MediaReference): Promise<PrivateMediaMetadata> {
    const media = MediaReferenceSchema.parse(cloneRecord(candidate));
    if (!this.media.has(media.pathname)) throw new RepositoryNotFoundError("Private media was not found");
    const stored = this.media.get(media.pathname);
    const content = parseStored(PrivateMediaContentSchema, stored, "Stored private media failed validation");
    if (!mediaReferencesMatch(content.metadata.media, media)) {
      throw new RepositoryDataError("Stored private media does not match its authoritative reference");
    }
    return cloneRecord(content.metadata);
  }

  async readPrivateMediaContent(candidate: MediaReference): Promise<PrivateMediaContent> {
    const media = MediaReferenceSchema.parse(cloneRecord(candidate));
    if (!this.media.has(media.pathname)) throw new RepositoryNotFoundError("Private media was not found");
    const stored = this.media.get(media.pathname);
    const content = parseStored(PrivateMediaContentSchema, stored, "Stored private media failed validation");
    if (!mediaReferencesMatch(content.metadata.media, media)) {
      throw new RepositoryDataError("Stored private media does not match its authoritative reference");
    }
    return cloneRecord(content);
  }

  private marketplaceRecord(candidate: ActiveListing): MarketplaceListing {
    const listing = parseStored(ActiveListingSchema, candidate, "Stored listing failed validation");
    const purchaseId = deterministicPurchaseId(listing.listingId);
    const hasStoredReceipt = this.receipts.has(purchaseId);
    const storedReceipt = this.receipts.get(purchaseId);
    let receipt: SettlementReceipt | null = null;
    if (hasStoredReceipt) {
      receipt = parseStored(SettlementReceiptSchema, storedReceipt, "Stored settlement receipt failed validation");
      if (receipt.purchaseId !== deterministicPurchaseId(listing.listingId)) {
        throw new RepositoryDataError("Stored settlement receipt does not match its deterministic path");
      }
      assertReceiptMatchesPublishedActiveListing(receipt, listing, "stored");
    }
    return parseStored(
      MarketplaceListingSchema,
      {
        listing,
        visibility: receipt ? "sold" : "active",
        receiptId: receipt?.receiptId ?? null,
      },
      "Stored marketplace listing failed validation"
    );
  }
}
