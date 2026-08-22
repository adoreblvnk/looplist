import { z } from "zod";
import {
  BuyerSearchClaimSchema,
  BuyerSearchSelectionRecordSchema,
  type BuyerSearchClaim,
  type BuyerSearchSelectionRecord,
} from "../domain/buyer-search";
import {
  ActiveListingSchema,
  AnalysisRunStateSchema,
  ListingDraftSchema,
  MediaReferenceSchema,
  MoneySchema,
  PublicationRunStateSchema,
  PurchaseRunStateSchema,
  ReconciliationFailureSchema,
  SettlementReceiptSchema,
  SoldComparableSchema,
  type ActiveListing,
  type AnalysisRunState,
  type MediaReference,
  type PublicationRunState,
  type PurchaseRunState,
  type ReconciliationFailure,
  type SettlementReceipt,
  type SoldComparable,
} from "../domain/marketplace";
import { scaleDemoUsdcAmount } from "../domain/usdc";

export const MAX_SOLD_COMPARABLES = 100;

export const DurableRunSnapshotSchema = z.union([
  AnalysisRunStateSchema,
  PublicationRunStateSchema,
  PurchaseRunStateSchema,
]);
export type DurableRunSnapshot = z.infer<typeof DurableRunSnapshotSchema>;
export type QueuedAnalysisRun = Extract<AnalysisRunState, { status: "queued" }>;
export type QueuedPurchaseRun = Extract<PurchaseRunState, { status: "queued" }>;

export const PublicationRequestRecordSchema = z.object({
  runId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  listingId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  analysisRunId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  network: z.literal("eip155:84532"),
  sellerApproved: z.literal(true),
  approvedDraft: ListingDraftSchema,
  approvedPrice: MoneySchema,
  requestedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
}).strict().superRefine((request, context) => {
  if (request.approvedPrice.network !== request.network) {
    context.addIssue({ code: "custom", path: ["network"], message: "Publication network must match the approved price network" });
  }
});
export type PublicationRequestRecord = z.infer<typeof PublicationRequestRecordSchema>;

export const MarketplaceListingSchema = z
  .object({
    listing: ActiveListingSchema,
    visibility: z.enum(["active", "sold"]),
    receiptId: z.string().nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.visibility === "active" && record.receiptId !== null) {
      context.addIssue({ code: "custom", path: ["receiptId"], message: "Active listing cannot have a receipt" });
    }
    if (record.visibility === "sold" && record.receiptId === null) {
      context.addIssue({ code: "custom", path: ["receiptId"], message: "Sold listing requires a receipt" });
    }
  });
export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>;

export const PrivateMediaMetadataSchema = z
  .object({
    media: MediaReferenceSchema,
    size: z.number().int().nonnegative().max(20 * 1024 * 1024),
    uploadedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  })
  .strict();
export type PrivateMediaMetadata = z.infer<typeof PrivateMediaMetadataSchema>;

export const PrivateMediaContentSchema = z
  .object({
    metadata: PrivateMediaMetadataSchema,
    bytes: z.instanceof(Uint8Array),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.bytes.byteLength !== content.metadata.size) {
      context.addIssue({ code: "custom", path: ["bytes"], message: "Media byte length must match metadata" });
    }
  });
export type PrivateMediaContent = z.infer<typeof PrivateMediaContentSchema>;

export const AnalysisStartClaimSchema = z.object({
  runId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  media: z.array(MediaReferenceSchema).min(3).max(8),
  claimedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
}).strict();
export type AnalysisStartClaim = z.infer<typeof AnalysisStartClaimSchema>;

export const AnalysisStartConfirmationSchema = z.object({
  runId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  workflowRunId: z.string().trim().min(1).max(256),
  confirmedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
}).strict();
export type AnalysisStartConfirmation = z.infer<typeof AnalysisStartConfirmationSchema>;

