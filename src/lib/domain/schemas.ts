import { z } from "zod";
import {
  isUploadImagePath,
  isDraftPath,
  isAdapterRecordPath,
  isSkillPath,
} from "./path-predicates";

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MiB

export const RunIdSchema = z
  .string()
  .min(1, "Workflow run ID is required")
  .max(128, "Workflow run ID too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid workflow run ID format");

export const TraceLabelSchema = z.enum([
  "Observation",
  "Action",
  "Tool result",
  "Verification",
  "Skill saved",
]);

export type TraceLabel = z.infer<typeof TraceLabelSchema>;

export const TraceEntrySchema = z
  .object({
    label: TraceLabelSchema,
    summary: z.string(),
    timestamp: z.string(),
  })
  .strict();

export type TraceEntry = z.infer<typeof TraceEntrySchema>;

export const DefectSchema = z
  .object({
    description: z.string().describe("Description of defect, damage, or wear"),
    location: z.string().describe("Location on the item where defect is observed"),
    evidence: z.string().describe("Visual evidence from photos supporting this finding"),
  })
  .strict();

export type Defect = z.infer<typeof DefectSchema>;

export const PriceSuggestionSchema = z
  .object({
    sgd: z.number().finite().positive().describe("Suggested listing price in SGD"),
    usd: z.number().finite().positive().describe("Suggested listing price in USD"),
    rationale: z.string().describe("Brief market rationale for suggested pricing"),
  })
  .strict();

export type PriceSuggestion = z.infer<typeof PriceSuggestionSchema>;

export const ItemSpecificsSchema = z
  .object({
    Brand: z.string().min(1, "Brand item specific is required").max(100, "Brand key or value too long"),
    Model: z.string().min(1, "Model item specific is required").max(500, "Model value too long"),
  })
  .catchall(z.string().min(1, "Value cannot be empty").max(500, "Value too long"))
  .refine((rec) => Object.keys(rec).length <= 50, "Item specifics count cannot exceed 50")
  .refine(
    (rec) => Object.keys(rec).every((k) => k.length >= 1 && k.length <= 100),
    "Item specific key length must be between 1 and 100 characters"
  );

export type ItemSpecifics = z.infer<typeof ItemSpecificsSchema>;

export const AnalyzeItemSpecificsSchema = z
  .object({
    Brand: z.string().min(1).describe("Brand or maker"),
    Model: z.string().min(1).describe("Exact model name or number only"),
    Color: z.string().min(1).describe("Observed color or finish"),
    Type: z.string().min(1).describe("Marketplace item type"),
    Platform: z.string().min(1).describe("Compatible platform or Not applicable"),
    CountryOrRegion: z
      .string()
      .min(1)
      .describe("Country or region of manufacture, or Not determined from photos"),
  })
  .strict();

export const AnalyzeOutputSchema = z
  .object({
    identity: z.string().describe("Brand or maker name (e.g. Nintendo)"),
    model: z.string().describe("Specific model name or number (e.g. Game Boy DMG-01)"),
    category: z.string().describe("Suggested category for listing"),
    accessories: z.array(z.string()).describe("Included accessories or attachments observed in photos"),
    defects: z.array(DefectSchema).describe("Defects, wear, or damage observed with visual evidence from photos"),
    condition: z.enum([
      "New",
      "Like New",
      "Very Good",
      "Good",
      "Acceptable",
      "For parts or not working",
    ]).describe("Overall item condition rating"),
    confidence: z.number().min(0).max(1).describe("Assessment confidence score between 0 and 1"),
    unresolvedQuestions: z.array(z.string()).describe("Questions for seller if details remain ambiguous; empty array if clear"),
    title: z.string().min(1).max(80).describe("Optimized listing title (maximum 80 characters)"),
    description: z.string().describe("Detailed listing description including inclusions, condition, and defects"),
    itemSpecifics: AnalyzeItemSpecificsSchema.describe(
      "Structured marketplace specifics; use concise values and never concatenate fields"
    ),
    priceSuggestion: PriceSuggestionSchema.describe("Price suggestions in SGD and USD with rationale"),
  })
  .strict();

export type AnalyzeOutput = z.infer<typeof AnalyzeOutputSchema>;

export const AnalyzeInputSchema = z
  .object({
    imagePaths: z
      .array(
        z.string().min(1).refine(isUploadImagePath, {
          message: "Path must be a valid uploads/ image path",
        })
      )
      .min(3, "At least 3 LoopList image pathnames are required")
      .max(8, "At most 8 LoopList image pathnames are allowed"),
  })
  .strict();

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

