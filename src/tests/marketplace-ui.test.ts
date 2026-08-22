import { describe, expect, it } from "vitest";
import { BUYER_QUERY_PLACEHOLDER } from "../components/marketplace/buyer-search";
import {
  displayListingPrice,
  displayPrice,
  filterListings,
  formatDisplayedUsdcAtomic,
  formatUsdcAtomic,
  parseDisplayedUsdcInput,
  parseUsdcInput,
  publicMediaUrl,
} from "../components/marketplace/utils";
import type { Listing, Money } from "../components/marketplace/types";

const listing = {
  listingId: "one",
  title: "MacBook Air",
  description: "Lightly used laptop",
  category: "electronics",
  brand: "Apple",
  model: "M2",
  condition: "good",
  seller: { id: "seed-seller-a", displayName: "Jordan", fictional: true },
  price: { currency: "USDC", network: "eip155:84532", atomicAmount: "1" },
  status: "active",
  canDelete: false,
  attributes: {},
  includedAccessories: [],
  visiblyMissingAccessories: [],
  evidence: [],
  assumptions: [],
  photoIds: ["p1", "p2", "p3"],
  publishedAt: "x",
} satisfies Listing;

const money = (atomicAmount: string) => ({
  currency: "USDC",
  network: "eip155:84532",
  atomicAmount,
}) satisfies Money;

describe("marketplace UI utilities", () => {
  it("uses the Air Force 1 regional resale query as buyer-search guidance", () => {
    expect(BUYER_QUERY_PLACEHOLDER).toBe("BNIB Air Force 1 under 120 USDC, can nego, MRT meetup, deal today.");
  });

  it("parses exact six-decimal raw USDC without floats", () => {
    expect(parseUsdcInput("12.34")).toBe("12340000");
    expect(parseUsdcInput("0.000001")).toBe("1");
    expect(parseUsdcInput("01")).toBeNull();
    expect(parseUsdcInput("1.0000001")).toBeNull();
    expect(parseUsdcInput("0")).toBeNull();
  });

  it("formats exact raw atomic amounts", () => {
    expect(formatUsdcAtomic("12340000")).toBe("12.340000");
    expect(formatUsdcAtomic("1")).toBe("0.000001");
  });

  it("displays payment amounts at exactly 1,000 times their on-chain value", () => {
    expect(formatDisplayedUsdcAtomic("108000")).toBe("108");
    expect(displayListingPrice(money("108000"))).toBe("108 USDC");
    expect(displayPrice(money("108000"))).toBe("108 USDC");
    expect(displayListingPrice(money("78000"))).toBe("78 USDC");
    expect(displayListingPrice(money("1"))).toBe("0.001 USDC");
  });

  it("converts an editable displayed price back to exact payment atomic units", () => {
    expect(parseDisplayedUsdcInput("108")).toBe("108000");
    expect(parseDisplayedUsdcInput("108.123")).toBe("108123");
    expect(parseDisplayedUsdcInput("0.001")).toBe("1");
    expect(parseDisplayedUsdcInput("108.1234")).toBeNull();
    expect(parseDisplayedUsdcInput("0")).toBeNull();
  });

  it("filters basic text and category", () => {
    expect(filterListings([listing], "apple", "all")).toHaveLength(1);
    expect(filterListings([listing], "shoe", "all")).toHaveLength(0);
    expect(filterListings([listing], "", "sneakers")).toHaveLength(0);
  });

  it("only creates controlled public media URLs", () => {
    const url = publicMediaUrl("one", "p1");
    expect(url).toBe("/api/listings/one/media/p1");
    expect(url).not.toContain("media/uploads");
  });
});
