import { z } from "zod";
import {
  BASE_SEPOLIA_NETWORK,
  DEMO_BUYER,
  PurchaseReservationSchema,
  PurchaseRunStateSchema,
  SettlementReceiptSchema,
  SettlementSubmissionSchema,
  deterministicPurchaseId,
  type PurchaseRunState,
  type SettlementReceipt,
} from "../domain/marketplace";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
  type MarketplaceRepository,
} from "../persistence/repository";
import { CheckoutSnapshotSchema, PURCHASE_RESERVATION_SECONDS, type CheckoutSnapshot } from "./contracts";
import type { VerifiedX402Payment, X402SettlementGateway } from "./x402-server";

const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export class PurchaseError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "PurchaseError";
  }
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function fingerprint(parts: readonly string[]): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\u001f")));
  return `0x${Buffer.from(digest).toString("hex")}`;
}

function conditionSummary(runOrListing: { approvedDraft: { condition: string; evidence: Array<{ kind: string; claim: string }> } }): string {
  const evidence = runOrListing.approvedDraft.evidence
    .filter(({ kind }) => kind === "condition" || kind === "defect")
    .slice(0, 2).map(({ claim }) => claim).join(" · ");
  return evidence || runOrListing.approvedDraft.condition.replaceAll("_", " ");
}

export class PurchaseService {
  constructor(
    private readonly repository: MarketplaceRepository,
    private readonly gateway: X402SettlementGateway,
    private readonly clock: () => string,
    private readonly recipientAddress: string,
  ) {
    EvmAddressSchema.parse(recipientAddress);
  }

  async checkout(listingId: string): Promise<CheckoutSnapshot> {
    const record = await this.repository.getListing(listingId);
    if (record.listing.recipientAddress.toLowerCase() !== this.recipientAddress.toLowerCase()) {
      throw new PurchaseError("recipient_changed", 409, "This listing is not available for checkout");
    }
    if (record.visibility === "sold") {
      const receipt = await this.repository.readSettlementReceipt(deterministicPurchaseId(listingId));
      return this.snapshot(record.listing, "sold", null, receipt);
    }
    try {
      const run = await this.readRun(listingId);
      return this.snapshotFromRun(record.listing, run);
    } catch (error) {
      if (!(error instanceof RepositoryNotFoundError)) throw error;
      return this.snapshot(record.listing, "active", null, null);
    }
  }

  async reserve(listingId: string, buyerAddress: string): Promise<PurchaseRunState> {
    const buyer = EvmAddressSchema.parse(buyerAddress);
    const record = await this.repository.getListing(listingId);
    if (record.visibility === "sold") throw new PurchaseError("listing_sold", 409, "This listing has been sold");
    const listing = record.listing;
    if (listing.approvedPrice.network !== BASE_SEPOLIA_NETWORK ||
      listing.recipientAddress.toLowerCase() !== this.recipientAddress.toLowerCase()) {
      throw new PurchaseError("listing_changed", 409, "Checkout terms changed; review the listing again");
    }
    const createdAt = this.clock();
    const expiresAt = new Date(Date.parse(createdAt) + PURCHASE_RESERVATION_SECONDS * 1_000).toISOString();
    const purchaseId = deterministicPurchaseId(listingId);
    const paymentFingerprint = await fingerprint([
      purchaseId, listing.approvedPrice.atomicAmount, listing.recipientAddress.toLowerCase(),
      BASE_SEPOLIA_NETWORK, buyer.toLowerCase(), listing.approvedDraft.title,
    ]);
    const reservation = PurchaseReservationSchema.parse({
      purchaseId, listingId, buyer: DEMO_BUYER, buyerAddress: buyer,
      recipientAddress: listing.recipientAddress, amount: listing.approvedPrice,
      createdAt, expiresAt, paymentFingerprint,
    });
    const queued = PurchaseRunStateSchema.parse({
      runId: listingId, kind: "purchase", status: "queued", reservation,
      listingTitle: listing.approvedDraft.title, seller: listing.seller,
      createdAt, updatedAt: createdAt, attempt: 0,
    });
    try {
      return await this.repository.createPurchaseRun(queued as Extract<PurchaseRunState, { status: "queued" }>);
    } catch (error) {
      if (!(error instanceof RepositoryConflictError)) throw error;
      const existing = await this.readRun(listingId);
      const expired = Date.parse(createdAt) >= Date.parse(existing.reservation.expiresAt);
      if (expired) {
        if (existing.status !== "queued") {
          throw new PurchaseError("purchase_not_payable", 409, "Purchase is not payable");
        }
        await this.repository.saveRunSnapshot(queued);
        const replacement = await this.readRun(listingId);
        if (!equal(replacement, queued)) {
          throw new PurchaseError("reservation_conflict", 409, "Another buyer already reserved this listing");
        }
        return replacement;
      }
      const sameTerms = existing.reservation.buyerAddress.toLowerCase() === buyer.toLowerCase() &&
        existing.reservation.recipientAddress.toLowerCase() === listing.recipientAddress.toLowerCase() &&
        equal(existing.reservation.amount, listing.approvedPrice) &&
        existing.listingTitle === listing.approvedDraft.title;
      if (!sameTerms) {
        throw new PurchaseError("reservation_conflict", 409, "Another buyer already reserved this listing");
      }
      return existing;
    }
  }

