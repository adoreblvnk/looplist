/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  AnalysisSuccess,
  Assumption,
  Category,
  Condition,
  Draft,
  MediaReference,
} from "./types";
import {
  displayListingPrice,
  formatDisplayedUsdcAtomic,
  friendlyError,
  idempotencyKey,
  parseDisplayedUsdcInput,
} from "./utils";
import { analysisPhotosAreBound } from "./sell-flow-lifecycle";

type Step = "photos" | "analysis" | "review" | "published";
type PublishedListing = { listingId: string; title: string };
type AnalysisFailure = { status: "failed"; error?: { message?: string } };

const allowed = ["image/jpeg", "image/png", "image/webp"];
const steps: Step[] = ["photos", "analysis", "review", "published"];

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function assertActive(signal: AbortSignal, mounted: React.RefObject<boolean>): void {
  if (signal.aborted || !mounted.current) throw abortError();
}

export function SellFlow() {
  const [step, setStep] = useState<Step>("photos");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadedMedia, setUploadedMedia] = useState<MediaReference[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [terminalFailed, setTerminalFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisSuccess | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [price, setPrice] = useState("");
  const [published, setPublished] = useState<PublishedListing | null>(null);

  const analysisKey = useRef(idempotencyKey("analysis"));
  const publicationKey = useRef(idempotencyKey("publication"));
  const uploadedMediaRef = useRef<MediaReference[]>([]);
  const runIdRef = useRef<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const priceInput = useRef<HTMLInputElement | null>(null);
  const previewsRef = useRef<string[]>([]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortController.current?.abort();
      if (timeout.current) clearTimeout(timeout.current);
      previewsRef.current.forEach(URL.revokeObjectURL);
    };
  }, []);

  function replacePreviews(next: string[]) {
    previewsRef.current.forEach(URL.revokeObjectURL);
    previewsRef.current = next;
    setPreviews(next);
  }

  function resetAnalysisIdentity() {
    analysisKey.current = idempotencyKey("analysis");
    publicationKey.current = idempotencyKey("publication");
    uploadedMediaRef.current = [];
    runIdRef.current = null;
    setUploadedMedia([]);
    setRunId(null);
    setTerminalFailed(false);
    setAnalysis(null);
    setDraft(null);
    setPublished(null);
  }

  function choose(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list);
    if (next.length < 3 || next.length > 8) {
      setMessage("Choose 3 to 8 photos.");
      return;
    }
    if (next.some((file) => !allowed.includes(file.type))) {
      setMessage("Use JPEG, PNG, or WebP photos.");
      return;
    }
    if (next.some((file) => file.size > 8 * 1024 * 1024)) {
      setMessage("Each photo must be 8 MB or smaller.");
      return;
    }

    abortController.current?.abort();
    resetAnalysisIdentity();
    setFiles(next);
    replacePreviews(next.map(URL.createObjectURL));
    setMessage("");
    setStep("photos");
  }

  function clearPhotos() {
    abortController.current?.abort();
    resetAnalysisIdentity();
    setFiles([]);
    replacePreviews([]);
    setMessage("Photos cleared.");
    setBusy(false);
    setStep("photos");
  }

  function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = null;
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      timeout.current = setTimeout(() => {
        timeout.current = null;
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
    });
  }

  async function beginAnalysis() {
    const controller = new AbortController();
    abortController.current?.abort();
    abortController.current = controller;
    const { signal } = controller;
    setBusy(true);
    setMessage("");

    try {
      let media = uploadedMediaRef.current;
      if (media.length === 0) {
        const uploaded: MediaReference[] = [];
        for (const file of files) {
          const response = await fetch("/api/media", {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
            signal,
          });
          assertActive(signal, mounted);
          if (!response.ok) throw new Error(friendlyError(response.status));
          const reference = (await response.json()) as MediaReference;
          assertActive(signal, mounted);
          uploaded.push(reference);
        }
        media = uploaded;
        uploadedMediaRef.current = uploaded;
        assertActive(signal, mounted);
        setUploadedMedia(uploaded);
      }

      let currentRunId = runIdRef.current;
      if (!currentRunId) {
        const started = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": analysisKey.current,
          },
          body: JSON.stringify({ media }),
          signal,
        });
        assertActive(signal, mounted);
        if (!started.ok) throw new Error(friendlyError(started.status));
        const accepted = (await started.json()) as { runId: string };
        assertActive(signal, mounted);
        currentRunId = accepted.runId;
        runIdRef.current = currentRunId;
        setRunId(currentRunId);
      }

      assertActive(signal, mounted);
      setStep("analysis");
      let pollDelay = 750;
      for (let attempt = 0; attempt < 35; attempt += 1) {
        await wait(pollDelay, signal);
        assertActive(signal, mounted);
        const response = await fetch(`/api/analyze/${encodeURIComponent(currentRunId)}`, { signal });
        assertActive(signal, mounted);
        if (!response.ok) throw new Error(friendlyError(response.status));
        const state = (await response.json()) as AnalysisSuccess | AnalysisFailure;
        assertActive(signal, mounted);

        if (state.status === "succeeded") {
          if (!analysisPhotosAreBound(state.photoIds, media, state.draft.evidence.map(({ photoId }) => photoId))) {
            setTerminalFailed(true);
            throw new Error("Analysis returned evidence for an unknown photo. Nothing can be published.");
          }
          assertActive(signal, mounted);
          setAnalysis(state);
          setDraft(state.draft);
          setPrice(formatDisplayedUsdcAtomic(state.priceRecommendation.recommendedPrice.atomicAmount));
          setTerminalFailed(false);
          setStep("review");
          return;
        }
        if (state.status === "failed") {
          assertActive(signal, mounted);
          setTerminalFailed(true);
          setMessage(state.error?.message ?? "Analysis couldn’t complete. Start a new analysis when you’re ready.");
          setStep("photos");
          return;
        }
        pollDelay = Math.min(3000, Math.round(pollDelay * 1.35));
      }
      throw new Error("Analysis is taking longer than expected. Retry to resume this same analysis.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!mounted.current || signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setStep("photos");
    } finally {
      if (mounted.current && abortController.current === controller) {
        abortController.current = null;
        setBusy(false);
      }
    }
  }

  function startNewAnalysis() {
    analysisKey.current = idempotencyKey("analysis");
    publicationKey.current = idempotencyKey("publication");
    runIdRef.current = null;
    setRunId(null);
    setTerminalFailed(false);
    void beginAnalysis();
  }

  function cancel() {
    abortController.current?.abort();
    abortController.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    setBusy(false);
    setStep("photos");
    setMessage("Analysis cancelled. Your photos are still selected.");
  }

  async function publish() {
    if (!analysis || !draft) return;
    const invalidField = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "[data-review-form] input:invalid, [data-review-form] textarea:invalid, [data-review-form] select:invalid",
    );
    if (invalidField) {
      invalidField.focus();
      invalidField.reportValidity();
      setMessage("Check the highlighted listing field before publishing.");
      return;
    }
    const atomic = parseDisplayedUsdcInput(price);
    if (!atomic) {
      priceInput.current?.focus();
      setMessage("Enter a price above zero with no more than three decimal places.");
      return;
    }
    if (!analysisPhotosAreBound(
      analysis.photoIds,
      uploadedMediaRef.current,
      draft.evidence.map(({ photoId }) => photoId),
    )) {
      setMessage("Evidence references an unknown source photo. Nothing was published.");
      return;
    }

    const controller = new AbortController();
    abortController.current?.abort();
    abortController.current = controller;
    const { signal } = controller;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": publicationKey.current,
        },
        body: JSON.stringify({
          analysisRunId: analysis.runId,
          ...draft,
          approvedPrice: { currency: "USDC", network: "eip155:84532", atomicAmount: atomic },
        }),
        signal,
      });
      assertActive(signal, mounted);
      if (!response.ok) throw new Error(friendlyError(response.status));
      const listing = (await response.json()) as PublishedListing;
      assertActive(signal, mounted);
      setPublished(listing);
      setStep("published");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!mounted.current || signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Publication failed. Please try again.");
    } finally {
      if (mounted.current && abortController.current === controller) {
        abortController.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <main id="main-content" className="sell-page">
      <ol className="steps" aria-label="Listing progress">
        {["Photos", "Analysis", "Review", "Published"].map((label, index) => (
          <li
            className={index < steps.indexOf(step) ? "completed" : index === steps.indexOf(step) ? "current" : ""}
            aria-current={index === steps.indexOf(step) ? "step" : undefined}
            key={label}
          >
            {label}
          </li>
        ))}
      </ol>

      {step === "photos" && (
        <section className="sell-section">
          <h1 ref={heading} tabIndex={-1} data-step-heading>Sell an item</h1>
          <p>Start with 3–8 clear photos. Include every side, accessory, and visible flaw.</p>
          <label className="upload-zone">
            <strong>{files.length > 0 ? "Change product photos" : "Choose product photos"}</strong>
            <span>JPEG, PNG, or WebP · up to 8 MB each</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => choose(event.target.files)}
            />
          </label>
          {previews.length > 0 && (
            <div className="preview-grid">
              {previews.map((src, index) => (
                <img key={src} src={src} alt={`Selected photo ${index + 1}`} />
              ))}
            </div>
          )}
          <div className="actions">
            <button
              className="button primary"
              disabled={files.length < 3 || busy}
              onClick={terminalFailed ? startNewAnalysis : beginAnalysis}
            >
              {busy
                ? uploadedMedia.length > 0 ? "Resuming…" : "Uploading…"
                : terminalFailed ? "Start new analysis"
                  : runId ? "Resume analysis" : "Analyze photos"}
            </button>
            {files.length > 0 && (
              <button className="button" disabled={busy} onClick={clearPhotos}>Clear photos</button>
            )}
          </div>
        </section>
      )}

      {step === "analysis" && (
        <section className="sell-section analysis-progress" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <h1 ref={heading} tabIndex={-1} data-step-heading>Building your listing</h1>
          <p>Reviewing the photos and comparing similar sold items. This can take a minute.</p>
          <button className="button" onClick={cancel}>Cancel</button>
        </section>
      )}

      {step === "review" && draft && analysis && (
        <Review
          headingRef={heading}
          priceInputRef={priceInput}
          draft={draft}
          setDraft={setDraft}
          price={price}
          setPrice={setPrice}
          analysis={analysis}
          previews={previews}
          publish={publish}
          busy={busy}
        />
      )}

      {step === "published" && published && (
        <section className="sell-section published">
          <h1 ref={heading} tabIndex={-1} data-step-heading>Your listing is live</h1>
          <p><strong>{published.title}</strong> is now visible in the marketplace.</p>
          <div className="actions">
            <Link className="button primary" href={`/listings/${published.listingId}`}>View listing</Link>
            <Link className="button" href="/">Browse marketplace</Link>
          </div>
        </section>
      )}

      <div className="form-status" role="status" aria-live="polite" aria-atomic="true">
        {message && <p className="form-error">{message}</p>}
      </div>
    </main>
  );
}

