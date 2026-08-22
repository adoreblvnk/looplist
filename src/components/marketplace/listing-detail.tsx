/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Checkout } from "./checkout";
import type { Listing } from "./types";
import { categoryLabel, displayListingPrice, humanize, publicMediaUrl } from "./utils";

export function ListingDetail({ listingId }: { listingId: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [retry, setRetry] = useState(0);
  const galleryDialog = useRef<HTMLDialogElement>(null);

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
      .then((listing) => listing && setData(listing))
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

  return (
    <main id="main-content" className="detail-page">
      <Link href="/" className="back-link">← All listings</Link>
      <div className="detail-shell">
        <section className="gallery" aria-label="Product photos">
          <button className="primary-photo" type="button" onClick={() => galleryDialog.current?.showModal()} aria-label={`Expand photo ${selected + 1} of ${data.photoIds.length}`}>
            <img src={publicMediaUrl(data.listingId, photoId)} alt={`${data.title}, photo ${selected + 1}`}/>
            <span className="photo-count">View {data.photoIds.length} photos</span>
          </button>
          <div className="thumbnails">
            {data.photoIds.map((id, index) => (
              <button key={id} type="button" aria-label={`View photo ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>
                <img src={publicMediaUrl(data.listingId, id)} alt=""/>
              </button>
            ))}
          </div>
        </section>

        <article className="listing-info">
          <div className="listing-status"><span>{data.status === "sold" ? "Sold" : "Available"}</span><span>{categoryLabel(data.category)}</span></div>
          <h1>{data.title}</h1>
          <p className="detail-price">{displayListingPrice(data.price)}</p>
          <p className="condition">{humanize(data.condition)} · sold by {data.seller.displayName}</p>
          <hr/>
          <h2>Description</h2>
          <p className="description">{data.description}</p>
          {Object.keys(data.attributes).length > 0 && <><h2>Details</h2><dl className="attributes">{Object.entries(data.attributes).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{value}</dd></div>)}</dl></>}
          <List title="Included" items={data.includedAccessories}/>
          <List title="Visibly missing" items={data.visiblyMissingAccessories}/>
          <Checkout listingId={data.listingId}/>
        </article>
      </div>

      <section className="evidence-section">
        <h2>Photo-backed evidence</h2>
        <p>Select a claim to inspect its source photo.</p>
        <div className="evidence-list">
          {data.evidence.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelected(Math.max(0, data.photoIds.indexOf(item.photoId)))}>
              <span>{humanize(item.kind)} · {humanize(item.confidence)} confidence</span>
              <strong>{item.claim}</strong>
              <small>View source photo {data.photoIds.indexOf(item.photoId) + 1}</small>
            </button>
          ))}
        </div>
        {data.assumptions.length > 0 && <div className="assumptions"><h2>Unverified assumptions</h2>{data.assumptions.map((item) => <div key={item.id}><strong>{humanize(item.field)}</strong><span>{item.value} · {humanize(item.confidence)} confidence</span></div>)}</div>}
      </section>

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
    </main>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return items.length ? <><h2>{title}</h2><ul className="simple-list">{items.map((item) => <li key={item}>{item}</li>)}</ul></> : null;
}

function Status({ title, retry }: { title: string; retry?: () => void }) {
  return <main id="main-content" className="status-panel"><h1>{title}</h1><p>Return to the marketplace or try again.</p>{retry && <button className="button" onClick={retry}>Try again</button>} <Link className="button" href="/">Browse listings</Link></main>;
}
