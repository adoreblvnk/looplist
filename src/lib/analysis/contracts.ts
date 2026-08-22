import { z } from "zod";
import {
  EditableAssumptionSchema,
  ListingAttributesSchema,
  ListingConditionSchema,
  MarketplaceCategorySchema,
  MediaReferenceSchema,
  PhotoEvidenceSchema,
  type MediaReference,
  type SoldComparable,
} from "../domain/marketplace";
import { UsdcAtomicAmountSchema } from "../domain/usdc";

const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const LabelSchema = z.string().trim().min(1).max(120);

export const AnalysisMediaInputSchema = z
  .array(MediaReferenceSchema)
  .min(3)
  .max(8)
  .superRefine((references, context) => {
    const ids = new Set<string>();
    const pathnames = new Set<string>();
    for (const [index, reference] of references.entries()) {
      if (ids.has(reference.id)) {
        context.addIssue({ code: "custom", path: [index, "id"], message: "Photo IDs must be unique" });
      }
      ids.add(reference.id);
      if (pathnames.has(reference.pathname)) {
        context.addIssue({ code: "custom", path: [index, "pathname"], message: "Photo pathnames must be unique" });
      }
      pathnames.add(reference.pathname);
    }
  });

export const GeminiListingCandidateSchema = z
  .object({
    title: z.string().trim().min(5).max(80),
    description: z.string().trim().min(20).max(3_000),
    category: MarketplaceCategorySchema,
    brand: LabelSchema,
    model: LabelSchema,
    condition: ListingConditionSchema,
    attributes: ListingAttributesSchema,
    includedAccessories: z.array(LabelSchema).max(20),
    visiblyMissingAccessories: z.array(LabelSchema).max(20),
    evidence: z.array(PhotoEvidenceSchema).min(1).max(32),
    assumptions: z.array(EditableAssumptionSchema).max(16),
  })
  .strict();
export type GeminiListingCandidate = z.infer<typeof GeminiListingCandidateSchema>;

const GemmaPriceCandidateObjectSchema = z
  .object({
    recommendedAtomicAmount: UsdcAtomicAmountSchema.refine((value) => value !== "0"),
    minimumAtomicAmount: UsdcAtomicAmountSchema.refine((value) => value !== "0"),
    maximumAtomicAmount: UsdcAtomicAmountSchema.refine((value) => value !== "0"),
    comparables: z
      .array(
        z
          .object({
            comparableId: IdentifierSchema,
            similarityScore: z.number().finite().min(0).max(1),
            similarityReason: z.string().trim().min(10).max(500),
          })
          .strict()
      )
      .min(1)
      .max(8),
    strongestComparableIds: z.array(IdentifierSchema).min(1).max(3),
    rationale: z.string().trim().min(20).max(1_500),
  })
  .strict();

const GEMMA_ATOMIC_AMOUNT_KEYS = [
  "recommendedAtomicAmount",
  "minimumAtomicAmount",
  "maximumAtomicAmount",
] as const;

export const GemmaPriceCandidateSchema = z.preprocess((value) => {
  const unwrapped = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (typeof unwrapped !== "object" || unwrapped === null || Array.isArray(unwrapped)) return unwrapped;
  const candidate: Record<string, unknown> = { ...unwrapped };
  for (const key of GEMMA_ATOMIC_AMOUNT_KEYS) {
    const amount = candidate[key];
    if (typeof amount === "number" && Number.isSafeInteger(amount)) {
      candidate[key] = String(amount);
    } else if (typeof amount === "string" && /^\d{1,3}(?:,\d{3})+$/.test(amount)) {
      candidate[key] = amount.replaceAll(",", "");
    }
  }
  return candidate;
}, GemmaPriceCandidateObjectSchema);
export type GemmaPriceCandidate = z.infer<typeof GemmaPriceCandidateSchema>;

export interface ListingGeneratorPhoto {
  media: MediaReference;
  uploadedAt: string;
  bytes: Uint8Array;
}

export interface ListingDraftGenerator {
  generate(input: { photos: ListingGeneratorPhoto[] }): Promise<unknown>;
}

export type PricingComparable = Omit<SoldComparable, "similarityScore" | "similarityReason">;

export const PricingDraftProjectionSchema = z.object({
  title: z.string().trim().min(5).max(80),
  description: z.string().trim().min(20).max(3_000),
  category: MarketplaceCategorySchema,
  brand: LabelSchema,
  model: LabelSchema,
  condition: ListingConditionSchema,
  attributes: ListingAttributesSchema,
  includedAccessories: z.array(LabelSchema).max(20),
  visiblyMissingAccessories: z.array(LabelSchema).max(20),
  evidence: z.array(PhotoEvidenceSchema.pick({ id: true, kind: true, claim: true, confidence: true })).min(1).max(32),
  assumptions: z.array(EditableAssumptionSchema.pick({ field: true, value: true, confidence: true })).max(16),
}).strict();
export type PricingDraftProjection = z.infer<typeof PricingDraftProjectionSchema>;

export interface PriceRecommendationGenerator {
  generate(input: { draft: PricingDraftProjection; soldComparables: PricingComparable[] }): Promise<unknown>;
}
