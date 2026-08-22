import { z } from "zod";
import { MediaReferenceSchema, type MediaReference } from "../domain/marketplace";
import { uploadedMediaPath } from "../persistence/paths";
import type { MarketplaceRepository } from "../persistence/repository";
import { RepositoryDataError, RepositoryNotFoundError } from "../persistence/repository";
import { inspectImage } from "./media-upload-api";

const IdentifierSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const PublicUploadedMediaReferenceSchema = z.object({
  id: IdentifierSchema,
  mediaType: z.literal("image"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  alt: z.literal("Seller-uploaded product photo"),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
}).strict();
export type PublicUploadedMediaReference = z.infer<typeof PublicUploadedMediaReferenceSchema>;

export class UploadedMediaValidationError extends Error {
  constructor() {
    super("Uploaded media could not be validated");
    this.name = "UploadedMediaValidationError";
  }
}

export const PublicUploadedMediaInputSchema = z.array(PublicUploadedMediaReferenceSchema).min(3).max(8).superRefine((media, context) => {
  const ids = new Set<string>();
  media.forEach(({ id }, index) => {
    if (ids.has(id)) context.addIssue({ code: "custom", path: [index, "id"], message: "Media IDs must be unique" });
    ids.add(id);
  });
});

export async function hydrateUploadedMedia(
  repository: MarketplaceRepository,
  input: readonly PublicUploadedMediaReference[]
): Promise<MediaReference[]> {
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
  return Promise.all(input.map(async (candidate) => {
    const reference = MediaReferenceSchema.parse({
      ...candidate,
      pathname: uploadedMediaPath(candidate.id, candidate.id, extension[candidate.mimeType]),
    });
    try {
      const content = await repository.readPrivateMediaContent(reference);
      const dimensions = inspectImage(content.bytes, candidate.mimeType);
      if (dimensions.width !== candidate.width || dimensions.height !== candidate.height) {
        throw new UploadedMediaValidationError();
      }
      return MediaReferenceSchema.parse({
        ...reference,
        alt: "Seller-uploaded product photo",
        ...dimensions,
      });
    } catch (error) {
      if (error instanceof RepositoryNotFoundError || error instanceof RepositoryDataError) {
        throw new UploadedMediaValidationError();
      }
      throw new UploadedMediaValidationError();
    }
  }));
}
