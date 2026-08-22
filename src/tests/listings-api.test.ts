import { describe, expect, it, vi } from "vitest";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { RepositoryDataError, RepositoryUnavailableError, type MarketplaceRepository } from "../lib/persistence/repository";
import {
  createListingGetHandler,
  createListingMediaGetHandler,
  createListingsGetHandler,
  createListingsPostHandler,
  derivePublicationIdentity,
  type ListingApiServices,
} from "../lib/server/listings-api";
import { recommendation, validDraft } from "./domain-fixtures";

vi.mock("server-only", () => ({}));

const NOW = "2026-08-21T10:05:00.000Z";
function services(repository = new InMemoryMarketplaceRepository()): ListingApiServices {
  return {
    repository,
    clock: () => NOW,
    recipientAddress: "0x1111111111111111111111111111111111111111",
    network: "eip155:84532",
  };
}
async function succeeded(repository: MarketplaceRepository, runId = "analysis-publishable") {
  await repository.saveRunSnapshot({
    runId,
    kind: "analysis",
    status: "succeeded",
    media: structuredClone(validDraft.media),
    photoIds: validDraft.media.map(({ id }) => id),
    geminiAttempts: 1,
    gemmaAttempts: 1,
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:04:00.000Z",
    attempt: 2,
    startedAt: "2026-08-21T10:01:00.000Z",
    completedAt: "2026-08-21T10:04:00.000Z",
    draft: structuredClone(validDraft),
    priceRecommendation: structuredClone(recommendation),
  });
}
function payload(runId = "analysis-publishable") {
  const { media: _media, ...edits } = structuredClone(validDraft);
  void _media;
  return { analysisRunId: runId, ...edits, approvedPrice: { currency: "USDC", network: "eip155:84532", atomicAmount: "825123456" } };
}
function request(body: unknown, key = "publication-key-0001"): Request {
  return new Request("http://localhost/api/listings", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

describe("seller-approved listing publication and public APIs", () => {
  it("publishes only a succeeded analysis, rebinds immutable media, and preserves exact six-decimal money", async () => {
    const dependencies = services();
    await succeeded(dependencies.repository);
    const response = await createListingsPostHandler(() => dependencies)(request(payload()));
    expect(response.status).toBe(201);
    const publicListing = await response.json();
    expect(publicListing.price.atomicAmount).toBe("825123456");
    expect(publicListing.photoIds).toEqual(validDraft.media.map(({ id }) => id));
    const identity = await derivePublicationIdentity("publication-key-0001");
    const stored = await dependencies.repository.getListing(identity.listingId);
    expect(stored.listing.approvedDraft.media).toEqual(validDraft.media);
    expect(stored.listing.seller.id).toBe("demo-seller");
    expect(stored.listing.recipientAddress).toBe(dependencies.recipientAddress);
  });

  it("returns the same result for exact replay and 409 for any changed replay", async () => {
    const dependencies = services();
    await succeeded(dependencies.repository);
    const handler = createListingsPostHandler(() => dependencies);
    expect((await handler(request(payload(), "publication-key-replay"))).status).toBe(201);
    expect((await handler(request(payload(), "publication-key-replay"))).status).toBe(200);
    const changed = payload(); changed.title = "Changed seller-approved title";
    const conflict = await handler(request(changed, "publication-key-replay"));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_key_reused");
  });

  it("binds an interrupted publication claim to its original recipient configuration", async () => {
    const repository = new InMemoryMarketplaceRepository();
    await succeeded(repository);
    const original = services(repository);
    const publish = repository.publishSellerListing.bind(repository);
    repository.publishSellerListing = vi.fn(async () => { throw new RepositoryUnavailableError(); });

    const interrupted = await createListingsPostHandler(() => original)(request(payload(), "publication-key-interrupted"));
    expect(interrupted.status).toBe(503);
    repository.publishSellerListing = publish;

    const changed = { ...services(repository), recipientAddress: "0x2222222222222222222222222222222222222222" };
    const conflict = await createListingsPostHandler(() => changed)(request(payload(), "publication-key-interrupted"));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_key_reused");

    const replay = await createListingsPostHandler(() => original)(request(payload(), "publication-key-interrupted"));
    expect(replay.status).toBe(201);
    const identity = await derivePublicationIdentity("publication-key-interrupted");
    expect((await repository.getListing(identity.listingId)).listing.recipientAddress).toBe(original.recipientAddress);
  });

  it("has one recipient-bound winner across concurrent service configurations", async () => {
    const repository = new InMemoryMarketplaceRepository();
    await succeeded(repository);
    const first = services(repository);
    const second = { ...services(repository), recipientAddress: "0x2222222222222222222222222222222222222222" };
    const responses = await Promise.all([
      createListingsPostHandler(() => first)(request(payload(), "publication-key-config-race")),
      createListingsPostHandler(() => second)(request(payload(), "publication-key-config-race")),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const identity = await derivePublicationIdentity("publication-key-config-race");
    const stored = await repository.getListing(identity.listingId);
    expect([first.recipientAddress, second.recipientAddress]).toContain(stored.listing.recipientAddress);
  });

  it("has one immutable winner under concurrent divergent and identical requests", async () => {
    const divergentDependencies = services();
    await succeeded(divergentDependencies.repository);
    const changed = payload(); changed.description = "A different seller-approved description that remains structurally valid for publication.";
    const divergent = await Promise.all([
      createListingsPostHandler(() => divergentDependencies)(request(payload(), "publication-key-race-a")),
      createListingsPostHandler(() => divergentDependencies)(request(changed, "publication-key-race-a")),
    ]);
    expect(divergent.map(({ status }) => status).sort()).toEqual([201, 409]);

    const sameDependencies = services();
    await succeeded(sameDependencies.repository);
    const same = await Promise.all([
      createListingsPostHandler(() => sameDependencies)(request(payload(), "publication-key-race-b")),
      createListingsPostHandler(() => sameDependencies)(request(payload(), "publication-key-race-b")),
    ]);
    expect(same.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect((await sameDependencies.repository.listMarketplaceListings())).toHaveLength(1);
  });

  it("rejects queued/failed/missing analysis and evidence claims against unknown photos", async () => {
    const dependencies = services();
    await dependencies.repository.createAnalysisRun({
      runId: "analysis-queued", kind: "analysis", status: "queued", media: structuredClone(validDraft.media),
      photoIds: validDraft.media.map(({ id }) => id), geminiAttempts: 0, gemmaAttempts: 0,
      createdAt: NOW, updatedAt: NOW, attempt: 0,
    });
    expect((await createListingsPostHandler(() => dependencies)(request(payload("analysis-queued"), "publication-key-queued"))).status).toBe(409);
    expect((await createListingsPostHandler(() => dependencies)(request(payload("analysis-missing"), "publication-key-missing"))).status).toBe(404);
    await succeeded(dependencies.repository, "analysis-hostile");
    const hostile = payload("analysis-hostile"); hostile.evidence[0].photoId = "unknown-photo";
    expect((await createListingsPostHandler(() => dependencies)(request(hostile, "publication-key-hostile"))).status).toBe(400);
  });

  it("serves strict feed/detail projections without private-field leakage", async () => {
    const dependencies = services();
    await succeeded(dependencies.repository);
    await createListingsPostHandler(() => dependencies)(request(payload(), "publication-key-public"));
    const feed = await createListingsGetHandler(() => dependencies)();
    expect(feed.status).toBe(200);
    const feedPayload = await feed.json();
    const listingId = feedPayload.listings[0].listingId;
    const detail = await createListingGetHandler(() => dependencies)(new Request("http://localhost"), { params: Promise.resolve({ listingId }) });
    expect(detail.status).toBe(200);
    const serialized = JSON.stringify({ feed: feedPayload, detail: await detail.json() });
    for (const forbidden of ["pathname", "recipientAddress", "analysisRunId", "workflowRunId", "bytes", "storageUrl", "BLOB_READ_WRITE_TOKEN"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(feedPayload.listings[0].price).toEqual({ currency: "USDC", network: "eip155:84532", atomicAmount: "825123456" });
  });

  it("streams only media belonging to the listing with fixed private headers", async () => {
    const dependencies = services();
    await succeeded(dependencies.repository);
    for (const media of validDraft.media) await dependencies.repository.createPrivateMedia(media, new Uint8Array([1, 2, 3]), NOW);
    await createListingsPostHandler(() => dependencies)(request(payload(), "publication-key-media"));
    const listingId = (await derivePublicationIdentity("publication-key-media")).listingId;
    const handler = createListingMediaGetHandler(() => dependencies);
    const response = await handler(new Request("http://localhost"), { params: Promise.resolve({ listingId, photoId: "photo-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await handler(new Request("http://localhost"), { params: Promise.resolve({ listingId, photoId: "photo-unknown" }) })).status).toBe(404);
  });

  it.each([
    [new RepositoryDataError("secret"), 500, "listing_data_invalid"],
    [new RepositoryUnavailableError("secret"), 503, "listing_unavailable"],
  ])("sanitizes feed failures", async (cause, status, code) => {
    const dependencies = services();
    dependencies.repository.listMarketplaceListings = vi.fn(async () => { throw cause; });
    const response = await createListingsGetHandler(() => dependencies)();
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain("secret");
  });
});
