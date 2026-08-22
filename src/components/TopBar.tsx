"use client";

import React from "react";
import Link from "next/link";
import { LiveServiceStatus } from "./LiveServiceStatus";

interface TopBarProps {
  currentStep?: string;
  onReset?: () => void;
  showReset?: boolean;
}

export function TopBar({ currentStep, onReset, showReset = false }: TopBarProps) {
  return (
    <header className="h-16 border-b border-[var(--hairline)] bg-[var(--paper)] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20 gap-2">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <Link
          href="/"
          className="text-base sm:text-lg font-bold tracking-tight text-[var(--ink)] hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1 shrink-0"
        >
          LoopList
        </Link>
        <span className="text-[var(--hairline)] shrink-0" aria-hidden="true">
          /
        </span>
        <span className="text-xs font-mono font-medium text-[var(--ink-muted)] truncate min-w-0">
          {currentStep ? `Inspection workspace: ${currentStep}` : "Marketplace seller workspace"}
        </span>
      </div>

      <div className="hidden xl:flex items-center gap-6 shrink-0">
        <LiveServiceStatus />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <a
          href="https://luma.com/deepmind-v4ci"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center text-xs font-mono text-[var(--ink-muted)] hover:text-[var(--ink)] underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1"
        >
          Build with Gemini Hackathon 2026 ↗
        </a>

        {showReset && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="px-3.5 py-2 text-xs font-mono font-medium text-[var(--ink)] bg-[var(--paper-raised)] border border-[var(--hairline)] hover:border-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] cursor-pointer min-h-[44px]"
          >
            Reset workspace
          </button>
        )}
      </div>
    </header>
  );
}
