import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ActiveListingSchema, SoldComparableSchema } from "../lib/domain/marketplace";
import { SEED_ACTIVE_LISTINGS, SEED_SOLD_COMPARABLES, SEEDED_SELLERS } from "../lib/persistence/seed-marketplace";
import {
  SEED_MEDIA_MANIFEST,
  resolveSeedMedia,
  resolveSeedMediaSourcePath,
} from "../lib/persistence/seed-media-manifest";

const EXPECTED_PRODUCT_SETS: Readonly<Record<string, string>> = {
  "seed-macbook-air-m2-512": "silver_macbook_air_existing_v1",
  "seed-switch-oled-white": "switch_oled_white_generated_v1",
  "seed-sony-wh1000xm5-black": "sony_wh1000xm5_black_generated_v1",
  "seed-pixel-8-blue": "pixel_8_blue_generated_v1",
  "seed-asics-kayano-30": "asics_kayano30_white_blue_generated_v1",
  "seed-nike-pegasus-40": "nike_pegasus40_white_orange_generated_v1",
  "seed-brooks-ghost-15": "brooks_ghost15_blue_white_generated_v1",
  "seed-newbalance-1080v13": "newbalance_1080v13_white_orange_generated_v1",
  "seed-nike-air-force-1-07-white": "nike_af1_07_white_existing_v1",
  "seed-nike-air-force-1-miami-double-hook": "nike_af1_miami_double_hook_existing_v1",
};

const EXPECTED_EXISTING_SOURCE_COPIES = {
  "seed-media/seed-nike-air-force-1-07-white/seed-nike-air-force-1-07-white-p1.jpg": { source: "img/carousell/air force 1 07 white like new/img1.jpg", width: 810, height: 1080, sha256: "c7a9187b4f027e298ba0a55eeb15fe99fd4fb2d79db2083cd794da0e2d8f14a3" },
  "seed-media/seed-nike-air-force-1-07-white/seed-nike-air-force-1-07-white-p2.jpg": { source: "img/carousell/air force 1 07 white like new/img2.jpg", width: 810, height: 1080, sha256: "015fe8cce8c32850424b4358fadba5e608cb4f750ee0257460ac4394aafc9483" },
  "seed-media/seed-nike-air-force-1-07-white/seed-nike-air-force-1-07-white-p3.jpg": { source: "img/carousell/air force 1 07 white like new/img3.jpg", width: 810, height: 1080, sha256: "2c759c491b1ea4380a10fbeccb4614f53e54a6aa1a76aab548c1c7dc3581ea61" },
  "seed-media/seed-nike-air-force-1-07-white/seed-nike-air-force-1-07-white-p4.jpg": { source: "img/carousell/air force 1 07 white like new/img4.jpg", width: 1080, height: 810, sha256: "7993c00c2e0b0d360243db4593e73d0ac2fce10733de51b3a8d729e607a1ff9d" },
  "seed-media/seed-nike-air-force-1-07-white/seed-nike-air-force-1-07-white-p5.jpg": { source: "img/carousell/air force 1 07 white like new/img5.jpg", width: 1080, height: 810, sha256: "36b9d2008cb040f28a133dc0f1059490641b86904d4c6559c5d28ff67295cf8b" },
  "seed-media/seed-nike-air-force-1-07-white/seed-nike-air-force-1-07-white-p6.jpg": { source: "img/carousell/air force 1 07 white like new/img6.jpg", width: 810, height: 1080, sha256: "a206fa116cc9d58e3c909fe24242518793f5cd43233ab72a95775bc32b8d7649" },
  "seed-media/seed-nike-air-force-1-miami-double-hook/seed-nike-air-force-1-miami-double-hook-p1.jpg": { source: "img/carousell/Nike Air Force 1 Miami Dolphins Double Hook Classic Retro White Orange Blue brand new/img1.jpg", width: 1664, height: 2200, sha256: "d0c97c5fa45f6ccc3434029d64b76158ac4455757cb7ac7036b249f470f3409b" },
  "seed-media/seed-nike-air-force-1-miami-double-hook/seed-nike-air-force-1-miami-double-hook-p2.jpg": { source: "img/carousell/Nike Air Force 1 Miami Dolphins Double Hook Classic Retro White Orange Blue brand new/img2.jpg", width: 1678, height: 2200, sha256: "1423035b00247eb9b2675df6741b4aa817483e1c8db7c12fa3745a15d56d4c18" },
  "seed-media/seed-nike-air-force-1-miami-double-hook/seed-nike-air-force-1-miami-double-hook-p3.jpg": { source: "img/carousell/Nike Air Force 1 Miami Dolphins Double Hook Classic Retro White Orange Blue brand new/img3.jpg", width: 1679, height: 2200, sha256: "de9c7a573ad0d31555253a1f1be200262e71d2d4b33c84ccf3fad10d5ef885ab" },
} as const;

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG file");
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }
  throw new Error("JPEG dimensions were not found");
}

function assertRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) assertRecursivelyFrozen(nested, seen);
}

describe("deterministic marketplace seed corpus", () => {
  it("deep-freezes every exported seed fixture without changing schema-valid values", () => {
    const before = structuredClone({
      sellers: SEEDED_SELLERS,
      listings: SEED_ACTIVE_LISTINGS,
      comparables: SEED_SOLD_COMPARABLES,
    });

    for (const fixture of [SEEDED_SELLERS, SEED_ACTIVE_LISTINGS, SEED_SOLD_COMPARABLES]) {
      assertRecursivelyFrozen(fixture);
    }
    expect(Reflect.set(SEEDED_SELLERS[0], "displayName", "Mutated seller")).toBe(false);
    expect(Reflect.set(SEED_ACTIVE_LISTINGS[0].approvedDraft.media[0], "alt", "Mutated media")).toBe(false);
    expect(Reflect.set(SEED_ACTIVE_LISTINGS[0].approvedDraft.evidence[0], "claim", "Mutated claim")).toBe(false);
    expect(Reflect.set(SEED_SOLD_COMPARABLES[0].soldPrice, "atomicAmount", "1")).toBe(false);
    expect(() => Reflect.apply(Array.prototype.push, SEED_ACTIVE_LISTINGS, [structuredClone(SEED_ACTIVE_LISTINGS[0])]))
      .toThrow(TypeError);

    expect({ sellers: SEEDED_SELLERS, listings: SEED_ACTIVE_LISTINGS, comparables: SEED_SOLD_COMPARABLES })
      .toEqual(before);
    expect(ActiveListingSchema.array().parse(SEED_ACTIVE_LISTINGS)).toEqual(SEED_ACTIVE_LISTINGS);
    expect(SoldComparableSchema.array().parse(SEED_SOLD_COMPARABLES)).toEqual(SEED_SOLD_COMPARABLES);
  });

  it("contains exactly 10 schema-valid active listings across all three upstream categories", () => {
    expect(SEED_ACTIVE_LISTINGS).toHaveLength(10);
    expect(ActiveListingSchema.array().parse(SEED_ACTIVE_LISTINGS)).toEqual(SEED_ACTIVE_LISTINGS);
    expect(new Set(SEED_ACTIVE_LISTINGS.map(({ listingId }) => listingId)).size).toBe(10);
    expect(new Set(SEED_ACTIVE_LISTINGS.map(({ approvedDraft }) => approvedDraft.category))).toEqual(new Set(["electronics", "running_shoes", "sneakers"]));
    expect(SEED_ACTIVE_LISTINGS.filter(({ approvedDraft }) => approvedDraft.category === "electronics")).toHaveLength(4);
    expect(SEED_ACTIVE_LISTINGS.filter(({ approvedDraft }) => approvedDraft.category === "running_shoes")).toHaveLength(4);
    expect(SEED_ACTIVE_LISTINGS.filter(({ approvedDraft }) => approvedDraft.category === "sneakers")).toHaveLength(2);
    expect(SEED_ACTIVE_LISTINGS.every(({ state, source }) => state === "active" && source === "seed")).toBe(true);
  });

  it("uses fixed fictional seeded seller identities, never the live demo seller", () => {
    expect(SEEDED_SELLERS).toHaveLength(4);
    expect(new Set(SEEDED_SELLERS.map(({ id }) => id)).size).toBe(4);
    for (const listing of SEED_ACTIVE_LISTINGS) {
      expect(listing.seller).toMatchObject({ fictional: true, role: "seller" });
      expect(listing.seller.id).toMatch(/^seed-seller-/);
      expect(listing.seller.id).not.toBe("demo-seller");
    }
  });

  it("avoids unsupported configuration, size, and accessory claims", () => {
    const macbooks = SEED_ACTIVE_LISTINGS.filter(({ approvedDraft }) => /macbook/i.test(approvedDraft.title));
    expect(macbooks).toHaveLength(1);
    expect(macbooks[0].approvedDraft.attributes).toEqual({ Color: "Silver", Form: "Laptop" });
    expect(macbooks[0].approvedDraft.title).not.toMatch(/M[1234]|\d+\s?(?:GB|TB)|13-inch|charger/i);

    for (const listing of SEED_ACTIVE_LISTINGS) {
      expect(listing.approvedDraft.media.length).toBeGreaterThanOrEqual(3);
      expect(listing.approvedDraft.media.length).toBeLessThanOrEqual(8);
      expect(listing.approvedDraft.assumptions.every(({ editable, verified }) => editable && !verified)).toBe(true);
      if (["running_shoes", "sneakers"].includes(listing.approvedDraft.category)) {
        expect(listing.approvedDraft.attributes).not.toHaveProperty("Size");
        expect(listing.approvedDraft.attributes).not.toHaveProperty("Width");
        expect(listing.approvedDraft.includedAccessories).toEqual([]);
      }
    }

    const whiteAf1 = SEED_ACTIVE_LISTINGS.find(({ listingId }) => listingId === "seed-nike-air-force-1-07-white")!;
    const miamiAf1 = SEED_ACTIVE_LISTINGS.find(({ listingId }) => listingId === "seed-nike-air-force-1-miami-double-hook")!;
    expect(whiteAf1.approvedDraft.media).toHaveLength(6);
    expect(miamiAf1.approvedDraft.media).toHaveLength(3);
    for (const listing of [whiteAf1, miamiAf1]) {
      expect(listing.approvedDraft.assumptions[0]?.value).toMatch(/size.*authenticity.*use history.*functional condition.*unverified/i);
      expect(listing.approvedDraft.title).not.toMatch(/size\s*\d|authentic|brand new|never worn/i);
      expect(listing.approvedDraft.description).not.toMatch(/size\s*\d|authentic|brand new|never worn/i);
    }
  });

  it("uses exact Base Sepolia USDC prices and evidence tied to listing photos", () => {
    const prices = new Set<string>();
    for (const listing of SEED_ACTIVE_LISTINGS) {
      expect(listing.approvedPrice).toMatchObject({ currency: "USDC", network: "eip155:84532" });
      expect(listing.approvedPrice.atomicAmount).toMatch(/^[1-9]\d*$/);
      prices.add(listing.approvedPrice.atomicAmount);
      const photoIds = new Set(listing.approvedDraft.media.map(({ id }) => id));
      expect(listing.approvedDraft.evidence.every(({ photoId }) => photoIds.has(photoId))).toBe(true);
      expect(listing.approvedDraft.evidence.some(({ kind }) => kind === "condition")).toBe(true);
    }
    expect(prices.size).toBe(10);
  });

  it("has schema-valid sold comparables with multiple relevant records for every shoe demo target", () => {
    expect(SoldComparableSchema.array().parse(SEED_SOLD_COMPARABLES)).toEqual(SEED_SOLD_COMPARABLES);
    expect(SEED_SOLD_COMPARABLES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(SEED_SOLD_COMPARABLES.map(({ comparableId }) => comparableId)).size).toBe(SEED_SOLD_COMPARABLES.length);
    for (const model of ["Gel-Kayano 30", "Pegasus 40", "Ghost 15", "Fresh Foam X 1080v13", "Air Force 1 '07", "Air Force 1 Miami Dolphins Double Hook"]) {
      expect(SEED_SOLD_COMPARABLES.filter((entry) => entry.model === model).length).toBeGreaterThanOrEqual(2);
    }
    expect(SEED_SOLD_COMPARABLES.filter(({ category }) => category === "running_shoes").length).toBeGreaterThanOrEqual(8);
    expect(SEED_SOLD_COMPARABLES.filter(({ category }) => category === "sneakers").length).toBeGreaterThanOrEqual(4);
  });
});

