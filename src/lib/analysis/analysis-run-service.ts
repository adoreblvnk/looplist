import {
  ANALYSIS_RUN_FAILURES,
  AnalysisRunStateSchema,
  MAX_ANALYSIS_STAGE_ATTEMPTS as DOMAIN_MAX_ANALYSIS_STAGE_ATTEMPTS,
  type AnalysisRunState,
  type ListingDraft,
  type MediaReference,
  type PriceRecommendation,
} from "../domain/marketplace";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  type MarketplaceRepository,
} from "../persistence/repository";
import { AnalysisMediaInputSchema, type ListingDraftGenerator, type PriceRecommendationGenerator } from "./contracts";
import { generateListingDraft } from "./generate-listing-draft";
import { recommendPrice } from "./recommend-price";

export type AnalysisClock = () => string;
export type AnalysisFailureStage = "gemini" | "gemma";
export const MAX_ANALYSIS_STAGE_ATTEMPTS = DOMAIN_MAX_ANALYSIS_STAGE_ATTEMPTS;

export class AnalysisRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisRunTransitionError";
  }
}

export class AnalysisRunExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AnalysisRunExecutionError";
  }
}

function isRepositoryError(error: unknown): boolean {
  return error instanceof RepositoryConflictError ||
    error instanceof RepositoryDataError ||
    error instanceof RepositoryNotFoundError ||
    error instanceof RepositoryUnavailableError;
}

type RunningWithDraft = AnalysisRunState & { status: "running"; draft: ListingDraft };
type DraftAvailableAnalysis = AnalysisRunState & {
  status: "running" | "succeeded";
  draft: ListingDraft;
};
type SucceededAnalysis = AnalysisRunState & {
  status: "succeeded";
  priceRecommendation: PriceRecommendation;
};
type FailedAnalysis = AnalysisRunState & { status: "failed" };

/**
 * Serializes transitions per run within this service instance, so unrelated runs do not block.
 * Repository writes remain ordinary last-writer-wins writes, so workflows must keep one writer
 * for each analysis run.
 */