export const EbayListingSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(80, "Title must be 80 characters or fewer"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    category: z.string().min(1, "Category is required"),
    condition: z.enum([
      "New",
      "Like New",
      "Very Good",
      "Good",
      "Acceptable",
      "For parts or not working",
    ]),
    priceSgd: z.number().finite("Price SGD must be finite").positive("Price in SGD must be greater than 0"),
    priceUsd: z.number().finite("Price USD must be finite").positive("Price in USD must be greater than 0"),
    itemSpecifics: ItemSpecificsSchema,
    imagePaths: z
      .array(
        z.string().min(1).refine(isUploadImagePath, {
          message: "Path must be a valid uploads/ image path",
        })
      )
      .min(3, "At least 3 image pathnames required")
      .max(8, "At most 8 image pathnames allowed"),
  })
  .strict();

export type EbayListing = z.infer<typeof EbayListingSchema>;

export const PublishDraftListingSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(500, "Title exceeds basic request limit"),
    description: z.string().min(1, "Description is required").max(5000, "Description exceeds basic request limit"),
    category: z.string().min(1, "Category is required").max(200, "Category exceeds request limit"),
    condition: z.enum([
      "New",
      "Like New",
      "Very Good",
      "Good",
      "Acceptable",
      "For parts or not working",
    ]),
    priceSgd: z.number().finite("Price SGD must be finite").positive("Price in SGD must be greater than 0"),
    priceUsd: z.number().finite("Price USD must be finite").positive("Price in USD must be greater than 0"),
    itemSpecifics: z
      .record(
        z.string().min(1, "Key cannot be empty").max(100, "Key too long"),
        z.string().min(1, "Value cannot be empty").max(500, "Value too long")
      )
      .refine((rec) => Object.keys(rec).length <= 50, "Item specifics count cannot exceed 50"),
    imagePaths: z
      .array(
        z.string().min(1).refine(isUploadImagePath, {
          message: "Path must be a valid uploads/ image path",
        })
      )
      .min(3, "At least 3 image pathnames required")
      .max(8, "At most 8 image pathnames allowed"),
  })
  .strict();

export type PublishDraftListing = z.infer<typeof PublishDraftListingSchema>;

export const PublishRequestSchema = z
  .object({
    approved: z.literal(true, {
      message: "Publication requires explicit seller approval (approved must be true)",
    }),
    draftPathname: z.string().refine(isDraftPath, { message: "Invalid draft pathname" }).optional(),
    listing: PublishDraftListingSchema,
  })
  .strict();

export type PublishRequest = z.infer<typeof PublishRequestSchema>;

export const ImagePathSchema = z.string().min(1, "Path parameter is required").refine(isUploadImagePath, {
  message: "Path parameter must be a valid uploads/ image path",
});

export const EbayAdapterRecordSchema = z
  .object({
    id: z.string().min(1),
    listingId: z.string().min(1),
    listingUrl: z.string().url(),
    isAdapter: z.literal(true),
    adapterNotice: z.string().min(1),
    listing: EbayListingSchema,
    publishedAt: z.string().min(1),
    status: z.literal("PUBLISHED"),
  })
  .strict();

export type EbayAdapterRecord = z.infer<typeof EbayAdapterRecordSchema>;

export const RunMarkerSchema = z
  .object({
    runId: RunIdSchema,
    kind: z.enum(["analysis", "publication"]),
    createdAt: z.string(),
  })
  .strict();

export type RunMarker = z.infer<typeof RunMarkerSchema>;

export const AnalyzeResponseDTOSchema = z
  .object({
    kind: z.literal("analysis"),
    runId: RunIdSchema,
    draftPathname: z.string().refine(isDraftPath, { message: "Invalid draft pathname" }),
    analysis: AnalyzeOutputSchema,
    imagePaths: z.array(
      z.string().min(1).refine(isUploadImagePath, {
        message: "Path must be a valid uploads/ image path",
      })
    ),
    trace: z.array(TraceEntrySchema),
  })
  .strict();

export type AnalyzeResponseDTO = z.infer<typeof AnalyzeResponseDTOSchema>;

export const PublishResponseDTOSchema = z
  .object({
    kind: z.literal("publication"),
    runId: RunIdSchema,
    publishedListingId: z.string().min(1),
    publishedListingUrl: z.string().url(),
    isAdapter: z.literal(true),
    adapterNotice: z.string().min(1),
    adapterRecordPath: z.string().refine(isAdapterRecordPath, { message: "Invalid adapter record path" }),
    verificationStatus: z.literal("VERIFIED"),
    repaired: z.boolean(),
    repairSkillPath: z.string().refine(isSkillPath, { message: "Invalid skill path" }).nullable(),
    finalListing: EbayListingSchema,
    trace: z.array(TraceEntrySchema),
  })
  .strict();

export type PublishResponseDTO = z.infer<typeof PublishResponseDTOSchema>;

export interface UploadResponseDTO {
  pathname: string;
  previewUrl: string;
}

export interface RunStatusDTO {
  status: string;
  result?: AnalyzeResponseDTO | PublishResponseDTO | null;
  error?: string | null;
}
