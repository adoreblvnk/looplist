import {
  ListingDraftSchema,
  MediaReferenceSchema,
  mediaReferencesEqual,
  type ListingDraft,
  type MediaReference,
} from "../domain/marketplace";
import {
  PrivateMediaContentSchema,
  RepositoryDataError,
  type MarketplaceRepository,
} from "../persistence/repository";
import {
  AnalysisMediaInputSchema,
  GeminiListingCandidateSchema,
  type ListingDraftGenerator,
  type ListingGeneratorPhoto,
} from "./contracts";

export const MAX_GEMINI_PHOTO_BYTES = 20 * 1024 * 1024;

export class AnalysisCoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AnalysisCoreError";
  }
}

export interface PreparedListingGeneration {
  media: MediaReference[];
  photos: ListingGeneratorPhoto[];
}

function canonicalTimestamp(timestamp: string): boolean {
  const parsed = new Date(timestamp);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === timestamp;
}

export async function prepareListingGeneration(
  repository: MarketplaceRepository,
  input: readonly MediaReference[]
): Promise<PreparedListingGeneration> {
  const media = AnalysisMediaInputSchema.parse(structuredClone(input));
  const photos: ListingGeneratorPhoto[] = [];
  let totalBytes = 0;

  for (const reference of media) {
    const contentResult = PrivateMediaContentSchema.safeParse(
      await repository.readPrivateMediaContent(structuredClone(reference))
    );
    if (!contentResult.success) {
      throw new RepositoryDataError("Stored private media content failed validation");
    }
    const content = contentResult.data;
    if (
      !mediaReferencesEqual(content.metadata.media, reference) ||
      content.metadata.media.mimeType !== reference.mimeType ||
      !canonicalTimestamp(content.metadata.uploadedAt)
    ) {
      throw new RepositoryDataError("Stored private media does not match its authoritative reference");
    }
    totalBytes += content.bytes.byteLength;
    if (totalBytes > MAX_GEMINI_PHOTO_BYTES) {
      throw new AnalysisCoreError(
        "analysis_media_too_large",
        "Combined private photo content exceeds the analysis limit"
      );
    }
    photos.push({
      media: MediaReferenceSchema.parse(structuredClone(reference)),
      uploadedAt: content.metadata.uploadedAt,
      bytes: new Uint8Array(content.bytes),
    });
  }
  return { media, photos };
}

export function hydrateListingDraft(
  prepared: PreparedListingGeneration,
  candidate: unknown
): ListingDraft {
  const parsed = GeminiListingCandidateSchema.parse(candidate);
  return ListingDraftSchema.parse({
    ...structuredClone(parsed),
    media: prepared.media.map((reference) => structuredClone(reference)),
  });
}

export async function generateListingDraft(
  repository: MarketplaceRepository,
  generator: ListingDraftGenerator,
  input: readonly MediaReference[]
): Promise<ListingDraft> {
  const prepared = await prepareListingGeneration(repository, input);
  return hydrateListingDraft(
    prepared,
    await generator.generate({ photos: structuredClone(prepared.photos) })
  );
}
