"use client";

import React from "react";
import Link from "next/link";

export function LandingTrust() {
  return (
    <section className="w-full py-16 bg-[var(--paper)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-[4px] bg-[var(--paper-raised)] border border-[var(--hairline)] text-xs font-mono text-[var(--ink-muted)]">
          <span>Trust and verification principles</span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--ink)] max-w-2xl mx-auto leading-snug">
          Verifiable seller outcomes from photos to published receipt.
        </h2>

        <p className="text-sm text-[var(--ink-muted)] leading-relaxed max-w-2xl mx-auto">
          LoopList provides complete transparency at every stage: evidence extraction, defect disclosures, pricing review, explicit approval, and independent verification.
        </p>

        <div className="paper-card p-6 text-left font-mono text-xs space-y-3 max-w-2xl mx-auto border-[var(--strong-rule)]">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2">
            <span className="font-bold text-[var(--ink)]">Seller protection guarantees</span>
          </div>

          <ul className="space-y-2 text-[var(--ink-muted)]">
            <li className="flex items-start gap-2">
              <span className="text-[var(--status-success)] font-bold">✓</span>
              <span>
                <strong className="text-[var(--ink)]">Explicit approval boundary:</strong> Listings are never published without your explicit confirmation checkbox.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[var(--status-success)] font-bold">✓</span>
              <span>
                <strong className="text-[var(--ink)]">Independent verification:</strong> Published listings are re-retrieved and verified against submitted fields.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[var(--status-success)] font-bold">✓</span>
              <span>
                <strong className="text-[var(--ink)]">Bounded repair checks:</strong> Marketplace schema mismatches trigger at most two targeted repair iterations before publication.
              </span>
            </li>
          </ul>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/demo"
            className="px-6 py-3 text-xs font-mono font-bold text-[var(--paper)] bg-[var(--ink)] hover:bg-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] inline-flex items-center justify-center"
          >
            Launch interactive seller demo →
          </Link>

          <a
            href="https://luma.com/deepmind-v4ci"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[var(--ink-muted)] hover:text-[var(--ink)] underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1"
          >
            Build with Gemini Hackathon 2026 on Luma ↗
          </a>
        </div>
      </div>
    </section>
  );
}
