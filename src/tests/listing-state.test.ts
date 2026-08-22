import { describe, expect, it } from "vitest";
import {
  ListingStateTransitionError,
  createPurchaseReservation,
  failSettlementReconciliation,
  releaseExpiredReservation,
  reserveListing,
  settleListing,
  submitSettlement,
  transitionListingState,
} from "../lib/domain/listing-state";
import type { Listing, SettlementReceipt } from "../lib/domain/marketplace";
import {
  activeListing,
  money,
  paymentFingerprint,
  reconciliationFailure,
  settlementReceipt,
  settlementSubmission,
} from "./domain-fixtures";

const reservationInput = {
  buyerAddress: "0x2222222222222222222222222222222222222222",
  createdAt: "2026-08-21T10:01:00.000Z",
  expiresAt: "2026-08-21T10:06:00.000Z",
  paymentFingerprint,
};

function paymentPending() {
  const reservation = createPurchaseReservation(activeListing, reservationInput);
  return reserveListing(activeListing, reservation);
}

function settlementPending() {
  const pending = paymentPending();
  return submitSettlement(pending, settlementSubmission(pending.reservation.purchaseId));
}

describe("settlement-safe listing transitions", () => {
  it("allows active -> payment_pending and preserves immutable approved snapshots", () => {
    const pending = paymentPending();
    expect(pending.state).toBe("payment_pending");
    expect(pending.approvedDraft).toEqual(activeListing.approvedDraft);
    expect(pending.approvedPrice).toEqual(activeListing.approvedPrice);
    expect(pending.reservation.purchaseId).toBe(`purchase:${activeListing.listingId}`);
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(pending.approvedDraft)).toBe(true);
    expect(Object.isFrozen(pending.approvedPrice)).toBe(true);
    expect(() => {
      (pending.approvedDraft as { title: string }).title = "Mutated after seller approval";
    }).toThrow(TypeError);
  });

  it("allows payment_pending -> settlement_pending and durably preserves authoritative references", () => {
    const pending = paymentPending();
    const submission = settlementSubmission(pending.reservation.purchaseId);
    const reconciling = transitionListingState(pending, {
      type: "submit_settlement",
      submission,
    });
    expect(reconciling.state).toBe("settlement_pending");
    if (reconciling.state === "settlement_pending") {
      expect(reconciling.reservation).toEqual(pending.reservation);
      expect(reconciling.settlement).toEqual(submission);
    }
  });

  it("allows settlement_pending -> sold only with a matching authoritative receipt", () => {
    const reconciling = settlementPending();
    const sold = settleListing(reconciling, settlementReceipt(reconciling.reservation.purchaseId));
    expect(sold.state).toBe("sold");
    expect(sold.receipt.receiptId).toBe(sold.reservation.purchaseId);
    expect(sold.receipt.amount).toEqual(activeListing.approvedPrice);
    expect(sold.settlement).toEqual(reconciling.settlement);
  });

  it("releases payment_pending at reservation expiry before settlement submission", () => {
    const pending = paymentPending();
    const activeAgain = releaseExpiredReservation(pending, reservationInput.expiresAt);
    expect(activeAgain.state).toBe("active");
    expect(activeAgain.reservation).toBeNull();
  });

  it("rejects release of payment_pending before reservation expiry", () => {
    expect(() => releaseExpiredReservation(paymentPending(), "2026-08-21T10:05:59.999Z")).toThrow(
      /before it expires/
    );
  });

  it("never releases settlement_pending through the expiry path", () => {
    expect(() =>
      releaseExpiredReservation(settlementPending(), "2026-08-21T11:00:00.000Z")
    ).toThrow(/settlement_pending state/);
  });

  it("returns settlement_pending to active only through terminal reconciliation failure", () => {
    const reconciling = settlementPending();
    const failure = reconciliationFailure(reconciling.reservation.purchaseId);
    const activeAgain = failSettlementReconciliation(reconciling, failure);
    expect(activeAgain.state).toBe("active");
    expect(activeAgain.reservation).toBeNull();
    expect(activeAgain.lastReconciliationFailure).toEqual(failure);
  });

  it("rejects reconciliation failure without a recorded reason", () => {
    const reconciling = settlementPending();
    expect(() =>
      failSettlementReconciliation(reconciling, {
        ...reconciliationFailure(reconciling.reservation.purchaseId),
        reason: "",
      })
    ).toThrow();
  });

  it("rejects reconciliation failure without a recorded time", () => {
    const reconciling = settlementPending();
    const failure = { ...reconciliationFailure(reconciling.reservation.purchaseId) } as Partial<
      ReturnType<typeof reconciliationFailure>
    >;
    delete failure.failedAt;
    expect(() => failSettlementReconciliation(reconciling, failure as never)).toThrow();
  });
});

