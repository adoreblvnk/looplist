import "server-only";
import { readFile } from "node:fs/promises";
import { SEED_ACTIVE_LISTINGS, SEED_SOLD_COMPARABLES } from "./seed-marketplace";
import { SEED_MEDIA_MANIFEST, resolveSeedMediaSourcePath } from "./seed-media-manifest";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
  bindSeedListingRecipient,
  type MarketplaceRepository,
} from "./repository";

export interface SeedProvisioningResult {
  media: number;
  listings: number;
  soldComparables: number;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

/** Explicit, opt-in provisioning. Importing this module performs no reads or writes. */
export async function provisionSeedMarketplace(
  repository: MarketplaceRepository,
  options: {
    recipientAddress: string;
    readSource?: (absolutePath: string) => Promise<Uint8Array>;
    uploadedAt?: string;
  }
): Promise<SeedProvisioningResult> {
  const readSource = options.readSource ?? (async (absolutePath) => new Uint8Array(await readFile(absolutePath)));
  const uploadedAt = options.uploadedAt ?? "2026-08-20T12:00:00.000Z";
  const seedListings = SEED_ACTIVE_LISTINGS.map((listing) =>
    bindSeedListingRecipient(listing, options.recipientAddress)
  );
  let mediaCount = 0;

  for (const listing of seedListings) {
    for (const media of listing.approvedDraft.media) {
      const manifest = SEED_MEDIA_MANIFEST[media.pathname];
      if (!manifest) throw new Error(`Missing canonical seed media manifest entry for ${media.pathname}`);
      const bytes = await readSource(resolveSeedMediaSourcePath(manifest.sourceRelativePath));
      try {
        await repository.createPrivateMedia(media, bytes, uploadedAt);
      } catch (cause) {
        if (!(cause instanceof RepositoryConflictError)) throw cause;
        const existing = await repository.readPrivateMediaContent(media);
        if (!bytesEqual(existing.bytes, bytes)) {
          throw new RepositoryConflictError("Existing seed media differs from the canonical seed corpus");
        }
      }
      mediaCount += 1;
    }
  }

  for (const listing of seedListings) {
    try {
      await repository.createSeedListing(listing);
    } catch (cause) {
      if (!(cause instanceof RepositoryConflictError)) throw cause;
      const existing = await repository.getListing(listing.listingId);
      if (!equal(existing.listing, listing)) {
        throw new RepositoryConflictError("Existing seed listing differs from the canonical seed corpus");
      }
    }
  }

  let storedComparables: Awaited<ReturnType<MarketplaceRepository["listSoldComparables"]>>;
  try {
    storedComparables = await repository.listSoldComparables();
  } catch (cause) {
    if (cause instanceof RepositoryNotFoundError) storedComparables = [];
    else throw cause;
  }
  const comparablesById = new Map(storedComparables.map((record) => [record.comparableId, record]));
  for (const comparable of SEED_SOLD_COMPARABLES) {
    const existing = comparablesById.get(comparable.comparableId);
    if (existing) {
      if (!equal(existing, comparable)) {
        throw new RepositoryConflictError("Existing sold comparable differs from the canonical seed corpus");
      }
      continue;
    }
    try {
      await repository.createSoldComparable(comparable);
    } catch (cause) {
      if (!(cause instanceof RepositoryConflictError)) throw cause;
      const winner = (await repository.listSoldComparables())
        .find(({ comparableId }) => comparableId === comparable.comparableId);
      if (!winner || !equal(winner, comparable)) {
        throw new RepositoryConflictError("Existing sold comparable differs from the canonical seed corpus");
      }
    }
  }

  return {
    media: mediaCount,
    listings: seedListings.length,
    soldComparables: SEED_SOLD_COMPARABLES.length,
  };
}
