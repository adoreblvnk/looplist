import { describe, expect, it } from "vitest";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "@x402/core/types";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import { PurchaseError, PurchaseService } from "../lib/payment/purchase-service";
import type { VerifiedX402Payment, X402SettlementGateway } from "../lib/payment/x402-server";
import type { PurchaseReservation } from "../lib/domain/marketplace";
import { activeListing } from "./domain-fixtures";

const BUYER = "0x2222222222222222222222222222222222222222";
const OTHER_BUYER = "0x3333333333333333333333333333333333333333";
const TX = `0x${"a".repeat(64)}`;

class FakeGateway implements X402SettlementGateway {
  verifyError: Error | null = null;
  settleError: Error | null = null;
  paymentRequired(reservation: PurchaseReservation): Promise<{ header: string; body: PaymentRequired }> {
    return Promise.resolve({ header: "required", body: { x402Version: 2, resource: { url: "https://loop.test" }, accepts: [{ scheme: "exact", network: reservation.amount.network, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: reservation.amount.atomicAmount, payTo: reservation.recipientAddress, maxTimeoutSeconds: 300, extra: {} }] } });
  }
  verify(_header: string, reservation: PurchaseReservation): Promise<VerifiedX402Payment> {
    if (this.verifyError) return Promise.reject(this.verifyError);
    const accepted = { scheme: "exact", network: reservation.amount.network, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: reservation.amount.atomicAmount, payTo: reservation.recipientAddress, maxTimeoutSeconds: 300, extra: {} };
    return Promise.resolve({ payload: { x402Version: 2, accepted, payload: {} } as PaymentPayload, paymentReference: "sha256:payment" });
  }
  settle(_verified: VerifiedX402Payment, reservation: PurchaseReservation): Promise<SettleResponse> {
    if (this.settleError) return Promise.reject(this.settleError);
    return Promise.resolve({ success: true, payer: reservation.buyerAddress, transaction: TX, network: reservation.amount.network, amount: reservation.amount.atomicAmount });
  }
  settlementHeader(): string { return "settled"; }
}

function harness() {
  const repository = new InMemoryMarketplaceRepository({ listings: [activeListing] });
  const gateway = new FakeGateway();
  let now = "2026-08-21T10:00:00.000Z";
  const service = new PurchaseService(repository, gateway, () => now, activeListing.recipientAddress);
  return { repository, gateway, service, setNow(value: string) { now = value; } };
}

