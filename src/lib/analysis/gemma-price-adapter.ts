import "server-only";
import { GemmaPriceCandidateSchema, PricingDraftProjectionSchema, type PriceRecommendationGenerator } from "./contracts";
import { GEMMA_PRICING_MODEL_ID } from "./google-models";
import { generateGoogleObject, type StructuredGeneration } from "./google-structured-generation";

export const GEMMA_PRICING_INSTRUCTIONS = `Return exactly the requested price candidate schema using only the authoritative listing projection and sold-comparable projection supplied below. Do not use tools, network access, external comparables, or unstated facts. Select only supplied comparable IDs. Explain each selected comparable's fit by product/model, condition, attributes, and included accessories. Recommend exact atomic USDC amounts for the recommendation, minimum, and maximum, with minimum <= recommendation <= maximum. Explain the strongest matches and pricing range. Do not include or infer seller secrets, wallet addresses, or personal data.`;

export class GemmaPriceRecommendationGenerator implements PriceRecommendationGenerator {
  constructor(private readonly generateObject: StructuredGeneration = generateGoogleObject) {}

  async generate(input: Parameters<PriceRecommendationGenerator["generate"]>[0]): Promise<unknown> {
    const compactInput = {
      draft: PricingDraftProjectionSchema.parse(structuredClone(input.draft)),
      soldComparables: structuredClone(input.soldComparables),
    };
    return this.generateObject({
      modelId: GEMMA_PRICING_MODEL_ID,
      schema: GemmaPriceCandidateSchema,
      messages: [{
        role: "user",
        content: `${GEMMA_PRICING_INSTRUCTIONS}\n\nAuthoritative input JSON:\n${JSON.stringify(compactInput)}`,
      }],
    });
  }
}
