import "server-only";
import { NoObjectGeneratedError } from "ai";
import { ZodError } from "zod";
import { GemmaBuyerSearchGenerator } from "../analysis/gemma-buyer-search-adapter";
import {
  BuyerSearchError,
  hydrateBuyerSearch,
  prepareBuyerSearch,
  searchMarketplace,
  toBuyerSearchSelection,
  type HydratedBuyerSearch,
} from "../analysis/search-marketplace";
import type { BuyerSearchGenerator } from "../analysis/buyer-search-contracts";
import {
  BuyerSearchClaimSchema,
  BuyerSearchRequestSchema,
  type BuyerSearchSelectionRecord,
} from "../domain/buyer-search";
import { createMarketplaceRepository } from "../persistence/production-repository";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  type MarketplaceRepository,
} from "../persistence/repository";
import { IDEMPOTENCY_KEY_PATTERN } from "./analysis-api";
import { toPublicListing } from "./listings-api";
import { readBoundedJson, RequestJsonError } from "./request-json";

export interface BuyerSearchApiServices {
  repository: MarketplaceRepository;
  generator: BuyerSearchGenerator;
  clock: () => string;
}

function productionServices(): BuyerSearchApiServices {
  return {
    repository: createMarketplaceRepository(),
    generator: new GemmaBuyerSearchGenerator(),
    clock: () => new Date().toISOString(),
  };
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function readIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new RequestJsonError("Invalid Idempotency-Key", 400);
  }
  return key;
}

export async function deriveBuyerSearchId(idempotencyKey: string): Promise<string> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new TypeError("Invalid idempotency key");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`buyer-search:${idempotencyKey}`)
  );
  return `search_${Buffer.from(digest).toString("base64url")}`;
}

function publicResult(result: HydratedBuyerSearch): unknown {
  return {
    searchId: result.searchId,
    query: result.query,
    interpretedConstraints: result.interpretedConstraints,
    createdAt: result.createdAt,
    matches: result.matches.map((match) => ({
      rank: match.rank,
      score: match.score,
      fitExplanation: match.fitExplanation,
      visibleDefects: match.visibleDefects,
      evidence: match.evidence,
      assumptions: match.assumptions,
      listing: toPublicListing(match.record),
    })),
  };
}

async function hydrateStoredSelection(
  repository: MarketplaceRepository,
  selection: BuyerSearchSelectionRecord
): Promise<HydratedBuyerSearch> {
  const prepared = await prepareBuyerSearch(repository, selection.query);
  return hydrateBuyerSearch(prepared, selection.searchId, selection.generatedAt, {
    interpretedConstraints: selection.interpretedConstraints,
    matches: selection.matches,
  });
}

function isTimeout(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (error instanceof Error && /timed?\s*out|timeout/i.test(error.message))
  );
}

async function generateBuyerSearch(
  services: BuyerSearchApiServices,
  input: { searchId: string; query: string; generatedAt: string }
): Promise<HydratedBuyerSearch> {
  try {
    return await searchMarketplace(services.repository, services.generator, input);
  } catch (error) {
    if (!(error instanceof BuyerSearchError) && !NoObjectGeneratedError.isInstance(error)) throw error;
    return searchMarketplace(services.repository, services.generator, input);
  }
}

export function createBuyerSearchPostHandler(
  servicesFactory: () => BuyerSearchApiServices = productionServices
) {
  return async function POST(request: Request): Promise<Response> {
    let input: { query: string };
    let key: string;
    try {
      key = readIdempotencyKey(request);
      input = BuyerSearchRequestSchema.parse(await readBoundedJson(request));
    } catch (error) {
      if (error instanceof RequestJsonError) {
        if (error.status === 415) return failure(415, "unsupported_media_type", "Content-Type must be application/json");
        return failure(error.status === 413 ? 413 : 400, error.status === 413 ? "request_too_large" : "invalid_request", "Invalid buyer search request");
      }
      return failure(400, "invalid_request", "Invalid buyer search request");
    }

    try {
      const services = servicesFactory();
      const searchId = await deriveBuyerSearchId(key);
      const candidateClaim = BuyerSearchClaimSchema.parse({
        searchId,
        query: input.query,
        requestedAt: services.clock(),
      });
      let claim = candidateClaim;
      try {
        claim = await services.repository.createBuyerSearchClaim(candidateClaim);
      } catch (error) {
        if (!(error instanceof RepositoryConflictError)) throw error;
        claim = await services.repository.readBuyerSearchClaim(searchId);
        if (claim.query !== input.query) {
          return failure(409, "idempotency_key_reused", "Idempotency key was already used with a different buyer search");
        }
      }

      try {
        const stored = await services.repository.readBuyerSearchSelection(searchId);
        return json(publicResult(await hydrateStoredSelection(services.repository, stored)), 200);
      } catch (error) {
        if (!(error instanceof RepositoryNotFoundError)) throw error;
      }

      const generated = await generateBuyerSearch(services, {
        searchId,
        query: claim.query,
        generatedAt: services.clock(),
      });
      const selection = toBuyerSearchSelection(generated);
      try {
        await services.repository.createBuyerSearchSelection(selection);
        return json(publicResult(generated), 201);
      } catch (error) {
        if (!(error instanceof RepositoryConflictError)) throw error;
        const winner = await services.repository.readBuyerSearchSelection(searchId);
        return json(publicResult(await hydrateStoredSelection(services.repository, winner)), 200);
      }
    } catch (error) {
      if (isTimeout(error)) return failure(504, "buyer_search_timeout", "Buyer search timed out. Please retry.");
      if (NoObjectGeneratedError.isInstance(error)) {
        return failure(502, "buyer_search_model_output_invalid", "Gemma did not return a valid ranked-search response. Please retry.");
      }
      if (error instanceof BuyerSearchError) {
        const status = error.code === "unknown_or_unavailable_listing" ? 409 : 502;
        return failure(status, "buyer_search_invalid", "Buyer search could not return a grounded active listing result");
      }
      if (error instanceof RepositoryDataError || error instanceof ZodError) {
        return failure(500, "buyer_search_data_invalid", "Stored buyer search data is invalid");
      }
      if (error instanceof RepositoryUnavailableError) {
        return failure(503, "buyer_search_unavailable", "Buyer search is unavailable. Please retry.");
      }
      return failure(503, "buyer_search_unavailable", "Buyer search is unavailable. Please retry.");
    }
  };
}
