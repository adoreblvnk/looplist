import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiListingCandidateSchema, GemmaPriceCandidateSchema } from "../lib/analysis/contracts";
import { GeminiListingDraftGenerator, GEMINI_LISTING_INSTRUCTIONS } from "../lib/analysis/gemini-listing-adapter";
import { GemmaPriceRecommendationGenerator, GEMMA_PRICING_INSTRUCTIONS, GEMMA_PRICING_SETTINGS } from "../lib/analysis/gemma-price-adapter";
import {
  createGoogleStructuredGeneration,
  GOOGLE_GENERATION_TIMEOUT_MS,
  GOOGLE_MAX_OUTPUT_TOKENS,
  type StructuredGeneration,
  type StructuredGenerationRequest,
} from "../lib/analysis/google-structured-generation";
import { GEMINI_LISTING_MODEL_ID, GEMMA_PRICING_MODEL_ID } from "../lib/analysis/google-models";
import {
  GEMMA_BUYER_SEARCH_SETTINGS,
  GemmaBuyerSearchGenerationSchema,
  GemmaBuyerSearchGenerator,
} from "../lib/analysis/gemma-buyer-search-adapter";
import { pricingDraftProjection } from "../lib/analysis/recommend-price";
import { validDraft, comparable } from "./domain-fixtures";

vi.mock("server-only", () => ({}));

