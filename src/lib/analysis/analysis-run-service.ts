import { ZodError } from "zod";
import {
  ANALYSIS_RUN_FAILURES,
  AnalysisRunStateSchema,
  MAX_ANALYSIS_STAGE_ATTEMPTS as DOMAIN_MAX_ANALYSIS_STAGE_ATTEMPTS,
  type AnalysisFailureKind,
  type AnalysisFailureStage,
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
import { AnalysisCoreError, hydrateListingDraft, prepareListingGeneration } from "./generate-listing-draft";
import { hydratePriceRecommendation, preparePriceRecommendation } from "./recommend-price";

export type AnalysisClock = () => string;
export type { AnalysisFailureStage };
export const MAX_ANALYSIS_STAGE_ATTEMPTS = DOMAIN_MAX_ANALYSIS_STAGE_ATTEMPTS;

export class AnalysisRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisRunTransitionError";
  }
}

/** Only provider invocation failures and invalid provider structured output use this retryable class. */
export class AnalysisRunExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AnalysisRunExecutionError";
  }
}

/** Deterministic, authoritative-data, repository, configuration, and invariant failures are fatal. */
export class AnalysisRunFatalError extends Error {
  constructor(
    readonly failureKind: Exclude<AnalysisFailureKind, "gemini" | "gemma">,
    readonly failureStage: AnalysisFailureStage
  ) {
    super(ANALYSIS_RUN_FAILURES[failureKind].message);
    this.name = "AnalysisRunFatalError";
  }
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

function fatalKind(stage: AnalysisFailureStage, error: unknown): AnalysisRunFatalError {
  if (error instanceof AnalysisRunFatalError) return error;
  if (error instanceof RepositoryUnavailableError || error instanceof RepositoryConflictError) {
    return new AnalysisRunFatalError("orchestration", stage);
  }
  if (stage === "gemini") {
    return new AnalysisRunFatalError("input", stage);
  }
  if (error instanceof RepositoryDataError || error instanceof RepositoryNotFoundError || error instanceof AnalysisCoreError || error instanceof ZodError) {
    return new AnalysisRunFatalError("comparable_data", stage);
  }
  return new AnalysisRunFatalError("orchestration", stage);
}

/** One workflow is the sole mutable snapshot writer for each claimed run. */
export class AnalysisRunService {
  private readonly transitionTails = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: MarketplaceRepository,
    private readonly clock: AnalysisClock
  ) {}

  enqueue(runId: string, input: readonly MediaReference[]): Promise<AnalysisRunState> {
    return this.serial(runId, async () => {
      const media = AnalysisMediaInputSchema.parse(structuredClone(input));
      const now = this.clock();
      const queued = AnalysisRunStateSchema.parse({
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
      });
      if (queued.status !== "queued") {
        throw new AnalysisRunTransitionError("Initial analysis run must be queued");
      }
      try {
        return AnalysisRunStateSchema.parse(
          structuredClone(await this.repository.createAnalysisRun(queued))
        );
      } catch (error) {
        if (error instanceof RepositoryConflictError) {
          throw new AnalysisRunTransitionError("Analysis run already exists");
        }
        throw error;
      }
    });
  }

  generateDraftStep(runId: string, generator: ListingDraftGenerator): Promise<DraftAvailableAnalysis> {
    return this.serial(runId, async () => {
      let current: AnalysisRunState;
      try {
        current = await this.read(runId);
      } catch (error) {
        throw fatalKind("gemini", error);
      }
      if ((current.status === "running" || current.status === "succeeded") && current.draft) {
        return current as DraftAvailableAnalysis;
      }
      this.assertMutable(current);

      if (current.status === "queued") {
        const startedAt = this.nextTimestamp(current);
        try {
          current = await this.save(AnalysisRunStateSchema.parse({
            ...current,
            status: "running",
            startedAt,
            updatedAt: startedAt,
          }));
        } catch (error) {
          throw fatalKind("gemini", error);
        }
      }
      if (current.status !== "running" || current.draft) {
        throw new AnalysisRunFatalError("orchestration", "gemini");
      }
      if (current.geminiAttempts >= MAX_ANALYSIS_STAGE_ATTEMPTS) {
        throw new AnalysisRunFatalError("orchestration", "gemini");
      }

      let prepared: Awaited<ReturnType<typeof prepareListingGeneration>>;
      try {
        prepared = await prepareListingGeneration(this.repository, current.media);
      } catch (error) {
        throw fatalKind("gemini", error);
      }

      const attemptAt = this.nextTimestamp(current);
      try {
        current = await this.save(AnalysisRunStateSchema.parse({
          ...current,
          geminiAttempts: current.geminiAttempts + 1,
          attempt: current.attempt + 1,
          updatedAt: attemptAt,
        }));
      } catch (error) {
        throw fatalKind("gemini", error);
      }
      if (current.status !== "running") throw new AnalysisRunFatalError("orchestration", "gemini");

      let draft: ListingDraft;
      try {
        const output = await generator.generate({ photos: structuredClone(prepared.photos) });
        draft = hydrateListingDraft(prepared, output);
      } catch {
        throw new AnalysisRunExecutionError(ANALYSIS_RUN_FAILURES.gemini.code, ANALYSIS_RUN_FAILURES.gemini.message);
      }

      const updatedAt = this.nextTimestamp(current);
      try {
        const saved = await this.save(AnalysisRunStateSchema.parse({ ...current, draft, updatedAt }));
        if (saved.status !== "running" || !saved.draft) throw new AnalysisRunTransitionError("Stored analysis run lost its listing draft");
        return saved as RunningWithDraft;
      } catch (error) {
        throw fatalKind("gemini", error);
      }
    });
  }

