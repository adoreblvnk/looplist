import "server-only";
import { z, ZodError } from "zod";
import {
  ActiveListingSchema,
  BASE_SEPOLIA_NETWORK,
  DEMO_SELLER,
  EditableAssumptionSchema,
  ListingAttributesSchema,
  ListingConditionSchema,
  MarketplaceCategorySchema,
  MoneySchema,
  PhotoEvidenceSchema,
  type ListingDraft,
  type MediaReference,
} from "../domain/marketplace";
import { createMarketplaceRepository } from "../persistence/production-repository";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  type MarketplaceListing,
  type MarketplaceRepository,
  type PublicationRequestRecord,
} from "../persistence/repository";
import { IDEMPOTENCY_KEY_PATTERN } from "./analysis-api";
import { readBoundedJson, RequestJsonError } from "./request-json";

const IdentifierSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const LabelSchema = z.string().trim().min(1).max(120);
const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const PublishListingRequestSchema = z.object({
  analysisRunId: IdentifierSchema,
  title: z.string().trim().min(5).max(80),
  description: z.string().trim().min(20).max(3_000),
  category: MarketplaceCategorySchema,
  brand: LabelSchema,
  model: LabelSchema,
  condition: ListingConditionSchema,
  attributes: ListingAttributesSchema,
  includedAccessories: z.array(LabelSchema).max(20),
  visiblyMissingAccessories: z.array(LabelSchema).max(20),
  evidence: z.array(PhotoEvidenceSchema).min(1).max(32),
  assumptions: z.array(EditableAssumptionSchema).max(16),
  approvedPrice: MoneySchema,
}).strict();
export type PublishListingRequest = z.infer<typeof PublishListingRequestSchema>;

export const PublicListingSchema = z.object({
  listingId: IdentifierSchema,
  title: z.string(),
  description: z.string(),
  category: MarketplaceCategorySchema,
  brand: z.string(),
  model: z.string(),
  condition: ListingConditionSchema,
  attributes: ListingAttributesSchema,
  includedAccessories: z.array(z.string()),
  visiblyMissingAccessories: z.array(z.string()),
  evidence: z.array(PhotoEvidenceSchema),
  assumptions: z.array(EditableAssumptionSchema),
  price: MoneySchema,
  status: z.enum(["active", "sold"]),
  seller: z.object({ id: IdentifierSchema, displayName: z.string(), fictional: z.literal(true) }).strict(),
  photoIds: z.array(IdentifierSchema).min(3).max(8),
  publishedAt: z.string(),
}).strict();
export type PublicListing = z.infer<typeof PublicListingSchema>;

export interface ListingApiServices {
  repository: MarketplaceRepository;
  clock: () => string;
  recipientAddress: string;
  network: typeof BASE_SEPOLIA_NETWORK;
}

class ListingConfigurationError extends Error {}

function productionServices(): ListingApiServices {
  const recipient = EvmAddressSchema.safeParse(process.env.X402_PAY_TO_ADDRESS);
  if (!recipient.success || process.env.X402_NETWORK !== BASE_SEPOLIA_NETWORK) {
    throw new ListingConfigurationError("Publication configuration is unavailable");
  }
  return {
    repository: createMarketplaceRepository(),
    clock: () => new Date().toISOString(),
    recipientAddress: recipient.data,
    network: BASE_SEPOLIA_NETWORK,
  };
}

function productionReadServices(): Pick<ListingApiServices, "repository"> {
  return { repository: createMarketplaceRepository() };
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}
function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function toPublicListing(record: MarketplaceListing): PublicListing {
  const { listing, visibility } = record;
  return PublicListingSchema.parse({
    listingId: listing.listingId,
    title: listing.approvedDraft.title,
    description: listing.approvedDraft.description,
    category: listing.approvedDraft.category,
    brand: listing.approvedDraft.brand,
    model: listing.approvedDraft.model,
    condition: listing.approvedDraft.condition,
    attributes: listing.approvedDraft.attributes,
    includedAccessories: listing.approvedDraft.includedAccessories,
    visiblyMissingAccessories: listing.approvedDraft.visiblyMissingAccessories,
    evidence: listing.approvedDraft.evidence,
    assumptions: listing.approvedDraft.assumptions,
    price: listing.approvedPrice,
    status: visibility,
    seller: {
      id: listing.seller.id,
      displayName: listing.seller.displayName,
      fictional: listing.seller.fictional,
    },
    photoIds: listing.approvedDraft.media.map(({ id }) => id),
    publishedAt: listing.publishedAt,
  });
}

