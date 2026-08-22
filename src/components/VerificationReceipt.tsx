"use client";

import React from "react";
import { PublishResponseDTO } from "@/lib/domain/schemas";
import { OperationalTrace } from "./OperationalTrace";

interface VerificationReceiptProps {
  result: PublishResponseDTO;
  onReset: () => void;
}

const sgdFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function VerificationReceipt({ result, onReset }: VerificationReceiptProps) {
  const listing = result.finalListing;

  return (
    <div className="space-y-6">
      <div className="paper-card p-6 border-[var(--status-success)] bg-[oklch(0.98_0.02_150)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[oklch(0.85_0.05_150)] pb-4">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-[var(--status-success)] text-[var(--paper)] flex items-center justify-center font-bold text-base">
              ✓
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-[var(--status-success)]">
                  Verification receipt
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-[var(--status-success)] text-[var(--paper)]">
                  {result.verificationStatus}
                </span>
              </div>
              <h2 className="text-lg font-bold text-[var(--ink)] tracking-tight mt-0.5">
                Adapter listing successfully published and verified
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onReset}
            className="px-4 py-2 text-xs font-mono font-semibold text-[var(--ink)] bg-[var(--paper)] border border-[var(--hairline)] hover:border-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] cursor-pointer min-h-[44px] self-start sm:self-auto"
          >
            + Start new listing
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div>
            <span className="text-[var(--ink-muted)] block">Adapter listing ID</span>
            <code className="text-sm font-bold text-[var(--ink)] bg-[var(--paper)] px-2 py-1 rounded border border-[var(--hairline)] mt-1 block truncate">
              {result.publishedListingId}
            </code>
          </div>

          <div>
            <span className="text-[var(--ink-muted)] block">Adapter reference URL</span>
            <span className="text-xs font-medium text-[var(--ink)] bg-[var(--paper)] px-2 py-1 rounded border border-[var(--hairline)] mt-1 block truncate">
              {result.publishedListingUrl}
            </span>
            <span className="text-[10px] text-[var(--ink-muted)] mt-0.5 block">
              (Non-public demo reference)
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-[oklch(0.85_0.05_150)] text-xs font-mono space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[var(--ink)]">Repair status:</span>
            <span>{result.repaired ? "Repaired via Gemini repair loop" : "No schema violations (passed initial adapter validation)"}</span>
          </div>

          {result.repairSkillPath && (
            <div className="flex items-center gap-2 text-[var(--status-info)]">
              <span className="font-bold">Persisted skill artifact:</span>
              <code className="bg-[var(--paper)] px-1.5 py-0.5 rounded border border-[var(--hairline)] text-[11px]">
                {result.repairSkillPath}
              </code>
            </div>
          )}
        </div>
      </div>

      <div className="paper-card p-5 space-y-4">
        <h3 className="text-xs font-mono font-bold text-[var(--ink-muted)] border-b border-[var(--hairline)] pb-2">
          Published field snapshot
        </h3>

        <div className="space-y-3">
          <div>
            <span className="text-[11px] font-mono text-[var(--ink-muted)] block">Title</span>
            <span className="text-sm font-semibold text-[var(--ink)]">{listing.title}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[11px] font-mono text-[var(--ink-muted)] block">Category</span>
              <span className="text-[var(--ink)]">{listing.category}</span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--ink-muted)] block">Condition</span>
              <span className="font-semibold text-[var(--ink)]">{listing.condition}</span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--ink-muted)] block">SGD price</span>
              <span className="font-mono font-semibold text-[var(--ink)]">{sgdFormatter.format(listing.priceSgd)}</span>
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--ink-muted)] block">USD price</span>
              <span className="font-mono font-semibold text-[var(--ink)]">{usdFormatter.format(listing.priceUsd)}</span>
            </div>
          </div>

          <div>
            <span className="text-[11px] font-mono text-[var(--ink-muted)] block mb-1">Item specifics</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[var(--paper-raised)] p-3 rounded-[4px] border border-[var(--hairline)] text-xs">
              {Object.entries(listing.itemSpecifics).map(([k, v]) => (
                <div key={k} className="font-mono">
                  <span className="text-[var(--ink-muted)]">{k}: </span>
                  <span className="font-semibold text-[var(--ink)]">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] font-mono text-[var(--ink-muted)] block">Description</span>
            <p className="text-xs text-[var(--ink)] whitespace-pre-wrap bg-[var(--paper-raised)] p-3 rounded-[4px] border border-[var(--hairline)] mt-1">
              {listing.description}
            </p>
          </div>
        </div>
      </div>

      <div className="paper-card p-5 space-y-4">
        <h3 className="text-xs font-mono font-bold text-[var(--ink-muted)] border-b border-[var(--hairline)] pb-2">
          Audit and execution trace
        </h3>
        <OperationalTrace trace={result.trace} />
      </div>
    </div>
  );
}
