import { describe, expect, it, vi } from "vitest";
import { ListingDraftSchema, type MediaReference } from "../lib/domain/marketplace";
import {
  AnalysisMediaInputSchema,
  GeminiListingCandidateSchema,
  type ListingDraftGenerator,
} from "../lib/analysis/contracts";
import {
  AnalysisCoreError,
  MAX_GEMINI_PHOTO_BYTES,
  generateListingDraft,
} from "../lib/analysis/generate-listing-draft";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { RepositoryDataError, type MarketplaceRepository } from "../lib/persistence/repository";
import { validDraft } from "./domain-fixtures";

function references(count = 3): MediaReference[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `analysis-photo-${index + 1}`,
    pathname: `media/uploads/analysis-session/analysis-photo-${index + 1}.webp`,
    mediaType: "image" as const,
    mimeType: "image/webp" as const,
    alt: `Analysis photo ${index + 1}`,
    width: 1200,
    height: 900,
  }));
}

function candidate(photoId = "analysis-photo-1") {
  const draft: Partial<typeof validDraft> = structuredClone(validDraft);
  delete draft.media;
  return {
    ...draft,
    evidence: validDraft.evidence.map((evidence, index) => ({
      ...evidence,
      id: `analysis-evidence-${index + 1}`,
      photoId,
    })),
  };
}

function repositoryFor(media: readonly MediaReference[], bytes?: readonly Uint8Array[]) {
  return new InMemoryMarketplaceRepository({
    media: media.map((reference, index) => ({
      media: reference,
      bytes: bytes?.[index] ?? new Uint8Array([index + 1]),
    })),
  });
}

describe("Gemini listing analysis core", () => {
  it("accepts exactly 3 and 8 unique canonical references and rejects 2, 9, duplicates, and malformed refs", async () => {
    for (const count of [3, 8]) {
      expect(AnalysisMediaInputSchema.parse(references(count))).toHaveLength(count);
    }
    for (const invalid of [
      references(2),
      references(9),
      [references(3)[0], references(3)[0], references(3)[2]],
      references(3).map((media, index) => index === 0 ? { ...media, pathname: "https://public.example/photo.webp" } : media),
    ]) {
      const generate = vi.fn();
      await expect(
        generateListingDraft(repositoryFor(references(3)), { generate }, invalid as MediaReference[])
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
    }
  });

  it("reads exact private bytes in input order once and attaches only authoritative media", async () => {
    const media = references(3);
    const bytes = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])];
    const generate = vi.fn(async ({ photos }: Parameters<ListingDraftGenerator["generate"]>[0]) => {
      expect(photos.map(({ media: photo }) => photo.id)).toEqual(media.map(({ id }) => id));
      expect(photos.map(({ bytes: photoBytes }) => [...photoBytes])).toEqual(bytes.map((value) => [...value]));
      expect(photos.map(({ media: photo }) => photo.mimeType)).toEqual(media.map(({ mimeType }) => mimeType));
      return candidate();
    });
    const result = await generateListingDraft(repositoryFor(media, bytes), { generate }, media);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.media).toEqual(media);
    result.media[0].alt = "Caller mutation";
    expect(media[0].alt).toBe("Analysis photo 1");
  });

  it("rejects missing, mismatched, and aggregate-oversized private content without invoking Gemini", async () => {
    const media = references(3);
    const generate = vi.fn();
    await expect(
      generateListingDraft(new InMemoryMarketplaceRepository(), { generate }, media)
    ).rejects.toThrow();

    const mismatchRepository = {
      readPrivateMediaContent: async (reference: MediaReference) => ({
        metadata: {
          media: { ...reference, alt: "Different authoritative metadata" },
          size: 1,
          uploadedAt: "2026-08-21T00:00:00.000Z",
        },
        bytes: new Uint8Array([1]),
      }),
    } as MarketplaceRepository;
    await expect(generateListingDraft(mismatchRepository, { generate }, media)).rejects.toBeInstanceOf(RepositoryDataError);

    const chunkSize = Math.floor(MAX_GEMINI_PHOTO_BYTES / 3) + 1;
    const oversizedRepository = {
      readPrivateMediaContent: async (reference: MediaReference) => ({
        metadata: {
          media: reference,
          size: chunkSize,
          uploadedAt: "2026-08-21T00:00:00.000Z",
        },
        bytes: new Uint8Array(chunkSize),
      }),
    } as MarketplaceRepository;
    await expect(generateListingDraft(oversizedRepository, { generate }, media)).rejects.toMatchObject({
      code: "analysis_media_too_large",
    } satisfies Partial<AnalysisCoreError>);
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps Gemini candidates strict, price-free, and evidence-bound", async () => {
    const media = references(3);
    expect(GeminiListingCandidateSchema.safeParse({ ...candidate(), recommendedPrice: "1" }).success).toBe(false);
    expect(GeminiListingCandidateSchema.safeParse({ ...candidate(), media }).success).toBe(false);

    const hostile = [
      { ...candidate(), price: { atomicAmount: "1" } },
      { ...candidate(), evidence: [{ ...candidate().evidence[0], photoId: "unknown-photo" }] },
      { ...candidate(), evidence: [{ ...candidate().evidence[0], kind: "identity" }] },
      { ...candidate(), unsupported: "provider payload" },
    ];
    for (const output of hostile) {
      await expect(
        generateListingDraft(repositoryFor(media), { generate: async () => output }, media)
      ).rejects.toThrow();
    }

    expect(ListingDraftSchema.parse(await generateListingDraft(
      repositoryFor(media),
      { generate: async () => candidate() },
      media
    )).media).toEqual(media);
  });
});
