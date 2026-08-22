"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";

export function LandingHero() {
  return (
    <section className="w-full py-12 md:py-20 border-b border-[var(--hairline)] bg-[var(--paper)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-[4px] bg-[var(--paper-raised)] border border-[var(--hairline)] text-xs font-mono text-[var(--ink-muted)]">
            <span className="w-2 h-2 rounded-full bg-[var(--ink-muted)]" />
            <span>Build with Gemini Hackathon 2026 track</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--ink)] leading-[1.1] max-w-2xl">
            Turn item photos into a verified marketplace listing in seconds.
          </h1>

          <p className="text-base sm:text-lg text-[var(--ink-muted)] leading-relaxed max-w-xl">
            LoopList uses Gemini 3.6 Flash multimodal reasoning to detect item identity, model, accessories, condition, and defects. Approve condition disclosures and pricing before publication to the marketplace adapter.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <Link
              href="/demo"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-mono font-bold text-[var(--paper)] bg-[var(--ink)] hover:bg-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[48px]"
            >
              <span>Launch interactive seller demo</span>
              <span>→</span>
            </Link>

            <a
              href="https://luma.com/deepmind-v4ci"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-3.5 text-xs font-mono font-medium text-[var(--ink)] bg-[var(--paper-raised)] border border-[var(--hairline)] hover:border-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[48px]"
            >
              <span>Build with Gemini Hackathon 2026 on Luma ↗</span>
            </a>
          </div>

          <div className="pt-4 flex items-center gap-6 text-xs font-mono text-[var(--ink-muted)] border-t border-[var(--hairline)]">
            <div>
              <span className="font-bold text-[var(--ink)]">3–8</span> photos required
            </div>
            <div>•</div>
            <div>
              <span className="font-bold text-[var(--ink)]">Explicit</span> seller approval
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="paper-card p-4 space-y-3 border-[var(--strong-rule)]">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2.5 text-xs font-mono">
              <span className="font-bold text-[var(--ink)]">
                Inspection sheet specimen
              </span>
              <span className="px-2 py-0.5 rounded bg-[oklch(0.98_0.02_150)] text-[var(--status-success)] font-semibold border border-[var(--status-success)] text-[10px]">
                Verified specimen
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="relative aspect-square rounded-[2px] overflow-hidden border border-[var(--hairline)] bg-[var(--paper-raised)]">
                <Image
                  src="/demo/game-boy-front.png"
                  alt="Game Boy front specimen"
                  fill
                  sizes="(max-width: 1024px) 30vw, 150px"
                  className="object-cover"
                />
              </div>
              <div className="relative aspect-square rounded-[2px] overflow-hidden border border-[var(--hairline)] bg-[var(--paper-raised)]">
                <Image
                  src="/demo/game-boy-back.png"
                  alt="Game Boy back specimen"
                  fill
                  sizes="(max-width: 1024px) 30vw, 150px"
                  className="object-cover"
                />
              </div>
              <div className="relative aspect-square rounded-[2px] overflow-hidden border border-[var(--hairline)] bg-[var(--paper-raised)]">
                <Image
                  src="/demo/game-boy-detail.png"
                  alt="Game Boy detail specimen"
                  fill
                  sizes="(max-width: 1024px) 30vw, 150px"
                  className="object-cover"
                />
              </div>
            </div>

            <div className="space-y-2 pt-1 font-mono text-xs">
              <div className="flex justify-between items-center bg-[var(--paper-raised)] p-2 rounded border border-[var(--hairline)]">
                <span className="text-[var(--ink-muted)]">Identity:</span>
                <span className="font-bold text-[var(--ink)]">Teal Nintendo Game Boy Color model CGB-001</span>
              </div>

              <div className="flex justify-between items-center bg-[var(--paper-raised)] p-2 rounded border border-[var(--hairline)]">
                <span className="text-[var(--ink-muted)]">Gemini confidence:</span>
                <span className="font-bold text-[var(--status-success)]">95% (High)</span>
              </div>

              <div className="p-2.5 rounded bg-[var(--paper-raised)] border border-[var(--hairline)] space-y-1">
                <span className="text-[var(--ink-muted)] block text-[11px]">Observed defects:</span>
                <span className="font-sans text-xs text-[var(--ink)] block">
                  • Hairline scratch on plastic screen lens (Upper center)
                </span>
                <span className="font-sans text-xs text-[var(--ink)] block">
                  • Light battery door latch friction wear
                </span>
              </div>

              <div className="flex justify-between items-center bg-[var(--paper-raised)] p-2 rounded border border-[var(--hairline)]">
                <span className="text-[var(--ink-muted)]">Price suggestion:</span>
                <span className="font-bold text-[var(--ink)]">$95.00 SGD / $70.00 USD</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
