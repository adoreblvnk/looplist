import "server-only";
import { WorkflowAgent, ModelCallStreamPart } from "@ai-sdk/workflow";
import { google } from "@ai-sdk/google";
import { getWritable, getWorkflowMetadata } from "workflow";
import { Output, isStepCount } from "ai";
import { loadAndValidateImageBlob, putPrivateBlobJson } from "../lib/server/blob-client";
import {
  AnalyzeOutputSchema,
  AnalyzeOutput,
  AnalyzeResponseDTO,
} from "../lib/domain/schemas";

export async function fetchImageDataStep(
  imagePaths: string[]
): Promise<Array<{ mimeType: string; base64: string }>> {
  "use step";

  const results: Array<{ mimeType: string; base64: string }> = [];

  for (const pathname of imagePaths) {
    const validatedImage = await loadAndValidateImageBlob(pathname);
    if (!validatedImage) {
      throw new Error(`Failed to load or validate image at path: ${pathname}`);
    }

    const base64 = validatedImage.buffer.toString("base64");
    results.push({
      mimeType: validatedImage.mimeType,
      base64,
    });
  }

  return results;
}

export async function runGeminiAnalysisStep(
  images: Array<{ mimeType: string; base64: string }>
): Promise<AnalyzeOutput> {
  "use step";

  const agent = new WorkflowAgent({
    model: google("gemini-3.6-flash"),
    instructions: `You are an expert consumer electronics inspector and listing specialist for LoopList.
Analyze the provided item photos with meticulous attention to detail.
Identify the exact brand, model, category, included accessories, and any visible flaws, defects, or wear points with visual evidence.
Keep every item-specific value concise and independent. Never concatenate multiple fields into Model. Use "Not applicable" or "Not determined from photos" when a fixed field cannot be supported, and add a seller question only when that detail materially affects the listing.
Provide an accurate condition assessment, confidence score (0 to 1), unresolved questions (only if critical details remain ambiguous; empty array otherwise), an optimized eBay title (maximum 80 characters), a clear item description, structured item specifics, and price suggestions in SGD and USD with rationale.`,
  });

  const imageParts = images.map((img) => ({
    type: "image" as const,
    image: Buffer.from(img.base64, "base64"),
    mediaType: img.mimeType,
  }));

  const writable = getWritable<ModelCallStreamPart>();

  const streamResult = await agent.stream({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Examine these item photos in detail. Extract structured identity, accessories, defects with visual evidence, condition rating, confidence score, unresolved questions if any, eBay title (max 80 chars), description, key item specifics (Brand and Model are required), and SGD/USD price suggestions with rationale.",
          },
          ...imageParts,
        ],
      },
    ],
    writable,
    stopWhen: isStepCount(5),
    output: Output.object({
      schema: AnalyzeOutputSchema,
    }),
  });

  return streamResult.output;
}

export async function saveDraftStep(
  runId: string,
  imagePaths: string[],
  analysis: AnalyzeOutput
): Promise<{ draftPathname: string }> {
  "use step";

  const draftPathname = `drafts/draft-${runId}.json`;
  const draftRecord = {
    id: `draft-${runId}`,
    runId,
    imagePaths,
    analysis,
    createdAt: new Date().toISOString(),
  };

  await putPrivateBlobJson(draftPathname, draftRecord);

  return { draftPathname };
}

export async function analyzeWorkflow(
  imagePaths: string[]
): Promise<AnalyzeResponseDTO> {
  "use workflow";

  const { workflowRunId: runId } = getWorkflowMetadata();

  const images = await fetchImageDataStep(imagePaths);
  const analysis = await runGeminiAnalysisStep(images);
  const { draftPathname } = await saveDraftStep(runId, imagePaths, analysis);

  const timestamp = new Date().toISOString();

  return {
    kind: "analysis",
    runId,
    draftPathname,
    analysis,
    imagePaths,
    trace: [
      {
        label: "Observation",
        summary: `Loaded ${imagePaths.length} private item photos and performed multimodal inspection with Gemini 3.6 Flash.`,
        timestamp,
      },
      {
        label: "Action",
        summary: `Identified item as ${analysis.identity} ${analysis.model} under category "${analysis.category}".`,
        timestamp,
      },
      {
        label: "Tool result",
        summary: `Condition evaluated as ${analysis.condition} (confidence: ${(analysis.confidence * 100).toFixed(0)}%) with ${analysis.defects.length} defect/wear observations.`,
        timestamp,
      },
      {
        label: "Verification",
        summary: `Validated structured output and stored draft listing record in private Blob at ${draftPathname}.`,
        timestamp,
      },
    ],
  };
}
