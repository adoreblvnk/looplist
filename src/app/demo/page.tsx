"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { StateRail, StepKey } from "@/components/StateRail";
import { PhotoIntake } from "@/components/PhotoIntake";
import { EvidenceSheet } from "@/components/EvidenceSheet";
import { ListingEditor } from "@/components/ListingEditor";
import { ApprovalBlock } from "@/components/ApprovalBlock";
import { VerificationReceipt } from "@/components/VerificationReceipt";
import { OperationalTrace } from "@/components/OperationalTrace";
import {
  AnalyzeResponseDTO,
  PublishResponseDTO,
  EbayListing,
  AnalyzeResponseDTOSchema,
  PublishResponseDTOSchema,
  EbayListingSchema,
  PublishDraftListingSchema,
} from "@/lib/domain/schemas";

const STORAGE_ANALYSIS_RUN_ID = "looplist_analysis_run_id";
const STORAGE_PUBLISH_RUN_ID = "looplist_publish_run_id";
const STORAGE_DISPOSABLE_CACHE = "looplist_disposable_cache";

function safeGetLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function safeRemoveLocalStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

function loadAndValidateDisposableCache(
  runId: string,
  unresolvedQuestions: string[],
  authoritativeImagePaths: string[]
): { listing: EbayListing | null; answers: Record<string, string> } {
  const rawCache = safeGetLocalStorage(STORAGE_DISPOSABLE_CACHE);
  if (!rawCache) {
    return { listing: null, answers: {} };
  }

  let parsedCache: unknown;
  try {
    parsedCache = JSON.parse(rawCache);
  } catch {
    safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
    return { listing: null, answers: {} };
  }

  if (typeof parsedCache !== "object" || parsedCache === null) {
    safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
    return { listing: null, answers: {} };
  }

  const cacheObj = parsedCache as Record<string, unknown>;

  if (cacheObj.analysisRunId !== runId) {
    safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
    return { listing: null, answers: {} };
  }

  const listingParseRes = EbayListingSchema.safeParse(cacheObj.listing);
  if (!listingParseRes.success) {
    safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
    return { listing: null, answers: {} };
  }

  if (
    listingParseRes.data.imagePaths.length !== authoritativeImagePaths.length ||
    listingParseRes.data.imagePaths.some((path, index) => path !== authoritativeImagePaths[index])
  ) {
    safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
    return { listing: null, answers: {} };
  }

  const validAnswers: Record<string, string> = {};
  if (cacheObj.answers !== undefined) {
    if (
      typeof cacheObj.answers !== "object" ||
      cacheObj.answers === null ||
      Array.isArray(cacheObj.answers)
    ) {
      safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
      return { listing: null, answers: {} };
    }

    const questionsSet = new Set(unresolvedQuestions);
    const answersObj = cacheObj.answers as Record<string, unknown>;

    for (const [qKey, qVal] of Object.entries(answersObj)) {
      if (questionsSet.has(qKey) && typeof qVal === "string" && qVal.length <= 300) {
        validAnswers[qKey] = qVal;
      } else {
        safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
        return { listing: null, answers: {} };
      }
    }
  }

  return {
    listing: listingParseRes.data,
    answers: validAnswers,
  };
}

function getMergedListingPayload(
  listing: EbayListing,
  unresolvedQuestions: string[] = [],
  sellerAnswers: Record<string, string> = {}
): EbayListing {
  const answeredPairs = unresolvedQuestions
    .map((q) => {
      const ans = sellerAnswers[q]?.trim();
      return ans ? `• ${q}: ${ans}` : null;
    })
    .filter((line): line is string => line !== null);

  if (answeredPairs.length === 0) {
    return listing;
  }

  const cleanDesc = listing.description.split("\n\nSeller-provided details:")[0].trim();
  const mergedDescription = `${cleanDesc}\n\nSeller-provided details:\n${answeredPairs.join("\n")}`;

  return {
    ...listing,
    description: mergedDescription,
  };
}

