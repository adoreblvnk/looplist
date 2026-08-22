/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BuyerSearch } from "./buyer-search";
import type { Category, Listing } from "./types";
import { categories, displayListingPrice, filterListings, humanize, publicMediaUrl } from "./utils";

export function MarketplaceFeed() {
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | Category>("all");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requested = parameters.get("category");
    if (requested === "electronics" || requested === "running_shoes" || requested === "sneakers") setCategory(requested);
    setQuery(parameters.get("q")?.slice(0, 120) ?? "");
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    fetch("/api/listings")
      .then((response) => {
        if (!response.ok) throw new Error("marketplace_unavailable");
        return response.json();
      })
      .then((payload) => { if (live) setItems(payload.listings); })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [retry]);

  const shown = useMemo(() => filterListings(items, query, category), [items, query, category]);

  return (
    <main id="main-content" className="market-main">
      <section className="feed-intro">
        <div><p className="section-label">Local marketplace</p><h1>Fresh finds, clearly described.</h1></div>
        <p>Pre-owned electronics and footwear grounded in seller photos.</p>
      </section>
      <BuyerSearch/>
      <section className="browse-listings" aria-labelledby="browse-heading">
        <div className="browse-heading">
          <div><h2 id="browse-heading">Browse listings</h2><p className="result-count">{loading ? "Loading marketplace" : `${shown.length} ${shown.length === 1 ? "listing" : "listings"}`}</p></div>
          <Link href="/sell" className="text-link">List an item →</Link>
        </div>
        <div className="search-row">
          <div className="category-tabs" role="group" aria-label="Filter by category">
            {categories.map((item) => <button type="button" key={item.value} aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
          </div>
          {query && <button className="clear-search" type="button" onClick={() => setQuery("")}>Clear “{query}”</button>}
        </div>
        {loading ? (
          <div className="product-grid" aria-label="Loading listings">{Array.from({ length: 8 }, (_, index) => <div className="product-card" key={index}><div className="skeleton product-image"/><div className="skeleton line"/><div className="skeleton line short"/></div>)}</div>
        ) : error ? (
          <Status title="The marketplace couldn’t load" text="Check your connection and try again." action={() => setRetry((value) => value + 1)}/>
        ) : shown.length === 0 ? (
          <Status title="No listings match" text="Try a different search or category." action={() => { setQuery(""); setCategory("all"); }} actionLabel="Clear filters"/>
        ) : (
          <div className="product-grid">
            {shown.map((listing) => <article className={`product-card ${listing.status === "sold" ? "sold" : ""}`} key={listing.listingId}><p className="card-seller">{listing.seller.displayName} <span>· demo seller</span></p><Link href={`/listings/${listing.listingId}`} aria-label={`${listing.title}, ${displayListingPrice(listing.price)}`}><div className="product-image-wrap"><img className="product-image" src={publicMediaUrl(listing.listingId, listing.photoIds[0])} alt=""/>{listing.status === "sold" && <span className="sold-badge">Sold</span>}</div><div className="product-copy"><h3>{listing.title}</h3><p>{humanize(listing.condition)}</p><strong>{displayListingPrice(listing.price)}</strong></div></Link></article>)}
          </div>
        )}
      </section>
    </main>
  );
}

function Status({ title, text, action, actionLabel = "Try again" }: { title: string; text: string; action: () => void; actionLabel?: string }) {
  return <section className="status-panel"><h2>{title}</h2><p>{text}</p><button className="button" onClick={action}>{actionLabel}</button></section>;
}
