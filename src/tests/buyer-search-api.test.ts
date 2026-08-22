import { describe, expect, it, vi } from "vitest";
import type { BuyerSearchGenerator } from "../lib/analysis/buyer-search-contracts";
import { DEMO_BUYER_QUERY } from "../lib/domain/demo-buyer-search";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import {
  createBuyerSearchPostHandler,
  deriveBuyerSearchId,
  type BuyerSearchApiServices,
} from "../lib/server/buyer-search-api";
import { activeListing, money } from "./domain-fixtures";

vi.mock("server-only", () => ({}));

const QUERY = "Find a MacBook below 900 USDC with no visible screen damage and acceptable cosmetic wear.";
const NOW = "2026-08-21T10:05:00.000Z";

function output() {
  return {
    interpretedConstraints: {
      categories: ["electronics"],
      maximumAtomicAmount: "900000000",
      acceptableConditions: ["acceptable", "good", "very_good", "like_new", "new"],
      requiredTerms: ["MacBook"],
      excludedDefectTerms: ["screen damage"],
    },
    matches: [{
      listingId: activeListing.listingId,
      score: 0.97,
      fitExplanation: "This MacBook is inside the 900 USDC budget and its display condition is photo-grounded.",
      evidenceIds: ["evidence-1"],
      assumptionIds: ["assumption-1"],
    }],
  };
}

function services(
  repository = new InMemoryMarketplaceRepository({ listings: [activeListing] }),
  generator: BuyerSearchGenerator = { generate: vi.fn(async () => output()) },
  fixedDemoSearch = false
): BuyerSearchApiServices {
  return { repository, generator, clock: () => NOW, fixedDemoSearch };
}

function request(query = QUERY, key = "buyer-search-key-0001", contentType = "application/json") {
  return new Request("http://localhost/api/buyer-search", {
    method: "POST",
    headers: { "content-type": contentType, "idempotency-key": key },
    body: JSON.stringify({ query }),
  });
}

describe("buyer search API", () => {
  it("returns the fixed Air Force 1 demo result without calling Gemma", async () => {
    const demoListing = structuredClone(activeListing);
    demoListing.listingId = "listing-air-force-demo";
    demoListing.approvedDraft.title = "Nike Air Force 1 Low White Sneakers";
    demoListing.approvedDraft.category = "sneakers";
    demoListing.approvedDraft.brand = "Nike";
    demoListing.approvedDraft.model = "Air Force 1";
    demoListing.approvedDraft.condition = "like_new";
    demoListing.approvedPrice = money("118500");
    const generator: BuyerSearchGenerator = {
      generate: vi.fn(async () => { throw new Error("Gemma must not run for the fixed demo query"); }),
    };
    const repository = new InMemoryMarketplaceRepository({ listings: [demoListing] });

    const response = await createBuyerSearchPostHandler(() => services(repository, generator, true))(
      request("This submitted wording is deliberately ignored.", "buyer-search-key-fixed-demo")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.query).toBe(DEMO_BUYER_QUERY);
    expect(payload.matches[0].listing.listingId).toBe(demoListing.listingId);
    expect(payload.matches[0].score).toBe(0.99);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("returns a strict grounded projection without private storage or settlement leakage", async () => {
    const response = await createBuyerSearchPostHandler(() => services())(request());
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.matches[0].listing.price.atomicAmount).toBe("850000000");
    expect(payload.matches[0].listing.status).toBe("active");
    expect(payload.matches[0].evidence[0].claim).toBe("Display has no visible cracks");
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["pathname", "media/uploads", "recipientAddress", "workflow", "raw", "BLOB_READ_WRITE_TOKEN"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("replays the durable selection and rejects changed use of the same idempotency key", async () => {
    const dependencies = services();
    const handler = createBuyerSearchPostHandler(() => dependencies);
    expect((await handler(request(QUERY, "buyer-search-key-replay"))).status).toBe(201);
    expect((await handler(request(QUERY, "buyer-search-key-replay"))).status).toBe(200);
    expect(dependencies.generator.generate).toHaveBeenCalledTimes(1);
    const conflict = await handler(request("Find running shoes below 100 USDC.", "buyer-search-key-replay"));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_key_reused");
  });

  it("has one immutable result winner under concurrent identical retries", async () => {
    const dependencies = services();
    const handler = createBuyerSearchPostHandler(() => dependencies);
    const responses = await Promise.all([
      handler(request(QUERY, "buyer-search-key-race")),
      handler(request(QUERY, "buyer-search-key-race")),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const searchId = await deriveBuyerSearchId("buyer-search-key-race");
    expect((await dependencies.repository.readBuyerSearchSelection(searchId)).matches).toHaveLength(1);
  });

  it("surfaces bounded timeout and lets the same claim retry safely", async () => {
    const repository = new InMemoryMarketplaceRepository({ listings: [activeListing] });
    const timedOut: BuyerSearchGenerator = { generate: vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }) };
    const timeoutHandler = createBuyerSearchPostHandler(() => services(repository, timedOut));
    const first = await timeoutHandler(request(QUERY, "buyer-search-key-timeout"));
    expect(first.status).toBe(504);
    expect((await first.json()).error.code).toBe("buyer_search_timeout");

    const retry = await createBuyerSearchPostHandler(() => services(repository))(request(QUERY, "buyer-search-key-timeout"));
    expect(retry.status).toBe(201);
  });

  it("retries one invalid Gemma selection inside the same durable claim", async () => {
    const repository = new InMemoryMarketplaceRepository({ listings: [activeListing] });
    const generator: BuyerSearchGenerator = {
      generate: vi.fn()
        .mockResolvedValueOnce({ invalid: "shape" })
        .mockResolvedValueOnce(output()),
    };
    const dependencies = services(repository, generator);
    const handler = createBuyerSearchPostHandler(() => dependencies);

    const response = await handler(request(QUERY, "buyer-search-key-bounded-retry"));
    expect(response.status).toBe(201);
    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect((await handler(request(QUERY, "buyer-search-key-bounded-retry"))).status).toBe(200);
    expect(generator.generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["x", "application/json", 400],
    [QUERY, "text/plain", 415],
  ])("rejects malformed or unsupported requests", async (query, contentType, status) => {
    const response = await createBuyerSearchPostHandler(() => services())(request(query, "buyer-search-key-invalid", contentType));
    expect(response.status).toBe(status);
  });

  it("sanitizes malformed model output instead of returning provider details", async () => {
    const generator: BuyerSearchGenerator = { generate: vi.fn(async () => ({ secretProviderPayload: "do-not-leak" })) };
    const response = await createBuyerSearchPostHandler(() => services(undefined, generator))(request());
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("buyer_search_invalid");
    expect(body).not.toContain("do-not-leak");
    expect(generator.generate).toHaveBeenCalledTimes(2);
  });
});
