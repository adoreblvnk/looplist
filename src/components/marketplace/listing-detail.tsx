/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Checkout } from "./checkout";
import type { Listing } from "./types";
import { categoryLabel, displayListingPrice, humanize, publicMediaUrl } from "./utils";

export function ListingDetail({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const galleryDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/listings/${encodeURIComponent(listingId)}`)
      .then((response) => {
        if (response.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!response.ok) throw new Error("listing_unavailable");
        return response.json();
      })
      .then((listing: Listing | null) => {
        if (!listing) return;
        setData(listing);
        const requestedCheckout = new URLSearchParams(window.location.search).get("purchase") === "review";
        setCheckoutOpen(listing.status === "sold" || requestedCheckout);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [listingId, retry]);

  if (loading) {
    return <main id="main-content" className="detail-shell"><div className="skeleton detail-placeholder"/><div><div className="skeleton line"/><div className="skeleton line short"/></div></main>;
  }
  if (notFound) return <Status title="Listing not found"/>;
  if (error || !data) return <Status title="This listing couldn’t load" retry={() => setRetry((value) => value + 1)}/>;

  const photoId = data.photoIds[selected];
  const movePhoto = (direction: -1 | 1) => setSelected((current) => (current + direction + data.photoIds.length) % data.photoIds.length);
  const inspectPhoto = (index: number) => {
    setSelected(index);
    galleryDialog.current?.showModal();
  };
  const openCheckout = () => {
    setCheckoutOpen(true);
    requestAnimationFrame(() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const deleteListing = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(data.listingId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "The listing could not be deleted. Please try again.");
      }
      deleteDialog.current?.close();
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "The listing could not be deleted. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <main id="main-content" className="detail-page">
      <nav className="detail-breadcrumb" aria-label="Breadcrumb"><Link href="/">Marketplace</Link><span>›</span><Link href={`/?category=${data.category}`}>{categoryLabel(data.category)}</Link><span>›</span><span aria-current="page">{data.title}</span></nav>
      <section className={`detail-gallery ${data.photoIds.length === 1 ? "single" : ""}`} aria-label="Product photos">
        {data.photoIds.slice(0, 3).map((id, index) => (
          <button className="gallery-panel" key={id} type="button" onClick={() => { setSelected(index); galleryDialog.current?.showModal(); }} aria-label={`Expand photo ${index + 1} of ${data.photoIds.length}`}>
            <img src={publicMediaUrl(data.listingId, id)} alt={`${data.title}, photo ${index + 1}`}/>
            {index === Math.min(2, data.photoIds.length - 1) && <span className="photo-count">View {data.photoIds.length} photos</span>}
          </button>
        ))}
      </section>
      <div className="thumbnails" aria-label="Choose product photo">
        {data.photoIds.map((id, index) => (
          <button key={id} type="button" aria-label={`Open photo ${index + 1}`} aria-pressed={selected === index} onClick={() => inspectPhoto(index)}>
            <img src={publicMediaUrl(data.listingId, id)} alt=""/>
          </button>
        ))}
      </div>

      <div className="detail-content">
        <article className="listing-info">
          <div className="listing-status"><span>{data.status === "sold" ? "Sold" : "Available"}</span><span>{categoryLabel(data.category)}</span></div>
          <h1>{data.title}</h1>
          <p className="detail-price">{displayListingPrice(data.price)}</p>
          <p className="condition">{humanize(data.condition)} · listed by {data.seller.displayName}</p>
          <hr/>
          <h2>Description</h2>
          <p className="description">{data.description}</p>
          {Object.keys(data.attributes).length > 0 && <><h2>Details</h2><dl className="attributes">{Object.entries(data.attributes).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{value}</dd></div>)}</dl></>}
          <List title="Included" items={data.includedAccessories}/>
          <List title="Visibly missing" items={data.visiblyMissingAccessories}/>
          <section className="evidence-section">
            <h2>Photo-backed evidence</h2>
            <p>Select a claim to match it to its source photo.</p>
            <div className="evidence-list">
              {data.evidence.map((item) => (
                <button key={item.id} type="button" onClick={() => inspectPhoto(Math.max(0, data.photoIds.indexOf(item.photoId)))}>
                  <span>{humanize(item.kind)} · {humanize(item.confidence)} confidence</span>
                  <strong>{item.claim}</strong>
                  <small>Source photo {data.photoIds.indexOf(item.photoId) + 1}</small>
                </button>
              ))}
            </div>
            {data.assumptions.length > 0 && <div className="assumptions"><h2>Unverified assumptions</h2>{data.assumptions.map((item) => <div key={item.id}><strong>{humanize(item.field)}</strong><span>{item.value} · {humanize(item.confidence)} confidence</span></div>)}</div>}
          </section>
        </article>

        <aside className="transaction-rail" aria-label="Seller and purchase">
          <section className="seller-summary"><div className="seller-mark" aria-hidden="true">{data.seller.displayName.charAt(0)}</div><div><strong>{data.seller.displayName}</strong><span>Verified seller</span></div></section>
          <div className="transaction-summary"><span>{data.status === "sold" ? "Sold listing" : "Available now"}</span><strong>{displayListingPrice(data.price)}</strong><p>{humanize(data.condition)} condition</p></div>
          {!checkoutOpen && <button className="button primary purchase-review" type="button" onClick={openCheckout}>{data.status === "sold" ? "View receipt" : "Review purchase"}</button>}
          <p className="transaction-note">Buyer approval and wallet confirmation are required before any testnet payment.</p>
          {checkoutOpen && <div id="checkout" className="checkout-boundary"><Checkout listingId={data.listingId}/></div>}
          {data.canDelete && <button className="button danger delete-listing" type="button" onClick={() => { setDeleteError(null); deleteDialog.current?.showModal(); }}>Delete listing</button>}
        </aside>
      </div>

      <div className="purchase-dock" aria-label="Purchase summary"><div><span>{data.status === "sold" ? "Sold" : humanize(data.condition)}</span><strong>{displayListingPrice(data.price)}</strong></div><button className="button primary" type="button" onClick={openCheckout}>{data.status === "sold" ? "View receipt" : "Review purchase"}</button></div>

      <dialog ref={galleryDialog} className="gallery-dialog" aria-label={`${data.title} photo gallery`} onClick={(event) => { if (event.target === event.currentTarget) galleryDialog.current?.close(); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") movePhoto(-1); if (event.key === "ArrowRight") movePhoto(1); }}>
        <div className="gallery-dialog-shell">
          <div className="gallery-dialog-header"><span>{selected + 1} / {data.photoIds.length}</span><button type="button" onClick={() => galleryDialog.current?.close()} aria-label="Close photo gallery">×</button></div>
          <div className="gallery-dialog-stage">
            <button type="button" className="gallery-arrow previous" onClick={() => movePhoto(-1)} aria-label="Previous photo">←</button>
            <img src={publicMediaUrl(data.listingId, photoId)} alt={`${data.title}, expanded photo ${selected + 1}`}/>
            <button type="button" className="gallery-arrow next" onClick={() => movePhoto(1)} aria-label="Next photo">→</button>
          </div>
          <div className="gallery-dialog-thumbnails" aria-label="Choose expanded photo">
            {data.photoIds.map((id, index) => <button key={id} type="button" aria-label={`Expand photo ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)}><img src={publicMediaUrl(data.listingId, id)} alt=""/></button>)}
          </div>
        </div>
      </dialog>

      <dialog ref={deleteDialog} className="wallet-dialog" aria-labelledby="delete-listing-title" onClick={(event) => { if (!deleting && event.target === event.currentTarget) deleteDialog.current?.close(); }}>
        <div className="wallet-dialog-card">
          <div className="wallet-dialog-heading">
            <div><span className="eyebrow">Seller action</span><h2 id="delete-listing-title">Delete this listing?</h2></div>
            <button className="wallet-dialog-close" type="button" disabled={deleting} onClick={() => deleteDialog.current?.close()} aria-label="Close delete confirmation">×</button>
          </div>
          <p>This removes the listing from the marketplace. Sold listings and listings with any payment attempt cannot be deleted.</p>
          {deleteError && <p className="delete-error" role="alert">{deleteError}</p>}
          <div className="button-row">
            <button className="button secondary" type="button" disabled={deleting} onClick={() => deleteDialog.current?.close()}>Keep listing</button>
            <button className="button danger" type="button" disabled={deleting} onClick={deleteListing}>{deleting ? "Deleting…" : "Delete listing"}</button>
          </div>
        </div>
      </dialog>
    </main>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return items.length ? <><h2>{title}</h2><ul className="simple-list">{items.map((item) => <li key={item}>{item}</li>)}</ul></> : null;
}

function Status({ title, retry }: { title: string; retry?: () => void }) {
  return <main id="main-content" className="status-panel"><h1>{title}</h1><p>Return to the marketplace or try again.</p>{retry && <button className="button" onClick={retry}>Try again</button>} <Link className="button" href="/">Browse listings</Link></main>;
}
