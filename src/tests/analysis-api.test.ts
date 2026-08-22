import { describe, expect, it, vi } from "vitest";
import { AnalysisRunService } from "../lib/analysis/analysis-run-service";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { RepositoryDataError, RepositoryNotFoundError, RepositoryUnavailableError } from "../lib/persistence/repository";
import {
  createAnalyzeGetHandler,
  createAnalyzePostHandler,
  deriveAnalysisRunId,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_PATTERN,
  type AnalysisApiServices,
} from "../lib/server/analysis-api";
import { AnalyzeAcceptedSchema, AnalyzeRequestSchema, AnalysisRunApiStateSchema } from "../lib/server/analysis-api-schemas";
import { validDraft } from "./domain-fixtures";
import { uploadedMediaPath } from "../lib/persistence/paths";

vi.mock("server-only", () => ({}));

function webp(width = 1600, height = 1200): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8], 20);
  return bytes;
}
function fullMedia() { return structuredClone(validDraft.media).map((reference) => ({ ...reference, alt: "Seller-uploaded product photo", pathname: uploadedMediaPath(reference.id, reference.id, "webp") })); }
function media() { return fullMedia().map(({ pathname: _pathname, ...reference }) => { void _pathname; return reference; }); }
function seededRepository() { return new InMemoryMarketplaceRepository({ media: fullMedia().map((reference) => ({ media: reference, bytes: webp(reference.width, reference.height) })) }); }
function services(repository = seededRepository()): AnalysisApiServices {
  return {
    repository,
    clock: () => "2026-08-21T10:00:00.000Z",
    preflightAnalysis: vi.fn(),
    startAnalysis: vi.fn(async () => "wrun_private_engine_id"),
  };
}
function request(body: unknown, key = "request-key-0001", headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key, ...headers },
    body: JSON.stringify(body),
  });
}

async function body(response: Response) { return response.json(); }

function overlapInitialCreates(repository: InMemoryMarketplaceRepository): void {
  const create = repository.createAnalysisRun.bind(repository);
  let entered = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  repository.createAnalysisRun = async (candidate) => {
    entered += 1;
    if (entered === 2) release();
    await barrier;
    return create(candidate);
  };
}