  recommendPriceStep(runId: string, generator: PriceRecommendationGenerator): Promise<SucceededAnalysis> {
    return this.serial(runId, async () => {
      let current: AnalysisRunState;
      try {
        current = await this.read(runId);
      } catch (error) {
        throw fatalKind("gemma", error);
      }
      if (current.status === "succeeded") return current as SucceededAnalysis;
      this.assertMutable(current);
      if (current.status !== "running" || !current.draft) {
        throw new AnalysisRunFatalError("orchestration", "gemma");
      }
      if (current.gemmaAttempts >= MAX_ANALYSIS_STAGE_ATTEMPTS) {
        throw new AnalysisRunFatalError("orchestration", "gemma");
      }

      let prepared: Awaited<ReturnType<typeof preparePriceRecommendation>>;
      try {
        prepared = await preparePriceRecommendation(this.repository, current.draft);
      } catch (error) {
        throw fatalKind("gemma", error);
      }

      const attemptAt = this.nextTimestamp(current);
      try {
        current = await this.save(AnalysisRunStateSchema.parse({
          ...current,
          gemmaAttempts: current.gemmaAttempts + 1,
          attempt: current.attempt + 1,
          updatedAt: attemptAt,
        }));
      } catch (error) {
        throw fatalKind("gemma", error);
      }
      if (current.status !== "running" || !current.draft) throw new AnalysisRunFatalError("orchestration", "gemma");

      let priceRecommendation: PriceRecommendation;
      try {
        const output = await generator.generate(structuredClone(prepared.generatorInput));
        priceRecommendation = hydratePriceRecommendation(prepared, output);
      } catch {
        throw new AnalysisRunExecutionError(ANALYSIS_RUN_FAILURES.gemma.code, ANALYSIS_RUN_FAILURES.gemma.message);
      }

      const completedAt = this.nextTimestamp(current);
      try {
        return (await this.save(AnalysisRunStateSchema.parse({
          ...current,
          status: "succeeded",
          priceRecommendation,
          completedAt,
          updatedAt: completedAt,
        }))) as SucceededAnalysis;
      } catch (error) {
        throw fatalKind("gemma", error);
      }
    });
  }

  finalizeFailure(runId: string, stage: AnalysisFailureStage): Promise<FailedAnalysis> {
    return this.serial(runId, async () => {
      const current = await this.read(runId);
      this.assertMutable(current);
      if (current.status !== "running") throw new AnalysisRunTransitionError("Analysis run has not started");
      const matchingStage = stage === "gemini" ? !current.draft : Boolean(current.draft);
      const stageAttempts = stage === "gemini" ? current.geminiAttempts : current.gemmaAttempts;
      if (!matchingStage || stageAttempts !== MAX_ANALYSIS_STAGE_ATTEMPTS) {
        throw new AnalysisRunTransitionError("Analysis failure stage is not exhausted and incomplete");
      }
      return this.saveFailure(current, stage, stage);
    });
  }

  finalizeFatalFailure(
    runId: string,
    failureKind: Exclude<AnalysisFailureKind, "gemini" | "gemma">,
    stage: AnalysisFailureStage
  ): Promise<FailedAnalysis> {
    return this.serial(runId, async () => {
      const current = await this.read(runId);
      if (current.status === "failed") return current as FailedAnalysis;
      if (current.status === "succeeded") throw new AnalysisRunTransitionError("Analysis run is terminal");
      if (stage === "gemini" && current.status === "running" && current.draft && failureKind !== "orchestration") {
        throw new AnalysisRunTransitionError("Only Gemini orchestration failure may preserve a durable draft");
      }
      if (stage === "gemma" && (current.status !== "running" || !current.draft)) {
        throw new AnalysisRunTransitionError("Gemma fatal failure requires a durable draft");
      }
      return this.saveFailure(current, failureKind, stage);
    });
  }

  readSnapshot(runId: string): Promise<AnalysisRunState> {
    return this.serial(runId, () => this.read(runId));
  }

  private async saveFailure(
    current: Exclude<AnalysisRunState, { status: "succeeded" | "failed" }>,
    failureKind: AnalysisFailureKind,
    failureStage: AnalysisFailureStage
  ): Promise<FailedAnalysis> {
    const startedAt = current.status === "running" ? current.startedAt : this.nextTimestamp(current);
    const basis = current.status === "running" ? current : { ...current, startedAt, updatedAt: startedAt };
    const failedAt = this.nextTimestamp(basis);
    return (await this.save(AnalysisRunStateSchema.parse({
      ...basis,
      status: "failed",
      startedAt,
      failedAt,
      updatedAt: failedAt,
      failureKind,
      failureStage,
      error: ANALYSIS_RUN_FAILURES[failureKind],
    }))) as FailedAnalysis;
  }

  private assertMutable(run: AnalysisRunState): void {
    if (run.status === "succeeded" || run.status === "failed") {
      throw new AnalysisRunTransitionError("Analysis run is terminal");
    }
  }

  private nextTimestamp(current: Pick<AnalysisRunState, "updatedAt">): string {
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
