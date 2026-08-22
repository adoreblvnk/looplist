import {
  DEMO_BUYER,
  DEMO_SELLER,
  deterministicPurchaseId,
  type ActiveListing,
  type ListingDraft,
  type Money,
  type PriceRecommendation,
  type PurchaseReservation,
  type ReconciliationFailure,
  type SettlementReceipt,
  type SettlementSubmission,
  type SoldComparable,
} from "../lib/domain/marketplace";

export const paymentFingerprint = `0x${"b".repeat(64)}` as const;

export const money = (atomicAmount = "850000000"): Money => ({
  currency: "USDC",
  network: "eip155:84532",
  atomicAmount,
});

export const validDraft: ListingDraft = {
  title: "Apple MacBook Air M2 13-inch",
  description: "MacBook Air with light cosmetic wear and no visible screen damage.",
  category: "electronics",
  brand: "Apple",
  model: "MacBook Air M2",
  condition: "very_good",
  attributes: { Memory: "16 GB", Storage: "512 GB", Color: "Midnight" },
  includedAccessories: ["USB-C power adapter"],
  visiblyMissingAccessories: ["Retail box"],
  media: [
    { id: "photo-1", pathname: "media/uploads/session-1/photo-1.webp", mediaType: "image", mimeType: "image/webp", alt: "Open MacBook front", width: 1600, height: 1200 },
    { id: "photo-2", pathname: "media/uploads/session-1/photo-2.webp", mediaType: "image", mimeType: "image/webp", alt: "MacBook top case", width: 1600, height: 1200 },
    { id: "photo-3", pathname: "media/uploads/session-1/photo-3.webp", mediaType: "image", mimeType: "image/webp", alt: "MacBook ports", width: 1600, height: 1200 },
  ],
  evidence: [
    { id: "evidence-1", photoId: "photo-1", kind: "condition", claim: "Display has no visible cracks", confidence: "high" },
    { id: "evidence-2", photoId: "photo-2", kind: "defect", claim: "Light wear is visible on the top case", confidence: "medium" },
  ],
  assumptions: [
    { id: "assumption-1", field: "batteryHealth", value: "Not determined from photos", confidence: "low", editable: true, verified: false, sellerEdited: false },
  ],
};

export const comparable: SoldComparable = {
  comparableId: "comparable-1",
  title: "Apple MacBook Air M2 13-inch 16GB",
  category: "electronics",
  brand: "Apple",
  model: "MacBook Air M2",
  condition: "very_good",
  attributes: { Memory: "16 GB", Storage: "512 GB" },
  includedAccessories: ["USB-C power adapter"],
  similarityScore: 0.96,
  similarityReason: "Matches the model, memory, storage, accessories, and visible condition.",
  soldPrice: money("840000000"),
  soldAt: "2026-08-01T10:00:00.000Z",
};

export const recommendation: PriceRecommendation = {
  recommendedPrice: money("850000000"),
  minimumPrice: money("800000000"),
  maximumPrice: money("900000000"),
  comparables: [comparable],
  strongestComparableIds: [comparable.comparableId],
  rationale: "The strongest sold comparable matches the model, memory, storage, and visible condition.",
};

export const activeListing: ActiveListing = {
  listingId: "listing-demo-1",
  source: "seller",
  seller: DEMO_SELLER,
  recipientAddress: "0x1111111111111111111111111111111111111111",
  approvedDraft: validDraft,
  approvedPrice: money(),
  publishedAt: "2026-08-21T10:00:00.000Z",
  lastReconciliationFailure: null,
  state: "active",
  reservation: null,
  settlement: null,
  receipt: null,
};

export function purchaseReservation(fingerprint = paymentFingerprint): PurchaseReservation {
  return {
    purchaseId: deterministicPurchaseId(activeListing.listingId),
    listingId: activeListing.listingId,
    buyer: DEMO_BUYER,
    buyerAddress: "0x2222222222222222222222222222222222222222",
    recipientAddress: activeListing.recipientAddress,
    amount: activeListing.approvedPrice,
    createdAt: "2026-08-21T10:01:00.000Z",
    expiresAt: "2026-08-21T10:06:00.000Z",
    paymentFingerprint: fingerprint,
  };
}

export function settlementSubmission(purchaseId = deterministicPurchaseId(activeListing.listingId)): SettlementSubmission {
  return {
    purchaseId,
    x402PaymentReference: "x402-payment-response-demo-1",
    settlementTransaction: `0x${"a".repeat(64)}`,
    submittedAt: "2026-08-21T10:02:00.000Z",
  };
}

export function settlementReceipt(purchaseId = deterministicPurchaseId(activeListing.listingId)): SettlementReceipt {
  return {
    receiptId: purchaseId,
    purchaseId,
    listingId: activeListing.listingId,
    listingTitle: activeListing.approvedDraft.title,
    buyer: DEMO_BUYER,
    seller: DEMO_SELLER,
    buyerAddress: "0x2222222222222222222222222222222222222222",
    recipientAddress: activeListing.recipientAddress,
    amount: activeListing.approvedPrice,
    x402PaymentReference: "x402-payment-response-demo-1",
    settlementTransaction: `0x${"a".repeat(64)}`,
    settledAt: "2026-08-21T10:03:00.000Z",
    status: "sold",
  };
}

export function reconciliationFailure(purchaseId = deterministicPurchaseId(activeListing.listingId)): ReconciliationFailure {
  return {
    purchaseId,
    x402PaymentReference: "x402-payment-response-demo-1",
    settlementTransaction: `0x${"a".repeat(64)}`,
    reason: "Facilitator confirmed that the submitted transaction did not settle.",
    failedAt: "2026-08-21T10:04:00.000Z",
  };
}