describe("strict idempotent analysis API", () => {
  it("exports strict bounded input and exact Idempotency-Key grammar", async () => {
    expect(AnalyzeRequestSchema.safeParse({ media: media(), extra: true }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ media: fullMedia() }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ media: media().slice(0, 2) }).success).toBe(false);
    const duplicate = media(); duplicate[1] = duplicate[0];
    expect(AnalyzeRequestSchema.safeParse({ media: duplicate }).success).toBe(false);

    expect(IDEMPOTENCY_KEY_MIN_LENGTH).toBe(8);
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(128);
    expect(IDEMPOTENCY_KEY_PATTERN.test("A1234567")).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test(`A${"._~-z".repeat(25)}xy`)).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test("A123456")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test(`A${"b".repeat(128)}`)).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("-1234567")).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test("A123 567")).toBe(false);

    const raw = "NeverStoreThisRawKey-01";
    const first = await deriveAnalysisRunId(raw);
    expect(first).toBe(await deriveAnalysisRunId(raw));
    expect(first).toMatch(/^analysis_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain(raw);
  });

  it("preflights, enqueues, immutably claims, starts once, and confirms the private workflow ID", async () => {
    const dependencies = services();
    const key = "request-key-0002";
    const runId = await deriveAnalysisRunId(key);
    const response = await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key));
    expect(response.status).toBe(202);
    expect(await body(response)).toEqual({ runId, status: "queued" });
    expect(dependencies.preflightAnalysis).toHaveBeenCalledTimes(1);
    expect(dependencies.startAnalysis).toHaveBeenCalledWith(runId);
    expect(await dependencies.repository.readRunSnapshot("analysis", runId)).toMatchObject({ status: "queued" });
    const claim = await dependencies.repository.readAnalysisStartClaim(runId);
    expect(claim).toEqual({ runId, media: fullMedia(), claimedAt: "2026-08-21T10:00:00.000Z" });
    expect(JSON.stringify(claim)).not.toContain(key);
    expect(await dependencies.repository.readAnalysisStartConfirmation(runId)).toEqual({
      runId,
      workflowRunId: "wrun_private_engine_id",
      confirmedAt: "2026-08-21T10:00:00.000Z",
    });
    expect(JSON.stringify(await body(await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key)))))
      .not.toContain("wrun_private_engine_id");
    expect(dependencies.startAnalysis).toHaveBeenCalledTimes(1);
  });

  it("reuses one app run for exact replay and rejects different full media", async () => {
    const dependencies = services();
    const key = "request-key-0003";
    const runId = await deriveAnalysisRunId(key);
    expect((await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key))).status).toBe(202);
    expect((await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key))).status).toBe(202);
    const changed = media(); changed[0].width += 1;
    const conflict = await createAnalyzePostHandler(() => dependencies)(request({ media: changed }, key));
    expect(conflict.status).toBe(400);
    expect((await body(conflict)).error.code).toBe("invalid_media");
    expect(dependencies.startAnalysis).toHaveBeenCalledTimes(1);
    expect(await dependencies.repository.readRunSnapshot("analysis", runId)).toMatchObject({ runId });
  });

  it("rejects hostile concurrent metadata before it can alter the immutable media winner", async () => {
    const repository = seededRepository();
    const dependencies = services(repository);
    const key = "request-key-hostile-media";
    const runId = await deriveAnalysisRunId(key);
    const left = media();
    const right = media();
    right[0].width += 1;
    const startedBindings: Array<{ run: unknown; claim: unknown }> = [];
    dependencies.startAnalysis = vi.fn(async (startedRunId) => {
      startedBindings.push({
        run: await repository.readRunSnapshot("analysis", startedRunId),
        claim: await repository.readAnalysisStartClaim(startedRunId),
      });
      return "wrun_concurrent_media";
    });

    const responses = await Promise.all([
      createAnalyzePostHandler(() => dependencies)(request({ media: left }, key)),
      createAnalyzePostHandler(() => dependencies)(request({ media: right }, key)),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([202, 400]);
    expect((await body(responses.find(({ status }) => status === 400)!)).error.code)
      .toBe("invalid_media");
    const winner = await repository.readRunSnapshot("analysis", runId);
    const claim = await repository.readAnalysisStartClaim(runId);
    expect(winner.kind).toBe("analysis");
    if (winner.kind !== "analysis") throw new Error("Expected analysis run");
    expect(claim.media).toEqual(winner.media);
    expect(dependencies.startAnalysis).toHaveBeenCalledTimes(1);
    expect(startedBindings).toEqual([{ run: winner, claim }]);
  });

  it("starts exactly once for concurrent first requests with identical media", async () => {
    const repository = seededRepository();
    overlapInitialCreates(repository);
    const dependencies = services(repository);
    const key = "request-key-concurrent-same";
    const responses = await Promise.all([
      createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key)),
      createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key)),
    ]);
    expect(responses.every(({ status }) => status === 202 || status === 503)).toBe(true);
    expect(dependencies.startAnalysis).toHaveBeenCalledTimes(1);
    const runId = await deriveAnalysisRunId(key);
    const stored = await repository.readRunSnapshot("analysis", runId);
    if (stored.kind !== "analysis") throw new Error("Expected analysis run");
    expect((await repository.readAnalysisStartClaim(runId)).media).toEqual(stored.media);
  });

  it("rechecks the immutable run binding after winning the claim and before start", async () => {
    const repository = seededRepository();
    const createClaim = repository.createAnalysisStartClaim.bind(repository);
    repository.createAnalysisStartClaim = async (claim) => {
      const created = await createClaim(claim);
      const stored = await repository.readRunSnapshot("analysis", claim.runId);
      if (stored.kind !== "analysis" || stored.status !== "queued") {
        throw new Error("Expected queued analysis run");
      }
      const divergentMedia = structuredClone(stored.media);
      divergentMedia[0].alt = "Injected divergent run media";
      await repository.saveRunSnapshot({ ...stored, media: divergentMedia });
      return created;
    };
    const dependencies = services(repository);
    const response = await createAnalyzePostHandler(() => dependencies)(
      request({ media: media() }, "request-key-prestart-check")
    );
    expect(response.status).toBe(500);
    expect((await body(response)).error.code).toBe("analysis_data_invalid");
    expect(dependencies.startAnalysis).not.toHaveBeenCalled();
  });

  it("rejects stored claim/run media corruption without accepting or starting", async () => {
    const repository = seededRepository();
    const dependencies = services(repository);
    const key = "request-key-corrupt-binding";
    const runId = await deriveAnalysisRunId(key);
    const runMedia = fullMedia();
    await new AnalysisRunService(repository, dependencies.clock).enqueue(runId, runMedia);
    const claimMedia = fullMedia();
    claimMedia[0].alt = "Corrupt claim media";
    await repository.createAnalysisStartClaim({ runId, media: claimMedia, claimedAt: dependencies.clock() });

    const response = await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key));
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({
      error: { code: "analysis_data_invalid", message: "Stored analysis data is invalid" },
    });
    expect(dependencies.startAnalysis).not.toHaveBeenCalled();
  });

  it.each(["success response loss", "definitive throw"])("never starts again after a claim when start has %s", async () => {
    const dependencies = services();
    const key = "request-key-ambiguous";
    let workflowRuns = 0;
    dependencies.startAnalysis = vi.fn(async () => {
      workflowRuns += 1;
      throw new Error("secret workflow failure");
    });
    const first = await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key));
    const replay = await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key));
    expect(first.status).toBe(503);
    expect(replay.status).toBe(503);
    expect((await body(replay)).error.code).toBe("analysis_start_pending");
    expect(dependencies.startAnalysis).toHaveBeenCalledTimes(1);
    expect(workflowRuns).toBe(1);
    expect(await dependencies.repository.readRunSnapshot("analysis", await deriveAnalysisRunId(key))).toMatchObject({ status: "queued" });
  });

  it("fails Google preflight before enqueue, claim, or workflow start", async () => {
    const dependencies = services();
    dependencies.preflightAnalysis = vi.fn(() => { throw new Error("secret missing key"); });
    const key = "request-key-config";
    const runId = await deriveAnalysisRunId(key);
    const response = await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await body(response))).not.toContain("secret");
    await expect(dependencies.repository.readRunSnapshot("analysis", runId)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(dependencies.repository.readAnalysisStartClaim(runId)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(dependencies.startAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    [request({ media: media().slice(0, 2) }, "request-key-0004"), 400, "invalid_request"],
    [new Request("http://localhost/api/analyze", { method: "POST", headers: { "idempotency-key": "request-key-0005" }, body: "{}" }), 415, "unsupported_media_type"],
    [request({ media: media() }, "request-key-0006", { "content-length": "70000" }), 413, "request_too_large"],
    [request({ media: media() }, "short"), 400, "invalid_request"],
  ])("returns stable bounded request errors", async (input, status, code) => {
    const response = await createAnalyzePostHandler(() => services())(input);
    expect(response.status).toBe(status);
    expect(await body(response)).toEqual({ error: { code, message: expect.any(String) } });
  });

  it("reads persisted source truth with no pathnames, bytes, URLs, raw key, or workflow ID", async () => {
    const dependencies = services();
    const key = "request-key-0007";
    const runId = await deriveAnalysisRunId(key);
    await createAnalyzePostHandler(() => dependencies)(request({ media: media() }, key));
    const response = await createAnalyzeGetHandler(() => dependencies)(new Request("http://localhost"), { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await body(response);
    expect(AnalysisRunApiStateSchema.safeParse(payload).success).toBe(true);
    expect(AnalyzeAcceptedSchema.safeParse({ runId, status: payload.status }).success).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("pathname");
    expect(serialized).not.toContain("Uint8Array");
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain("wrun_private_engine_id");
  });

  it.each([
    [new RepositoryNotFoundError(), 404, "analysis_run_not_found"],
    [new RepositoryDataError("secret corrupt record"), 500, "analysis_data_invalid"],
    [new RepositoryUnavailableError("secret provider failure"), 503, "analysis_unavailable"],
  ])("maps GET repository failures without details", async (cause, status, code) => {
    const repository = new InMemoryMarketplaceRepository();
    repository.readRunSnapshot = vi.fn(async () => { throw cause; });
    const response = await createAnalyzeGetHandler(() => services(repository))(new Request("http://localhost"), { params: Promise.resolve({ runId: "analysis-api-run" }) });
    expect(response.status).toBe(status);
    const payload = await body(response);
    expect(payload.error.code).toBe(code);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});
