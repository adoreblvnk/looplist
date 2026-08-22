"use client";

import React from "react";

export function LiveServiceStatus() {
  const services = [
    { name: "Gemini 3.6 Flash", status: "Required path", indicator: "bg-[var(--ink-muted)]" },
    { name: "Vercel Blob", status: "Required path", indicator: "bg-[var(--ink-muted)]" },
    { name: "Vercel Workflow", status: "Required path", indicator: "bg-[var(--ink-muted)]" },
    { name: "eBay Adapter", status: "Demo adapter", indicator: "bg-[var(--ink-muted)]" },
  ];

  return (
    <div className="flex items-center gap-3 text-xs font-mono text-[var(--ink-muted)]">
      {services.map((s) => (
        <span
          key={s.name}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-[var(--paper-raised)] border border-[var(--hairline)]"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${s.indicator}`}
            aria-hidden="true"
          />
          <span className="font-medium text-[var(--ink)]">{s.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
            {s.status}
          </span>
        </span>
      ))}
    </div>
  );
}