export class AnalysisRunService {
  private readonly transitionTails = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: MarketplaceRepository,
    private readonly clock: AnalysisClock
  ) {}

  enqueue(runId: string, input: readonly MediaReference[]): Promise<AnalysisRunState> {
    return this.serial(runId, async () => {
      const media = AnalysisMediaInputSchema.parse(structuredClone(input));
      try {
        await this.read(runId);
        throw new AnalysisRunTransitionError("Analysis run already exists");
      } catch (error) {
        if (!(error instanceof RepositoryNotFoundError)) throw error;
      }
      const now = this.clock();
      return this.save(AnalysisRunStateSchema.parse({
        runId,
        kind: "analysis",
        status: "queued",
        media,
        photoIds: media.map(({ id }) => id),
        createdAt: now,
        updatedAt: now,
        attempt: 0,
        geminiAttempts: 0,
        gemmaAttempts: 0,
      }));
    });
  }

  generateDraftStep(
    runId: string,
    generator: ListingDraftGenerator
  ): Promise<DraftAvailableAnalysis> {
    return this.serial(runId, async () => {
      let current = await this.read(runId);
      if ((current.status === "running" || current.status === "succeeded") && current.draft) {
        return current as DraftAvailableAnalysis;
      }
      this.assertMutable(current);

      if (current.status === "queued") {
        const startedAt = this.nextTimestamp(current);
        current = await this.save(AnalysisRunStateSchema.parse({
          ...current,
          status: "running",
          startedAt,
          updatedAt: startedAt,
        }));
      }
      if (current.status !== "running" || current.draft) {
        throw new AnalysisRunTransitionError("Analysis run is not ready for listing generation");
      }
      if (current.geminiAttempts >= MAX_ANALYSIS_STAGE_ATTEMPTS) {
        throw new AnalysisRunTransitionError("Listing analysis attempts are exhausted");
      }

      const attemptAt = this.nextTimestamp(current);
      current = await this.save(AnalysisRunStateSchema.parse({
        ...current,
        geminiAttempts: current.geminiAttempts + 1,
        attempt: current.attempt + 1,
        updatedAt: attemptAt,
      }));
      if (current.status !== "running") {
        throw new AnalysisRunTransitionError("Analysis run left the listing generation stage");
      }

      let draft: ListingDraft;
      try {
        draft = await generateListingDraft(this.repository, generator, current.media);
      } catch (error) {
        if (isRepositoryError(error)) throw error;
        throw new AnalysisRunExecutionError(ANALYSIS_RUN_FAILURES.gemini.code, ANALYSIS_RUN_FAILURES.gemini.message);
      }

      const updatedAt = this.nextTimestamp(current);
      const saved = await this.save(AnalysisRunStateSchema.parse({ ...current, draft, updatedAt }));
      if (saved.status !== "running" || !saved.draft) {
        throw new AnalysisRunTransitionError("Stored analysis run lost its listing draft");
      }
      return saved as RunningWithDraft;
    });
  }

  recommendPriceStep(
    runId: string,
    generator: PriceRecommendationGenerator
  ): Promise<SucceededAnalysis> {
    return this.serial(runId, async () => {
      let current = await this.read(runId);
      if (current.status === "succeeded") return current as SucceededAnalysis;
      this.assertMutable(current);
      if (current.status !== "running" || !current.draft) {
        throw new AnalysisRunTransitionError("Analysis run has no durable listing draft");
      }
      if (current.gemmaAttempts >= MAX_ANALYSIS_STAGE_ATTEMPTS) {
        throw new AnalysisRunTransitionError("Price recommendation attempts are exhausted");
      }

      const attemptAt = this.nextTimestamp(current);
      current = await this.save(AnalysisRunStateSchema.parse({
        ...current,
        gemmaAttempts: current.gemmaAttempts + 1,
        attempt: current.attempt + 1,
        updatedAt: attemptAt,
      }));
      if (current.status !== "running" || !current.draft) {
        throw new AnalysisRunTransitionError("Analysis run left the price recommendation stage");
      }

      let priceRecommendation: PriceRecommendation;
      try {
        priceRecommendation = await recommendPrice(this.repository, generator, current.draft);
      } catch (error) {
        if (isRepositoryError(error)) throw error;
        throw new AnalysisRunExecutionError(ANALYSIS_RUN_FAILURES.gemma.code, ANALYSIS_RUN_FAILURES.gemma.message);
      }

      const completedAt = this.nextTimestamp(current);
      return (await this.save(AnalysisRunStateSchema.parse({
        ...current,
        status: "succeeded",
        priceRecommendation,
        completedAt,
        updatedAt: completedAt,
      }))) as SucceededAnalysis;
    });
  }

  finalizeFailure(runId: string, stage: AnalysisFailureStage): Promise<FailedAnalysis> {
    return this.serial(runId, async () => {
      const current = await this.read(runId);
      this.assertMutable(current);
      if (current.status !== "running") {
        throw new AnalysisRunTransitionError("Analysis run has not started");
      }
      const matchingStage = stage === "gemini" ? !current.draft : Boolean(current.draft);
      const stageAttempts = stage === "gemini" ? current.geminiAttempts : current.gemmaAttempts;
      if (!matchingStage || stageAttempts !== MAX_ANALYSIS_STAGE_ATTEMPTS) {
        throw new AnalysisRunTransitionError("Analysis failure stage is not exhausted and incomplete");
      }
      const failedAt = this.nextTimestamp(current);
      return (await this.save(AnalysisRunStateSchema.parse({
        ...current,
        status: "failed",
        failedAt,
        updatedAt: failedAt,
        error: ANALYSIS_RUN_FAILURES[stage],
      }))) as FailedAnalysis;
    });
  }

  readSnapshot(runId: string): Promise<AnalysisRunState> {
    return this.serial(runId, () => this.read(runId));
  }

  private assertMutable(run: AnalysisRunState): void {
    if (run.status === "succeeded" || run.status === "failed") {
      throw new AnalysisRunTransitionError("Analysis run is terminal");
    }
  }

  private nextTimestamp(current: AnalysisRunState): string {
    const next = this.clock();
    if (Date.parse(next) < Date.parse(current.updatedAt)) {
      throw new AnalysisRunTransitionError("Analysis run timestamps must be monotonic");
    }
    return next;
  }

  private async read(runId: string): Promise<AnalysisRunState> {
    const snapshot = await this.repository.readRunSnapshot("analysis", runId);
    return AnalysisRunStateSchema.parse(structuredClone(snapshot));
  }

  private async save(run: AnalysisRunState): Promise<AnalysisRunState> {
    const saved = await this.repository.saveRunSnapshot(AnalysisRunStateSchema.parse(structuredClone(run)));
    return AnalysisRunStateSchema.parse(structuredClone(saved));
  }

  private serial<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.transitionTails.get(runId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    this.transitionTails.set(runId, settled);
    void settled.then(() => {
      if (this.transitionTails.get(runId) === settled) this.transitionTails.delete(runId);
    });
    return result;
  }
}