describe("fail-closed listing transition branches", () => {
  it("rejects settlement submission directly from active", () => {
    expect(() => submitSettlement(activeListing, settlementSubmission())).toThrow(
      /active to settlement_pending/
    );
  });

  it("rejects settlement finalization directly from payment_pending", () => {
    const pending = paymentPending();
    expect(() => settleListing(pending, settlementReceipt(pending.reservation.purchaseId))).toThrow(
      /payment_pending to sold/
    );
  });

  it("keeps sold terminal", () => {
    const reconciling = settlementPending();
    const sold = settleListing(reconciling, settlementReceipt(reconciling.reservation.purchaseId));
    expect(() => reserveListing(sold, sold.reservation)).toThrow(/sold to payment_pending/);
    expect(() => settleListing(sold, sold.receipt)).toThrow(/sold to sold/);
  });

  it("rejects a reservation whose exact price differs from the approved snapshot", () => {
    const reservation = createPurchaseReservation(activeListing, reservationInput);
    expect(() => reserveListing(activeListing, { ...reservation, amount: money("850000001") })).toThrow(
      /amount does not match the immutable approved price/
    );
  });

  it("rejects settlement submission for a different purchase", () => {
    const pending = paymentPending();
    expect(() =>
      submitSettlement(pending, {
        ...settlementSubmission(),
        purchaseId: "purchase:other-listing",
      })
    ).toThrow(/durable purchase reservation/);
  });

  it("rejects settlement submission after reservation expiry", () => {
    const pending = paymentPending();
    expect(() =>
      submitSettlement(pending, {
        ...settlementSubmission(pending.reservation.purchaseId),
        submittedAt: "2026-08-21T10:06:00.001Z",
      })
    ).toThrow(/strictly before reservation expiry/);
  });

  it("rejects settlement submission exactly at reservation expiry", () => {
    const pending = paymentPending();
    expect(() =>
      submitSettlement(pending, {
        ...settlementSubmission(pending.reservation.purchaseId),
        submittedAt: pending.reservation.expiresAt,
      })
    ).toThrow(/strictly before reservation expiry/);
  });

  it("rejects terminal reconciliation failure from active", () => {
    expect(() => failSettlementReconciliation(activeListing, reconciliationFailure())).toThrow(
      /active state/
    );
  });

  it("rejects terminal reconciliation failure from sold", () => {
    const reconciling = settlementPending();
    const sold = settleListing(reconciling, settlementReceipt(reconciling.reservation.purchaseId));
    expect(() =>
      failSettlementReconciliation(sold, reconciliationFailure(sold.reservation.purchaseId))
    ).toThrow(/sold state/);
  });

  it.each([
    ["listing title", /title/i, (receipt: SettlementReceipt) => ({ ...receipt, listingTitle: "Different approved listing title" })],
    ["recipient", /recipient/i, (receipt: SettlementReceipt) => ({ ...receipt, recipientAddress: "0x3333333333333333333333333333333333333333" })],
    ["approved price", /exact amount/i, (receipt: SettlementReceipt) => ({ ...receipt, amount: money("850000001") })],
    ["payment reference", /payment reference/i, (receipt: SettlementReceipt) => ({ ...receipt, x402PaymentReference: "different-payment-reference" })],
    ["transaction reference", /transaction reference/i, (receipt: SettlementReceipt) => ({ ...receipt, settlementTransaction: `0x${"c".repeat(64)}` })],
  ])("rejects settlement with a mismatched immutable %s", (_field, message, mutate) => {
    const reconciling = settlementPending();
    const tampered = mutate(settlementReceipt(reconciling.reservation.purchaseId));
    expect(() => settleListing(reconciling, tampered)).toThrow(message);
  });

  it("rejects structurally incoherent listing state before transition logic", () => {
    const malformed = {
      ...activeListing,
      state: "settlement_pending",
      reservation: null,
      settlement: null,
      receipt: null,
    } as unknown as Listing;
    expect(() => createPurchaseReservation(malformed, reservationInput)).toThrow();
  });

  it("uses the dispatcher for explicit terminal reconciliation failure", () => {
    const reconciling = settlementPending();
    const result = transitionListingState(reconciling, {
      type: "fail_reconciliation",
      failure: reconciliationFailure(reconciling.reservation.purchaseId),
    });
    expect(result.state).toBe("active");
  });

  it("throws the domain transition error on an illegal reserve source", () => {
    const pending = paymentPending();
    expect(() => reserveListing(pending, pending.reservation)).toThrow(ListingStateTransitionError);
  });
});
