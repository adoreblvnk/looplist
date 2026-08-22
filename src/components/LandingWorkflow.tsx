"use client";

import React from "react";

export function LandingWorkflow() {
  const steps = [
    {
      num: "01",
      title: "Photo intake and storage",
      desc: "Upload 3 to 8 item photos directly or test with our seeded Game Boy specimen. Images are stored safely in private Vercel Blob storage.",
    },
    {
      num: "02",
      title: "Gemini 3.6 multimodal reasoning",
      desc: "Gemini analyzes physical evidence to extract item identity, exact model numbers, included accessories, physical wear, and visual defect locations with confidence scoring.",
    },
    {
      num: "03",
      title: "Seller review and detail editing",
      desc: "Inspect extracted fields, review identified defect disclosures, answer material unresolved questions, and adjust recommended SGD/USD marketplace pricing.",
    },
    {
      num: "04",
      title: "Explicit approval and adapter verification",
      desc: "A mandatory seller approval gate precedes publication. LoopList executes deterministic eBay-adapter schema verification, hash integrity checks, and bounded Gemini repair after adapter rejection.",
    },
  ];

  return (
    <section className="w-full py-16 border-b border-[var(--hairline)] bg-[var(--canvas)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
        <div className="space-y-2 text-center max-w-2xl mx-auto">
          <h2 className="text-xs font-mono font-bold text-[var(--ink-muted)]">
            Ordered execution journey
          </h2>
          <p className="text-2xl font-bold tracking-tight text-[var(--ink)]">
            A linear, verifiable path from item photography to published listing.
          </p>
        </div>

        <div className="paper-card divide-y divide-[var(--hairline)]">
          {steps.map((s) => (
            <div
              key={s.num}
              className="p-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-start"
            >
              <div className="md:col-span-1">
                <span className="text-lg font-mono font-bold text-[var(--ink-muted)]">
                  {s.num}
                </span>
              </div>
              <div className="md:col-span-4">
                <h3 className="text-sm font-bold text-[var(--ink)]">
                  {s.title}
                </h3>
              </div>
              <div className="md:col-span-7">
                <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
