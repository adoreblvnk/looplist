import { describe, expect, it, vi } from "vitest";
import {
  IN_MEMORY_REPOSITORY_TEST_HOOK,
  InMemoryMarketplaceRepository,
} from "../lib/persistence/in-memory-marketplace-repository";
import { provisionSeedMarketplace } from "../lib/persistence/provision-seed-marketplace";
import { RepositoryConflictError } from "../lib/persistence/repository";
import { SEED_ACTIVE_LISTINGS, SEED_SOLD_COMPARABLES } from "../lib/persistence/seed-marketplace";
import { SEED_MEDIA_MANIFEST } from "../lib/persistence/seed-media-manifest";
import { PurchaseService } from "../lib/payment/purchase-service";
import type { X402SettlementGateway } from "../lib/payment/x402-server";

vi.mock("server-only", () => ({}));

const uploadedAt = "2026-08-20T12:00:00.000Z";
const recipientAddress = "0x9999999999999999999999999999999999999999";
const source = async (absolutePath: string) => new TextEncoder().encode(`canonical:${absolutePath}`);

describe("explicit seed provisioning", () => {
  it("writes all private media, ten active listings, and sold comparables only when called", async () => {
    const repository = new InMemoryMarketplaceRepository();
    expect(await repository.listMarketplaceListings()).toEqual([]);
    expect(await repository.listSoldComparables()).toEqual([]);
    const result = await provisionSeedMarketplace(repository, { recipientAddress, readSource: source, uploadedAt });
    expect(result).toEqual({
      media: Object.keys(SEED_MEDIA_MANIFEST).length,
      listings: 10,
      soldComparables: SEED_SOLD_COMPARABLES.length,
    });
    expect(await repository.listMarketplaceListings()).toHaveLength(10);
    expect(await repository.listSoldComparables()).toHaveLength(SEED_SOLD_COMPARABLES.length);
    for (const listing of SEED_ACTIVE_LISTINGS) {
      expect((await repository.getListing(listing.listingId)).listing.recipientAddress).toBe(recipientAddress);
      for (const media of listing.approvedDraft.media) {
        expect((await repository.readPrivateMediaMetadata(media)).uploadedAt).toBe(uploadedAt);
      }
    }
  });

  it("is idempotent for exact records and bytes", async () => {
    const repository = new InMemoryMarketplaceRepository();
    await provisionSeedMarketplace(repository, { recipientAddress, readSource: source, uploadedAt });
    await expect(provisionSeedMarketplace(repository, { recipientAddress, readSource: source, uploadedAt })).resolves.toMatchObject({ listings: 10 });
    expect(await repository.listMarketplaceListings()).toHaveLength(10);
  });

  it("allows seed checkout from a freshly provisioned repository with the configured recipient", async () => {
    const repository = new InMemoryMarketplaceRepository();
    await provisionSeedMarketplace(repository, { recipientAddress, readSource: source, uploadedAt });
    const purchases = new PurchaseService(
      repository,
      {} as X402SettlementGateway,
      () => "2026-08-21T10:00:00.000Z",
      recipientAddress,
    );

    await expect(purchases.checkout("seed-macbook-air-m2-512")).resolves.toMatchObject({
      status: "active",
      recipientAddress,
    });
  });

  it("rejects divergent immutable records instead of overwriting", async () => {
    const canonical = SEED_ACTIVE_LISTINGS[0];
    const divergent = structuredClone(canonical);
    divergent.approvedDraft.title = "Divergent but structurally valid seed listing title";
    const repository = new InMemoryMarketplaceRepository({
      [IN_MEMORY_REPOSITORY_TEST_HOOK]: [{ collection: "listings", key: canonical.listingId, value: divergent }],
    });
    await expect(provisionSeedMarketplace(repository, { recipientAddress, readSource: source, uploadedAt }))
      .rejects.toBeInstanceOf(RepositoryConflictError);
    expect((await repository.getListing(canonical.listingId)).listing.approvedDraft.title).toBe(divergent.approvedDraft.title);
  });
});
