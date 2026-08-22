import type { MediaReference } from "./types";

export interface AnalysisLifecycle {
  analysisKey: string;
  uploadedMedia: MediaReference[];
  runId: string | null;
  terminalFailed: boolean;
}

export type AnalysisAttemptPlan =
  | { action: "upload"; analysisKey: string }
  | { action: "start"; analysisKey: string; media: MediaReference[] }
  | { action: "poll"; runId: string };

export function planAnalysisAttempt(state: AnalysisLifecycle): AnalysisAttemptPlan {
  if (state.runId) return { action: "poll", runId: state.runId };
  if (state.uploadedMedia.length > 0) {
    return { action: "start", analysisKey: state.analysisKey, media: state.uploadedMedia };
  }
  return { action: "upload", analysisKey: state.analysisKey };
}

export function selectDifferentFiles(newKey: string): AnalysisLifecycle {
  return { analysisKey: newKey, uploadedMedia: [], runId: null, terminalFailed: false };
}

export function startNewAnalysis(state: AnalysisLifecycle, newKey: string): AnalysisLifecycle {
  return { ...state, analysisKey: newKey, runId: null, terminalFailed: false };
}
