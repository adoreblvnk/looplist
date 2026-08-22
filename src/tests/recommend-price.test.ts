import { describe, expect, it, vi } from "vitest";
import {
  GemmaPriceCandidateSchema,
  type PriceRecommendationGenerator,
} from "../lib/analysis/contracts";
import { MAX_GEMMA_PRICING_INPUT_BYTES, recommendPrice } from "../lib/analysis/recommend-price";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { MAX_SOLD_COMPARABLES } from "../lib/persistence/repository";
import { SEED_SOLD_COMPARABLES } from "../lib/persistence/seed-marketplace";
import { comparable, validDraft } from "./domain-fixtures";

function priceCandidate(comparableId = comparable.comparableId) {
  return {
    recommendedAtomicAmount: "850000000",
    minimumAtomicAmount: "800000000",
    maximumAtomicAmount: "900000000",
    comparables: [
      {
        comparableId,
        similarityScore: 0.91,
        similarityReason: "The model and visible condition are strongly aligned.",
      },
    ],
    strongestComparableIds: [comparableId],
    rationale: "The selected immutable sold comparable supports the proposed bounded recommendation.",
  };
}

function comparableCorpus(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(comparable),
    comparableId: `bounded-comparable-${index}`,
  }));
}

describe("Gemma comparable pricing core", () => {
  it("fails closed on an empty repository corpus without invoking Gemma", async () => {
    const generate = vi.fn();
    await expect(
      recommendPrice(new InMemoryMarketplaceRepository(), { generate }, validDraft)
    ).rejects.toMatchObject({ code: "sold_comparable_corpus_empty" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("accepts the exact comparable limit and rejects limit plus one before Gemma", async () => {
    const exactCorpus = comparableCorpus(MAX_SOLD_COMPARABLES);
    const exactGenerate = vi.fn(async () => priceCandidate(exactCorpus[0].comparableId));
    await recommendPrice(
      new InMemoryMarketplaceRepository({ soldComparables: exactCorpus }),
      { generate: exactGenerate },
      validDraft
    );
    expect(exactGenerate).toHaveBeenCalledTimes(1);

    class OversizedCorpusRepository extends InMemoryMarketplaceRepository {
      override async listSoldComparables() { return comparableCorpus(MAX_SOLD_COMPARABLES + 1); }
    }
    const overflowGenerate = vi.fn();
    await expect(recommendPrice(new OversizedCorpusRepository(), { generate: overflowGenerate }, validDraft))
      .rejects.toMatchObject({ code: "sold_comparable_corpus_invalid" });
    expect(overflowGenerate).not.toHaveBeenCalled();
  });

  it("accepts the current seed corpus within the aggregate UTF-8 pricing-input bound", async () => {
    const generate = vi.fn(async (input: Parameters<PriceRecommendationGenerator["generate"]>[0]) => {
      expect(new TextEncoder().encode(JSON.stringify(input)).byteLength)
        .toBeLessThanOrEqual(MAX_GEMMA_PRICING_INPUT_BYTES);
      return priceCandidate(SEED_SOLD_COMPARABLES[0].comparableId);
    });
    await recommendPrice(
      new InMemoryMarketplaceRepository({ soldComparables: [...SEED_SOLD_COMPARABLES] }),
      { generate },
      validDraft
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects an over-budget valid corpus before invoking Gemma", async () => {
    const oversized = comparableCorpus(MAX_SOLD_COMPARABLES).map((record) => ({
      ...record,
      attributes: Object.fromEntries(
        Array.from({ length: 24 }, (_, index) => [`Attribute${index}`, "é".repeat(200)])
      ),
      includedAccessories: Array.from({ length: 20 }, () => "é".repeat(120)),
    }));
    const generate = vi.fn();
    await expect(recommendPrice(
      new InMemoryMarketplaceRepository({ soldComparables: oversized }),
      { generate },
      validDraft
    )).rejects.toMatchObject({ code: "sold_comparable_input_too_large" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("passes validated cloned draft and immutable corpus once, then hydrates authoritative facts", async () => {
    const corpus = { ...structuredClone(comparable), title: "Immutable sold title", similarityScore: 0.2 };
    const repository = new InMemoryMarketplaceRepository({ soldComparables: [corpus] });
    const generate = vi.fn(async (input) => {
      const serialized = JSON.stringify(input);
      for (const forbidden of ["pathname", "\"media\"", "\"width\"", "\"height\"", "\"bytes\""]) {
        expect(serialized).not.toContain(forbidden);
      }
      for (const reference of validDraft.media) expect(serialized).not.toContain(reference.pathname);
      expect(input.draft.evidence[0]).toEqual(expect.objectContaining({ id: validDraft.evidence[0].id, claim: validDraft.evidence[0].claim }));
      expect(input.draft.evidence[0]).not.toHaveProperty("photoId");
      input.draft.title = "Generator mutation";
      input.soldComparables[0].title = "Generator attempted fact mutation";
      return priceCandidate();
    });
    const result = await recommendPrice(repository, { generate }, validDraft);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.comparables[0]).toMatchObject({
      comparableId: corpus.comparableId,
      title: corpus.title,
      category: corpus.category,
      brand: corpus.brand,
      model: corpus.model,
      condition: corpus.condition,
      soldAt: corpus.soldAt,
      soldPrice: corpus.soldPrice,
      similarityScore: 0.91,
    });
    expect(result.recommendedPrice).toEqual({
      currency: "USDC",
      network: "eip155:84532",
      atomicAmount: "850000000",
    });
    expect(validDraft.title).not.toBe("Generator mutation");
    expect((await repository.listSoldComparables())[0].title).toBe(corpus.title);
  });

  it("hydrates seller-facing copy from canonical money without internal tokens", async () => {
    const repository = new InMemoryMarketplaceRepository({ soldComparables: [comparable] });
    const output = priceCandidate();
    output.rationale = `Use ${comparable.comparableId}: 800000000–900000000 USDC, with 850000000 USDC recommended for like_new.`;
    output.comparables[0].similarityReason = `${comparable.comparableId} is like_new and sold for 850,000,000 USDC.`;

    const result = await recommendPrice(repository, { generate: async () => output }, validDraft);
    const sellerCopy = [result.rationale, ...result.comparables.map((item) => item.similarityReason)].join(" ");

    expect(result.rationale).toContain(comparable.title);
    expect(result.rationale).toContain("800–900 USDC");
    expect(result.rationale).toContain("850 USDC");
    expect(result.comparables[0].similarityReason).toContain("Like new");
    expect(sellerCopy).not.toContain(comparable.comparableId);
    expect(sellerCopy).not.toContain("like_new");
    expect(sellerCopy).not.toMatch(/(?:800|850|900)[,.]?000[,.]?000/);
  });

  it("rejects candidates that echo facts or include unknown or duplicate selected IDs", async () => {
    expect(GemmaPriceCandidateSchema.safeParse({
      ...priceCandidate(),
      comparables: [{ ...priceCandidate().comparables[0], title: "Fact override" }],
    }).success).toBe(false);

    const repository = new InMemoryMarketplaceRepository({ soldComparables: [comparable] });
    await expect(
      recommendPrice(repository, { generate: async () => priceCandidate("unknown-comparable") }, validDraft)
    ).rejects.toMatchObject({ code: "price_candidate_unknown_comparable" });
    const duplicate = priceCandidate();
    duplicate.comparables.push(structuredClone(duplicate.comparables[0]));
    await expect(
      recommendPrice(repository, { generate: async () => duplicate }, validDraft)
    ).rejects.toMatchObject({ code: "price_candidate_duplicate_comparable" });
  });

  it("rejects invalid atomic amounts, inverted ranges, and invalid strongest comparable IDs", async () => {
    const repository = new InMemoryMarketplaceRepository({ soldComparables: [comparable] });
    const invalid = [
      { ...priceCandidate(), recommendedAtomicAmount: "1.5" },
      { ...priceCandidate(), minimumAtomicAmount: "900000000", maximumAtomicAmount: "800000000" },
      { ...priceCandidate(), strongestComparableIds: ["unknown-comparable"] },
      { ...priceCandidate(), strongestComparableIds: [comparable.comparableId, comparable.comparableId] },
      { ...priceCandidate(), comparables: [{ ...priceCandidate().comparables[0], similarityScore: 1.1 }] },
    ];
    for (const output of invalid) {
      await expect(
        recommendPrice(repository, { generate: async () => output }, validDraft)
      ).rejects.toThrow();
    }
  });
});
