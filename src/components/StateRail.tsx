"use client";

import React from "react";

export type StepKey = "photos" | "inspection" | "review" | "approval" | "verified";

interface StateRailProps {
  currentStep: StepKey;
}

const STEPS: { key: StepKey; label: string }[] = [
  { key: "photos", label: "1. Photos" },
  { key: "inspection", label: "2. Inspection" },
  { key: "review", label: "3. Review" },
  { key: "approval", label: "4. Approval" },
  { key: "verified", label: "5. Verified" },
];

export function StateRail({ currentStep }: StateRailProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav
      aria-label="Workflow progress"
      className="w-full bg-[var(--paper)] border-b border-[var(--hairline)] py-3 px-4 sm:px-6"
    >
      <ol className="max-w-6xl mx-auto flex items-center justify-between gap-2 overflow-x-auto text-xs font-mono">
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;

          return (
            <li key={step.key} className="flex items-center gap-2 flex-shrink-0">
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] border transition-colors ${
                  isCurrent
                    ? "bg-[var(--ink)] text-[var(--paper)] border-[var(--ink)] font-semibold"
                    : isCompleted
                    ? "bg-[var(--paper-raised)] text-[var(--ink)] border-[var(--hairline)]"
                    : "bg-transparent text-[var(--ink-muted)] border-transparent"
                }`}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted && (
                  <span className="text-[var(--status-success)] font-bold" aria-hidden="true">
                    ✓
                  </span>
                )}
                <span>{step.label}</span>
              </div>

              {idx < STEPS.length - 1 && (
                <span className="text-[var(--hairline)] text-sm hidden sm:inline" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