export async function derivePublicationIdentity(idempotencyKey: string): Promise<{ runId: string; listingId: string }> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new TypeError("Invalid idempotency key");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`publication:${idempotencyKey}`));
  const opaque = Buffer.from(digest).toString("base64url");
  return { runId: IdentifierSchema.parse(`publication_${opaque}`), listingId: IdentifierSchema.parse(`listing_${opaque}`) };
}

function readIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) throw new RequestJsonError("Invalid Idempotency-Key", 400);
  return key;
}

function draftFromRequest(input: PublishListingRequest, media: MediaReference[]): ListingDraft {
  return {
    title: input.title,
    description: input.description,
    category: input.category,
    brand: input.brand,
    model: input.model,
    condition: input.condition,
    attributes: input.attributes,
    includedAccessories: input.includedAccessories,
    visiblyMissingAccessories: input.visiblyMissingAccessories,
    media: structuredClone(media),
    evidence: input.evidence,
    assumptions: input.assumptions,
  };
}

function requestMatches(stored: PublicationRequestRecord, candidate: PublicationRequestRecord): boolean {
  return stored.runId === candidate.runId && stored.listingId === candidate.listingId &&
    stored.analysisRunId === candidate.analysisRunId && stored.sellerApproved === candidate.sellerApproved &&
    stored.recipientAddress === candidate.recipientAddress && stored.network === candidate.network &&
    equal(stored.approvedDraft, candidate.approvedDraft) && equal(stored.approvedPrice, candidate.approvedPrice);
}

async function publishClaimed(
  repository: MarketplaceRepository,
  claim: PublicationRequestRecord
): Promise<Response> {
  const listing = ActiveListingSchema.parse({
    listingId: claim.listingId,
    source: "seller",
    seller: DEMO_SELLER,
    recipientAddress: claim.recipientAddress,
    approvedDraft: claim.approvedDraft,
    approvedPrice: claim.approvedPrice,
    publishedAt: claim.requestedAt,
    lastReconciliationFailure: null,
    state: "active",
    reservation: null,
    settlement: null,
    receipt: null,
  });
  try {
    return json(toPublicListing(await repository.publishSellerListing(listing)), 201);
  } catch (cause) {
    if (!(cause instanceof RepositoryConflictError)) throw cause;
    const existing = await repository.getListing(listing.listingId);
    if (!equal(existing.listing, listing)) return failure(409, "publication_conflict", "Publication identity already has different content");
    return json(toPublicListing(existing), 200);
  }
}

export function createListingsPostHandler(servicesFactory: () => ListingApiServices = productionServices) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const key = readIdempotencyKey(request);
      const input = PublishListingRequestSchema.parse(await readBoundedJson(request));
      const services = servicesFactory();
      const identity = await derivePublicationIdentity(key);
      const analysis = await services.repository.readRunSnapshot("analysis", input.analysisRunId);
      if (analysis.kind !== "analysis" || analysis.status !== "succeeded") {
        return failure(409, "analysis_not_publishable", "Only a succeeded analysis run can be published");
      }
      const approvedDraft = ActiveListingSchema.safeParse({
        listingId: identity.listingId,
        source: "seller",
        seller: DEMO_SELLER,
        recipientAddress: services.recipientAddress,
        approvedDraft: draftFromRequest(input, analysis.media),
        approvedPrice: input.approvedPrice,
        publishedAt: services.clock(),
        lastReconciliationFailure: null,
        state: "active",
        reservation: null,
        settlement: null,
        receipt: null,
      });
      if (!approvedDraft.success) return failure(400, "invalid_publication", "Seller-approved listing is invalid");
      const candidate: PublicationRequestRecord = {
        runId: identity.runId,
        listingId: identity.listingId,
        analysisRunId: input.analysisRunId,
        recipientAddress: services.recipientAddress,
        network: services.network,
        sellerApproved: true,
        approvedDraft: approvedDraft.data.approvedDraft,
        approvedPrice: approvedDraft.data.approvedPrice,
        requestedAt: services.clock(),
      };
      let claim: PublicationRequestRecord;
      try {
        claim = await services.repository.createPublicationRequest(candidate);
      } catch (cause) {
        if (!(cause instanceof RepositoryConflictError)) throw cause;
        claim = await services.repository.readPublicationRequest(identity.runId);
        if (!requestMatches(claim, candidate)) {
          return failure(409, "idempotency_key_reused", "Idempotency key was already used with a different publication");
        }
      }
      return await publishClaimed(services.repository, claim);
    } catch (cause) {
      if (cause instanceof RequestJsonError) {
        if (cause.status === 415) return failure(415, "unsupported_media_type", "Content-Type must be application/json");
        return failure(cause.status === 413 ? 413 : 400, cause.status === 413 ? "request_too_large" : "invalid_request", "Invalid publication request");
      }
      if (cause instanceof RepositoryNotFoundError) return failure(404, "analysis_run_not_found", "Analysis run was not found");
      if (cause instanceof RepositoryDataError) return failure(500, "listing_data_invalid", "Stored listing data is invalid");
      if (cause instanceof RepositoryUnavailableError) return failure(503, "listing_unavailable", "Listing service is unavailable");
      if (cause instanceof ZodError || cause instanceof TypeError) return failure(400, "invalid_request", "Invalid publication request");
      return failure(503, "listing_unavailable", "Listing service is unavailable");
    }
  };
}

