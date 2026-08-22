"use client";

import React from "react";

interface ApprovalBlockProps {
  isApproved: boolean;
  onApprovalChange: (approved: boolean) => void;
  onPublish: () => void;
  isPublishing: boolean;
  canApprove: boolean;
  disabledReason?: string | null;
}

export function ApprovalBlock({
  isApproved,
  onApprovalChange,
  onPublish,
  isPublishing,
  canApprove,
  disabledReason,
}: ApprovalBlockProps) {
  const canPublish = canApprove && isApproved && !isPublishing;

  return (
    <div className="paper-card p-5 space-y-4 border-[var(--strong-rule)]">
      <div className="border-b border-[var(--hairline)] pb-3">
        <h4 className="text-xs font-mono font-bold text-[var(--ink)]">
          Seller review and mandatory approval gate
        </h4>
        <p className="text-xs text-[var(--ink-muted)] mt-1">
          Review all condition disclosures, observed defects, and price suggestions above. LoopList never publishes without your explicit consent.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="seller-approval-checkbox"
          name="sellerApproval"
          checked={isApproved}
          onChange={(e) => onApprovalChange(e.target.checked)}
          disabled={isPublishing || !canApprove}
          className="mt-0.5 h-5 w-5 rounded border-[var(--hairline)] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <label
          htmlFor="seller-approval-checkbox"
          className={`text-xs font-sans font-medium leading-relaxed ${
            !canApprove || isPublishing
              ? "text-[var(--ink-muted)] cursor-not-allowed"
              : "text-[var(--ink)] cursor-pointer"
          }`}
        >
          I have reviewed the condition disclosures, observed defects, item specifics, and price. I explicitly authorize publication of this listing payload to the marketplace adapter.
        </label>
      </div>

      <div className="p-3 rounded-[4px] bg-[var(--paper-raised)] border border-[var(--hairline)] text-[11px] font-mono text-[var(--ink-muted)] space-y-1">
        <p className="font-bold text-[var(--ink)]">Target marketplace adapter statement:</p>
        <p>
          Target: <span className="font-bold text-[var(--ink)]">eBay-compatible deterministic demo adapter</span> (ID: <code className="bg-[var(--paper)] px-1 py-0.5 rounded border border-[var(--hairline)]">ebay-sandbox-v1</code>).
        </p>
        <p>
          Note: This action submits the approved listing to an eBay-compatible deterministic demo adapter and does not publish to public eBay. Gemini repair runs only after adapter validation rejects a field (maximum 2 repair attempts), and versioned skill persistence occurs only after retrieval verification passes.
        </p>
      </div>

      {!canApprove && disabledReason && (
        <p className="text-xs font-mono text-[var(--status-error)] bg-[oklch(0.98_0.02_28)] p-2 rounded border border-[var(--status-error)]">
          ⚠ Approval disabled: {disabledReason}
        </p>
      )}

      {canApprove && disabledReason && (
        <p className="text-xs font-mono text-[var(--status-error)] bg-[oklch(0.98_0.02_28)] p-2 rounded border border-[var(--status-error)]">
          ⚠ Cannot publish: {disabledReason}
        </p>
      )}

      <div className="pt-2 flex items-center justify-end">
        <button
          type="button"
          onClick={onPublish}
          disabled={!canPublish}
          className="w-full sm:w-auto px-6 py-3 text-xs font-mono font-semibold text-[var(--paper)] bg-[var(--ink)] hover:bg-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[44px]"
        >
          {isPublishing ? (
            <span className="flex items-center gap-2 justify-center">
              <span className="w-3 h-3 border-2 border-[var(--paper)] border-t-transparent rounded-full animate-spin" />
              <span>Publishing to demo adapter…</span>
            </span>
          ) : (
            <span>Authorize & publish listing (eBay-compatible demo adapter) →</span>
          )}
        </button>
      </div>
    </div>
  );
}
