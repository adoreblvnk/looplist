import { describe, expect, it } from "vitest";
import {
  analysisPhotosAreBound,
  planAnalysisAttempt,
  selectDifferentFiles,
  startNewAnalysis,
  type AnalysisLifecycle,
} from "../components/marketplace/sell-flow-lifecycle";
import type { MediaReference } from "../components/marketplace/types";

const media: MediaReference[] = [
  {
    id: "photo-1",
    pathname: "media/uploads/session/photo-1.webp",
    mediaType: "image",
    mimeType: "image/webp",
    alt: "Photo 1",
    width: 640,
    height: 480,
  },
];

function lifecycle(overrides: Partial<AnalysisLifecycle> = {}): AnalysisLifecycle {
  return {
    analysisKey: "analysis-key-old",
    uploadedMedia: [],
    runId: null,
    terminalFailed: false,
    ...overrides,
  };
}

describe("seller analysis lifecycle decisions", () => {
  it("resumes polling the same durable run without upload or POST", () => {
    expect(planAnalysisAttempt(lifecycle({ uploadedMedia: media, runId: "run-existing" }))).toEqual({
      action: "poll",
      runId: "run-existing",
    });
  });

  it("reuses uploaded media and the same key when start transport acknowledgement is missing", () => {
    expect(planAnalysisAttempt(lifecycle({ uploadedMedia: media }))).toEqual({
      action: "start",
      analysisKey: "analysis-key-old",
      media,
    });
  });

  it("rotates a terminal failed run key but retains its immutable uploaded media", () => {
    const next = startNewAnalysis(
      lifecycle({ uploadedMedia: media, runId: "run-failed", terminalFailed: true }),
      "analysis-key-new",
    );
    expect(next).toEqual({
      analysisKey: "analysis-key-new",
      uploadedMedia: media,
      runId: null,
      terminalFailed: false,
    });
    expect(planAnalysisAttempt(next).action).toBe("start");
  });

  it("never keeps uploaded media, run ID, or idempotency key for changed files", () => {
    const next = selectDifferentFiles("analysis-key-new");
    expect(next).toEqual({
      analysisKey: "analysis-key-new",
      uploadedMedia: [],
      runId: null,
      terminalFailed: false,
    });
    expect(planAnalysisAttempt(next)).toEqual({ action: "upload", analysisKey: "analysis-key-new" });
  });

  it("fails closed for reordered analysis photos or evidence with an unknown immutable source", () => {
    expect(analysisPhotosAreBound(["photo-1"], media, ["photo-1"])).toBe(true);
    expect(analysisPhotosAreBound(["photo-other"], media, ["photo-other"])).toBe(false);
    expect(analysisPhotosAreBound(["photo-1"], media, ["photo-unknown"])).toBe(false);
  });
});