function validatePublishPayload(
  listing: EbayListing | null,
  unresolvedQuestions: string[] = [],
  sellerAnswers: Record<string, string> = {}
): { valid: boolean; errors: Record<string, string>; disabledReason: string | null } {
  if (!listing) {
    return { valid: false, errors: {}, disabledReason: "No active listing payload" };
  }

  const errors: Record<string, string> = {};

  const unansweredCount = unresolvedQuestions.filter(
    (q) => !sellerAnswers[q] || !sellerAnswers[q].trim()
  ).length;

  if (unansweredCount > 0) {
    errors["unresolvedQuestions"] = `Answer all unresolved detail questions (${unansweredCount} remaining).`;
  }

  const mergedPayload = getMergedListingPayload(listing, unresolvedQuestions, sellerAnswers);
  const parseResults = [
    EbayListingSchema.safeParse(mergedPayload),
    PublishDraftListingSchema.safeParse(mergedPayload),
  ];

  for (const parseResult of parseResults) {
    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        const pathStr = issue.path.join(".");
        if (!errors[pathStr]) {
          errors[pathStr] = issue.message;
        }
      }
    }
  }

  const valid = Object.keys(errors).length === 0;

  let disabledReason: string | null = null;
  if (!valid) {
    if (errors["unresolvedQuestions"]) {
      disabledReason = errors["unresolvedQuestions"];
    } else if (errors["title"]) {
      disabledReason = errors["title"];
    } else if (errors["description"]) {
      disabledReason = errors["description"];
    } else if (errors["itemSpecifics.Brand"] || errors["Brand"]) {
      disabledReason = errors["itemSpecifics.Brand"] || errors["Brand"] || "Brand item specific is required";
    } else if (errors["itemSpecifics.Model"] || errors["Model"]) {
      disabledReason = errors["itemSpecifics.Model"] || errors["Model"] || "Model item specific is required";
    } else if (errors["priceSgd"]) {
      disabledReason = errors["priceSgd"];
    } else if (errors["priceUsd"]) {
      disabledReason = errors["priceUsd"];
    } else if (errors["category"]) {
      disabledReason = errors["category"];
    } else if (errors["condition"]) {
      disabledReason = errors["condition"];
    } else {
      disabledReason = Object.values(errors)[0];
    }
  }

  return { valid, errors, disabledReason };
}

