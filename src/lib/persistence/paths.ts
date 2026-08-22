import { z } from "zod";
import { MediaReferenceSchema, type MediaReference } from "../domain/marketplace";

const PathIdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Invalid persistence path identifier");

export const DurableRunKindSchema = z.enum(["analysis", "publication", "purchase"]);
export type DurableRunKind = z.infer<typeof DurableRunKindSchema>;
const MediaExtensionSchema = z.enum(["jpg", "jpeg", "png", "webp"]);

function id(value: string): string {
  return PathIdentifierSchema.parse(value);
}

export function publishedListingPath(listingId: string): string {
  return `records/listings/${id(listingId)}/published.json`;
}

export function soldComparablePath(comparableId: string): string {
  return `records/comparables/sold/${id(comparableId)}.json`;
}

export function durableRunPath(kind: DurableRunKind, runId: string): string {
  return `records/runs/${DurableRunKindSchema.parse(kind)}/${id(runId)}.json`;
}

export function analysisStartClaimPath(runId: string): string {
  return `records/runs/analysis-start/${id(runId)}/claim.json`;
}

export function analysisStartConfirmationPath(runId: string): string {
  return `records/runs/analysis-start/${id(runId)}/confirmation.json`;
}

export function settlementReceiptPath(purchaseId: string): string {
  const parsed = z
    .string()
    .min(10)
    .max(73)
    .regex(/^purchase:[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Invalid purchase ID")
    .parse(purchaseId);
  return `records/settlements/receipts/${parsed}.json`;
}

export function reconciliationRecordPath(purchaseId: string, reconciliationId: string): string {
  const receiptPath = settlementReceiptPath(purchaseId);
  const canonicalPurchaseId = receiptPath.slice(
    "records/settlements/receipts/".length,
    -".json".length
  );
  return `records/settlements/reconciliation/${canonicalPurchaseId}/${id(reconciliationId)}.json`;
}

export function seedMediaPath(listingId: string, mediaId: string, extension: "jpg" | "jpeg" | "png" | "webp"): string {
  return `media/seed/${id(listingId)}/${id(mediaId)}.${MediaExtensionSchema.parse(extension)}`;
}

export function uploadedMediaPath(uploadSessionId: string, mediaId: string, extension: "jpg" | "jpeg" | "png" | "webp"): string {
  return `media/uploads/${id(uploadSessionId)}/${id(mediaId)}.${MediaExtensionSchema.parse(extension)}`;
}

export function publicationRequestPath(runId: string): string {
  return `records/runs/publication-request/${id(runId)}.json`;
}

export function parsePrivateMediaReference(value: unknown): MediaReference {
  return MediaReferenceSchema.parse(value);
}

const CanonicalPathIdentifierPattern = "[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}";
const CanonicalPurchaseIdPattern = `purchase:${CanonicalPathIdentifierPattern}`;

export const PublishedListingPathSchema = z
  .string()
  .regex(
    new RegExp(`^records/listings/${CanonicalPathIdentifierPattern}/published\\.json$`),
    "Invalid immutable published listing path"
  );
export const SoldComparablePathSchema = z
  .string()
  .regex(
    new RegExp(`^records/comparables/sold/${CanonicalPathIdentifierPattern}\\.json$`),
    "Invalid immutable sold comparable path"
  );
export const DurableRunPathSchema = z
  .string()
  .regex(
    new RegExp(`^records/runs/(?:analysis|publication|purchase)/${CanonicalPathIdentifierPattern}\\.json$`),
    "Invalid durable run path"
  );
export const AnalysisStartClaimPathSchema = z.string().regex(
  new RegExp(`^records/runs/analysis-start/${CanonicalPathIdentifierPattern}/claim\\.json$`),
  "Invalid immutable analysis-start claim path"
);
export const AnalysisStartConfirmationPathSchema = z.string().regex(
  new RegExp(`^records/runs/analysis-start/${CanonicalPathIdentifierPattern}/confirmation\\.json$`),
  "Invalid immutable analysis-start confirmation path"
);
export const SettlementReceiptPathSchema = z
  .string()
  .regex(
    new RegExp(`^records/settlements/receipts/${CanonicalPurchaseIdPattern}\\.json$`),
    "Invalid immutable settlement receipt path"
  );
export const ReconciliationRecordPathSchema = z
  .string()
  .regex(
    new RegExp(
      `^records/settlements/reconciliation/${CanonicalPurchaseIdPattern}/${CanonicalPathIdentifierPattern}\\.json$`
    ),
    "Invalid reconciliation record path"
  );
