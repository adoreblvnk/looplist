import { z } from "zod";
import {
  ConfidenceLabelSchema,
  ListingAttributesSchema,
  ListingConditionSchema,
  MarketplaceCategorySchema,
  MoneySchema,
} from "../domain/marketplace";
import { GemmaBuyerSearchCandidateSchema } from "../domain/buyer-search";

const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const BuyerSearchListingProjectionSchema = z
  .object({
    listingId: IdentifierSchema,
    title: z.string().trim().min(5).max(80),
    category: MarketplaceCategorySchema,
    brand: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    condition: ListingConditionSchema,
    price: MoneySchema,
    attributes: ListingAttributesSchema,
    includedAccessories: z.array(z.string().trim().min(1).max(120)).max(20),
    visibleDefects: z.array(z.string().trim().min(3).max(500)).max(12),
    evidence: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            kind: z.enum(["identity", "accessory", "condition", "defect"]),
            claim: z.string().trim().min(3).max(500),
            confidence: ConfidenceLabelSchema,
          })
          .strict()
      )
      .max(32),
    assumptions: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            field: z.string().trim().min(1).max(80),
            value: z.string().trim().min(1).max(500),
            confidence: ConfidenceLabelSchema,
          })
          .strict()
      )
      .max(16),
  })
  .strict();
export type BuyerSearchListingProjection = z.infer<typeof BuyerSearchListingProjectionSchema>;

export { GemmaBuyerSearchCandidateSchema };

export interface BuyerSearchGenerator {
  generate(input: {
    query: string;
    listings: BuyerSearchListingProjection[];
  }): Promise<unknown>;
}
