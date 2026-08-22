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
  mediaReferencesEqual,
  type ActiveListing,
  type MediaReference,
  type ReconciliationFailure,
  type SettlementReceipt,
  type SoldComparable,
} from "../domain/marketplace";
import { analysisStartClaimPath, analysisStartConfirmationPath, buyerSearchClaimPath, buyerSearchSelectionPath, durableRunPath, publicationRequestPath, publishedListingPath, reconciliationRecordPath, settlementReceiptPath, soldComparablePath } from "./paths";
import {
  AnalysisStartClaimSchema,
  AnalysisStartConfirmationSchema,
  DurableRunSnapshotSchema,
  MarketplaceListingSchema,
  MAX_SOLD_COMPARABLES,
  PrivateMediaContentSchema,
  PrivateMediaMetadataSchema,
  PublicationRequestRecordSchema,
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  assertReceiptMatchesPublishedActiveListing,
  type AnalysisStartClaim,
  type AnalysisStartConfirmation,
  type DurableRunSnapshot,
  type MarketplaceListing,
  type MarketplaceRepository,
  type PrivateMediaContent,
  type PrivateMediaMetadata,
  type PublicationRequestRecord,
  type QueuedAnalysisRun,
} from "./repository";

type SeedMedia = { media: MediaReference; bytes: Uint8Array; uploadedAt?: string };

type StoredCollection = "listings" | "runs" | "receipts" | "reconciliations" | "comparables" | "media";
export const IN_MEMORY_REPOSITORY_TEST_HOOK: unique symbol = Symbol("in-memory-repository-test-hook");
export interface InMemoryMarketplaceRepositoryOptions {
  listings?: ActiveListing[];
  media?: SeedMedia[];
  soldComparables?: SoldComparable[];
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

export class InMemoryMarketplaceRepository implements MarketplaceRepository {
  private readonly listings = new Map<string, ActiveListing>();
  private readonly runs = new Map<string, DurableRunSnapshot>();
  private readonly analysisStartClaims = new Map<string, AnalysisStartClaim>();
  private readonly analysisStartConfirmations = new Map<string, AnalysisStartConfirmation>();
  private readonly publicationRequests = new Map<string, PublicationRequestRecord>();
  private readonly buyerSearchClaims = new Map<string, BuyerSearchClaim>();
  private readonly buyerSearchSelections = new Map<string, BuyerSearchSelectionRecord>();
  private readonly receipts = new Map<string, SettlementReceipt>();
  private readonly reconciliations = new Map<string, ReconciliationFailure>();
  private readonly comparables = new Map<string, SoldComparable>();
  private readonly media = new Map<string, PrivateMediaContent>();

  constructor(options: InMemoryMarketplaceRepositoryOptions = {}) {
    if ((options.soldComparables?.length ?? 0) > MAX_SOLD_COMPARABLES) {
      throw new RepositoryDataError("Initial sold comparable corpus exceeded its record limit");
    }
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
    for (const candidate of options.soldComparables ?? []) {
      const comparable = SoldComparableSchema.parse(cloneRecord(candidate));
      if (this.comparables.has(comparable.comparableId)) {
        throw new RepositoryConflictError("Duplicate initial sold comparable ID");
      }
      this.comparables.set(comparable.comparableId, cloneRecord(comparable));
    }
    for (const injection of options[IN_MEMORY_REPOSITORY_TEST_HOOK] ?? []) {
      const value = cloneRecord(injection.value);
      switch (injection.collection) {
        case "listings": (this.listings as Map<string, unknown>).set(injection.key, value); break;
        case "runs": (this.runs as Map<string, unknown>).set(injection.key, value); break;
        case "receipts": (this.receipts as Map<string, unknown>).set(injection.key, value); break;
        case "reconciliations": (this.reconciliations as Map<string, unknown>).set(injection.key, value); break;
        case "comparables": (this.comparables as Map<string, unknown>).set(injection.key, value); break;
        case "media": (this.media as Map<string, unknown>).set(injection.key, value); break;
      }
    }
  }

  async createAnalysisRun(candidate: QueuedAnalysisRun): Promise<QueuedAnalysisRun> {
    const run = DurableRunSnapshotSchema.parse(cloneRecord(candidate));
    if (run.kind !== "analysis" || run.status !== "queued") {
      throw new TypeError("createAnalysisRun accepts queued analysis runs only");
    }
    const key = `analysis:${run.runId}`;
    if (this.runs.has(key)) throw new RepositoryConflictError();
    this.runs.set(key, cloneRecord(run));
    return DurableRunSnapshotSchema.parse(cloneRecord(run)) as QueuedAnalysisRun;
  }

