/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import type { BuyerSearchResponse } from "./types";
import { displayListingPrice, humanize, publicMediaUrl } from "./utils";

const EXAMPLE_QUERY = "Find a MacBook below 900 USDC with no visible screen damage and acceptable cosmetic wear.";
const CLIENT_TIMEOUT_MS = 95_000;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: BuyerSearchResponse }
  | { status: "error"; message: string; timeout: boolean };

export function BuyerSearch() {
  const [query, setQuery] = useState(EXAMPLE_QUERY);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const replay = useRef<{ query: string; key: string } | null>(null);

  async function runSearch(searchQuery: string, reuse: boolean) {
    const normalized = searchQuery.trim();
    if (normalized.length < 3 || normalized.length > 500) {
      setState({ status: "error", message: "Describe what you want in 3 to 500 characters.", timeout: false });
      return;
    }
    const key = reuse && replay.current?.query === normalized
      ? replay.current.key
      : `buyer-${crypto.randomUUID()}`;
    replay.current = { query: normalized, key };
    setState({ status: "loading" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/buyer-search", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ query: normalized }),
        signal: controller.signal,
      });
      const payload = await response.json() as BuyerSearchResponse | { error?: { code?: string; message?: string } };
      if (!response.ok || !("matches" in payload)) {
        const timeout = response.status === 504 || ("error" in payload && payload.error?.code === "buyer_search_timeout");
        throw Object.assign(new Error(timeout ? "The ranked search took too long. Try it again." : "Ranked search is unavailable right now. Try again."), { timeout });
      }
      setState({ status: "success", result: payload });
    } catch (error) {
      const timeout = controller.signal.aborted || (error instanceof Error && "timeout" in error && error.timeout === true);
      setState({
        status: "error",
        message: timeout ? "The ranked search took too long. Try it again." : "Ranked search is unavailable right now. Try again.",
        timeout,
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query, false);
  }

  return (
    <section className="buyer-search" aria-labelledby="buyer-search-heading">
      <div className="buyer-search-copy">
        <p className="section-label">Ranked search</p>
        <h2 id="buyer-search-heading">Describe the right item</h2>
        <p>Gemma ranks available listings against your budget, condition, and product requirements.</p>
      </div>
      <form className="buyer-search-form" onSubmit={submit}>
        <label htmlFor="buyer-request">What are you looking for?</label>
        <div className="buyer-search-control">
          <textarea
            id="buyer-request"
            rows={2}
            maxLength={500}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={state.status === "loading"}
          />
          <button className="button primary" type="submit" disabled={state.status === "loading"}>
            {state.status === "loading" ? "Ranking…" : "Find matches"}
          </button>
        </div>
      </form>

      <div className="buyer-search-status" aria-live="polite">
        {state.status === "loading" && (
          <div className="ranked-loading">
            <span className="spinner" aria-hidden="true" />
            <div><strong>Checking active listings</strong><p>Applying your constraints and grounding every match.</p></div>
          </div>
        )}
        {state.status === "error" && (
          <div className="inline-status" role="alert">
            <div><strong>{state.timeout ? "Search timed out" : "Search unavailable"}</strong><p>{state.message}</p></div>
            <button className="button" type="button" onClick={() => void runSearch(query, true)}>Retry</button>
          </div>
        )}
        {state.status === "success" && state.result.matches.length === 0 && (
          <div className="inline-status">
            <div><strong>No active listing fits every requirement</strong><p>Adjust the budget, condition, or product details and search again.</p></div>
          </div>
        )}
      </div>

      {state.status === "success" && state.result.matches.length > 0 && (
        <div className="ranked-results" aria-label="Gemma ranked matches">
          <div className="ranked-results-heading">
            <h3>{state.result.matches.length} grounded {state.result.matches.length === 1 ? "match" : "matches"}</h3>
            <span>Active listings only</span>
          </div>
          {state.result.matches.map((match) => (
            <article className="ranked-result" key={match.listing.listingId}>
              <Link className="ranked-result-photo" href={`/listings/${match.listing.listingId}`}>
                <img src={publicMediaUrl(match.listing.listingId, match.listing.photoIds[0])} alt="" />
                <span>#{match.rank}</span>
              </Link>
              <div className="ranked-result-main">
                <div className="ranked-result-title">
                  <div><strong>{displayListingPrice(match.listing.price)}</strong><h3>{match.listing.title}</h3></div>
                  <span>{humanize(match.listing.condition)}</span>
                </div>
                <p className="fit-explanation">{match.fitExplanation}</p>
                <div className="grounding-grid">
                  <div><h4>Visible condition</h4>{match.visibleDefects.length ? <ul>{match.visibleDefects.map((defect) => <li key={defect}>{defect}</li>)}</ul> : <p>No visible defects were recorded.</p>}</div>
                  <div><h4>Uncertainty</h4>{match.assumptions.length ? <ul>{match.assumptions.map((item) => <li key={item.assumptionId}>{humanize(item.field)}: {item.value} <span>({item.confidence})</span></li>)}</ul> : <p>No confidence-labelled assumptions were selected.</p>}</div>
                </div>
                <div className="ranked-result-actions">
                  <span>{match.listing.seller.displayName} · fictional seller</span>
                  <Link className="button primary" href={`/listings/${match.listing.listingId}?purchase=review`}>Review to buy</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
