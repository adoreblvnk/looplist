import { z } from "zod";
import {
  ConfidenceLabelSchema,
  ListingConditionSchema,
  MarketplaceCategorySchema,
} from "./marketplace";
import { UsdcAtomicAmountSchema } from "./usdc";

const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const TimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  });
const SearchTermSchema = z.string().trim().min(1).max(60);

export const BuyerSearchRequestSchema = z
  .object({ query: z.string().trim().min(3).max(500) })
  .strict();
export type BuyerSearchRequest = z.infer<typeof BuyerSearchRequestSchema>;

export const BuyerSearchInterpretedConstraintsSchema = z
  .object({
    categories: z.array(MarketplaceCategorySchema).max(3),
    maximumAtomicAmount: UsdcAtomicAmountSchema.nullable(),
    acceptableConditions: z.array(ListingConditionSchema).max(6),
    requiredTerms: z.array(SearchTermSchema).max(8),
    excludedDefectTerms: z.array(SearchTermSchema).max(8),
  })
  .strict()
  .superRefine((constraints, context) => {
    for (const [field, values] of Object.entries({
      categories: constraints.categories,
      acceptableConditions: constraints.acceptableConditions,
      requiredTerms: constraints.requiredTerms.map((term) => term.toLocaleLowerCase("en")),
      excludedDefectTerms: constraints.excludedDefectTerms.map((term) => term.toLocaleLowerCase("en")),
    })) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [field], message: `${field} must be unique` });
      }
    }
  });
export type BuyerSearchInterpretedConstraints = z.infer<
  typeof BuyerSearchInterpretedConstraintsSchema
>;

const EvidenceSelectionSchema = z
  .object({
    evidenceId: IdentifierSchema,
    claim: z.string().trim().min(3).max(500),
    confidence: ConfidenceLabelSchema,
  })
  .strict();

const AssumptionSelectionSchema = z
  .object({
    assumptionId: IdentifierSchema,
    field: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(500),
    confidence: ConfidenceLabelSchema,
  })
  .strict();

export const GemmaBuyerMatchCandidateSchema = z
  .object({
    listingId: IdentifierSchema,
    score: z.number().finite().min(0).max(1),
    fitExplanation: z.string().trim().min(10).max(360),
    evidenceIds: z.array(IdentifierSchema).max(8),
    assumptionIds: z.array(IdentifierSchema).max(8),
  })
  .strict()
  .superRefine((match, context) => {
    if (new Set(match.evidenceIds).size !== match.evidenceIds.length) {
      context.addIssue({ code: "custom", path: ["evidenceIds"], message: "Evidence IDs must be unique" });
    }
    if (new Set(match.assumptionIds).size !== match.assumptionIds.length) {
      context.addIssue({ code: "custom", path: ["assumptionIds"], message: "Assumption IDs must be unique" });
    }
  });
export type GemmaBuyerMatchCandidate = z.infer<typeof GemmaBuyerMatchCandidateSchema>;

export const GemmaBuyerSearchCandidateSchema = z
  .object({
    interpretedConstraints: BuyerSearchInterpretedConstraintsSchema,
    matches: z.array(GemmaBuyerMatchCandidateSchema).max(10),
  })
  .strict()
  .superRefine((candidate, context) => {
    const listingIds = new Set<string>();
    candidate.matches.forEach((match, index) => {
      if (listingIds.has(match.listingId)) {
        context.addIssue({
          code: "custom",
          path: ["matches", index, "listingId"],
          message: "Listing IDs must be unique",
        });
      }
      listingIds.add(match.listingId);
    });
  });
export type GemmaBuyerSearchCandidate = z.infer<typeof GemmaBuyerSearchCandidateSchema>;

export const BuyerSearchClaimSchema = z
  .object({
    searchId: IdentifierSchema,
    query: BuyerSearchRequestSchema.shape.query,
    requestedAt: TimestampSchema,
  })
  .strict();
export type BuyerSearchClaim = z.infer<typeof BuyerSearchClaimSchema>;

export const BuyerSearchSelectionRecordSchema = z
  .object({
    searchId: IdentifierSchema,
    query: BuyerSearchRequestSchema.shape.query,
    interpretedConstraints: BuyerSearchInterpretedConstraintsSchema,
    matches: z.array(GemmaBuyerMatchCandidateSchema).max(10),
    generatedAt: TimestampSchema,
  })
  .strict();
export type BuyerSearchSelectionRecord = z.infer<typeof BuyerSearchSelectionRecordSchema>;

export const BuyerSearchEvidenceSchema = EvidenceSelectionSchema;
export const BuyerSearchAssumptionSchema = AssumptionSelectionSchema;
