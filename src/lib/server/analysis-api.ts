import "server-only";
import { start } from "workflow/api";
import { ZodError } from "zod";
import { AnalysisRunService, AnalysisRunTransitionError } from "../analysis/analysis-run-service";
import { requireGoogleApiKey } from "../analysis/google-structured-generation";
import { mediaReferencesEqual, type AnalysisRunState, type MediaReference } from "../domain/marketplace";
import { analyzeWorkflow } from "../../workflows/analyze-workflow";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  type AnalysisStartClaim,
  type MarketplaceRepository,
} from "../persistence/repository";
import { createMarketplaceRepository } from "../persistence/production-repository";
import { readBoundedJson, RequestJsonError } from "./request-json";
import { AnalyzeAcceptedSchema, AnalyzeRequestSchema, AnalysisRunIdSchema, toAnalysisRunApiState } from "./analysis-api-schemas";

/** 8-128 ASCII unreserved characters; leading character must be alphanumeric. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,127}$/;
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export interface AnalysisApiServices {
  repository: MarketplaceRepository;
  clock: () => string;
  preflightAnalysis: () => void | Promise<void>;
  startAnalysis: (runId: string) => Promise<string>;
}

function productionServices(): AnalysisApiServices {
  return {
    repository: createMarketplaceRepository(),
    clock: () => new Date().toISOString(),
    preflightAnalysis: () => { requireGoogleApiKey(); },
    startAnalysis: async (runId) => (await start(analyzeWorkflow, [runId])).runId,
  };
}

const headers = { "Cache-Control": "no-store" };
function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers });
}
function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function readIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new RequestJsonError(
      `Idempotency-Key must be ${IDEMPOTENCY_KEY_MIN_LENGTH}-${IDEMPOTENCY_KEY_MAX_LENGTH} ASCII unreserved characters and start with an alphanumeric character`,
      400
    );
  }
  return key;
}

export async function deriveAnalysisRunId(idempotencyKey: string): Promise<string> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new TypeError("Invalid idempotency key");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencyKey));
  const opaque = Buffer.from(digest).toString("base64url");
  return AnalysisRunIdSchema.parse(`analysis_${opaque}`);
}

function sameMedia(left: readonly MediaReference[], right: readonly MediaReference[]): boolean {
  return left.length === right.length && left.every((value, index) => mediaReferencesEqual(value, right[index]));
}

async function optionalClaim(repository: MarketplaceRepository, runId: string): Promise<AnalysisStartClaim | null> {
  try {
    return await repository.readAnalysisStartClaim(runId);
  } catch (cause) {
    if (cause instanceof RepositoryNotFoundError) return null;
    throw cause;
  }
}

async function hasConfirmation(repository: MarketplaceRepository, runId: string): Promise<boolean> {
  try {
    await repository.readAnalysisStartConfirmation(runId);
    return true;
  } catch (cause) {
    if (cause instanceof RepositoryNotFoundError) return false;
    throw cause;
  }
}

async function readRun(repository: MarketplaceRepository, clock: () => string, runId: string): Promise<AnalysisRunState> {
  return new AnalysisRunService(repository, clock).readSnapshot(runId);
}

function accepted(run: AnalysisRunState): Response {
  return json(AnalyzeAcceptedSchema.parse({ runId: run.runId, status: run.status }), 202);
}

async function replayClaim(
  services: AnalysisApiServices,
  claim: AnalysisStartClaim,
  media: readonly MediaReference[]
): Promise<Response> {
  const run = await readRun(services.repository, services.clock, claim.runId);
  if (!sameMedia(claim.media, run.media)) {
    throw new RepositoryDataError("Stored analysis run and start claim media do not match");
  }
  if (!sameMedia(run.media, media)) {
    return error(409, "idempotency_key_reused", "Idempotency key was already used with different media");
  }
  if (await hasConfirmation(services.repository, claim.runId) || run.status !== "queued") return accepted(run);
  return error(
    503,
    "analysis_start_pending",
    "Analysis start is pending confirmation; poll the run status"
  );
}

export function createAnalyzePostHandler(servicesFactory: () => AnalysisApiServices = productionServices) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const idempotencyKey = readIdempotencyKey(request);
      const body = await readBoundedJson(request);
      const input = AnalyzeRequestSchema.parse(body);
      const services = servicesFactory();
      const runId = await deriveAnalysisRunId(idempotencyKey);

      const existingClaim = await optionalClaim(services.repository, runId);
      if (existingClaim) return await replayClaim(services, existingClaim, input.media);

      await services.preflightAnalysis();
      const service = new AnalysisRunService(services.repository, services.clock);
      let run: AnalysisRunState;
      try {
        run = await service.enqueue(runId, input.media);
      } catch (cause) {
        if (!(cause instanceof AnalysisRunTransitionError)) throw cause;
        run = await service.readSnapshot(runId);
        if (!sameMedia(run.media, input.media)) {
          return error(409, "idempotency_key_reused", "Idempotency key was already used with different media");
        }
      }

      const claim = { runId, media: structuredClone(input.media), claimedAt: services.clock() };
      try {
        await services.repository.createAnalysisStartClaim(claim);
      } catch (cause) {
        if (!(cause instanceof RepositoryConflictError)) throw cause;
        const winner = await services.repository.readAnalysisStartClaim(runId);
        return await replayClaim(services, winner, input.media);
      }

      run = await service.readSnapshot(runId);
      if (!sameMedia(run.media, claim.media)) {
        throw new RepositoryDataError("Stored analysis run and start claim media do not match");
      }

      let workflowRunId: string;
      try {
        workflowRunId = await services.startAnalysis(runId);
      } catch {
        return error(503, "analysis_start_pending", "Analysis start is pending confirmation; poll the run status");
      }
      try {
        await services.repository.createAnalysisStartConfirmation({
          runId,
          workflowRunId,
          confirmedAt: services.clock(),
        });
      } catch (cause) {
        if (!(cause instanceof RepositoryConflictError)) {
          return error(503, "analysis_start_pending", "Analysis start is pending confirmation; poll the run status");
        }
      }
      return accepted(run);
    } catch (cause) {
      if (cause instanceof RequestJsonError) {
        if (cause.status === 415) return error(415, "unsupported_media_type", "Content-Type must be application/json");
        return error(cause.status === 413 ? 413 : 400, cause.status === 413 ? "request_too_large" : "invalid_request", cause.status === 413 ? "Analysis request is too large" : "Invalid analysis request");
      }
      if (cause instanceof ZodError) return error(400, "invalid_request", "Invalid analysis request");
      if (cause instanceof RepositoryConflictError || cause instanceof AnalysisRunTransitionError) {
        return error(409, "analysis_run_conflict", "Analysis run already exists");
      }
      if (cause instanceof RepositoryDataError) {
        return error(500, "analysis_data_invalid", "Stored analysis data is invalid");
      }
      return error(503, "analysis_unavailable", "Analysis service is unavailable");
    }
  };
}

export function createAnalyzeGetHandler(servicesFactory: () => Pick<AnalysisApiServices, "repository" | "clock"> = productionServices) {
  return async function GET(_request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
    const parsedParams = AnalysisRunIdSchema.safeParse((await context.params).runId);
    if (!parsedParams.success) return error(400, "invalid_run_id", "Invalid analysis run ID");
    try {
      const services = servicesFactory();
      const state = await new AnalysisRunService(services.repository, services.clock).readSnapshot(parsedParams.data);
      return json(toAnalysisRunApiState(state), 200);
    } catch (cause) {
      if (cause instanceof RepositoryNotFoundError) return error(404, "analysis_run_not_found", "Analysis run was not found");
      if (cause instanceof RepositoryUnavailableError) return error(503, "analysis_unavailable", "Analysis service is unavailable");
      if (cause instanceof RepositoryDataError || cause instanceof ZodError) return error(500, "analysis_data_invalid", "Stored analysis data is invalid");
      return error(503, "analysis_unavailable", "Analysis service is unavailable");
    }
  };
}
