import { z } from "zod";
import { GeminiListingCandidateSchema } from "../analysis/contracts";
import {
  AnalysisRunStateSchema,
  PriceRecommendationSchema,
} from "../domain/marketplace";
import { PublicUploadedMediaInputSchema } from "./public-media";

export const AnalysisRunIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const AnalyzeRequestSchema = z.object({ media: PublicUploadedMediaInputSchema }).strict();
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const AnalyzeAcceptedSchema = z.object({
  runId: AnalysisRunIdSchema,
  status: z.enum(["queued", "running", "succeeded", "failed"]),
}).strict();

const PublicMediaReferenceSchema = z.object({
  id: AnalysisRunIdSchema,
  mediaType: z.literal("image"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  alt: z.string().trim().min(1).max(200),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
}).strict();
const publicRunBase = {
  runId: AnalysisRunIdSchema,
  kind: z.literal("analysis"),
  media: z.array(PublicMediaReferenceSchema).min(3).max(8),
  photoIds: z.array(AnalysisRunIdSchema).min(3).max(8),
  createdAt: z.string(),
  updatedAt: z.string(),
  attempt: z.number().int().nonnegative(),
  geminiAttempts: z.number().int().nonnegative(),
  gemmaAttempts: z.number().int().nonnegative(),
};

export const AnalysisRunApiStateSchema = z.discriminatedUnion("status", [
  z.object({ ...publicRunBase, status: z.literal("queued") }).strict(),
  z.object({ ...publicRunBase, status: z.literal("running"), startedAt: z.string(), draft: GeminiListingCandidateSchema.optional() }).strict(),
  z.object({ ...publicRunBase, status: z.literal("succeeded"), startedAt: z.string(), completedAt: z.string(), draft: GeminiListingCandidateSchema, priceRecommendation: PriceRecommendationSchema }).strict(),
  z.object({ ...publicRunBase, status: z.literal("failed"), startedAt: z.string(), failedAt: z.string(), draft: GeminiListingCandidateSchema.optional(), error: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
]);
export type AnalysisRunApiState = z.infer<typeof AnalysisRunApiStateSchema>;

export function toAnalysisRunApiState(input: unknown): AnalysisRunApiState {
  const run = AnalysisRunStateSchema.parse(input);
  const publicRun = structuredClone(run) as unknown as Record<string, unknown>;
  delete publicRun.failureKind;
  delete publicRun.failureStage;
  const media = run.media.map((value) => {
    const reference: Partial<typeof value> = structuredClone(value);
    delete reference.pathname;
    return reference;
  });
  let draft: unknown;
  if ("draft" in run && run.draft) {
    const candidate: Partial<typeof run.draft> = structuredClone(run.draft);
    delete candidate.media;
    draft = candidate;
  }
  return AnalysisRunApiStateSchema.parse({ ...publicRun, media, ...(draft ? { draft } : {}) });
}

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }).strict() }).strict();
