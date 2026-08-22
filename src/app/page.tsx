import React from "react";
import Link from "next/link";
import { LandingHero } from "@/components/LandingHero";
import { LandingWorkflow } from "@/components/LandingWorkflow";
import { LandingTrust } from "@/components/LandingTrust";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--paper)] focus:text-[var(--ink)] focus:border focus:border-[var(--strong-rule)] focus:rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[var(--strong-rule)] font-mono text-xs"
      >
        Skip to main content
      </a>

      <header className="h-16 border-b border-[var(--hairline)] bg-[var(--paper)] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-[var(--ink)] hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1"
          >
            LoopList
          </Link>
          <span className="text-[var(--hairline)]" aria-hidden="true">
            /
          </span>
          <span className="text-xs font-mono text-[var(--ink-muted)]">
            Verified marketplace listings
          </span>
        </div>

        <nav aria-label="Main navigation" className="flex items-center gap-4 text-xs font-mono">
          <a
            href="https://luma.com/deepmind-v4ci"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-block text-[var(--ink-muted)] hover:text-[var(--ink)] underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1"
          >
            Build with Gemini Hackathon 2026 ↗
          </a>
          <Link
            href="/demo"
            className="px-3.5 py-1.5 font-semibold text-[var(--paper)] bg-[var(--ink)] hover:bg-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] flex items-center"
          >
            Seller workspace demo →
          </Link>
        </nav>
      </header>

      <main id="main-content" className="flex-1 flex flex-col" tabIndex={-1}>
        <LandingHero />
        <LandingWorkflow />
        <LandingTrust />
      </main>

      <footer className="border-t border-[var(--hairline)] bg-[var(--paper)] py-8 px-4 sm:px-6 text-xs font-mono text-[var(--ink-muted)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[var(--ink)]">LoopList</span>
            <span>·</span>
            <span>Built for Build with Gemini Hackathon 2026</span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://luma.com/deepmind-v4ci"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1"
            >
              Build with Gemini Hackathon 2026 on Luma
            </a>
            <span>•</span>
            <Link
              href="/demo"
              className="hover:underline text-[var(--ink)] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-1"
            >
              /demo
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