describe("truthful non-public seed media manifest", () => {
  it("deep-freezes every manifest object and nested evidence-ID array", () => {
    const before = structuredClone(SEED_MEDIA_MANIFEST);
    assertRecursivelyFrozen(SEED_MEDIA_MANIFEST);
    for (const entry of Object.values(SEED_MEDIA_MANIFEST)) {
      expect(Reflect.set(entry, "productDescription", "Mutated description")).toBe(false);
      expect(() => Reflect.apply(Array.prototype.push, entry.supportsEvidenceIds, ["mutated-evidence-id"]))
        .toThrow(TypeError);
    }
    expect(SEED_MEDIA_MANIFEST).toEqual(before);
  });

  it("enforces the explicit listing-to-product-set mapping without cross-product reuse", () => {
    expect(Object.keys(EXPECTED_PRODUCT_SETS).sort()).toEqual(SEED_ACTIVE_LISTINGS.map(({ listingId }) => listingId).sort());
    const seenProductSets = new Map<string, string>();
    const seenSources = new Set<string>();
    const seenMediaIds = new Set<string>();

    for (const listing of SEED_ACTIVE_LISTINGS) {
      const entries = listing.approvedDraft.media.map((media) => {
        const entry = SEED_MEDIA_MANIFEST[media.pathname];
        expect(entry).toBeDefined();
        expect(entry.listingId).toBe(listing.listingId);
        expect(entry.productSetId).toBe(EXPECTED_PRODUCT_SETS[listing.listingId]);
        expect(seenSources.has(entry.sourceRelativePath)).toBe(false);
        expect(seenMediaIds.has(media.id)).toBe(false);
        seenSources.add(entry.sourceRelativePath);
        seenMediaIds.add(media.id);
        return entry;
      });
      expect(new Set(entries.map(({ productSetId }) => productSetId))).toEqual(new Set([EXPECTED_PRODUCT_SETS[listing.listingId]]));
      const priorListing = seenProductSets.get(entries[0].productSetId);
      expect(priorListing).toBeUndefined();
      seenProductSets.set(entries[0].productSetId, listing.listingId);
    }
  });

  it("stores exact decoded JPEG dimensions and MIME for every unique source", async () => {
    const media = SEED_ACTIVE_LISTINGS.flatMap(({ approvedDraft }) => approvedDraft.media);
    expect(Object.keys(SEED_MEDIA_MANIFEST)).toHaveLength(media.length);

    for (const reference of media) {
      const entry = resolveSeedMedia(reference.pathname);
      expect(entry).toEqual(SEED_MEDIA_MANIFEST[reference.pathname]);
      expect(entry?.mimeType).toBe(reference.mimeType);
      const absolutePath = resolveSeedMediaSourcePath(entry!.sourceRelativePath);
      expect(absolutePath).toBe(path.join(process.cwd(), entry!.sourceRelativePath));
      expect((await stat(absolutePath)).isFile()).toBe(true);
      const bytes = await readFile(absolutePath);
      expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(jpegDimensions(bytes)).toEqual({ width: reference.width, height: reference.height });
    }
    expect(resolveSeedMedia("media/seed/missing/missing.jpg")).toBeNull();
  });

  it("preserves exact bytes, hashes, dimensions, and provenance for the existing Nike photo sets", async () => {
    for (const [destination, expected] of Object.entries(EXPECTED_EXISTING_SOURCE_COPIES)) {
      const destinationBytes = await readFile(path.join(process.cwd(), destination));
      const sourceBytes = await readFile(path.join(process.cwd(), expected.source));
      expect(destinationBytes.equals(sourceBytes)).toBe(true);
      expect(createHash("sha256").update(destinationBytes).digest("hex")).toBe(expected.sha256);
      expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(expected.sha256);
      expect(jpegDimensions(destinationBytes)).toEqual({ width: expected.width, height: expected.height });

      const manifestEntry = Object.values(SEED_MEDIA_MANIFEST).find(
        ({ sourceRelativePath }) => sourceRelativePath === destination
      );
      expect(manifestEntry).toMatchObject({
        origin: "existing_product_photos",
        mimeType: "image/jpeg",
      });
      expect(manifestEntry?.supportsEvidenceIds).not.toHaveLength(0);
    }
  });

  it("curates every evidence claim to the exact mapped photo that supports it", () => {
    for (const listing of SEED_ACTIVE_LISTINGS) {
      for (const evidence of listing.approvedDraft.evidence) {
        const media = listing.approvedDraft.media.find(({ id }) => id === evidence.photoId);
        expect(media).toBeDefined();
        expect(SEED_MEDIA_MANIFEST[media!.pathname].supportsEvidenceIds).toContain(evidence.id);
      }
      const manifestedEvidenceIds = listing.approvedDraft.media.flatMap(
        ({ pathname }) => SEED_MEDIA_MANIFEST[pathname].supportsEvidenceIds
      );
      expect(new Set(manifestedEvidenceIds)).toEqual(new Set(listing.approvedDraft.evidence.map(({ id }) => id)));
    }
  });

  it.each([
    "../seed-media/escape/file.jpg",
    "seed-media/../escape/file.jpg",
    "seed-media//listing/file.jpg",
    "seed-media/./listing/file.jpg",
    "seed-media\\listing\\file.jpg",
    "https://example.com/seed-media/listing/file.jpg",
    "seed-media/listing/file.jpg?download=1",
    "seed-media/listing/file.jpg#fragment",
    "public/seed-media/listing/file.jpg",
    "",
  ])("rejects hostile or non-approved source path %j", (sourcePath) => {
    expect(() => resolveSeedMediaSourcePath(sourcePath)).toThrow();
  });
});
