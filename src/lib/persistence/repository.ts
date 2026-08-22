import { z } from "zod";
import {
  ActiveListingSchema,
  AnalysisRunStateSchema,
  MediaReferenceSchema,
  PublicationRunStateSchema,
  PurchaseRunStateSchema,
  ReconciliationFailureSchema,
  SettlementReceiptSchema,
  type ActiveListing,
  type AnalysisRunState,
  type MediaReference,
  type PublicationRunState,
  type PurchaseRunState,
  type ReconciliationFailure,
  type SettlementReceipt,
} from "../domain/marketplace";

export const DurableRunSnapshotSchema = z.union([
  AnalysisRunStateSchema,
  PublicationRunStateSchema,
  PurchaseRunStateSchema,
]);
export type DurableRunSnapshot = z.infer<typeof DurableRunSnapshotSchema>;

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
  publishSellerListing(listing: ActiveListing): Promise<MarketplaceListing>;
  getListing(listingId: string): Promise<MarketplaceListing>;
  listMarketplaceListings(): Promise<MarketplaceListing[]>;
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
}

export function parseActiveListing(value: unknown): ActiveListing {
  return ActiveListingSchema.parse(value);
}
export function parseRunSnapshot(value: unknown): DurableRunSnapshot {
  return DurableRunSnapshotSchema.parse(value);
}
export function parseSettlementReceipt(value: unknown): SettlementReceipt {
  return SettlementReceiptSchema.parse(value);
}
export function parseReconciliationFailure(value: unknown): ReconciliationFailure {
  return ReconciliationFailureSchema.parse(value);
}
export function parseMediaReference(value: unknown): MediaReference {
  return MediaReferenceSchema.parse(value);
}

export type { AnalysisRunState, PublicationRunState, PurchaseRunState };
