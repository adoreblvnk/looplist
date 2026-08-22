import { describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { AnalysisRunService } from "../lib/analysis/analysis-run-service";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { executeAnalysisStage, executeConfigurationPreflight, generateListingStep, recommendPriceStep } from "../workflows/analyze-workflow";
import { comparable, validDraft } from "./domain-fixtures";

vi.mock("server-only", () => ({}));

function clock() { let tick = Date.parse("2026-08-21T10:00:00.000Z"); return () => new Date(tick++).toISOString(); }
function repository() { return new InMemoryMarketplaceRepository({ soldComparables: [comparable], media: validDraft.media.map((media) => ({ media, bytes: new Uint8Array([1]) })) }); }
function listingCandidate() { const value: Partial<typeof validDraft> = structuredClone(validDraft); delete value.media; return value; }

describe("analysis workflow retry policy", () => {
  it("classifies first model/core failure as retryable", async () => {
    const service = new AnalysisRunService(repository(), clock());
    await service.enqueue("workflow-retry", validDraft.media);
    await expect(executeAnalysisStage("workflow-retry", "gemini", 1, { service, generator: { generate: async () => { throw new Error("raw secret"); } } }))
      .rejects.toBeInstanceOf(RetryableError);
    expect(await service.readSnapshot("workflow-retry")).toMatchObject({ status: "running", geminiAttempts: 1 });
  });

  it("finalizes the second model failure and fails terminally without raw text", async () => {
    const service = new AnalysisRunService(repository(), clock());
    await service.enqueue("workflow-final", validDraft.media);
    const generator = { generate: vi.fn(async () => { throw new Error("raw provider secret"); }) };
    await expect(executeAnalysisStage("workflow-final", "gemini", 1, { service, generator })).rejects.toBeInstanceOf(RetryableError);
    const failure = executeAnalysisStage("workflow-final", "gemini", 2, { service, generator });
    await expect(failure).rejects.toBeInstanceOf(FatalError);
    const state = await service.readSnapshot("workflow-final");
    expect(state).toMatchObject({ status: "failed", geminiAttempts: 2, gemmaAttempts: 0 });
    expect(JSON.stringify(state)).not.toContain("secret");
  });

  it("retries Gemma independently without rerunning a durable Gemini draft", async () => {
    const service = new AnalysisRunService(repository(), clock());
    const gemini = vi.fn(async () => listingCandidate());
    await service.enqueue("workflow-gemma", validDraft.media);
    await executeAnalysisStage("workflow-gemma", "gemini", 1, { service, generator: { generate: gemini } });
    const gemma = { generate: vi.fn(async () => { throw new Error("pricing failure"); }) };
    await expect(executeAnalysisStage("workflow-gemma", "gemma", 1, { service, generator: gemma })).rejects.toBeInstanceOf(RetryableError);
    await expect(executeAnalysisStage("workflow-gemma", "gemma", 2, { service, generator: gemma })).rejects.toBeInstanceOf(FatalError);
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(await service.readSnapshot("workflow-gemma")).toMatchObject({ status: "failed", draft: validDraft, gemmaAttempts: 2 });
  });

  it("treats repository and invariant failures as fatal without multiplying attempts", async () => {
    const service = new AnalysisRunService(repository(), clock());
    await expect(executeAnalysisStage("missing-run", "gemini", 1, { service, generator: { generate: vi.fn() } }))
      .rejects.toBeInstanceOf(FatalError);
  });

  it("finalizes deterministic input failure without consuming a Gemini attempt", async () => {
    const service = new AnalysisRunService(new InMemoryMarketplaceRepository(), clock());
    await service.enqueue("workflow-input-fatal", validDraft.media);
    const generate = vi.fn();
    await expect(executeAnalysisStage("workflow-input-fatal", "gemini", 1, { service, generator: { generate } }))
      .rejects.toBeInstanceOf(FatalError);
    expect(generate).not.toHaveBeenCalled();
    expect(await service.readSnapshot("workflow-input-fatal")).toMatchObject({
      status: "failed",
      failureKind: "input",
      failureStage: "gemini",
      geminiAttempts: 0,
      gemmaAttempts: 0,
      error: { code: "analysis_input_invalid" },
    });
  });

  it("finalizes empty authoritative comparable data without consuming a Gemma attempt", async () => {
    const repository = new InMemoryMarketplaceRepository({
      media: validDraft.media.map((media) => ({ media, bytes: new Uint8Array([1]) })),
    });
    const service = new AnalysisRunService(repository, clock());
    await service.enqueue("workflow-comparable-fatal", validDraft.media);
    await executeAnalysisStage("workflow-comparable-fatal", "gemini", 1, {
      service,
      generator: { generate: async () => listingCandidate() },
    });
    const generate = vi.fn();
    await expect(executeAnalysisStage("workflow-comparable-fatal", "gemma", 1, { service, generator: { generate } }))
      .rejects.toBeInstanceOf(FatalError);
    expect(generate).not.toHaveBeenCalled();
    expect(await service.readSnapshot("workflow-comparable-fatal")).toMatchObject({
      status: "failed",
      failureKind: "comparable_data",
      failureStage: "gemma",
      draft: validDraft,
      geminiAttempts: 1,
      gemmaAttempts: 0,
      error: { code: "analysis_comparable_data_invalid" },
    });
  });

  it("durably finalizes configuration failure from queued state", async () => {
    const service = new AnalysisRunService(repository(), clock());
    await service.enqueue("workflow-config-fatal", validDraft.media);
    await expect(executeConfigurationPreflight("workflow-config-fatal", "gemini", service, () => {
      throw new Error("secret configuration detail");
    })).rejects.toBeInstanceOf(FatalError);
    const failed = await service.readSnapshot("workflow-config-fatal");
    expect(failed).toMatchObject({
      status: "failed",
      failureKind: "configuration",
      failureStage: "gemini",
      geminiAttempts: 0,
      gemmaAttempts: 0,
      error: { code: "analysis_configuration_unavailable" },
    });
    expect(JSON.stringify(failed)).not.toContain("secret");
  });

  it("encodes Workflow 4 retry count explicitly and enforces 1-based attempt metadata", async () => {
    expect(generateListingStep.maxRetries).toBe(1);
    expect(recommendPriceStep.maxRetries).toBe(1);
    const service = new AnalysisRunService(repository(), clock());
    await service.enqueue("workflow-invalid-attempt", validDraft.media);
    await expect(executeAnalysisStage("workflow-invalid-attempt", "gemini", 0, {
      service,
      generator: { generate: vi.fn() },
    })).rejects.toBeInstanceOf(FatalError);
    expect(await service.readSnapshot("workflow-invalid-attempt")).toMatchObject({
      status: "failed",
      failureKind: "orchestration",
      geminiAttempts: 0,
    });
  });
});
