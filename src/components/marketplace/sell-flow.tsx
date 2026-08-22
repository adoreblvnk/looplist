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
  displayPrice,
  formatUsdcAtomic,
  friendlyError,
  idempotencyKey,
  parseUsdcInput,
} from "./utils";
type Step = "photos" | "analysis" | "review" | "published";
const allowed = ["image/jpeg", "image/png", "image/webp"];
export function SellFlow() {
  const [step, setStep] = useState<Step>("photos"),
    [files, setFiles] = useState<File[]>([]),
    [previews, setPreviews] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [analysis, setAnalysis] = useState<AnalysisSuccess | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [price, setPrice] = useState(""),
    [published, setPublished] = useState<{
      listingId: string;
      title: string;
    } | null>(null);
  const analysisKey = useRef(idempotencyKey("analysis")),
    publicationKey = useRef(idempotencyKey("publication")),
    cancelled = useRef(false);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);
  function choose(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list);
    if (next.length < 3 || next.length > 8) {
      setMessage("Choose 3 to 8 photos.");
      return;
    }
    if (next.some((f) => !allowed.includes(f.type))) {
      setMessage("Use JPEG, PNG, or WebP photos.");
      return;
    }
    if (next.some((f) => f.size > 8 * 1024 * 1024)) {
      setMessage("Each photo must be 8 MB or smaller.");
      return;
    }
    previews.forEach(URL.revokeObjectURL);
    setFiles(next);
    setPreviews(next.map(URL.createObjectURL));
    setMessage("");
  }
  async function start() {
    setBusy(true);
    setMessage("");
    cancelled.current = false;
    try {
      const media: MediaReference[] = [];
      for (const file of files) {
        const r = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!r.ok) throw new Error(friendlyError(r.status));
        media.push(await r.json());
      }
      const started = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": analysisKey.current,
        },
        body: JSON.stringify({ media }),
      });
      if (!started.ok) throw new Error(friendlyError(started.status));
      const { runId } = await started.json();
      setStep("analysis");
      let delay = 750;
      for (let i = 0; i < 35 && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, delay));
        const response = await fetch(
          `/api/analyze/${encodeURIComponent(runId)}`,
        );
        if (!response.ok) throw new Error(friendlyError(response.status));
        const state = await response.json();
        if (state.status === "succeeded") {
          setAnalysis(state);
          setDraft(state.draft);
          setPrice(
            formatUsdcAtomic(
              state.priceRecommendation.recommendedPrice.atomicAmount,
            ),
          );
          setStep("review");
          return;
        }
        if (state.status === "failed")
          throw new Error(
            "Analysis couldn’t complete. Your photos are still here—try again.",
          );
        delay = Math.min(3000, Math.round(delay * 1.35));
      }
      if (!cancelled.current)
        throw new Error(
          "Analysis is taking longer than expected. Try again to check once more.",
        );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      setStep("photos");
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    cancelled.current = true;
    setStep("photos");
    setBusy(false);
    setMessage("Analysis cancelled. Your photos are still selected.");
  }
  async function publish() {
    if (!analysis || !draft) return;
    const atomic = parseUsdcInput(price);
    if (!atomic) {
      setMessage(
        "Enter a price above zero with no more than six decimal places.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": publicationKey.current,
        },
        body: JSON.stringify({
          analysisRunId: analysis.runId,
          ...draft,
          approvedPrice: {
            currency: "USDC",
            network: "eip155:84532",
            atomicAmount: atomic,
          },
        }),
      });
      if (!r.ok) throw new Error(friendlyError(r.status));
      const listing = await r.json();
      setPublished(listing);
      setStep("published");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Publication failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="sell-page">
      <ol className="steps" aria-label="Listing progress">
        {["Photos", "Analysis", "Review", "Published"].map((x, i) => (
          <li
            className={
              i <= ["photos", "analysis", "review", "published"].indexOf(step)
                ? "current"
                : ""
            }
            key={x}
          >
            {x}
          </li>
        ))}
      </ol>
      {step === "photos" && (
        <section className="sell-section">
          <h1>Sell an item</h1>
          <p>
            Start with 3–8 clear photos. Include every side, accessory, and
            visible flaw.
          </p>
          <label className="upload-zone">
            <strong>Choose product photos</strong>
            <span>JPEG, PNG, or WebP · up to 8 MB each</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => choose(e.target.files)}
            />
          </label>
          {previews.length > 0 && (
            <div className="preview-grid">
              {previews.map((src, i) => (
                <img key={src} src={src} alt={`Selected photo ${i + 1}`} />
              ))}
            </div>
          )}
          <div className="actions">
            <button
              className="button primary"
              disabled={files.length < 3 || busy}
              onClick={start}
            >
              {busy ? "Uploading…" : "Analyze photos"}
            </button>
            {files.length > 0 && (
              <button className="button" onClick={() => choose(null)}>
                Keep selected
              </button>
            )}
          </div>
        </section>
      )}
      {step === "analysis" && (
        <section className="sell-section analysis-progress">
          <div className="spinner" />
          <h1>Building your listing</h1>
          <p>
            Reviewing the photos and comparing similar sold items. This can take
            a minute.
          </p>
          <button className="button" onClick={cancel}>
            Cancel
          </button>
        </section>
      )}
      {step === "review" && draft && analysis && (
        <Review
          draft={draft}
          setDraft={setDraft}
          price={price}
          setPrice={setPrice}
          analysis={analysis}
          publish={publish}
          busy={busy}
        />
      )}{" "}
      {step === "published" && published && (
        <section className="sell-section published">
          <h1>Your listing is live</h1>
          <p>
            <strong>{published.title}</strong> is now visible in the
            marketplace.
          </p>
          <div className="actions">
            <Link
              className="button primary"
              href={`/listings/${published.listingId}`}
            >
              View listing
            </Link>
            <Link className="button" href="/">
              Browse marketplace
            </Link>
          </div>
        </section>
      )}
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </main>
  );
}
function Review({
  draft,
  setDraft,
  price,
  setPrice,
  analysis,
  publish,
  busy,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  price: string;
  setPrice: (s: string) => void;
  analysis: AnalysisSuccess;
  publish: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft({ ...draft, [k]: v });
  return (
    <section className="review-layout">
      <div className="editor">
        <h1>Review your listing</h1>
        <p>Everything below can be edited before you publish.</p>
        <Field label="Title">
          <input
            value={draft.title}
            minLength={5}
            maxLength={80}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={6}
            value={draft.description}
            minLength={20}
            maxLength={3000}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <div className="field-pair">
          <Field label="Category">
            <select
              value={draft.category}
              onChange={(e) => set("category", e.target.value as Category)}
            >
              <option value="electronics">Electronics</option>
              <option value="running_shoes">Running shoes</option>
              <option value="sneakers">Sneakers</option>
            </select>
          </Field>
          <Field label="Condition">
            <select
              value={draft.condition}
              onChange={(e) => set("condition", e.target.value as Condition)}
            >
              {[
                "new",
                "like_new",
                "very_good",
                "good",
                "acceptable",
                "for_parts",
              ].map((x) => (
                <option key={x} value={x}>
                  {x.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field-pair">
          <Field label="Brand">
            <input
              value={draft.brand}
              onChange={(e) => set("brand", e.target.value)}
            />
          </Field>
          <Field label="Model">
            <input
              value={draft.model}
              onChange={(e) => set("model", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Included accessories (one per line)">
          <textarea
            rows={3}
            value={draft.includedAccessories.join("\n")}
            onChange={(e) => set("includedAccessories", lines(e.target.value))}
          />
        </Field>
        <Field label="Visibly missing (one per line)">
          <textarea
            rows={3}
            value={draft.visiblyMissingAccessories.join("\n")}
            onChange={(e) =>
              set("visiblyMissingAccessories", lines(e.target.value))
            }
          />
        </Field>
        <h2>Attributes</h2>
        {Object.entries(draft.attributes).map(([k, v]) => (
          <Field key={k} label={k}>
            <input
              value={v}
              onChange={(e) =>
                set("attributes", { ...draft.attributes, [k]: e.target.value })
              }
            />
          </Field>
        ))}
        {draft.assumptions.length > 0 && (
          <>
            <h2>Unverified assumptions</h2>
            <p>Check and edit these details—they were not directly visible.</p>
            {draft.assumptions.map((a, i) => (
              <Field
                key={a.id}
                label={`${a.field} · ${a.confidence} confidence`}
              >
                <input
                  value={a.value}
                  onChange={(e) => {
                    const assumptions = [...draft.assumptions];
                    assumptions[i] = {
                      ...a,
                      value: e.target.value,
                      sellerEdited: true,
                    } as Assumption;
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
          {displayPrice(analysis.priceRecommendation.minimumPrice)}–
          {displayPrice(analysis.priceRecommendation.maximumPrice)}
        </p>
        <p>{analysis.priceRecommendation.rationale}</p>
        <Field label="Your final price (USDC)">
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-describedby="price-help"
          />
        </Field>
        <small id="price-help">
          The recommendation is guidance. You choose the final exact price.
        </small>
        <h2>Comparable sales</h2>
        {analysis.priceRecommendation.comparables.map((c) => (
          <div className="comparable" key={c.comparableId}>
            <strong>{c.title}</strong>
            <span>{displayPrice(c.soldPrice)}</span>
            <p>{c.similarityReason}</p>
          </div>
        ))}
        <h2>Photo evidence</h2>
        {draft.evidence.map((e) => (
          <div className="evidence-readonly" key={e.id}>
            <strong>{e.claim}</strong>
            <span>
              Photo {analysis.status === "succeeded" ? "source locked" : ""} ·{" "}
              {e.confidence}
            </span>
          </div>
        ))}
        <button
          className="button primary publish"
          disabled={busy || !parseUsdcInput(price)}
          onClick={publish}
        >
          {busy ? "Publishing…" : "Publish listing"}
        </button>
        <p className="publish-note">
          Nothing is published until you press this button.
        </p>
      </aside>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