export function createListingsGetHandler(servicesFactory: () => Pick<ListingApiServices, "repository"> = productionReadServices) {
  return async function GET(): Promise<Response> {
    try {
      const listings = await servicesFactory().repository.listMarketplaceListings();
      return json({ listings: listings.map(toPublicListing) }, 200);
    } catch (cause) {
      if (cause instanceof RepositoryDataError || cause instanceof ZodError) return failure(500, "listing_data_invalid", "Stored listing data is invalid");
      return failure(503, "listing_unavailable", "Listing service is unavailable");
    }
  };
}

export function createListingGetHandler(servicesFactory: () => Pick<ListingApiServices, "repository"> = productionReadServices) {
  return async function GET(_request: Request, context: { params: Promise<{ listingId: string }> }): Promise<Response> {
    const listingId = IdentifierSchema.safeParse((await context.params).listingId);
    if (!listingId.success) return failure(404, "listing_not_found", "Listing was not found");
    try {
      return json(toPublicListing(await servicesFactory().repository.getListing(listingId.data)), 200);
    } catch (cause) {
      if (cause instanceof RepositoryNotFoundError) return failure(404, "listing_not_found", "Listing was not found");
      if (cause instanceof RepositoryDataError || cause instanceof ZodError) return failure(500, "listing_data_invalid", "Stored listing data is invalid");
      return failure(503, "listing_unavailable", "Listing service is unavailable");
    }
  };
}

export function createListingMediaGetHandler(servicesFactory: () => Pick<ListingApiServices, "repository"> = productionReadServices) {
  return async function GET(_request: Request, context: { params: Promise<{ listingId: string; photoId: string }> }): Promise<Response> {
    const params = await context.params;
    const listingId = IdentifierSchema.safeParse(params.listingId);
    const photoId = IdentifierSchema.safeParse(params.photoId);
    if (!listingId.success || !photoId.success) return failure(404, "media_not_found", "Listing media was not found");
    try {
      const repository = servicesFactory().repository;
      const record = await repository.getListing(listingId.data);
      const media = record.listing.approvedDraft.media.find(({ id }) => id === photoId.data);
      if (!media) return failure(404, "media_not_found", "Listing media was not found");
      const content = await repository.readPrivateMediaContent(media);
      return new Response(new Blob([content.bytes]), {
        status: 200,
        headers: {
          "Content-Type": media.mimeType,
          "Content-Length": String(content.bytes.byteLength),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (cause) {
      if (cause instanceof RepositoryNotFoundError) return failure(404, "media_not_found", "Listing media was not found");
      if (cause instanceof RepositoryUnavailableError) return failure(503, "media_unavailable", "Listing media is unavailable");
      return failure(500, "media_read_failed", "Listing media could not be read");
    }
  };
}

export { BASE_SEPOLIA_NETWORK };
