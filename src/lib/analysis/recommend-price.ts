import {
  ListingDraftSchema,
  PriceRecommendationSchema,
  SoldComparableSchema,
  type ListingDraft,
  type PriceRecommendation,
  type SoldComparable,
} from "../domain/marketplace";
import { MAX_SOLD_COMPARABLES, type MarketplaceRepository } from "../persistence/repository";
import {
  GemmaPriceCandidateSchema,
  type PriceRecommendationGenerator,
  type PricingComparable,
} from "./contracts";
import { AnalysisCoreError } from "./generate-listing-draft";

/** Maximum serialized UTF-8 bytes passed to the Gemma pricing adapter. */
export const MAX_GEMMA_PRICING_INPUT_BYTES = 64 * 1024;

const fixedMoney = (atomicAmount: string) => ({
  currency: "USDC" as const,
  network: "eip155:84532" as const,
  atomicAmount,
});

function pricingComparable(comparable: SoldComparable): PricingComparable {
  return {
    comparableId: comparable.comparableId,
    title: comparable.title,
    category: comparable.category,
    brand: comparable.brand,
    model: comparable.model,
    condition: comparable.condition,
    attributes: structuredClone(comparable.attributes),
    includedAccessories: structuredClone(comparable.includedAccessories),
    soldPrice: structuredClone(comparable.soldPrice),
    soldAt: comparable.soldAt,
  };
}

export async function recommendPrice(
  repository: MarketplaceRepository,
  generator: PriceRecommendationGenerator,
  input: ListingDraft
): Promise<PriceRecommendation> {
  const draft = ListingDraftSchema.parse(structuredClone(input));
  const storedCorpus = structuredClone(await repository.listSoldComparables());
  if (storedCorpus.length > MAX_SOLD_COMPARABLES) {
    throw new AnalysisCoreError("sold_comparable_corpus_invalid", "Sold comparable corpus exceeded its record limit");
  }
  const corpus = SoldComparableSchema.array().max(MAX_SOLD_COMPARABLES).parse(storedCorpus);
  if (corpus.length === 0) {
    throw new AnalysisCoreError(
      "sold_comparable_corpus_empty",
      "Sold comparable corpus is empty"
    );
  }

  const corpusById = new Map<string, SoldComparable>();
  for (const comparable of corpus) {
    if (corpusById.has(comparable.comparableId)) {
      throw new AnalysisCoreError(
        "sold_comparable_corpus_invalid",
        "Sold comparable corpus contains duplicate IDs"
      );
    }
    corpusById.set(comparable.comparableId, comparable);
  }

  const generatorInput = {
    draft: structuredClone(draft),
    soldComparables: corpus.map(pricingComparable),
  };
  const inputBytes = new TextEncoder().encode(JSON.stringify(generatorInput)).byteLength;
  if (inputBytes > MAX_GEMMA_PRICING_INPUT_BYTES) {
    throw new AnalysisCoreError(
      "sold_comparable_input_too_large",
      "Sold comparable pricing input exceeded its byte limit"
    );
  }

  const candidate = GemmaPriceCandidateSchema.parse(
    await generator.generate(structuredClone(generatorInput))
  );
  const selectedIds = new Set<string>();
  const comparables = candidate.comparables.map((selection) => {
    if (selectedIds.has(selection.comparableId)) {
      throw new AnalysisCoreError(
        "price_candidate_duplicate_comparable",
        "Price candidate selected a comparable more than once"
      );
    }
    selectedIds.add(selection.comparableId);
    const authoritative = corpusById.get(selection.comparableId);
    if (!authoritative) {
      throw new AnalysisCoreError(
        "price_candidate_unknown_comparable",
        "Price candidate selected an unknown comparable"
      );
    }
    return SoldComparableSchema.parse({
      ...structuredClone(authoritative),
      similarityScore: selection.similarityScore,
      similarityReason: selection.similarityReason,
    });
  });

  return PriceRecommendationSchema.parse({
    recommendedPrice: fixedMoney(candidate.recommendedAtomicAmount),
    minimumPrice: fixedMoney(candidate.minimumAtomicAmount),
    maximumPrice: fixedMoney(candidate.maximumAtomicAmount),
    comparables,
    strongestComparableIds: structuredClone(candidate.strongestComparableIds),
    rationale: candidate.rationale,
  });
}
