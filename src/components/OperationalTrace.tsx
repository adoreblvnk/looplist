"use client";

import React from "react";
import { TraceEntry, TraceLabel } from "@/lib/domain/schemas";

interface OperationalTraceProps {
  trace: TraceEntry[];
}

const ALLOWED_LABELS: TraceLabel[] = [
  "Observation",
  "Action",
  "Tool result",
  "Verification",
  "Skill saved",
];

const LABEL_COLORS: Record<TraceLabel, string> = {
  Observation: "bg-[var(--paper-raised)] text-[var(--ink-muted)] border-[var(--hairline)]",
  Action: "bg-[var(--paper-raised)] text-[var(--ink)] border-[var(--hairline)] font-semibold",
  "Tool result": "bg-[var(--paper-raised)] text-[var(--status-info)] border-[var(--hairline)]",
  Verification: "bg-[var(--paper-raised)] text-[var(--status-success)] border-[var(--hairline)] font-semibold",
  "Skill saved": "bg-[var(--paper-raised)] text-[var(--status-warning)] border-[var(--hairline)] font-semibold",
};

export function OperationalTrace({ trace }: OperationalTraceProps) {
  const filteredTrace = trace.filter((entry) =>
    ALLOWED_LABELS.includes(entry.label)
  );

  if (filteredTrace.length === 0) {
    return (
      <p className="text-xs font-mono text-[var(--ink-muted)] italic">
        No operational trace records recorded.
      </p>
    );
  }

  return (
    <div className="space-y-3 font-mono text-xs">
      <div className="relative pl-4 border-l-2 border-[var(--hairline)] space-y-3">
        {filteredTrace.map((entry, idx) => {
          const badgeClass =
            LABEL_COLORS[entry.label] ||
            "bg-[var(--paper-raised)] text-[var(--ink)] border-[var(--hairline)]";

          return (
            <div key={idx} className="relative group">
              <span
                className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-[var(--hairline)] border-2 border-[var(--paper)]"
                aria-hidden="true"
              />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-[2px] border text-[10px] ${badgeClass}`}
                  >
                    {entry.label}
                  </span>
                  <span className="text-[var(--ink)] font-medium">
                    {entry.summary}
                  </span>
                </div>

                <span className="text-[10px] text-[var(--ink-muted)] shrink-0">
                  {entry.timestamp}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