describe("PurchaseService", () => {
  it("projects authoritative exact checkout terms without private media or storage paths", async () => {
    const { service } = harness();
    const checkout = await service.checkout(activeListing.listingId);
    expect(checkout).toMatchObject({ listingId: activeListing.listingId, amount: activeListing.approvedPrice, recipientAddress: activeListing.recipientAddress, chainId: 84532, status: "active" });
    expect(JSON.stringify(checkout)).not.toMatch(/pathname|records\/|media\/seed|workflow/i);
  });

  it("has one immutable reservation winner and permits exact same-wallet replay", async () => {
    const { service } = harness();
    const [first, replay] = await Promise.all([service.reserve(activeListing.listingId, BUYER), service.reserve(activeListing.listingId, BUYER)]);
    expect(replay.reservation).toEqual(first.reservation);
    await expect(service.reserve(activeListing.listingId, OTHER_BUYER)).rejects.toMatchObject({ code: "reservation_conflict", status: 409 });
  });

  it("rejects payment at the exact reservation expiry boundary", async () => {
    const { service, setNow } = harness();
    const run = await service.reserve(activeListing.listingId, BUYER);
    setNow(run.reservation.expiresAt);
    await expect(service.paymentRequired(run, "https://loop.test")).rejects.toMatchObject({ code: "reservation_expired" });
  });

  it("replaces an expired unsigned reservation and projects the listing as active again", async () => {
    const { service, setNow } = harness();
    const first = await service.reserve(activeListing.listingId, BUYER);
    setNow(first.reservation.expiresAt);

    await expect(service.checkout(activeListing.listingId)).resolves.toMatchObject({
      status: "active",
      reservationExpiresAt: null,
    });
    const replacement = await service.reserve(activeListing.listingId, OTHER_BUYER);
    expect(replacement).toMatchObject({ status: "queued", reservation: { buyerAddress: OTHER_BUYER } });
    expect(replacement.reservation.createdAt).toBe(first.reservation.expiresAt);
    expect(Date.parse(replacement.reservation.expiresAt)).toBeGreaterThan(Date.parse(first.reservation.expiresAt));
    await expect(service.readRun(activeListing.listingId)).resolves.toEqual(replacement);
  });

  it("does not replace an expired reservation after its signature was verified", async () => {
    const { service, setNow } = harness();
    const queued = await service.reserve(activeListing.listingId, BUYER);
    await service.verify(queued, "signed");
    setNow(queued.reservation.expiresAt);

    await expect(service.reserve(activeListing.listingId, OTHER_BUYER)).rejects.toMatchObject({
      code: "purchase_not_payable",
      status: 409,
    });
  });

  it("settles once, finalizes an immutable receipt, and makes the listing sold", async () => {
    const { service, repository, setNow } = harness();
    const queued = await service.reserve(activeListing.listingId, BUYER);
    const verified = await service.verify(queued, "signed");
    setNow("2026-08-21T10:00:01.000Z");
    const { run } = await service.settle(activeListing.listingId, verified);
    expect(run.status).toBe("settlement_pending");
    setNow("2026-08-21T10:00:02.000Z");
    const receipt = await service.finalize(activeListing.listingId);
    expect(receipt).toMatchObject({ listingId: activeListing.listingId, buyerAddress: BUYER, recipientAddress: activeListing.recipientAddress, amount: activeListing.approvedPrice, settlementTransaction: TX, status: "sold" });
    expect((await repository.getListing(activeListing.listingId)).visibility).toBe("sold");
    expect(await service.finalize(activeListing.listingId)).toEqual(receipt);
    await expect(service.reserve(activeListing.listingId, OTHER_BUYER)).rejects.toMatchObject({ code: "listing_sold" });
  });

  it("preserves settlement references through reconciliation failure and retry", async () => {
    const { service, setNow } = harness();
    const queued = await service.reserve(activeListing.listingId, BUYER);
    const verified = await service.verify(queued, "signed");
    setNow("2026-08-21T10:00:01.000Z");
    await service.settle(activeListing.listingId, verified);
    setNow("2026-08-21T10:00:02.000Z");
    await service.markReconciliationFailed(activeListing.listingId);
    expect((await service.checkout(activeListing.listingId)).status).toBe("reconciliation_failed");
    setNow("2026-08-21T10:00:03.000Z");
    const receipt = await service.finalize(activeListing.listingId);
    expect(receipt.x402PaymentReference).toBe("sha256:payment");
    expect(receipt.settlementTransaction).toBe(TX);
  });

  it("does not advance state after payment verification or facilitator settlement failures", async () => {
    const first = harness();
    const queued = await first.service.reserve(activeListing.listingId, BUYER);
    first.gateway.verifyError = new Error("payment_verification_failed");
    await expect(first.service.verify(queued, "bad")).rejects.toThrow("payment_verification_failed");
    expect((await first.service.readRun(activeListing.listingId)).status).toBe("queued");

    const second = harness();
    const queued2 = await second.service.reserve(activeListing.listingId, BUYER);
    const verified = await second.service.verify(queued2, "signed");
    second.gateway.settleError = new Error("facilitator unavailable");
    await expect(second.service.settle(activeListing.listingId, verified)).rejects.toThrow("facilitator unavailable");
    expect((await second.service.readRun(activeListing.listingId)).status).toBe("running");
  });

  it("fails closed when configured recipient differs from the immutable listing", async () => {
    const repository = new InMemoryMarketplaceRepository({ listings: [activeListing] });
    const service = new PurchaseService(repository, new FakeGateway(), () => "2026-08-21T10:00:00.000Z", OTHER_BUYER);
    await expect(service.checkout(activeListing.listingId)).rejects.toBeInstanceOf(PurchaseError);
  });
});
