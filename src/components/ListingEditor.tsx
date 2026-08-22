"use client";

import React from "react";
import { EbayListing } from "@/lib/domain/schemas";

interface ListingEditorProps {
  listing: EbayListing;
  priceRationale?: string;
  onChange: (updated: EbayListing) => void;
  errors?: Record<string, string>;
}

const CONDITION_OPTIONS = [
  "New",
  "Like New",
  "Very Good",
  "Good",
  "Acceptable",
  "For parts or not working",
] as const;

export function ListingEditor({
  listing,
  priceRationale,
  onChange,
  errors = {},
}: ListingEditorProps) {
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...listing, title: e.target.value });
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...listing, description: e.target.value });
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...listing, category: e.target.value });
  };

  const handleConditionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...listing,
      condition: e.target.value as EbayListing["condition"],
    });
  };

  const handlePriceSgdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    onChange({ ...listing, priceSgd: isNaN(val) ? 0 : val });
  };

  const handlePriceUsdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    onChange({ ...listing, priceUsd: isNaN(val) ? 0 : val });
  };

  const handleItemSpecificChange = (key: string, value: string) => {
    onChange({
      ...listing,
      itemSpecifics: {
        ...listing.itemSpecifics,
        [key]: value,
      },
    });
  };

  const titleLength = listing.title.length;
  const isTitleOverLimit = titleLength > 80;
  const titleErr = errors["title"] || (isTitleOverLimit ? "Title exceeds limit of 80 characters." : undefined);
  const categoryErr = errors["category"];
  const conditionErr = errors["condition"];
  const priceSgdErr = errors["priceSgd"];
  const priceUsdErr = errors["priceUsd"];
  const descErr = errors["description"];

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--hairline)] pb-3 flex items-center justify-between">
        <h3 className="text-sm font-mono font-bold text-[var(--ink)]">
          Listing fields and marketplace details
        </h3>
        <span className="text-xs font-mono text-[var(--ink-muted)]">
          Editable prior to approval
        </span>
      </div>

      <fieldset className="space-y-4 border-0 p-0 m-0">
        <legend className="sr-only">Marketplace listing information</legend>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor="listing-title"
              className="text-xs font-mono font-bold text-[var(--ink)] flex items-center gap-1"
            >
              Listing title <span className="text-[var(--status-error)]">*</span>
            </label>
            <span
              className={`text-[11px] font-mono ${
                isTitleOverLimit
                  ? "text-[var(--status-error)] font-bold"
                  : "text-[var(--ink-muted)]"
              }`}
            >
              {titleLength}/80 chars
            </span>
          </div>
          <input
            id="listing-title"
            name="title"
            type="text"
            value={listing.title}
            onChange={handleTitleChange}
            maxLength={100}
            autoComplete="off"
            aria-invalid={Boolean(titleErr)}
            aria-describedby={titleErr ? "error-listing-title" : undefined}
            required
            className={`w-full px-3 py-2 text-sm font-sans bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] ${
              titleErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
            }`}
          />
          {titleErr && (
            <p id="error-listing-title" className="text-[11px] font-mono text-[var(--status-error)] mt-1">
              {titleErr}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label
              htmlFor="listing-category"
              className="text-xs font-mono font-bold text-[var(--ink)]"
            >
              Category <span className="text-[var(--status-error)]">*</span>
            </label>
            <input
              id="listing-category"
              name="category"
              type="text"
              value={listing.category}
              onChange={handleCategoryChange}
              autoComplete="off"
              aria-invalid={Boolean(categoryErr)}
              aria-describedby={categoryErr ? "error-listing-category" : undefined}
              required
              className={`w-full px-3 py-2 text-xs font-sans bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] ${
                categoryErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
              }`}
            />
            {categoryErr && (
              <p id="error-listing-category" className="text-[11px] font-mono text-[var(--status-error)] mt-1">
                {categoryErr}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="listing-condition"
              className="text-xs font-mono font-bold text-[var(--ink)]"
            >
              Item condition <span className="text-[var(--status-error)]">*</span>
            </label>
            <select
              id="listing-condition"
              name="condition"
              value={listing.condition}
              onChange={handleConditionChange}
              autoComplete="off"
              aria-invalid={Boolean(conditionErr)}
              aria-describedby={conditionErr ? "error-listing-condition" : undefined}
              required
              className={`w-full px-3 py-2 text-xs font-sans bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] cursor-pointer min-h-[44px] ${
                conditionErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
              }`}
            >
              {CONDITION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {conditionErr && (
              <p id="error-listing-condition" className="text-[11px] font-mono text-[var(--status-error)] mt-1">
                {conditionErr}
              </p>
            )}
          </div>
        </div>

        <div className="paper-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-[var(--ink-muted)]">
              Pricing suggestions
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label
                htmlFor="price-sgd"
                className="text-xs font-mono font-bold text-[var(--ink)]"
              >
                Price (SGD $) <span className="text-[var(--status-error)]">*</span>
              </label>
              <input
                id="price-sgd"
                name="priceSgd"
                type="number"
                step="0.01"
                min="0.01"
                value={listing.priceSgd || ""}
                onChange={handlePriceSgdChange}
                autoComplete="off"
                aria-invalid={Boolean(priceSgdErr)}
                aria-describedby={priceSgdErr ? "error-price-sgd" : undefined}
                required
                className={`w-full px-3 py-2 text-xs font-mono bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] ${
                  priceSgdErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
                }`}
              />
              {priceSgdErr && (
                <p id="error-price-sgd" className="text-[11px] font-mono text-[var(--status-error)] mt-1">
                  {priceSgdErr}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label
                htmlFor="price-usd"
                className="text-xs font-mono font-bold text-[var(--ink)]"
              >
                Price (USD $) <span className="text-[var(--status-error)]">*</span>
              </label>
              <input
                id="price-usd"
                name="priceUsd"
                type="number"
                step="0.01"
                min="0.01"
                value={listing.priceUsd || ""}
                onChange={handlePriceUsdChange}
                autoComplete="off"
                aria-invalid={Boolean(priceUsdErr)}
                aria-describedby={priceUsdErr ? "error-price-usd" : undefined}
                required
                className={`w-full px-3 py-2 text-xs font-mono bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] ${
                  priceUsdErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
                }`}
              />
              {priceUsdErr && (
                <p id="error-price-usd" className="text-[11px] font-mono text-[var(--status-error)] mt-1">
                  {priceUsdErr}
                </p>
              )}
            </div>
          </div>

          {priceRationale && (
            <p className="text-[11px] font-mono text-[var(--ink-muted)] bg-[var(--paper-raised)] p-2.5 rounded border border-[var(--hairline)]">
              <span className="font-bold text-[var(--ink)]">Gemini pricing rationale: </span>
              {priceRationale}
            </p>
          )}
        </div>

        <div className="paper-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-[var(--ink-muted)]">
              Structured item specifics
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(listing.itemSpecifics).map(([key, val]) => {
              const specErr = errors[`itemSpecifics.${key}`] || errors[key];
              const fieldId = `item-spec-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
              const isRequired = key === "Brand" || key === "Model";

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={fieldId}
                      className="text-[11px] font-mono font-bold text-[var(--ink-muted)] truncate"
                    >
                      {key} {isRequired ? "*" : ""}
                    </label>
                  </div>
                  <input
                    id={fieldId}
                    name={`itemSpec_${key}`}
                    type="text"
                    value={val}
                    onChange={(e) => handleItemSpecificChange(key, e.target.value)}
                    autoComplete="off"
                    aria-invalid={Boolean(specErr)}
                    aria-describedby={specErr ? `error-${fieldId}` : undefined}
                    required={isRequired}
                    className={`w-full px-2.5 py-1.5 text-xs font-sans bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] min-h-[44px] ${
                      specErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
                    }`}
                  />
                  {specErr && (
                    <p id={`error-${fieldId}`} className="text-[11px] font-mono text-[var(--status-error)] mt-1">
                      {specErr}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="listing-description"
            className="text-xs font-mono font-bold text-[var(--ink)]"
          >
            Item description <span className="text-[var(--status-error)]">*</span>
          </label>
          <textarea
            id="listing-description"
            name="description"
            rows={5}
            value={listing.description}
            onChange={handleDescriptionChange}
            autoComplete="off"
            aria-invalid={Boolean(descErr)}
            aria-describedby={descErr ? "error-listing-description" : undefined}
            required
            className={`w-full px-3 py-2 text-xs font-sans bg-[var(--paper)] border rounded-[4px] text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] resize-y min-h-[100px] ${
              descErr ? "border-[var(--status-error)]" : "border-[var(--hairline)]"
            }`}
          />
          {descErr && (
            <p id="error-listing-description" className="text-[11px] font-mono text-[var(--status-error)] mt-1">
              {descErr}
            </p>
          )}
        </div>
      </fieldset>
    </div>
  );
}