  async createAnalysisStartClaim(candidate: AnalysisStartClaim): Promise<AnalysisStartClaim> {
    const claim = AnalysisStartClaimSchema.parse(cloneRecord(candidate));
    analysisStartClaimPath(claim.runId);
    if (this.analysisStartClaims.has(claim.runId)) throw new RepositoryConflictError();
    this.analysisStartClaims.set(claim.runId, cloneRecord(claim));
    return AnalysisStartClaimSchema.parse(cloneRecord(claim));
  }

  async readAnalysisStartClaim(runId: string): Promise<AnalysisStartClaim> {
    analysisStartClaimPath(runId);
    const stored = this.analysisStartClaims.get(runId);
    if (!stored) throw new RepositoryNotFoundError("Analysis-start claim was not found");
    const claim = parseStored(AnalysisStartClaimSchema, stored, "Stored analysis-start claim failed validation");
    if (claim.runId !== runId) throw new RepositoryDataError("Stored analysis-start claim does not match its path");
    return cloneRecord(claim);
  }

  async createAnalysisStartConfirmation(candidate: AnalysisStartConfirmation): Promise<AnalysisStartConfirmation> {
    const confirmation = AnalysisStartConfirmationSchema.parse(cloneRecord(candidate));
    analysisStartConfirmationPath(confirmation.runId);
    if (this.analysisStartConfirmations.has(confirmation.runId)) throw new RepositoryConflictError();
    this.analysisStartConfirmations.set(confirmation.runId, cloneRecord(confirmation));
    return AnalysisStartConfirmationSchema.parse(cloneRecord(confirmation));
  }

  async readAnalysisStartConfirmation(runId: string): Promise<AnalysisStartConfirmation> {
    analysisStartConfirmationPath(runId);
    const stored = this.analysisStartConfirmations.get(runId);
    if (!stored) throw new RepositoryNotFoundError("Analysis-start confirmation was not found");
    const confirmation = parseStored(AnalysisStartConfirmationSchema, stored, "Stored analysis-start confirmation failed validation");
    if (confirmation.runId !== runId) throw new RepositoryDataError("Stored analysis-start confirmation does not match its path");
    return cloneRecord(confirmation);
  }

  async createPublicationRequest(candidate: PublicationRequestRecord): Promise<PublicationRequestRecord> {
    const request = PublicationRequestRecordSchema.parse(cloneRecord(candidate));
    publicationRequestPath(request.runId);
    if (this.publicationRequests.has(request.runId)) throw new RepositoryConflictError();
    this.publicationRequests.set(request.runId, cloneRecord(request));
    return PublicationRequestRecordSchema.parse(cloneRecord(request));
  }

  async readPublicationRequest(runId: string): Promise<PublicationRequestRecord> {
    publicationRequestPath(runId);
    if (!this.publicationRequests.has(runId)) throw new RepositoryNotFoundError("Publication request was not found");
    const request = parseStored(
      PublicationRequestRecordSchema,
      this.publicationRequests.get(runId),
      "Stored publication request failed validation"
    );
    if (request.runId !== runId) throw new RepositoryDataError("Stored publication request does not match its path");
    return cloneRecord(request);
  }

  async createBuyerSearchClaim(candidate: BuyerSearchClaim): Promise<BuyerSearchClaim> {
    const claim = BuyerSearchClaimSchema.parse(cloneRecord(candidate));
    buyerSearchClaimPath(claim.searchId);
    if (this.buyerSearchClaims.has(claim.searchId)) throw new RepositoryConflictError();
    this.buyerSearchClaims.set(claim.searchId, cloneRecord(claim));
    return BuyerSearchClaimSchema.parse(cloneRecord(claim));
  }

  async readBuyerSearchClaim(searchId: string): Promise<BuyerSearchClaim> {
    buyerSearchClaimPath(searchId);
    const stored = this.buyerSearchClaims.get(searchId);
    if (!stored) throw new RepositoryNotFoundError("Buyer-search claim was not found");
    const claim = parseStored(BuyerSearchClaimSchema, stored, "Stored buyer-search claim failed validation");
    if (claim.searchId !== searchId) throw new RepositoryDataError("Stored buyer-search claim does not match its path");
    return cloneRecord(claim);
  }