export class RepositoryConflictError extends Error {
  readonly code = "repository_conflict";
  constructor(message = "An immutable repository record already exists") {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

export class RepositoryNotFoundError extends Error {
  readonly code = "repository_not_found";
  constructor(message = "Repository record was not found") {
    super(message);
    this.name = "RepositoryNotFoundError";
  }
}

export class RepositoryDataError extends Error {
  readonly code = "repository_data_invalid";
  constructor(message = "Stored repository data failed validation") {
    super(message);
    this.name = "RepositoryDataError";
  }
}

export class RepositoryUnavailableError extends Error {
  readonly code = "repository_unavailable";
  constructor(message = "Private persistence is unavailable") {
    super(message);
    this.name = "RepositoryUnavailableError";
  }
}

export const RECEIPT_LISTING_INVARIANT_MESSAGE =
  "Receipt does not match the immutable published active listing snapshot";

function receiptMatchesPublishedActiveListing(
  receipt: SettlementReceipt,
  listing: ActiveListing
): boolean {
  return (
    receipt.listingId === listing.listingId &&
    receipt.listingTitle === listing.approvedDraft.title &&
    receipt.seller.id === listing.seller.id &&
    receipt.seller.displayName === listing.seller.displayName &&
    receipt.seller.role === listing.seller.role &&
    receipt.seller.fictional === listing.seller.fictional &&
    receipt.recipientAddress === listing.recipientAddress &&
    receipt.amount.currency === listing.approvedPrice.currency &&
    receipt.amount.network === listing.approvedPrice.network &&
    receipt.amount.atomicAmount === listing.approvedPrice.atomicAmount
  );
}

export function assertReceiptMatchesPublishedActiveListing(
  receipt: SettlementReceipt,
  listing: ActiveListing,
  boundary: "input" | "stored"
): void {
  if (receiptMatchesPublishedActiveListing(receipt, listing)) return;
  if (boundary === "stored") {
    throw new RepositoryDataError(RECEIPT_LISTING_INVARIANT_MESSAGE);
  }
  throw new TypeError(RECEIPT_LISTING_INVARIANT_MESSAGE);
}

export interface MarketplaceRepository {
  /**
   * Immutable creation boundary for the exact validated queued analysis snapshot.
   * This prevents concurrent first writers from replacing the initial media binding.
   * Later sole-writer transitions use saveRunSnapshot; no general CAS is provided.
   */
  createAnalysisRun(run: QueuedAnalysisRun): Promise<QueuedAnalysisRun>;
  /** Immutable create-winner for a listing's sole purchase workflow. This is not CAS. */
  createPurchaseRun(run: QueuedPurchaseRun): Promise<QueuedPurchaseRun>;
  createAnalysisStartClaim(claim: AnalysisStartClaim): Promise<AnalysisStartClaim>;
  readAnalysisStartClaim(runId: string): Promise<AnalysisStartClaim>;
  createAnalysisStartConfirmation(confirmation: AnalysisStartConfirmation): Promise<AnalysisStartConfirmation>;
  readAnalysisStartConfirmation(runId: string): Promise<AnalysisStartConfirmation>;
  createPublicationRequest(request: PublicationRequestRecord): Promise<PublicationRequestRecord>;
  readPublicationRequest(runId: string): Promise<PublicationRequestRecord>;
  createBuyerSearchClaim(claim: BuyerSearchClaim): Promise<BuyerSearchClaim>;
  readBuyerSearchClaim(searchId: string): Promise<BuyerSearchClaim>;
  createBuyerSearchSelection(selection: BuyerSearchSelectionRecord): Promise<BuyerSearchSelectionRecord>;
  readBuyerSearchSelection(searchId: string): Promise<BuyerSearchSelectionRecord>;
  publishSellerListing(listing: ActiveListing): Promise<MarketplaceListing>;
  createSeedListing(listing: ActiveListing): Promise<MarketplaceListing>;
  getListing(listingId: string): Promise<MarketplaceListing>;
  listMarketplaceListings(): Promise<MarketplaceListing[]>;
  /**
   * Immutable bounded create. Production adapters use a single-writer capacity preflight;
   * the repository contract does not provide an atomic capacity check or CAS guarantee.
   */
  createSoldComparable(comparable: SoldComparable): Promise<SoldComparable>;
  listSoldComparables(): Promise<SoldComparable[]>;
  /**
   * Unconditionally replaces the snapshot at the run's deterministic path.
   * This is last-writer-wins persistence, not a monotonic update or CAS guarantee;
   * callers and workflows that can write the same run must serialize their writes.
   */
  saveRunSnapshot(run: DurableRunSnapshot): Promise<DurableRunSnapshot>;
  readRunSnapshot(kind: DurableRunSnapshot["kind"], runId: string): Promise<DurableRunSnapshot>;
  createSettlementReceipt(receipt: SettlementReceipt): Promise<SettlementReceipt>;
  readSettlementReceipt(purchaseId: string): Promise<SettlementReceipt>;
  createReconciliationRecord(reconciliationId: string, failure: ReconciliationFailure): Promise<ReconciliationFailure>;
  readReconciliationRecord(purchaseId: string, reconciliationId: string): Promise<ReconciliationFailure>;
  readPrivateMediaMetadata(media: MediaReference): Promise<PrivateMediaMetadata>;
  readPrivateMediaContent(media: MediaReference): Promise<PrivateMediaContent>;
  createPrivateMedia(media: MediaReference, bytes: Uint8Array, uploadedAt: string): Promise<PrivateMediaMetadata>;
}

export function parseActiveListing(value: unknown): ActiveListing {
  return ActiveListingSchema.parse(value);
}
const ONE_USDC_ATOMIC = BigInt(1_000_000);
export const DEMO_PRICE_SCALE_CUTOVER = "2026-08-22T03:25:00.000Z";

/** Normalizes seed records and pre-cutover seller demos without rewriting immutable Blob objects. */
export function normalizeDemoListingPrice(listing: ActiveListing): ActiveListing {
  const isLegacySellerDemo = listing.source === "seller" &&
    listing.listingId.startsWith("listing_") &&
    Date.parse(listing.publishedAt) < Date.parse(DEMO_PRICE_SCALE_CUTOVER);
  if ((listing.source !== "seed" && !isLegacySellerDemo) ||
      BigInt(listing.approvedPrice.atomicAmount) < ONE_USDC_ATOMIC) {
    return ActiveListingSchema.parse(structuredClone(listing));
  }
  return ActiveListingSchema.parse({
    ...structuredClone(listing),
    approvedPrice: {
      ...listing.approvedPrice,
      atomicAmount: scaleDemoUsdcAmount(listing.approvedPrice.atomicAmount),
    },
  });
}

/** Normalizes sold comparables provisioned before demo prices were scaled by 1:1,000. */
export function normalizeSeedComparablePrice(comparable: SoldComparable): SoldComparable {
  if (!comparable.comparableId.startsWith("sold-") ||
      BigInt(comparable.soldPrice.atomicAmount) < ONE_USDC_ATOMIC) {
    return SoldComparableSchema.parse(structuredClone(comparable));
  }
  return SoldComparableSchema.parse({
    ...structuredClone(comparable),
    soldPrice: {
      ...comparable.soldPrice,
      atomicAmount: scaleDemoUsdcAmount(comparable.soldPrice.atomicAmount),
    },
  });
}

export function bindSeedListingRecipient(listing: ActiveListing, recipientAddress: string): ActiveListing {
  if (listing.source !== "seed") throw new TypeError("Only seed listings can use a configured seed recipient");
  return ActiveListingSchema.parse({
    ...normalizeDemoListingPrice(listing),
    recipientAddress,
  });
}
export function parseRunSnapshot(value: unknown): DurableRunSnapshot {
  return DurableRunSnapshotSchema.parse(value);
}
export function parseSettlementReceipt(value: unknown): SettlementReceipt {
  return SettlementReceiptSchema.parse(value);
}
export function parseSoldComparable(value: unknown): SoldComparable {
  return SoldComparableSchema.parse(value);
}
export function parseReconciliationFailure(value: unknown): ReconciliationFailure {
  return ReconciliationFailureSchema.parse(value);
}
export function parseBuyerSearchClaim(value: unknown): BuyerSearchClaim {
  return BuyerSearchClaimSchema.parse(value);
}
export function parseBuyerSearchSelection(value: unknown): BuyerSearchSelectionRecord {
  return BuyerSearchSelectionRecordSchema.parse(value);
}
export function parseMediaReference(value: unknown): MediaReference {
  return MediaReferenceSchema.parse(value);
}

export type { AnalysisRunState, PublicationRunState, PurchaseRunState };
