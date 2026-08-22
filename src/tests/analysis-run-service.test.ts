import { describe, expect, it, vi } from "vitest";
import {
  AnalysisRunExecutionError,
  AnalysisRunService,
  AnalysisRunTransitionError,
} from "../lib/analysis/analysis-run-service";
import type { ListingDraftGenerator, PriceRecommendationGenerator } from "../lib/analysis/contracts";
import type { MediaReference } from "../lib/domain/marketplace";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { RepositoryUnavailableError } from "../lib/persistence/repository";
import { comparable, validDraft } from "./domain-fixtures";

function media(): MediaReference[] {
  return structuredClone(validDraft.media);
}

function listingCandidate() {
  const candidate: Partial<typeof validDraft> = structuredClone(validDraft);
  delete candidate.media;
  return candidate;
}

function priceCandidate() {
  return {
    recommendedAtomicAmount: "850000000",
    minimumAtomicAmount: "800000000",
    maximumAtomicAmount: "900000000",
    comparables: [{
      comparableId: comparable.comparableId,
      similarityScore: 0.95,
      similarityReason: "The same model and condition make this a strong comparison.",
    }],
    strongestComparableIds: [comparable.comparableId],
    rationale: "The strongest immutable sold comparable supports this recommendation and range.",
  };
}

function clock(...timestamps: string[]) {
  let index = 0;
  return () => {
    const value = timestamps[index++];
    if (!value) throw new Error("Test clock exhausted");
    return value;
  };
}

function sequentialClock(start = Date.parse("2026-08-21T10:00:00.000Z")) {
  let tick = start;
  return () => new Date(tick++).toISOString();
}

function repository() {
  return new InMemoryMarketplaceRepository({
    soldComparables: [comparable],
    media: media().map((reference, index) => ({ media: reference, bytes: new Uint8Array([index + 1]) })),
  });
}

