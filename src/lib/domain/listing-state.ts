import { z } from "zod";
import {
  ActiveListingSchema,
  DEMO_BUYER,
  ListingSchema,
  PaymentFingerprintSchema,
  PaymentPendingListingSchema,
  PurchaseReservationSchema,
  ReconciliationFailureSchema,
  SettlementPendingListingSchema,
  SettlementReceiptSchema,
  SettlementSubmissionSchema,
  SoldListingSchema,
  deterministicPurchaseId,
  reconciliationFailureInvariantViolations,
  settlementReservationInvariantViolations,
  soldReceiptInvariantViolations,
  type ActiveListing,
  type Listing,
  type PaymentPendingListing,
  type PurchaseReservation,
  type ReconciliationFailure,
  type SettlementPendingListing,
  type SettlementReceipt,
  type SettlementSubmission,
  type SoldListing,
} from "./marketplace";

export class ListingStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingStateTransitionError";
  }
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function reject(message: string): never {
  throw new ListingStateTransitionError(message);
}

export interface ReservationInput {
  buyerAddress: string;
  createdAt: string;
  expiresAt: string;
  paymentFingerprint: string;
}

export function createPurchaseReservation(listing: Listing, input: ReservationInput): PurchaseReservation {
  const current = ListingSchema.parse(listing);
  if (current.state !== "active") {
    return reject(`Cannot reserve listing from ${current.state} state`);
  }

  const fingerprint = PaymentFingerprintSchema.parse(input.paymentFingerprint);
  return deepFreeze(
    PurchaseReservationSchema.parse({
      purchaseId: deterministicPurchaseId(current.listingId),
      listingId: current.listingId,
      buyer: DEMO_BUYER,
      buyerAddress: input.buyerAddress,
      recipientAddress: current.recipientAddress,
      amount: current.approvedPrice,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      paymentFingerprint: fingerprint,
    })
  );
}

export function reserveListing(listing: Listing, reservation: PurchaseReservation): PaymentPendingListing {
  const current = ListingSchema.parse(listing);
  if (current.state !== "active") {
    return reject(`Cannot transition listing from ${current.state} to payment_pending`);
  }

  const approvedReservation = PurchaseReservationSchema.parse(reservation);
  if (approvedReservation.listingId !== current.listingId) {
    return reject("Reservation listing ID does not match the approved listing");
  }
  if (approvedReservation.recipientAddress !== current.recipientAddress) {
    return reject("Reservation recipient does not match the approved listing");
  }
  if (!equalValue(approvedReservation.amount, current.approvedPrice)) {
    return reject("Reservation amount does not match the immutable approved price");
  }

  return deepFreeze(
    PaymentPendingListingSchema.parse({
      ...current,
      state: "payment_pending",
      reservation: approvedReservation,
      settlement: null,
      receipt: null,
    })
  );
}

export function releaseExpiredReservation(listing: Listing, releasedAt: string): ActiveListing {
  const current = ListingSchema.parse(listing);
  if (current.state !== "payment_pending") {
    return reject(`Cannot release a reservation from ${current.state} state`);
  }

  const parsedReleasedAt = z.iso.datetime({ offset: true }).parse(releasedAt);
  if (Date.parse(parsedReleasedAt) < Date.parse(current.reservation.expiresAt)) {
    return reject("Cannot release a reservation before it expires");
  }

  return deepFreeze(
    ActiveListingSchema.parse({
      ...current,
      state: "active",
      reservation: null,
      settlement: null,
      receipt: null,
    })
  );
}

export function submitSettlement(
  listing: Listing,
  submission: SettlementSubmission
): SettlementPendingListing {
  const current = ListingSchema.parse(listing);
  if (current.state !== "payment_pending") {
    return reject(`Cannot transition listing from ${current.state} to settlement_pending`);
  }

  const approvedSubmission = SettlementSubmissionSchema.parse(submission);
  const [violation] = settlementReservationInvariantViolations(
    approvedSubmission,
    current.reservation
  );
  if (violation) {
    return reject(violation.message);
  }

  return deepFreeze(
    SettlementPendingListingSchema.parse({
      ...current,
      state: "settlement_pending",
      settlement: approvedSubmission,
      receipt: null,
    })
  );
}

export function settleListing(listing: Listing, receipt: SettlementReceipt): SoldListing {
  const current = ListingSchema.parse(listing);
  if (current.state !== "settlement_pending") {
    return reject(`Cannot transition listing from ${current.state} to sold`);
  }

  const approvedReceipt = SettlementReceiptSchema.parse(receipt);
  const [violation] = soldReceiptInvariantViolations({
    listingId: current.listingId,
    listingTitle: current.approvedDraft.title,
    seller: current.seller,
    recipientAddress: current.recipientAddress,
    approvedPrice: current.approvedPrice,
    reservation: current.reservation,
    settlement: current.settlement,
    receipt: approvedReceipt,
  });
  if (violation) {
    return reject(violation.message);
  }

  return deepFreeze(
    SoldListingSchema.parse({
      ...current,
      state: "sold",
      receipt: approvedReceipt,
    })
  );
}

export function failSettlementReconciliation(
  listing: Listing,
  failure: ReconciliationFailure
): ActiveListing {
  const current = ListingSchema.parse(listing);
  if (current.state !== "settlement_pending") {
    return reject(`Cannot fail settlement reconciliation from ${current.state} state`);
  }

  const approvedFailure = ReconciliationFailureSchema.parse(failure);
  const [violation] = reconciliationFailureInvariantViolations(
    approvedFailure,
    current.settlement
  );
  if (violation) {
    return reject(violation.message);
  }

  return deepFreeze(
    ActiveListingSchema.parse({
      ...current,
      state: "active",
      reservation: null,
      settlement: null,
      receipt: null,
      lastReconciliationFailure: approvedFailure,
    })
  );
}

export type ListingTransition =
  | { type: "reserve"; reservation: PurchaseReservation }
  | { type: "release_expired"; releasedAt: string }
  | { type: "submit_settlement"; submission: SettlementSubmission }
  | { type: "settle"; receipt: SettlementReceipt }
  | { type: "fail_reconciliation"; failure: ReconciliationFailure };

export function transitionListingState(
  listing: Listing,
  transition: ListingTransition
): ActiveListing | PaymentPendingListing | SettlementPendingListing | SoldListing {
  switch (transition.type) {
    case "reserve":
      return reserveListing(listing, transition.reservation);
    case "release_expired":
      return releaseExpiredReservation(listing, transition.releasedAt);
    case "submit_settlement":
      return submitSettlement(listing, transition.submission);
    case "settle":
      return settleListing(listing, transition.receipt);
    case "fail_reconciliation":
      return failSettlementReconciliation(listing, transition.failure);
  }
}
