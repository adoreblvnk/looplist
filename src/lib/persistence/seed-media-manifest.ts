import "server-only";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SEED_ACTIVE_LISTINGS } from "./seed-marketplace";

const IdentifierSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const SeedSourceRelativePathSchema = z
  .string()
  .max(256)
  .regex(
    /^seed-media\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}-p[1-8]\.jpg$/,
    "Seed media must use a canonical file below the approved non-public seed-media root"
  )
  .refine((value) => {
    const segments = value.split("/");
    return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
  }, "Seed media path cannot contain empty or dot segments")
  .refine(
    (value) =>
      !value.includes("\\") &&
      !/[?#]/.test(value) &&
      !/^[a-z][a-z0-9+.-]*:/i.test(value),
    "Seed media path cannot contain a URL scheme, backslash, query, or fragment"
  );

const SeedMediaManifestEntrySchema = z
  .object({
    listingId: IdentifierSchema,
    productSetId: IdentifierSchema,
    productDescription: z.string().trim().min(5).max(160),
    sourceRelativePath: SeedSourceRelativePathSchema,
    mimeType: z.literal("image/jpeg"),
    view: z.enum(["three_quarter", "side_or_rear", "detail", "interior", "top", "outsole", "label"]),
    supportsEvidenceIds: z.array(IdentifierSchema).max(8),
    origin: z.enum(["existing_product_photos", "generated_product_photos"]),
  })
  .strict();
export type SeedMediaManifestEntry = z.infer<typeof SeedMediaManifestEntrySchema>;

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const nested of value) deepFreeze(nested);
    return Object.freeze(value);
  }
  if (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    !Object.isFrozen(value)
  ) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

interface SourceSet {
  productSetId: string;
  productDescription: string;
  origin: SeedMediaManifestEntry["origin"];
}

const sourceSets: Readonly<Record<string, SourceSet>> = Object.freeze({
  "seed-macbook-air-m2-512": {
    productSetId: "silver_macbook_air_existing_v1",
    productDescription: "One silver Apple MacBook Air laptop, existing product-photo set",
    origin: "existing_product_photos",
  },
  "seed-switch-oled-white": {
    productSetId: "switch_oled_white_generated_v1",
    productDescription: "One white Nintendo Switch OLED console",
    origin: "generated_product_photos",
  },
  "seed-sony-wh1000xm5-black": {
    productSetId: "sony_wh1000xm5_black_generated_v1",
    productDescription: "One matte-black Sony WH-1000XM5 headphone set",
    origin: "generated_product_photos",
  },
  "seed-pixel-8-blue": {
    productSetId: "pixel_8_blue_generated_v1",
    productDescription: "One blue Google Pixel 8 phone",
    origin: "generated_product_photos",
  },
  "seed-asics-kayano-30": {
    productSetId: "asics_kayano30_white_blue_generated_v1",
    productDescription: "One white-and-blue ASICS Gel-Kayano 30 running-shoe pair",
    origin: "generated_product_photos",
  },
  "seed-nike-pegasus-40": {
    productSetId: "nike_pegasus40_white_orange_generated_v1",
    productDescription: "One white-and-orange Nike Pegasus 40 running-shoe pair",
    origin: "generated_product_photos",
  },
  "seed-brooks-ghost-15": {
    productSetId: "brooks_ghost15_blue_white_generated_v1",
    productDescription: "One blue-and-white Brooks Ghost 15 running-shoe pair",
    origin: "generated_product_photos",
  },
  "seed-newbalance-1080v13": {
    productSetId: "newbalance_1080v13_white_orange_generated_v1",
    productDescription: "One white-and-orange New Balance 1080v13 running-shoe pair",
    origin: "generated_product_photos",
  },
  "seed-nike-air-force-1-07-white": {
    productSetId: "nike_af1_07_white_existing_v1",
    productDescription: "One white Nike Air Force 1 '07 lifestyle-sneaker pair and photographed box label",
    origin: "existing_product_photos",
  },
  "seed-nike-air-force-1-miami-double-hook": {
    productSetId: "nike_af1_miami_double_hook_existing_v1",
    productDescription: "One white Nike Air Force 1 lifestyle-sneaker pair with orange and teal double-hook details",
    origin: "existing_product_photos",
  },
});

const viewsByListing: Readonly<Record<string, readonly SeedMediaManifestEntry["view"][]>> = Object.freeze({
  "seed-nike-air-force-1-07-white": ["three_quarter", "interior", "top", "side_or_rear", "outsole", "label"],
  "seed-nike-air-force-1-miami-double-hook": ["three_quarter", "side_or_rear", "outsole"],
});
const defaultViews = ["three_quarter", "side_or_rear", "detail"] as const;

export const SEED_MEDIA_MANIFEST: Readonly<Record<string, SeedMediaManifestEntry>> = deepFreeze(
  Object.fromEntries(
    SEED_ACTIVE_LISTINGS.flatMap((listing) => {
      const sourceSet = sourceSets[listing.listingId];
      const views = viewsByListing[listing.listingId] ?? defaultViews;
      if (!sourceSet || listing.approvedDraft.media.length !== views.length) {
        throw new Error(`Seed media source set is incomplete for ${listing.listingId}`);
      }
      return listing.approvedDraft.media.map((media, index) => [
        media.pathname,
        SeedMediaManifestEntrySchema.parse({
          listingId: listing.listingId,
          ...sourceSet,
          sourceRelativePath: `seed-media/${listing.listingId}/${media.id}.jpg`,
          mimeType: media.mimeType,
          view: views[index],
          supportsEvidenceIds: listing.approvedDraft.evidence
            .filter(({ photoId }) => photoId === media.id)
            .map(({ id }) => id),
        }),
      ]);
    })
  )
);

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APPROVED_SEED_MEDIA_ROOT = path.resolve(REPOSITORY_ROOT, "seed-media");

export function resolveSeedMediaSourcePath(sourceRelativePath: string): string {
  const canonicalPath = SeedSourceRelativePathSchema.parse(sourceRelativePath);
  const absolutePath = path.resolve(REPOSITORY_ROOT, canonicalPath);
  const relativeToApprovedRoot = path.relative(APPROVED_SEED_MEDIA_ROOT, absolutePath);
  if (
    relativeToApprovedRoot === "" ||
    relativeToApprovedRoot === ".." ||
    relativeToApprovedRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToApprovedRoot)
  ) {
    throw new TypeError("Seed media path escaped the approved non-public root");
  }
  return absolutePath;
}

export function resolveSeedMedia(pathname: string): SeedMediaManifestEntry | null {
  const entry = SEED_MEDIA_MANIFEST[pathname];
  if (!entry) return null;
  const cloned = SeedMediaManifestEntrySchema.parse(structuredClone(entry));
  resolveSeedMediaSourcePath(cloned.sourceRelativePath);
  return cloned;
}