export default function DemoPage() {
  const [currentStep, setCurrentStep] = useState<StepKey>("photos");
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const [publishRunId, setPublishRunId] = useState<string | null>(null);

  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponseDTO | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResponseDTO | null>(null);
  const [editableListing, setEditableListing] = useState<EbayListing | null>(null);

  const [sellerAnswers, setSellerAnswers] = useState<Record<string, string>>({});
  const [isApproved, setIsApproved] = useState<boolean>(false);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [liveStatusMessage, setLiveStatusMessage] = useState<string>("Ready for item photography intake.");

  const [statusCheckRetry, setStatusCheckRetry] = useState<(() => void) | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const pollAnalysisStatusRef = useRef<(runId: string) => void>(() => {});
  const pollPublishStatusRef = useRef<(runId: string) => void>(() => {});

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleReset = useCallback(() => {
    stopPolling();
    setStatusCheckRetry(null);
    safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
    safeRemoveLocalStorage(STORAGE_PUBLISH_RUN_ID);
    safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
    setAnalysisRunId(null);
    setPublishRunId(null);
    setAnalysisResult(null);
    setPublishResult(null);
    setEditableListing(null);
    setSellerAnswers({});
    setIsApproved(false);
    setIsUploading(false);
    setIsPublishing(false);
    setError(null);
    setCurrentStep("photos");
    setLiveStatusMessage("Reset workspace complete. Ready for item photos.");
  }, [stopPolling]);

  const handleAnalysisComplete = useCallback((dto: AnalyzeResponseDTO) => {
    const parseRes = AnalyzeResponseDTOSchema.safeParse(dto);
    if (!parseRes.success) {
      safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
      safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
      setAnalysisRunId(null);
      setError("Analysis result validation failed.");
      setLiveStatusMessage("Analysis result invalid.");
      return;
    }

    const validDto = parseRes.data;
    setAnalysisResult(validDto);

    const { listing: restoredListing, answers: restoredAnswers } = loadAndValidateDisposableCache(
      validDto.runId,
      validDto.analysis.unresolvedQuestions,
      validDto.imagePaths
    );

    const finalListing =
      restoredListing || {
        title: validDto.analysis.title,
        description: validDto.analysis.description,
        category: validDto.analysis.category,
        condition: validDto.analysis.condition,
        priceSgd: validDto.analysis.priceSuggestion.sgd,
        priceUsd: validDto.analysis.priceSuggestion.usd,
        itemSpecifics: { ...validDto.analysis.itemSpecifics },
        imagePaths: validDto.imagePaths,
      };

    setEditableListing(finalListing);
    setSellerAnswers(restoredAnswers);
    setIsApproved(false);
    setCurrentStep("review");
    setLiveStatusMessage("Gemini analysis completed. Review evidence and edit listing fields.");
  }, []);

  const pollAnalysisStatus = useCallback(
    (runId: string) => {
      stopPolling();
      setStatusCheckRetry(null);
      setError(null);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const check = async () => {
        try {
          const res = await fetch(`/api/analyze/${encodeURIComponent(runId)}`, {
            signal: controller.signal,
          });

          const data = (await res.json().catch(() => null)) as {
            status?: string;
            error?: string;
            result?: AnalyzeResponseDTO;
          } | null;

          if (!res.ok) {
            if (data?.status === "failed") {
              safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
              safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
              setAnalysisRunId(null);
              setError(data.error || "Analysis workflow encountered an unrecoverable failure.");
              setCurrentStep("photos");
              setLiveStatusMessage("Analysis failed.");
              return;
            }

            if (res.status === 400 || res.status === 404) {
              safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
              safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
              setAnalysisRunId(null);
              setError(data?.error || "Analysis run not found");
              setLiveStatusMessage("Analysis run not found.");
              setCurrentStep("photos");
              return;
            }

            const message = data?.error || `Server error checking status (${res.status})`;
            setError(message);
            setLiveStatusMessage(`Analysis error: ${message}`);
            setStatusCheckRetry(() => () => pollAnalysisStatusRef.current(runId));
            return;
          }

          if (!data) {
            throw new Error("Analysis status response was not valid JSON");
          }

          if (data.status === "completed" && data.result) {
            handleAnalysisComplete(data.result);
          } else if (data.status === "completed") {
            safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
            safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
            setAnalysisRunId(null);
            setError("Analysis result was missing from the completed workflow.");
            setCurrentStep("photos");
            setLiveStatusMessage("Analysis result invalid.");
          } else if (data.status === "failed") {
            safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
            safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
            setAnalysisRunId(null);
            setError(data.error || "Analysis workflow encountered an unrecoverable failure.");
            setCurrentStep("photos");
            setLiveStatusMessage("Analysis failed.");
          } else {
            setLiveStatusMessage("Gemini 3.6 Flash multimodal analysis in progress…");
            pollTimerRef.current = setTimeout(() => check(), 1000);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Polling failed";
          setError(msg);
          setLiveStatusMessage(`Analysis error: ${msg}`);
          setStatusCheckRetry(() => () => pollAnalysisStatusRef.current(runId));
        }
      };

      check();
    },
    [stopPolling, handleAnalysisComplete]
  );

  const pollPublishStatus = useCallback(
    (runId: string) => {
      stopPolling();
      setStatusCheckRetry(null);
      setError(null);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const check = async () => {
        try {
          const res = await fetch(`/api/publish/${encodeURIComponent(runId)}`, {
            signal: controller.signal,
          });

          const data = (await res.json().catch(() => null)) as {
            status?: string;
            error?: string;
            result?: PublishResponseDTO;
          } | null;

          if (!res.ok) {
            if (data?.status === "failed") {
              safeRemoveLocalStorage(STORAGE_PUBLISH_RUN_ID);
              setPublishRunId(null);
              setIsPublishing(false);
              setError(data.error || "Publish workflow encountered an unrecoverable failure.");
              setLiveStatusMessage("Publication failed.");
              return;
            }

            if (res.status === 400 || res.status === 404) {
              safeRemoveLocalStorage(STORAGE_PUBLISH_RUN_ID);
              setPublishRunId(null);
              setIsPublishing(false);
              const errorMessage = data?.error || "Publish run not found";
              setError(errorMessage);
              setLiveStatusMessage(`Publication failed: ${errorMessage}`);
              return;
            }

            const message = data?.error || `Server error checking publish status (${res.status})`;
            setError(message);
            setLiveStatusMessage(`Publish error: ${message}`);
            setStatusCheckRetry(() => () => pollPublishStatusRef.current(runId));
            return;
          }

          if (!data) {
            throw new Error("Publish status response was not valid JSON");
          }

          if (data.status === "completed" && data.result) {
            const parseRes = PublishResponseDTOSchema.safeParse(data.result);
            if (!parseRes.success) {
              safeRemoveLocalStorage(STORAGE_PUBLISH_RUN_ID);
              setPublishRunId(null);
              setIsPublishing(false);
              setError("Publish result validation failed.");
              setLiveStatusMessage("Publication result invalid.");
              return;
            }

            setPublishResult(parseRes.data);
            setIsPublishing(false);
            setCurrentStep("verified");
            setLiveStatusMessage("Publication verified successfully with adapter receipt.");

            safeRemoveLocalStorage(STORAGE_ANALYSIS_RUN_ID);
            safeRemoveLocalStorage(STORAGE_DISPOSABLE_CACHE);
          } else if (data.status === "completed") {
            safeRemoveLocalStorage(STORAGE_PUBLISH_RUN_ID);
            setPublishRunId(null);
            setIsPublishing(false);
            setError("Publish result was missing from the completed workflow.");
            setLiveStatusMessage("Publication result invalid.");
          } else if (data.status === "failed") {
            safeRemoveLocalStorage(STORAGE_PUBLISH_RUN_ID);
            setPublishRunId(null);
            setIsPublishing(false);
            setError(data.error || "Publish workflow encountered an unrecoverable failure.");
            setLiveStatusMessage("Publication failed.");
          } else {
            setLiveStatusMessage(
              "Publishing through the demo adapter and independently verifying the retrieved record…"
            );
            pollTimerRef.current = setTimeout(() => check(), 1000);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Publish polling failed";
          setError(msg);
          setLiveStatusMessage(`Publish error: ${msg}`);
          setStatusCheckRetry(() => () => pollPublishStatusRef.current(runId));
        }
      };

      check();
    },
    [stopPolling]
  );

  useEffect(() => {
    pollAnalysisStatusRef.current = pollAnalysisStatus;
    pollPublishStatusRef.current = pollPublishStatus;
  }, [pollAnalysisStatus, pollPublishStatus]);

  useEffect(() => {
    const savedPublishRunId = safeGetLocalStorage(STORAGE_PUBLISH_RUN_ID);
    const savedAnalysisRunId = safeGetLocalStorage(STORAGE_ANALYSIS_RUN_ID);

    const timer = setTimeout(() => {
      if (savedPublishRunId) {
        setPublishRunId(savedPublishRunId);
        setIsPublishing(true);
        setCurrentStep("approval");
        pollPublishStatus(savedPublishRunId);
      } else if (savedAnalysisRunId) {
        setAnalysisRunId(savedAnalysisRunId);
        setCurrentStep("inspection");
        pollAnalysisStatus(savedAnalysisRunId);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [pollAnalysisStatus, pollPublishStatus]);

  useEffect(() => {
    if (analysisRunId && editableListing && currentStep !== "verified") {
      safeSetLocalStorage(
        STORAGE_DISPOSABLE_CACHE,
        JSON.stringify({
          analysisRunId,
          listing: editableListing,
          answers: sellerAnswers,
        })
      );
    }
  }, [analysisRunId, editableListing, sellerAnswers, currentStep]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const validationResult = validatePublishPayload(
    editableListing,
    analysisResult?.analysis.unresolvedQuestions,
    sellerAnswers
  );

  const handleListingChange = (updated: EbayListing) => {
    setEditableListing(updated);
    setIsApproved(false);
  };

  const handleAnswerChange = (q: string, ans: string) => {
    setSellerAnswers((current) => ({ ...current, [q]: ans }));
    setIsApproved(false);
  };

  const handleStartAnalysis = async (imagePaths: string[]) => {
    try {
      setError(null);
      setIsUploading(true);
      setLiveStatusMessage("Initializing Gemini 3.6 Flash analysis workflow…");

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePaths }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start analysis workflow");
      }

      const data: { runId: string; status: string } = await res.json();
      setAnalysisRunId(data.runId);
      safeSetLocalStorage(STORAGE_ANALYSIS_RUN_ID, data.runId);

      setIsUploading(false);
      setCurrentStep("inspection");
      pollAnalysisStatus(data.runId);
    } catch (err: unknown) {
      setIsUploading(false);
      const msg = err instanceof Error ? err.message : "Failed to initialize analysis";
      setError(msg);
      setLiveStatusMessage(`Analysis startup failed: ${msg}`);
    }
  };

  const focusFirstInvalidControl = () => {
    if (!editableListing) return;
    const errorKeys = Object.keys(validationResult.errors);
    if (errorKeys.length === 0) return;

    const idMap: Record<string, string> = {
      title: "listing-title",
      category: "listing-category",
      condition: "listing-condition",
      priceSgd: "price-sgd",
      priceUsd: "price-usd",
      description: "listing-description",
    };

    for (const key of errorKeys) {
      if (idMap[key]) {
        const el = document.getElementById(idMap[key]);
        if (el) {
          el.focus();
          return;
        }
      }
      if (key.startsWith("itemSpecifics.") || editableListing.itemSpecifics[key] !== undefined) {
        const specKey = key.replace("itemSpecifics.", "");
        const fieldId = `item-spec-${specKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const el = document.getElementById(fieldId);
        if (el) {
          el.focus();
          return;
        }
      }
    }
  };

  const handlePublish = async () => {
    if (!editableListing) {
      setError("No active listing payload to publish.");
      return;
    }

    if (!isApproved) {
      setError("Explicit seller approval checkbox is required.");
      return;
    }

    if (!validationResult.valid) {
      setError(validationResult.disabledReason || "Please fix listing validation errors before publishing.");
      focusFirstInvalidControl();
      return;
    }

    const mergedPayload = getMergedListingPayload(
      editableListing,
      analysisResult?.analysis.unresolvedQuestions,
      sellerAnswers
    );

    try {
      setError(null);
      setIsPublishing(true);
      setCurrentStep("approval");
      setLiveStatusMessage("Submitting listing payload to publish workflow…");

      const bodyPayload = {
        approved: true as const,
        draftPathname: analysisResult?.draftPathname,
        listing: mergedPayload,
      };

      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to initialize publish workflow");
      }

      const data: { runId: string; status: string } = await res.json();
      setPublishRunId(data.runId);
      safeSetLocalStorage(STORAGE_PUBLISH_RUN_ID, data.runId);

      pollPublishStatus(data.runId);
    } catch (err: unknown) {
      setIsPublishing(false);
      const msg = err instanceof Error ? err.message : "Failed to start publication";
      setError(msg);
      setLiveStatusMessage(`Publication startup failed: ${msg}`);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--paper)] focus:text-[var(--ink)] focus:border focus:border-[var(--strong-rule)] focus:rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[var(--strong-rule)] font-mono text-xs"
      >
        Skip to main content
      </a>

      <TopBar currentStep={currentStep} onReset={handleReset} showReset={true} />
      <StateRail currentStep={currentStep} />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveStatusMessage}
      </div>

      <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-8" tabIndex={-1}>
        {currentStep === "photos" && (
          <section className="paper-card p-6">
            <PhotoIntake
              onStartAnalysis={handleStartAnalysis}
              isUploading={isUploading}
              error={error}
              onError={setError}
            />
          </section>
        )}

        {currentStep === "inspection" && (
          <section className="paper-card p-8 space-y-6 text-center">
            <div className="space-y-3 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-[var(--paper-raised)] border border-[var(--hairline)] flex items-center justify-center mx-auto text-[var(--ink)]">
                <span className="w-6 h-6 border-2 border-[var(--ink)] border-t-transparent rounded-full animate-spin" />
              </div>
              <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">
                Gemini 3.6 Flash inspection in progress
              </h2>
              <p className="text-xs font-mono text-[var(--ink-muted)]">
                Workflow run ID:{" "}
                <code className="bg-[var(--paper-raised)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                  {analysisRunId || "Initializing…"}
                </code>
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                aria-live="assertive"
                className="p-4 rounded-[4px] bg-[oklch(0.98_0.02_28)] border border-[var(--status-error)] text-xs text-[var(--status-error)] font-mono space-y-3 max-w-lg mx-auto text-left"
              >
                <div className="flex items-center justify-between">
                  <p className="font-bold">Inspection workflow error:</p>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-[var(--status-error)] font-bold hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center cursor-pointer"
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
                <p>{error}</p>
                <div className="flex items-center gap-3 pt-2">
                  {statusCheckRetry ? (
                    <button
                      type="button"
                      onClick={() => statusCheckRetry()}
                      className="px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[4px] text-xs font-mono font-bold cursor-pointer min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)]"
                    >
                      Retry status check
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-4 py-2 bg-[var(--paper)] text-[var(--status-error)] border border-[var(--status-error)] rounded-[4px] text-xs font-mono cursor-pointer min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)]"
                    >
                      Reset intake
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-xl mx-auto pt-4 text-left font-mono text-xs">
                <div className="p-4 rounded bg-[var(--paper-raised)] border border-[var(--hairline)] space-y-3">
                  <div className="h-4 bg-[var(--hairline)] rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-[var(--hairline)] rounded w-1/2 animate-pulse" />
                  <div className="h-3 bg-[var(--hairline)] rounded w-5/6 animate-pulse" />
                </div>
                <div className="p-4 rounded bg-[var(--paper-raised)] border border-[var(--hairline)] space-y-3">
                  <div className="h-4 bg-[var(--hairline)] rounded w-2/3 animate-pulse" />
                  <div className="h-3 bg-[var(--hairline)] rounded w-4/5 animate-pulse" />
                </div>
              </div>
            )}
          </section>
        )}

        {(currentStep === "review" || currentStep === "approval") && (
          <>
            {isPublishing || (publishRunId && !analysisResult) ? (
              <section className="paper-card p-8 space-y-6 text-center">
                <div className="space-y-3 max-w-md mx-auto">
                  <div className="w-12 h-12 rounded-full bg-[var(--paper-raised)] border border-[var(--hairline)] flex items-center justify-center mx-auto text-[var(--ink)]">
                    <span className="w-6 h-6 border-2 border-[var(--ink)] border-t-transparent rounded-full animate-spin" />
                  </div>
                  <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">
                    Publishing and verifying…
                  </h2>
                  <p className="text-xs font-mono text-[var(--ink-muted)]">
                    Publish run ID:{" "}
                    <code className="bg-[var(--paper-raised)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                      {publishRunId || "Initializing…"}
                    </code>
                  </p>
                </div>

                {error ? (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="p-4 rounded-[4px] bg-[oklch(0.98_0.02_28)] border border-[var(--status-error)] text-xs text-[var(--status-error)] font-mono space-y-3 max-w-lg mx-auto text-left"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-bold">Publication status error:</p>
                      <button
                        type="button"
                        onClick={() => setError(null)}
                        className="text-[var(--status-error)] font-bold hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center cursor-pointer"
                        aria-label="Dismiss error"
                      >
                        ✕
                      </button>
                    </div>
                    <p>{error}</p>
                    <div className="flex items-center gap-3 pt-2">
                      {statusCheckRetry ? (
                        <button
                          type="button"
                          onClick={() => statusCheckRetry()}
                          className="px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[4px] text-xs font-mono font-bold cursor-pointer min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)]"
                        >
                          Retry status check
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleReset}
                          className="px-4 py-2 bg-[var(--paper)] text-[var(--status-error)] border border-[var(--status-error)] rounded-[4px] text-xs font-mono font-bold cursor-pointer min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)]"
                        >
                          Reset intake
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-mono text-[var(--ink-muted)] pt-2">
                    Publishing through the demo adapter and independently verifying the retrieved record…
                  </p>
                )}
              </section>
            ) : analysisResult && editableListing ? (
              <div className="space-y-8">
                {error && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="p-3.5 rounded-[4px] bg-[oklch(0.98_0.02_28)] border border-[var(--status-error)] text-xs text-[var(--status-error)] font-mono flex items-center justify-between gap-2"
                  >
                    <div className="space-y-1">
                      <p>{error}</p>
                      {statusCheckRetry && (
                        <button
                          type="button"
                          onClick={() => statusCheckRetry()}
                          className="px-3 py-1 bg-[var(--ink)] text-[var(--paper)] rounded-[4px] text-xs font-mono font-bold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] mt-1"
                        >
                          Retry status check
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="font-bold hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center cursor-pointer shrink-0"
                      aria-label="Dismiss error"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  <aside className="lg:col-span-5 paper-card p-5 space-y-6">
                    <EvidenceSheet
                      analysis={analysisResult.analysis}
                      imagePaths={editableListing.imagePaths}
                      sellerAnswers={sellerAnswers}
                      onAnswerChange={handleAnswerChange}
                    />
                  </aside>

                  <div className="lg:col-span-7 space-y-8">
                    <section className="paper-card p-5">
                      <ListingEditor
                        listing={editableListing}
                        priceRationale={analysisResult.analysis.priceSuggestion.rationale}
                        onChange={handleListingChange}
                        errors={validationResult.errors}
                      />
                    </section>

                    <section>
                      <ApprovalBlock
                        isApproved={isApproved}
                        onApprovalChange={(val) => setIsApproved(val)}
                        onPublish={handlePublish}
                        isPublishing={isPublishing}
                        canApprove={validationResult.valid}
                        disabledReason={validationResult.disabledReason}
                      />
                    </section>
                  </div>
                </div>

                <section className="paper-card p-5 space-y-3">
                  <h3 className="text-xs font-mono font-bold text-[var(--ink-muted)] border-b border-[var(--hairline)] pb-2">
                    Operational trace stream
                  </h3>
                  <OperationalTrace trace={analysisResult.trace} />
                </section>
              </div>
            ) : (
              <section className="paper-card p-6 border-[var(--status-error)] space-y-4">
                <h3 className="text-base font-bold text-[var(--status-error)]">
                  Listing state unavailable
                </h3>
                <p className="text-xs font-mono text-[var(--ink)]">
                  {error || "No active analysis or listing data found."}
                </p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 bg-[var(--paper)] text-[var(--status-error)] border border-[var(--status-error)] rounded-[4px] text-xs font-mono font-bold cursor-pointer min-h-[44px]"
                >
                  Reset intake
                </button>
              </section>
            )}
          </>
        )}

        {currentStep === "verified" && (
          <section className="space-y-6">
            {isPublishing ? (
              <div className="paper-card p-8 space-y-4 text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--paper-raised)] border border-[var(--hairline)] flex items-center justify-center mx-auto text-[var(--ink)]">
                  <span className="w-6 h-6 border-2 border-[var(--ink)] border-t-transparent rounded-full animate-spin" />
                </div>
                <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">
                  Publishing and verifying…
                </h2>
                <p className="text-xs font-mono text-[var(--ink-muted)]">
                  Publish run ID:{" "}
                  <code className="bg-[var(--paper-raised)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                    {publishRunId || "Initializing…"}
                  </code>
                </p>
              </div>
            ) : publishResult ? (
              <VerificationReceipt result={publishResult} onReset={handleReset} />
            ) : error ? (
              <div
                role="alert"
                aria-live="assertive"
                className="paper-card p-6 border-[var(--status-error)] space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--status-error)]">
                    Publication failed
                  </h3>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-[var(--status-error)] font-bold hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center cursor-pointer"
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-xs font-mono text-[var(--ink)]">{error}</p>
                <div className="flex items-center gap-3">
                  {statusCheckRetry ? (
                    <button
                      type="button"
                      onClick={() => statusCheckRetry()}
                      className="px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[4px] text-xs font-mono font-bold cursor-pointer min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)]"
                    >
                      Retry status check
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-4 py-2 bg-[var(--paper)] text-[var(--status-error)] border border-[var(--status-error)] rounded-[4px] text-xs font-mono font-bold cursor-pointer min-h-[44px]"
                    >
                      Reset workspace
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}