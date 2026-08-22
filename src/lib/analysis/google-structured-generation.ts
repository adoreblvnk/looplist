import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, type ModelMessage } from "ai";
import type { ZodType } from "zod";

export interface StructuredGenerationRequest<T> {
  modelId: string;
  schema: ZodType<T>;
  messages: ModelMessage[];
}

export type StructuredGeneration = <T>(request: StructuredGenerationRequest<T>) => Promise<T>;

export function requireGoogleApiKey(): string {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");
  return apiKey;
}

interface GoogleGenerationDependencies {
  createProvider: typeof createGoogleGenerativeAI;
  generate: typeof generateText;
}

export const GOOGLE_GENERATION_TIMEOUT_MS = 90_000;
export const GOOGLE_MAX_OUTPUT_TOKENS = 2_048;

export function createGoogleStructuredGeneration(
  dependencies: GoogleGenerationDependencies = {
    createProvider: createGoogleGenerativeAI,
    generate: generateText,
  }
): StructuredGeneration {
  return async <T>({ modelId, schema, messages }: StructuredGenerationRequest<T>) => {
    const google = dependencies.createProvider({ apiKey: requireGoogleApiKey() });
    const result = await dependencies.generate({
      model: google(modelId),
      messages,
      output: Output.object({ schema }),
      maxRetries: 0,
      maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(GOOGLE_GENERATION_TIMEOUT_MS),
    });
    return result.output as T;
  };
}

export const generateGoogleObject = createGoogleStructuredGeneration();
