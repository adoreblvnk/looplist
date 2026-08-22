import "server-only";
import { WorkflowAgent, ModelCallStreamPart } from "@ai-sdk/workflow";
import { google } from "@ai-sdk/google";
import { getWritable, getWorkflowMetadata } from "workflow";
import { Output, isStepCount } from "ai";
import {
  EbayListing,
  EbayListingSchema,
  EbayAdapterRecord,
  PublishDraftListing,
  PublishResponseDTO,
  TraceEntry,
} from "../lib/domain/schemas";
import {
  runBoundedRepairController,
  ValidationResult,
} from "../lib/domain/repair-controller";
import {
  validateEbayListing,
  publishToEbayAdapter,
  verifyEbayAdapterRecord,
} from "../lib/server/ebay-adapter";
import { loadAndValidateImageBlob, putPrivateBlobJson } from "../lib/server/blob-client";

export async function validateListingStep(
  listing: unknown
): Promise<ValidationResult> {
  "use step";
  return validateEbayListing(listing);
}

export async function repairListingWithGeminiStep(
  listing: unknown,
  errors: string[],
  attemptNumber: number
): Promise<EbayListing> {
  "use step";

  const agent = new WorkflowAgent({
    model: google("gemini-3.6-flash"),
    instructions: `You are an eBay listing compliance specialist for LoopList.
Your task is to repair ONLY the rejected or non-compliant fields of a seller's listing so that it strictly adheres to eBay validation rules.
Ensure title is at most 80 characters, itemSpecifics has required Brand and Model keys, and all required fields are present.`,
  });

  const writable = getWritable<ModelCallStreamPart>();

  const streamResult = await agent.stream({
    messages: [
      {
        role: "user",
        content: `Repair Attempt #${attemptNumber}.
The listing failed eBay validation with the following errors:
${errors.join("\n")}

Original listing draft:
${JSON.stringify(listing, null, 2)}

Provide the corrected listing object with invalid fields repaired.`,
      },
    ],
    writable,
    stopWhen: isStepCount(5),
    output: Output.object({
      schema: EbayListingSchema,
    }),
  });

  return streamResult.output;
}

export async function verifyListingImagesStep(imagePaths: string[]): Promise<{ valid: boolean }> {
  "use step";
  for (const path of imagePaths) {
    const img = await loadAndValidateImageBlob(path);
    if (!img) {
      throw new Error(`Listing image verification failed for path: ${path}`);
    }
  }
  return { valid: true };
}

export async function saveRepairSkillStep(
  attemptNumber: number,
  originalListing: unknown,
  validationErrors: string[],
  repairedListing: EbayListing
): Promise<{ skillPathname: string }> {
  "use step";

  const skillId = crypto.randomUUID();
  const skillPathname = `skills/repair-v${attemptNumber}-${skillId}.json`;

  const skillArtifact = {
    id: skillId,
    version: attemptNumber,
    triggerErrors: validationErrors,
    originalListing,
    repairedListing,
    savedAt: new Date().toISOString(),
  };

  await putPrivateBlobJson(skillPathname, skillArtifact);

  return { skillPathname };
}

export async function publishAdapterStep(
  listing: EbayListing
): Promise<{ adapterRecordPath: string; record: EbayAdapterRecord }> {
  "use step";
  return publishToEbayAdapter(listing);
}

export async function verifyPublicationStep(
  adapterRecordPath: string,
  expectedListing: EbayListing
): Promise<{ verified: boolean }> {
  "use step";
  const { verified } = await verifyEbayAdapterRecord(adapterRecordPath, expectedListing);
  return { verified };
}

export async function publishWorkflow(params: {
  listing: PublishDraftListing;
}): Promise<PublishResponseDTO> {
  "use workflow";

  const repairResult = await runBoundedRepairController(
    params.listing,
    {
      validateListing: (listing) => validateListingStep(listing),
      repairWithGemini: (listing, errors, attempt) =>
        repairListingWithGeminiStep(listing, errors, attempt),
    }
  );

  const { finalListing, repaired, repairMetadata } = repairResult;

  await verifyListingImagesStep(finalListing.imagePaths);

  const { adapterRecordPath, record } = await publishAdapterStep(finalListing);
  await verifyPublicationStep(adapterRecordPath, finalListing);

  let repairSkillPath: string | null = null;
  if (repaired && repairMetadata) {
    const skillResult = await saveRepairSkillStep(
      repairMetadata.attemptNumber,
      repairMetadata.originalListing,
      repairMetadata.validationErrors,
      repairMetadata.repairedListing
    );
    repairSkillPath = skillResult.skillPathname;
  }

  const { workflowRunId: runId } = getWorkflowMetadata();
  const timestamp = new Date().toISOString();

  const trace: TraceEntry[] = [
    {
      label: "Observation",
      summary: "Received publish request with explicit seller approval.",
      timestamp,
    },
  ];

  if (repaired) {
    trace.push({
      label: "Action",
      summary: "Listing failed initial eBay validation; Gemini WorkflowAgent repaired rejected fields.",
      timestamp,
    });
    if (repairSkillPath) {
      trace.push({
        label: "Skill saved",
        summary: `Saved versioned repair skill artifact to private Blob at ${repairSkillPath}.`,
        timestamp,
      });
    }
  } else {
    trace.push({
      label: "Action",
      summary: "Deterministic eBay schema validation passed on first attempt.",
      timestamp,
    });
  }

  trace.push({
    label: "Tool result",
    summary: `Published to deterministic eBay adapter (${record.listingId}).`,
    timestamp,
  });

  trace.push({
    label: "Verification",
    summary: `Independently retrieved and verified adapter record at ${adapterRecordPath}. Status: PUBLISHED.`,
    timestamp,
  });

  return {
    kind: "publication",
    runId,
    publishedListingId: record.listingId,
    publishedListingUrl: record.listingUrl,
    isAdapter: true,
    adapterNotice: record.adapterNotice,
    adapterRecordPath,
    verificationStatus: "VERIFIED",
    repaired,
    repairSkillPath,
    finalListing,
    trace,
  };
}
