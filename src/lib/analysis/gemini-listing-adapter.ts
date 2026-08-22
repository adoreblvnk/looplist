import "server-only";
import type { ModelMessage } from "ai";
import { GeminiListingCandidateSchema, type ListingDraftGenerator } from "./contracts";
import { GEMINI_LISTING_MODEL_ID } from "./google-models";
import { generateGoogleObject, type StructuredGeneration } from "./google-structured-generation";

export const GEMINI_LISTING_INSTRUCTIONS = `Identify the single resale product shown in the supplied photos and return exactly the requested listing candidate schema.
Every evidence entry must reference one exact supplied photo ID. State condition and defects only when visible in those photos. Put uncertain details in explicit editable assumptions with editable=true and verified=false. Never provide prices or comparables. Never invent specifications, functionality, provenance, or accessories. Included and visibly missing accessories must be visually supported. Use exactly one of these marketplace category literals: electronics, running_shoes, sneakers. The sneakers category means lifestyle sneakers; use running_shoes only for performance running footwear.`;

export class GeminiListingDraftGenerator implements ListingDraftGenerator {
  constructor(private readonly generateObject: StructuredGeneration = generateGoogleObject) {}

  async generate({ photos }: Parameters<ListingDraftGenerator["generate"]>[0]): Promise<unknown> {
    const content: NonNullable<Extract<ModelMessage, { role: "user" }>["content"]> = [
      { type: "text", text: GEMINI_LISTING_INSTRUCTIONS },
    ];
    for (const photo of photos) {
      content.push({ type: "text", text: `Supplied photo ID: ${photo.media.id}` });
      content.push({
        type: "file",
        mediaType: photo.media.mimeType,
        data: { type: "data", data: new Uint8Array(photo.bytes) },
      });
    }
    return this.generateObject({
      modelId: GEMINI_LISTING_MODEL_ID,
      schema: GeminiListingCandidateSchema,
      messages: [{ role: "user", content }],
    });
  }
}