beforeEach(() => { process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key"; });

describe("live Google model adapters", () => {
  it("sends adjacent photo IDs and canonical AI SDK file data to the pinned Gemini model", async () => {
    let captured: StructuredGenerationRequest<unknown> | undefined;
    const generate: StructuredGeneration = async <T>(request: StructuredGenerationRequest<T>) => {
      captured = request;
      return {} as T;
    };
    const photos = validDraft.media.map((media, index) => ({ media, uploadedAt: "2026-08-21T10:00:00.000Z", bytes: new Uint8Array([index + 1, 9]) }));
    await new GeminiListingDraftGenerator(generate).generate({ photos });
    const request = captured!;
    expect(request.modelId).toBe(GEMINI_LISTING_MODEL_ID);
    expect(request.schema).toBe(GeminiListingCandidateSchema);
    const content = request.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error("Expected multimodal content parts");
    expect(content[0]).toMatchObject({ type: "text", text: expect.stringContaining(GEMINI_LISTING_INSTRUCTIONS) });
    for (const [index, photo] of photos.entries()) {
      expect(content[index * 2 + 1]).toEqual({ type: "text", text: `Supplied photo ID: ${photo.media.id}` });
      expect(content[index * 2 + 2]).toEqual({ type: "file", mediaType: photo.media.mimeType, data: { type: "data", data: photo.bytes } });
    }
    expect(JSON.stringify(content)).not.toContain("pathname");
    expect(JSON.stringify(content)).not.toContain("recommendedPrice");
    expect(GEMINI_LISTING_INSTRUCTIONS).toMatch(/visible|visually/);
    expect(GEMINI_LISTING_INSTRUCTIONS).toContain("Never provide prices or comparables");
    expect(GEMINI_LISTING_INSTRUCTIONS).toContain("electronics");
    expect(GEMINI_LISTING_INSTRUCTIONS).toContain("running_shoes");
    expect(GEMINI_LISTING_INSTRUCTIONS).toContain("sneakers");
    expect(GEMINI_LISTING_INSTRUCTIONS).toContain("lifestyle sneakers");
  });

  it("sends only the compact authoritative input to the pinned Gemma model", async () => {
    let captured: StructuredGenerationRequest<unknown> | undefined;
    const generate: StructuredGeneration = async <T>(request: StructuredGenerationRequest<T>) => {
      captured = request;
      return {} as T;
    };
    const soldComparable = {
      comparableId: comparable.comparableId,
      title: comparable.title,
      category: comparable.category,
      brand: comparable.brand,
      model: comparable.model,
      condition: comparable.condition,
      attributes: comparable.attributes,
      includedAccessories: comparable.includedAccessories,
      soldPrice: comparable.soldPrice,
      soldAt: comparable.soldAt,
    };
    await new GemmaPriceRecommendationGenerator(generate).generate({ draft: pricingDraftProjection(validDraft), soldComparables: [soldComparable] });
    const request = captured!;
    expect(request.modelId).toBe(GEMMA_PRICING_MODEL_ID);
    expect(request.schema).toBe(GemmaPriceCandidateSchema);
    expect(request.settings).toEqual(GEMMA_PRICING_SETTINGS);
    expect(request.messages[0].content).toContain(GEMMA_PRICING_INSTRUCTIONS);
    expect(request.messages[0].content).toContain(comparable.comparableId);
    expect(request.messages[0].content).not.toContain("sellerAddress");
    const serializedPrompt = String(request.messages[0].content);
    for (const forbidden of ["pathname", "\"media\"", "\"width\"", "\"height\"", "\"bytes\"", "identity"]) {
      expect(serializedPrompt).not.toContain(forbidden);
    }
    for (const reference of validDraft.media) expect(serializedPrompt).not.toContain(reference.pathname);
    expect(GEMMA_PRICING_INSTRUCTIONS).toContain("Do not use tools, network access, external comparables");
    expect(GEMMA_PRICING_INSTRUCTIONS).toContain("atomic USDC");
    for (const key of ["recommendedAtomicAmount", "minimumAtomicAmount", "maximumAtomicAmount", "comparables", "strongestComparableIds", "rationale"]) {
      expect(GEMMA_PRICING_INSTRUCTIONS).toContain(key);
    }
  });

  it("uses the bounded Gemma provider configuration for buyer ranking", async () => {
    let captured: StructuredGenerationRequest<unknown> | undefined;
    const generate: StructuredGeneration = async <T>(request: StructuredGenerationRequest<T>) => {
      captured = request;
      return {} as T;
    };

    await new GemmaBuyerSearchGenerator(generate).generate({
      query: "Find a MacBook below 900 USDC",
      listings: [],
    });

    expect(captured?.modelId).toBe(GEMMA_PRICING_MODEL_ID);
    expect(captured?.settings).toEqual(GEMMA_BUYER_SEARCH_SETTINGS);
    expect(captured?.settings?.providerOptions?.google).toEqual({
      structuredOutputs: false,
      thinkingConfig: { thinkingLevel: "minimal" },
    });
    const buyerPrompt = String(captured?.messages[0].content);
    for (const key of [
      "interpretedConstraints", "categories", "maximumAtomicAmount", "acceptableConditions",
      "requiredTerms", "excludedDefectTerms", "matches", "listingId", "score",
      "fitExplanation", "evidenceIds", "assumptionIds",
    ]) {
      expect(buyerPrompt).toContain(key);
    }
    expect(buyerPrompt).toContain("at most three");
    expect(buyerPrompt).toContain("900000000 for 900 USDC");
    expect(buyerPrompt).not.toContain("six-decimal USDC atomic strings");
  });

  it("retries one transient Gemma buyer-ranking failure and then succeeds", async () => {
    const transient = Object.assign(new Error("Service Unavailable"), { statusCode: 503 });
    const generate = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ matches: [] });

    await expect(new GemmaBuyerSearchGenerator(generate).generate({
      query: "Find running shoes",
      listings: [],
    })).resolves.toEqual({ matches: [] });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("normalizes only Gemma's observed single-object array wrapper before strict validation", () => {
    const candidate = {
      interpretedConstraints: {
        categories: ["electronics"],
        maximumAtomicAmount: "900000000",
        acceptableConditions: ["acceptable"],
        requiredTerms: ["MacBook"],
        excludedDefectTerms: ["screen damage"],
      },
      matches: [],
    };
    expect(GemmaBuyerSearchGenerationSchema.parse([candidate])).toEqual(candidate);
    expect(GemmaBuyerSearchGenerationSchema.safeParse([candidate, candidate]).success).toBe(false);
    expect(GemmaBuyerSearchGenerationSchema.safeParse([{ ...candidate, extra: true }]).success).toBe(false);
  });

  it("does not retry non-transient or repeatedly failing Gemma buyer ranking", async () => {
    const badRequest = Object.assign(new Error("Bad Request"), { status: 400 });
    const invalidGenerate = vi.fn().mockRejectedValue(badRequest);
    await expect(new GemmaBuyerSearchGenerator(invalidGenerate).generate({ query: "Find shoes", listings: [] }))
      .rejects.toBe(badRequest);
    expect(invalidGenerate).toHaveBeenCalledTimes(1);

    const unavailable = Object.assign(new Error("Bad Gateway"), { status: 502 });
    const unavailableGenerate = vi.fn().mockRejectedValue(unavailable);
    await expect(new GemmaBuyerSearchGenerator(unavailableGenerate).generate({ query: "Find shoes", listings: [] }))
      .rejects.toBe(unavailable);
    expect(unavailableGenerate).toHaveBeenCalledTimes(2);
  });

  it("uses the direct provider, exact model identity, object output, and zero AI SDK retries", async () => {
    const model = { specificationVersion: "v3" } as never;
    const provider = vi.fn(() => model);
    const createProvider = vi.fn(() => provider);
    const generate = vi.fn(async (options: unknown) => ({ output: { ok: true }, options } as never));
    const structured = createGoogleStructuredGeneration({ createProvider: createProvider as never, generate: generate as never });
    const result = await structured({ modelId: GEMINI_LISTING_MODEL_ID, schema: GeminiListingCandidateSchema, messages: [] });
    expect(result).toEqual({ ok: true });
    expect(createProvider).toHaveBeenCalledWith({ apiKey: "test-google-key" });
    expect(provider).toHaveBeenCalledWith(GEMINI_LISTING_MODEL_ID);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      model,
      maxRetries: 0,
      maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS,
      messages: [],
    }));
    expect(generate.mock.calls[0][0]).toHaveProperty("output");
    const abortSignal = (generate.mock.calls[0][0] as { abortSignal?: AbortSignal }).abortSignal;
    expect(abortSignal).toBeInstanceOf(AbortSignal);
    expect(GOOGLE_GENERATION_TIMEOUT_MS).toBe(90_000);
  });
});