  async paymentRequired(run: PurchaseRunState, resourceUrl: string) {
    await this.repository.getListing(run.reservation.listingId);
    this.assertPayable(run);
    return this.gateway.paymentRequired(run.reservation, resourceUrl);
  }

  async verify(run: PurchaseRunState, paymentHeader: string): Promise<VerifiedX402Payment> {
    await this.repository.getListing(run.reservation.listingId);
    this.assertPayable(run);
    const verified = await this.gateway.verify(paymentHeader, run.reservation);
    if (run.status === "queued") {
      const now = this.clock();
      await this.repository.saveRunSnapshot(PurchaseRunStateSchema.parse({
        ...run, status: "running", startedAt: now, updatedAt: now, attempt: run.attempt + 1,
      }));
    }
    return verified;
  }

  async settle(listingId: string, verified: VerifiedX402Payment) {
    const current = await this.readRun(listingId);
    if (current.status === "settlement_pending" || current.status === "succeeded") return { run: current, settled: undefined };
    if (current.status !== "running") throw new PurchaseError("purchase_not_payable", 409, "Purchase is not payable");
    const settled = await this.gateway.settle(verified, current.reservation);
    const submittedAt = this.clock();
    const settlement = SettlementSubmissionSchema.parse({
      purchaseId: current.reservation.purchaseId,
      x402PaymentReference: verified.paymentReference,
      settlementTransaction: settled.transaction,
      submittedAt,
    });
    const pending = PurchaseRunStateSchema.parse({
      ...current, status: "settlement_pending", settlement, updatedAt: submittedAt,
    });
    await this.repository.saveRunSnapshot(pending);
    return { run: pending, settled };
  }