describe("durable analysis run service", () => {
  it("serializes only the same run while unrelated runs continue", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    await service.enqueue("analysis-blocked-a", media());
    let releaseA!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseA = resolve; });
    let providerAStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerAStarted = resolve; });
    const runA = service.generateDraftStep("analysis-blocked-a", {
      generate: async () => {
        providerAStarted();
        await blocked;
        return listingCandidate();
      },
    });
    await started;

    let sameRunReadSettled = false;
    const sameRunRead = service.readSnapshot("analysis-blocked-a").then((snapshot) => {
      sameRunReadSettled = true;
      return snapshot;
    });
    const queuedB = await service.enqueue("analysis-unblocked-b", media());
    expect(await service.readSnapshot(queuedB.runId)).toMatchObject({ status: "queued" });
    expect(await service.generateDraftStep(queuedB.runId, { generate: async () => listingCandidate() }))
      .toMatchObject({ status: "running", draft: validDraft });
    expect(sameRunReadSettled).toBe(false);

    releaseA();
    await expect(runA).resolves.toMatchObject({ status: "running", draft: validDraft });
    await expect(sameRunRead).resolves.toMatchObject({ status: "running", draft: validDraft });
  });
  it("persists full media and legal separate-step counters without rerunning models", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const listingGenerate = vi.fn(async () => listingCandidate());
    const priceGenerate = vi.fn(async () => priceCandidate());
    const queued = await service.enqueue("analysis-run-core", media());
    expect(queued).toMatchObject({ status: "queued", media: media(), photoIds: media().map(({ id }) => id), attempt: 0, geminiAttempts: 0, gemmaAttempts: 0 });
    const running = await service.generateDraftStep(queued.runId, { generate: listingGenerate } satisfies ListingDraftGenerator);
    expect(running).toMatchObject({ status: "running", draft: validDraft, attempt: 1, geminiAttempts: 1, gemmaAttempts: 0 });
    const succeeded = await service.recommendPriceStep(queued.runId, { generate: priceGenerate } satisfies PriceRecommendationGenerator);
    expect(succeeded).toMatchObject({ status: "succeeded", media: media(), draft: validDraft, attempt: 2, geminiAttempts: 1, gemmaAttempts: 1 });
    expect(listingGenerate).toHaveBeenCalledTimes(1);
    expect(priceGenerate).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate IDs and pathnames at enqueue", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const duplicateId = media();
    duplicateId[1] = { ...duplicateId[1], id: duplicateId[0].id, pathname: duplicateId[0].pathname };
    await expect(service.enqueue("analysis-duplicate-id", duplicateId)).rejects.toThrow();

    const duplicatePathname = media();
    duplicatePathname[1] = { ...duplicatePathname[1], id: duplicatePathname[0].id };
    await expect(service.enqueue("analysis-duplicate-path", duplicatePathname)).rejects.toThrow();
  });

  it("retries Gemini, leaves running on exceptions, then explicitly finalizes sanitized failure", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    await service.enqueue("analysis-run-failure", media());
    const generate = vi.fn(async () => { throw new Error("secret provider payload"); });
    await expect(service.generateDraftStep("analysis-run-failure", { generate })).rejects.toMatchObject({ code: "analysis_listing_generation_failed" });
    expect(await service.readSnapshot("analysis-run-failure")).toMatchObject({ status: "running", geminiAttempts: 1, gemmaAttempts: 0 });
    await expect(service.finalizeFailure("analysis-run-failure", "gemini")).rejects.toBeInstanceOf(AnalysisRunTransitionError);
    await expect(service.generateDraftStep("analysis-run-failure", { generate })).rejects.toBeInstanceOf(AnalysisRunExecutionError);
    expect(generate).toHaveBeenCalledTimes(2);
    await expect(service.generateDraftStep("analysis-run-failure", { generate })).rejects.toMatchObject({ failureKind: "orchestration" });
    const failed = await service.finalizeFailure("analysis-run-failure", "gemini");
    expect(failed).toMatchObject({ status: "failed", media: media(), geminiAttempts: 2, gemmaAttempts: 0, error: {
      code: "analysis_listing_generation_failed", message: "Listing analysis failed. Please retry.",
    } });
    expect(JSON.stringify(failed)).not.toContain("secret");
  });

  it("retries Gemma independently, retains draft, and never reruns Gemini", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const listingGenerate = vi.fn(async () => listingCandidate());
    const priceGenerate = vi.fn()
      .mockRejectedValueOnce(new Error("secret Gemma failure"))
      .mockResolvedValueOnce(priceCandidate());
    await service.enqueue("analysis-run-price-retry", media());
    await service.generateDraftStep("analysis-run-price-retry", { generate: listingGenerate });
    await expect(service.recommendPriceStep("analysis-run-price-retry", { generate: priceGenerate })).rejects.toMatchObject({ code: "analysis_price_recommendation_failed" });
    expect(await service.readSnapshot("analysis-run-price-retry")).toMatchObject({ status: "running", draft: validDraft, geminiAttempts: 1, gemmaAttempts: 1 });
    const succeeded = await service.recommendPriceStep("analysis-run-price-retry", { generate: priceGenerate });
    expect(succeeded).toMatchObject({ status: "succeeded", geminiAttempts: 1, gemmaAttempts: 2 });
    expect(listingGenerate).toHaveBeenCalledTimes(1);
    expect(priceGenerate).toHaveBeenCalledTimes(2);
  });

  it("finalizes exhausted Gemma failure with its durable draft and protects terminal state", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const failure = { generate: async () => { throw new Error("provider text"); } };
    await service.enqueue("analysis-gemma-failed", media());
    await service.generateDraftStep("analysis-gemma-failed", { generate: async () => listingCandidate() });
    await expect(service.recommendPriceStep("analysis-gemma-failed", failure)).rejects.toBeInstanceOf(AnalysisRunExecutionError);
    await expect(service.recommendPriceStep("analysis-gemma-failed", failure)).rejects.toBeInstanceOf(AnalysisRunExecutionError);
    const failed = await service.finalizeFailure("analysis-gemma-failed", "gemma");
    expect(failed).toMatchObject({ status: "failed", draft: validDraft, geminiAttempts: 1, gemmaAttempts: 2, error: {
      code: "analysis_price_recommendation_failed", message: "Price recommendation failed. Please retry.",
    } });
    await expect(service.finalizeFailure("analysis-gemma-failed", "gemma")).rejects.toBeInstanceOf(AnalysisRunTransitionError);
  });

  it("returns durable draft and success idempotently on replay", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const listingGenerate = vi.fn(async () => listingCandidate());
    const priceGenerate = vi.fn(async () => priceCandidate());
    await service.enqueue("analysis-idempotent", media());
    const draft = await service.generateDraftStep("analysis-idempotent", { generate: listingGenerate });
    expect(await service.generateDraftStep("analysis-idempotent", { generate: listingGenerate })).toEqual(draft);
    const success = await service.recommendPriceStep("analysis-idempotent", { generate: priceGenerate });
    expect(await service.recommendPriceStep("analysis-idempotent", { generate: priceGenerate })).toEqual(success);
    expect(await service.generateDraftStep("analysis-idempotent", { generate: listingGenerate })).toEqual(success);
    expect(listingGenerate).toHaveBeenCalledTimes(1);
    expect(priceGenerate).toHaveBeenCalledTimes(1);
  });

  it("replays durable outputs after a stored response is lost", async () => {
    const draftRepository = repository();
    const saveDraft = draftRepository.saveRunSnapshot.bind(draftRepository);
    let loseDraftResponse = true;
    draftRepository.saveRunSnapshot = async (candidate) => {
      const saved = await saveDraft(candidate);
      if (loseDraftResponse && saved.kind === "analysis" && saved.status === "running" && saved.draft) {
        loseDraftResponse = false;
        throw new RepositoryUnavailableError();
      }
      return saved;
    };
    const draftService = new AnalysisRunService(draftRepository, sequentialClock());
    const listingGenerate = vi.fn(async () => listingCandidate());
    await draftService.enqueue("analysis-lost-draft-response", media());
    await expect(
      draftService.generateDraftStep("analysis-lost-draft-response", { generate: listingGenerate })
    ).rejects.toMatchObject({ failureKind: "orchestration" });
    expect(
      await draftService.generateDraftStep("analysis-lost-draft-response", { generate: listingGenerate })
    ).toMatchObject({ status: "running", draft: validDraft });
    expect(listingGenerate).toHaveBeenCalledTimes(1);

    const successRepository = repository();
    const saveSuccess = successRepository.saveRunSnapshot.bind(successRepository);
    let loseSuccessResponse = true;
    successRepository.saveRunSnapshot = async (candidate) => {
      const saved = await saveSuccess(candidate);
      if (loseSuccessResponse && saved.kind === "analysis" && saved.status === "succeeded") {
        loseSuccessResponse = false;
        throw new RepositoryUnavailableError();
      }
      return saved;
    };
    const successService = new AnalysisRunService(successRepository, sequentialClock());
    const priceGenerate = vi.fn(async () => priceCandidate());
    await successService.enqueue("analysis-lost-success-response", media());
    await successService.generateDraftStep("analysis-lost-success-response", {
      generate: async () => listingCandidate(),
    });
    await expect(
      successService.recommendPriceStep("analysis-lost-success-response", { generate: priceGenerate })
    ).rejects.toMatchObject({ failureKind: "orchestration" });
    expect(
      await successService.recommendPriceStep("analysis-lost-success-response", { generate: priceGenerate })
    ).toMatchObject({ status: "succeeded" });
    expect(priceGenerate).toHaveBeenCalledTimes(1);
  });

  it("rejects early and wrong-stage failure finalization", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const listingFailure = { generate: async () => { throw new Error("provider failure"); } };
    await service.enqueue("analysis-finalize-stage", media());
    await expect(service.generateDraftStep("analysis-finalize-stage", listingFailure))
      .rejects.toBeInstanceOf(AnalysisRunExecutionError);
    await expect(service.finalizeFailure("analysis-finalize-stage", "gemma"))
      .rejects.toBeInstanceOf(AnalysisRunTransitionError);
    await service.generateDraftStep("analysis-finalize-stage", { generate: async () => listingCandidate() });
    await expect(service.finalizeFailure("analysis-finalize-stage", "gemini"))
      .rejects.toBeInstanceOf(AnalysisRunTransitionError);
    await expect(service.recommendPriceStep("analysis-finalize-stage", {
      generate: async () => { throw new Error("provider failure"); },
    })).rejects.toBeInstanceOf(AnalysisRunExecutionError);
    await expect(service.finalizeFailure("analysis-finalize-stage", "gemma"))
      .rejects.toBeInstanceOf(AnalysisRunTransitionError);
  });

  it.each([
    ["start", ["2026-08-21T10:00:00.000Z", "2026-08-21T09:59:59.999Z"]],
    ["attempt", ["2026-08-21T10:00:00.000Z", "2026-08-21T10:01:00.000Z", "2026-08-21T10:00:59.999Z"]],
  ])("rejects a backwards %s clock before saving", async (branch, timestamps) => {
    const service = new AnalysisRunService(repository(), clock(...timestamps));
    await service.enqueue(`analysis-backwards-${branch}`, media());
    await expect(service.generateDraftStep(`analysis-backwards-${branch}`, { generate: async () => listingCandidate() }))
      .rejects.toBeInstanceOf(AnalysisRunTransitionError);
  });

  it("succeeds on Gemini's second attempt with exactly two calls", async () => {
    const service = new AnalysisRunService(repository(), sequentialClock());
    const generate = vi.fn().mockRejectedValueOnce(new Error("first failure")).mockResolvedValueOnce(listingCandidate());
    await service.enqueue("analysis-gemini-second-success", media());
    await expect(service.generateDraftStep("analysis-gemini-second-success", { generate }))
      .rejects.toBeInstanceOf(AnalysisRunExecutionError);
    const running = await service.generateDraftStep("analysis-gemini-second-success", { generate });
    expect(running).toMatchObject({ status: "running", geminiAttempts: 2, gemmaAttempts: 0, draft: validDraft });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["draft", ["2026-08-21T10:00:00.000Z", "2026-08-21T10:01:00.000Z", "2026-08-21T10:02:00.000Z", "2026-08-21T10:01:59.999Z"]],
    ["success", ["2026-08-21T10:00:00.000Z", "2026-08-21T10:01:00.000Z", "2026-08-21T10:02:00.000Z", "2026-08-21T10:03:00.000Z", "2026-08-21T10:04:00.000Z", "2026-08-21T10:03:59.999Z"]],
  ])("rejects a backwards %s output clock", async (branch, timestamps) => {
    const service = new AnalysisRunService(repository(), clock(...timestamps));
    await service.enqueue(`analysis-backwards-${branch}`, media());
    if (branch === "draft") {
      await expect(service.generateDraftStep(`analysis-backwards-${branch}`, { generate: async () => listingCandidate() }))
        .rejects.toBeInstanceOf(AnalysisRunTransitionError);
      return;
    }
    await service.generateDraftStep(`analysis-backwards-${branch}`, { generate: async () => listingCandidate() });
    await expect(service.recommendPriceStep(`analysis-backwards-${branch}`, { generate: async () => priceCandidate() }))
      .rejects.toBeInstanceOf(AnalysisRunTransitionError);
  });

  it("rejects a backwards final-failure clock", async () => {
    const service = new AnalysisRunService(repository(), clock(
      "2026-08-21T10:00:00.000Z", "2026-08-21T10:01:00.000Z", "2026-08-21T10:02:00.000Z",
      "2026-08-21T10:03:00.000Z", "2026-08-21T10:02:59.999Z"
    ));
    const generator = { generate: async () => { throw new Error("failure"); } };
    await service.enqueue("analysis-backwards-failure", media());
    await expect(service.generateDraftStep("analysis-backwards-failure", generator)).rejects.toBeInstanceOf(AnalysisRunExecutionError);
    await expect(service.generateDraftStep("analysis-backwards-failure", generator)).rejects.toBeInstanceOf(AnalysisRunExecutionError);
    await expect(service.finalizeFailure("analysis-backwards-failure", "gemini"))
      .rejects.toBeInstanceOf(AnalysisRunTransitionError);
  });
});
