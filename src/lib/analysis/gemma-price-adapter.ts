import "server-only";
import { GemmaPriceCandidateSchema, PricingDraftProjectionSchema, type PriceRecommendationGenerator } from "./contracts";
import { GEMMA_PRICING_MODEL_ID } from "./google-models";
import { generateGoogleObject, type StructuredGeneration } from "./google-structured-generation";

export const GEMMA_PRICING_INSTRUCTIONS = `Return only one JSON object with exactly these six top-level keys and no markdown or array wrapper: recommendedAtomicAmount (positive integer string), minimumAtomicAmount (positive integer string), maximumAtomicAmount (positive integer string), comparables (array of objects containing comparableId string, similarityScore number from 0 to 1, and similarityReason string), strongestComparableIds (array of comparableId strings), and rationale (string). Atomic amount strings must contain digits only, with no commas, spaces, decimal points, or currency labels. Use only the authoritative listing projection and sold-comparable projection supplied below. Do not use tools, network access, external comparables, or unstated facts. Select only supplied comparable IDs. Every strongestComparableId must also occur in comparables. Explain each selected comparable's fit by product/model, condition, attributes, and included accessories. Recommend exact atomic USDC amounts for the recommendation, minimum, and maximum, with minimum <= recommendation <= maximum. Explain the strongest matches and pricing range. Do not include or infer seller secrets, wallet addresses, or personal data.`;

export const GEMMA_PRICING_SETTINGS = {
  temperature: 0.2,
  topP: 0.9,
  topK: 32,
  providerOptions: {
    google: {
      structuredOutputs: false,
      thinkingConfig: { thinkingLevel: "minimal" as const },
    },
  },
} as const;

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
      settings: GEMMA_PRICING_SETTINGS,
    });
  }
}