  async createBuyerSearchSelection(candidate: BuyerSearchSelectionRecord): Promise<BuyerSearchSelectionRecord> {
    const selection = BuyerSearchSelectionRecordSchema.parse(cloneRecord(candidate));
    buyerSearchSelectionPath(selection.searchId);
    const claim = this.buyerSearchClaims.get(selection.searchId);
    if (!claim) throw new RepositoryNotFoundError("Buyer-search claim was not found");
    if (claim.query !== selection.query) throw new TypeError("Buyer-search selection must match its immutable claim");
    if (this.buyerSearchSelections.has(selection.searchId)) throw new RepositoryConflictError();
    this.buyerSearchSelections.set(selection.searchId, cloneRecord(selection));
    return BuyerSearchSelectionRecordSchema.parse(cloneRecord(selection));
  }

  async readBuyerSearchSelection(searchId: string): Promise<BuyerSearchSelectionRecord> {
    buyerSearchSelectionPath(searchId);
    const stored = this.buyerSearchSelections.get(searchId);
    if (!stored) throw new RepositoryNotFoundError("Buyer-search selection was not found");
    const selection = parseStored(BuyerSearchSelectionRecordSchema, stored, "Stored buyer-search selection failed validation");
    if (selection.searchId !== searchId) throw new RepositoryDataError("Stored buyer-search selection does not match its path");
    const claim = this.buyerSearchClaims.get(searchId);
    if (!claim || claim.query !== selection.query) throw new RepositoryDataError("Stored buyer-search selection does not match its claim");
    return cloneRecord(selection);
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

  async createSeedListing(candidate: ActiveListing): Promise<MarketplaceListing> {
    const listing = ActiveListingSchema.parse(cloneRecord(candidate));
    if (listing.source !== "seed") throw new TypeError("createSeedListing accepts seed listings only");
    if (this.listings.has(listing.listingId)) throw new RepositoryConflictError();
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

  async createSoldComparable(candidate: SoldComparable): Promise<SoldComparable> {
    const comparable = SoldComparableSchema.parse(cloneRecord(candidate));
    soldComparablePath(comparable.comparableId);
    if (this.comparables.has(comparable.comparableId)) throw new RepositoryConflictError();
    if (this.comparables.size >= MAX_SOLD_COMPARABLES) {
      throw new RepositoryDataError("Sold comparable corpus exceeded its record limit");
    }
    this.comparables.set(comparable.comparableId, cloneRecord(comparable));
    return SoldComparableSchema.parse(cloneRecord(comparable));
  }

  async listSoldComparables(): Promise<SoldComparable[]> {
    if (this.comparables.size > MAX_SOLD_COMPARABLES) {
      throw new RepositoryDataError("Sold comparable corpus exceeded its record limit");
    }
    return [...this.comparables.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([comparableId, stored]) => {
        const comparable = parseStored(
          SoldComparableSchema,
          stored,
          "Stored sold comparable failed validation"
        );
        if (comparable.comparableId !== comparableId) {
          throw new RepositoryDataError("Stored sold comparable does not match its deterministic path");
        }
        return cloneRecord(comparable);
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
    if (!mediaReferencesEqual(content.metadata.media, media)) {
      throw new RepositoryDataError("Stored private media does not match its authoritative reference");
    }
    return cloneRecord(content.metadata);
  }

  async readPrivateMediaContent(candidate: MediaReference): Promise<PrivateMediaContent> {
    const media = MediaReferenceSchema.parse(cloneRecord(candidate));
    if (!this.media.has(media.pathname)) throw new RepositoryNotFoundError("Private media was not found");
    const stored = this.media.get(media.pathname);
    const content = parseStored(PrivateMediaContentSchema, stored, "Stored private media failed validation");
    if (!mediaReferencesEqual(content.metadata.media, media)) {
      throw new RepositoryDataError("Stored private media does not match its authoritative reference");
    }
    return cloneRecord(content);
  }

  async createPrivateMedia(candidate: MediaReference, source: Uint8Array, uploadedAt: string): Promise<PrivateMediaMetadata> {
    const media = MediaReferenceSchema.parse(cloneRecord(candidate));
    const content = PrivateMediaContentSchema.parse({
      metadata: { media, size: source.byteLength, uploadedAt },
      bytes: new Uint8Array(source),
    });
    if (this.media.has(media.pathname)) throw new RepositoryConflictError();
    this.media.set(media.pathname, cloneRecord(content));
    return PrivateMediaMetadataSchema.parse(cloneRecord(content.metadata));
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