  async finalize(listingId: string): Promise<SettlementReceipt> {
    const current = await this.readRun(listingId);
    if (current.status === "succeeded") return current.receipt;
    if (current.status !== "settlement_pending" && current.status !== "reconciliation_failed") {
      throw new PurchaseError("settlement_not_pending", 409, "Settlement is not ready for reconciliation");
    }
    const settledAt = this.clock();
    const receipt = SettlementReceiptSchema.parse({
      receiptId: current.reservation.purchaseId,
      purchaseId: current.reservation.purchaseId,
      listingId: current.reservation.listingId,
      listingTitle: current.listingTitle,
      buyer: current.reservation.buyer,
      seller: current.seller,
      buyerAddress: current.reservation.buyerAddress,
      recipientAddress: current.reservation.recipientAddress,
      amount: current.reservation.amount,
      x402PaymentReference: current.settlement.x402PaymentReference,
      settlementTransaction: current.settlement.settlementTransaction,
      settledAt,
      status: "sold",
    });
    try {
      await this.repository.createSettlementReceipt(receipt);
    } catch (error) {
      if (!(error instanceof RepositoryConflictError)) throw error;
      const existing = await this.repository.readSettlementReceipt(receipt.purchaseId);
      if (!equal(existing, receipt)) return existing;
    }
    let successfulBasis;
    if (current.status === "reconciliation_failed") {
      const { failure, ...rest } = current;
      void failure;
      successfulBasis = rest;
    } else {
      successfulBasis = current;
    }
    const succeeded = PurchaseRunStateSchema.parse({
      ...successfulBasis, status: "succeeded", receipt, completedAt: settledAt, updatedAt: settledAt,
    });
    await this.repository.saveRunSnapshot(succeeded);
    return receipt;
  }

  async markReconciliationFailed(listingId: string): Promise<void> {
    const current = await this.readRun(listingId);
    if (current.status !== "settlement_pending") return;
    const failedAt = this.clock();
    const failure = {
      purchaseId: current.reservation.purchaseId,
      x402PaymentReference: current.settlement.x402PaymentReference,
      settlementTransaction: current.settlement.settlementTransaction,
      reason: "The settled payment could not be durably reconciled; retry receipt reconciliation.",
      failedAt,
    } as const;
    await this.repository.createReconciliationRecord(`failure_${failedAt.replace(/\D/g, "")}`, failure);
    await this.repository.saveRunSnapshot(PurchaseRunStateSchema.parse({
      ...current, status: "reconciliation_failed", failure, updatedAt: failedAt,
    }));
  }

  async readRun(listingId: string): Promise<PurchaseRunState> {
    const run = await this.repository.readRunSnapshot("purchase", listingId);
    if (run.kind !== "purchase") throw new PurchaseError("purchase_data_invalid", 500, "Purchase data is invalid");
    return PurchaseRunStateSchema.parse(run);
  }

  private assertPayable(run: PurchaseRunState) {
    if (run.status !== "queued" && run.status !== "running") {
      throw new PurchaseError("purchase_not_payable", 409, "Purchase is not payable");
    }
    if (Date.parse(this.clock()) >= Date.parse(run.reservation.expiresAt)) {
      throw new PurchaseError("reservation_expired", 409, "The reservation expired; this payment was not authorized");
    }
  }

  private snapshotFromRun(listing: Awaited<ReturnType<MarketplaceRepository["getListing"]>>["listing"], run: PurchaseRunState): CheckoutSnapshot {
    if (run.status === "succeeded") return this.snapshot(listing, "sold", run.reservation.expiresAt, run.receipt);
    if (run.status === "queued" && Date.parse(this.clock()) >= Date.parse(run.reservation.expiresAt)) {
      return this.snapshot(listing, "active", null, null);
    }
    const status = run.status === "settlement_pending" ? "settlement_pending" :
      run.status === "reconciliation_failed" ? "reconciliation_failed" : "payment_pending";
    return this.snapshot(listing, status, run.reservation.expiresAt, null);
  }

  private snapshot(listing: Awaited<ReturnType<MarketplaceRepository["getListing"]>>["listing"], status: CheckoutSnapshot["status"], expiresAt: string | null, receipt: SettlementReceipt | null): CheckoutSnapshot {
    return CheckoutSnapshotSchema.parse({
      listingId: listing.listingId, title: listing.approvedDraft.title,
      condition: listing.approvedDraft.condition, conditionSummary: conditionSummary(listing),
      amount: listing.approvedPrice, recipientAddress: listing.recipientAddress,
      network: BASE_SEPOLIA_NETWORK, chainId: 84532,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      reservationExpiresAt: expiresAt, status, receipt,
    });
  }
}
