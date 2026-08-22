"use client";

import React from "react";
import Image from "next/image";
import { AnalyzeOutput } from "@/lib/domain/schemas";

interface EvidenceSheetProps {
  analysis: AnalyzeOutput;
  imagePaths: string[];
  sellerAnswers: Record<string, string>;
  onAnswerChange: (question: string, answer: string) => void;
}

export function EvidenceSheet({
  analysis,
  imagePaths,
  sellerAnswers,
  onAnswerChange,
}: EvidenceSheetProps) {
  const confidencePercent = (analysis.confidence * 100).toFixed(0);

  let confidenceLabel = "High confidence";
  let confidenceBg = "bg-[var(--paper-raised)] border-[var(--status-success)] text-[var(--status-success)]";

  if (analysis.confidence < 0.6) {
    confidenceLabel = "Low confidence";
    confidenceBg = "bg-[var(--paper-raised)] border-[var(--status-error)] text-[var(--status-error)]";
  } else if (analysis.confidence < 0.85) {
    confidenceLabel = "Moderate confidence";
    confidenceBg = "bg-[var(--paper-raised)] border-[var(--status-warning)] text-[var(--status-warning)]";
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--hairline)] pb-3 flex items-center justify-between">
        <h3 className="text-sm font-mono font-bold text-[var(--ink)]">
          Evidence and inspection findings
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border font-mono text-xs font-semibold ${confidenceBg}`}
        >
          <span>{confidencePercent}%</span>
          <span>•</span>
          <span>{confidenceLabel}</span>
        </span>
      </div>

      <div className="paper-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <span className="font-mono text-[var(--ink-muted)] block">Brand / Identity</span>
            <span className="font-semibold text-sm text-[var(--ink)] mt-0.5 block">
              {analysis.identity || "Unknown"}
            </span>
          </div>
          <div>
            <span className="font-mono text-[var(--ink-muted)] block">Model</span>
            <span className="font-semibold text-sm text-[var(--ink)] mt-0.5 block">
              {analysis.model || "Unknown"}
            </span>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--hairline)] grid grid-cols-2 gap-4 text-xs">
          <div>
            <span className="font-mono text-[var(--ink-muted)] block">Category</span>
            <span className="text-[var(--ink)] mt-0.5 block">{analysis.category}</span>
          </div>
          <div>
            <span className="font-mono text-[var(--ink-muted)] block">Overall condition</span>
            <span className="font-semibold text-[var(--ink)] mt-0.5 block">
              {analysis.condition}
            </span>
          </div>
        </div>
      </div>

      <div className="paper-card p-4 space-y-2">
        <h4 className="text-xs font-mono font-bold text-[var(--ink-muted)]">
          Observed accessories ({analysis.accessories?.length || 0})
        </h4>
        {analysis.accessories && analysis.accessories.length > 0 ? (
          <ul className="text-xs space-y-1">
            {analysis.accessories.map((acc, i) => (
              <li key={i} className="flex items-center gap-2 text-[var(--ink)]">
                <span className="text-[var(--hairline)]">•</span>
                <span>{acc}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--ink-muted)] italic font-mono">
            No additional accessories observed in photos.
          </p>
        )}
      </div>

      <div className="paper-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-mono font-bold text-[var(--ink-muted)]">
            Observed defects and wear ({analysis.defects?.length || 0})
          </h4>
        </div>

        {analysis.defects && analysis.defects.length > 0 ? (
          <div className="space-y-3">
            {analysis.defects.map((defect, i) => (
              <div
                key={i}
                className="p-3 rounded-[4px] bg-[var(--paper-raised)] border border-[var(--hairline)] text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between font-semibold text-[var(--ink)]">
                  <span>{defect.description}</span>
                  <span className="text-[11px] font-mono text-[var(--ink-muted)]">
                    [{defect.location}]
                  </span>
                </div>
                <p className="text-[11px] font-mono text-[var(--ink-muted)] bg-[var(--paper)] p-2 rounded border border-[var(--hairline)]">
                  <span className="font-bold text-[var(--ink)]">Visual evidence: </span>
                  {defect.evidence}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--status-success)] font-mono">
            ✓ No visible physical damage or severe wear detected in photos.
          </p>
        )}
      </div>

      {analysis.unresolvedQuestions && analysis.unresolvedQuestions.length > 0 && (
        <div className="paper-card p-4 space-y-3 border-[var(--status-warning)]">
          <div className="flex items-start gap-2">
            <span className="text-[var(--status-warning)] font-bold text-sm" aria-hidden="true">
              ⚠
            </span>
            <div>
              <h4 className="text-xs font-mono font-bold text-[var(--ink)]">
                Unresolved details ({analysis.unresolvedQuestions.length})
              </h4>
              <p className="text-[11px] text-[var(--ink-muted)] mt-0.5">
                Gemini flagged material details requiring seller clarification. Answers are required prior to approval and will be appended to the listing description under a concise <code className="font-bold text-[var(--ink)] font-mono">Seller-provided details:</code> section in the exact publish payload.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {analysis.unresolvedQuestions.map((q, idx) => {
              const currentVal = sellerAnswers[q] || "";
              const charCount = currentVal.length;

              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <label
                      htmlFor={`question-${idx}`}
                      className="font-medium text-[var(--ink)]"
                    >
                      Question {idx + 1}: {q} <span className="text-[var(--status-error)]">*</span>
                    </label>
                    <span
                      className={`text-[10px] ${
                        charCount >= 300
                          ? "text-[var(--status-error)] font-bold"
                          : "text-[var(--ink-muted)]"
                      }`}
                    >
                      {charCount}/300
                    </span>
                  </div>
                  <input
                    type="text"
                    id={`question-${idx}`}
                    name={`question_${idx}`}
                    value={currentVal}
                    onChange={(e) => onAnswerChange(q, e.target.value.slice(0, 300))}
                    maxLength={300}
                    autoComplete="off"
                    required
                    placeholder="Provide details for this question…"
                    className="w-full px-3 py-2 text-xs font-sans bg-[var(--paper-raised)] border border-[var(--hairline)] rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px]"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-mono font-bold text-[var(--ink-muted)]">
          Inspected photos ({imagePaths.length})
        </h4>
        <div className="grid grid-cols-3 gap-2">
          {imagePaths.map((path, idx) => {
            const previewUrl = `/api/images?path=${encodeURIComponent(path)}`;
            return (
              <div
                key={path}
                className="relative aspect-square bg-[var(--paper-raised)] rounded-[2px] overflow-hidden border border-[var(--hairline)]"
              >
                <Image
                  src={previewUrl}
                  alt={`Inspected photo specimen ${idx + 1}`}
                  fill
                  sizes="(max-width: 1024px) 30vw, 160px"
                  className="object-cover"
                  unoptimized
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
