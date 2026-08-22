import "server-only";
import { FatalError, RetryableError, getStepMetadata } from "workflow";
import {
  AnalysisRunExecutionError,
  AnalysisRunFatalError,
  AnalysisRunService,
  type AnalysisFailureStage,
} from "../lib/analysis/analysis-run-service";
import { GeminiListingDraftGenerator } from "../lib/analysis/gemini-listing-adapter";
import { GemmaPriceRecommendationGenerator } from "../lib/analysis/gemma-price-adapter";
import { requireGoogleApiKey } from "../lib/analysis/google-structured-generation";
import type { ListingDraftGenerator, PriceRecommendationGenerator } from "../lib/analysis/contracts";
import { createMarketplaceRepository } from "../lib/persistence/production-repository";

interface StageDependencies {
  service: AnalysisRunService;
  generator: ListingDraftGenerator | PriceRecommendationGenerator;
}

async function finalizeFatal(
  runId: string,
  stage: AnalysisFailureStage,
  service: AnalysisRunService,
  failureKind: "configuration" | "input" | "comparable_data" | "orchestration"
): Promise<never> {
  try {
    await service.finalizeFatalFailure(runId, failureKind, stage);
  } catch {
    throw new FatalError("Analysis fatal failure could not be finalized");
  }
  throw new FatalError("Analysis stage failed fatally");
}

export async function executeAnalysisStage(
  runId: string,
  stage: AnalysisFailureStage,
  attempt: number,
  dependencies: StageDependencies
): Promise<void> {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) {
    await finalizeFatal(runId, stage, dependencies.service, "orchestration");
  }
  try {
    if (stage === "gemini") {
      await dependencies.service.generateDraftStep(runId, dependencies.generator as ListingDraftGenerator);
    } else {
      await dependencies.service.recommendPriceStep(runId, dependencies.generator as PriceRecommendationGenerator);
    }
  } catch (cause) {
    if (cause instanceof AnalysisRunExecutionError) {
      if (attempt < 2) throw new RetryableError("Analysis model stage failed", { retryAfter: 1_000 });
      try {
        await dependencies.service.finalizeFailure(runId, stage);
      } catch {
        throw new FatalError("Analysis stage failure could not be finalized");
      }
      throw new FatalError("Analysis model stage failed");
    }
    if (cause instanceof AnalysisRunFatalError) {
      await finalizeFatal(runId, cause.failureStage, dependencies.service, cause.failureKind);
    }
    await finalizeFatal(runId, stage, dependencies.service, "orchestration");
  }
}

export async function executeConfigurationPreflight(
  runId: string,
  stage: AnalysisFailureStage,
  service: AnalysisRunService,
  preflight: () => void = requireGoogleApiKey
): Promise<void> {
  try {
    preflight();
  } catch {
    await finalizeFatal(runId, stage, service, "configuration");
  }
}

export async function generateListingStep(runId: string): Promise<void> {
  "use step";
  const service = new AnalysisRunService(createMarketplaceRepository(), () => new Date().toISOString());
  await executeConfigurationPreflight(runId, "gemini", service);
  await executeAnalysisStage(runId, "gemini", getStepMetadata().attempt, {
    service,
    generator: new GeminiListingDraftGenerator(),
  });
}
generateListingStep.maxRetries = 1;

export async function recommendPriceStep(runId: string): Promise<void> {
  "use step";
  const service = new AnalysisRunService(createMarketplaceRepository(), () => new Date().toISOString());
  await executeConfigurationPreflight(runId, "gemma", service);
  await executeAnalysisStage(runId, "gemma", getStepMetadata().attempt, {
    service,
    generator: new GemmaPriceRecommendationGenerator(),
  });
}
recommendPriceStep.maxRetries = 1;

export async function analyzeWorkflow(runId: string): Promise<void> {
  "use workflow";
  await generateListingStep(runId);
  await recommendPriceStep(runId);
}