function Review({
  headingRef,
  priceInputRef,
  draft,
  setDraft,
  price,
  setPrice,
  analysis,
  previews,
  publish,
  busy,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  priceInputRef: React.RefObject<HTMLInputElement | null>;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  price: string;
  setPrice: (price: string) => void;
  analysis: AnalysisSuccess;
  previews: string[];
  publish: () => void;
  busy: boolean;
}) {
  const [selectedPhotoId, setSelectedPhotoId] = useState(analysis.photoIds[0]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const photoIndex = new Map(analysis.photoIds.map((photoId, index) => [photoId, index]));

  return (
    <section className="review-layout">
      <div className="editor" data-review-form>
        <div className="review-product-lead">
          <img src={previews[photoIndex.get(selectedPhotoId) ?? 0]} alt={`${draft.title}, selected product photo`} />
          <div>
            <h1 ref={headingRef} tabIndex={-1} data-step-heading>Review your listing</h1>
            <p>Everything below can be edited before you publish.</p>
          </div>
        </div>
        <Field label="Title">
          <input required value={draft.title} minLength={5} maxLength={80} onChange={(event) => set("title", event.target.value)} />
        </Field>
        <Field label="Description">
          <textarea required rows={6} value={draft.description} minLength={20} maxLength={3000} onChange={(event) => set("description", event.target.value)} />
        </Field>
        <div className="field-pair">
          <Field label="Category">
            <select value={draft.category} onChange={(event) => set("category", event.target.value as Category)}>
              <option value="electronics">Electronics</option>
              <option value="running_shoes">Running shoes</option>
              <option value="sneakers">Sneakers</option>
            </select>
          </Field>
          <Field label="Condition">
            <select value={draft.condition} onChange={(event) => set("condition", event.target.value as Condition)}>
              {["new", "like_new", "very_good", "good", "acceptable", "for_parts"].map((condition) => (
                <option key={condition} value={condition}>{condition.replaceAll("_", " ")}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field-pair">
          <Field label="Brand">
            <input required value={draft.brand} onChange={(event) => set("brand", event.target.value)} />
          </Field>
          <Field label="Model">
            <input required value={draft.model} onChange={(event) => set("model", event.target.value)} />
          </Field>
        </div>
        <Field label="Included accessories (one per line)">
          <textarea rows={3} value={draft.includedAccessories.join("\n")} onChange={(event) => set("includedAccessories", lines(event.target.value))} />
        </Field>
        <Field label="Visibly missing (one per line)">
          <textarea rows={3} value={draft.visiblyMissingAccessories.join("\n")} onChange={(event) => set("visiblyMissingAccessories", lines(event.target.value))} />
        </Field>
        <h2>Attributes</h2>
        {Object.entries(draft.attributes).map(([key, value]) => (
          <Field key={key} label={key}>
            <input value={value} onChange={(event) => set("attributes", { ...draft.attributes, [key]: event.target.value })} />
          </Field>
        ))}
        {draft.assumptions.length > 0 && (
          <>
            <h2>Unverified assumptions</h2>
            <p>Check and edit these details—they were not directly visible.</p>
            {draft.assumptions.map((assumption, index) => (
              <Field key={assumption.id} label={`${assumption.field} · ${assumption.confidence} confidence`}>
                <input
                  value={assumption.value}
                  onChange={(event) => {
                    const assumptions = [...draft.assumptions];
                    assumptions[index] = { ...assumption, value: event.target.value, sellerEdited: true } as Assumption;
                    set("assumptions", assumptions);
                  }}
                />
              </Field>
            ))}
          </>
        )}
      </div>

      <aside className="review-aside">
        <h2>Price recommendation</h2>
        <p className="range">
          {displayListingPrice(analysis.priceRecommendation.minimumPrice)}–{displayListingPrice(analysis.priceRecommendation.maximumPrice)}
        </p>
        <p>{analysis.priceRecommendation.rationale}</p>
        <Field label="Your final price (USDC)">
          <input
            ref={priceInputRef}
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            aria-describedby="price-help"
          />
        </Field>
        <small id="price-help">The recommendation is guidance. You choose the final listing price.</small>

        <h2>Comparable sales</h2>
        {analysis.priceRecommendation.comparables.map((comparable) => (
          <div className="comparable" key={comparable.comparableId}>
            <strong>{comparable.title}</strong>
            <span>{displayListingPrice(comparable.soldPrice)}</span>
            <p>{comparable.similarityReason}</p>
          </div>
        ))}

        <h2>Photo evidence</h2>
        <div className="evidence-source" aria-live="polite">
          {analysis.photoIds.map((photoId, index) => (
            <button
              type="button"
              key={photoId}
              className={selectedPhotoId === photoId ? "selected" : ""}
              aria-label={`Source photo ${index + 1}`}
              aria-pressed={selectedPhotoId === photoId}
              onClick={() => setSelectedPhotoId(photoId)}
            >
              <img src={previews[index]} alt="" />
              <span>Photo {index + 1}</span>
            </button>
          ))}
        </div>
        {draft.evidence.map((evidence) => {
          const index = photoIndex.get(evidence.photoId);
          if (index === undefined) return null;
          const selected = selectedPhotoId === evidence.photoId;
          return (
            <button
              type="button"
              className={`evidence-readonly ${selected ? "selected" : ""}`}
              key={evidence.id}
              aria-pressed={selected}
              onClick={() => setSelectedPhotoId(evidence.photoId)}
            >
              <img src={previews[index]} alt={`Source photo ${index + 1}`} />
              <span>
                <strong>{evidence.claim}</strong>
                <small>Photo {index + 1} · {evidence.confidence} confidence · source locked</small>
              </span>
            </button>
          );
        })}

        <button className="button primary publish" disabled={busy} onClick={publish}>
          {busy ? "Publishing…" : "Publish listing"}
        </button>
        <p className="publish-note" role="status" aria-live="polite">
          {busy ? "Publishing your approved listing…" : "Nothing is published until you press this button."}
        </p>
      </aside>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
