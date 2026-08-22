import "server-only";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { PurchaseReservation } from "../domain/marketplace";
import { BASE_SEPOLIA_NETWORK } from "../domain/marketplace";
import { BASE_SEPOLIA_USDC_ADDRESS, X402_FACILITATOR_URL } from "./contracts";

const MAX_TIMEOUT_SECONDS = 300;

function exactRequirements(reservation: PurchaseReservation): PaymentRequirements {
  return {
    scheme: "exact",
    network: BASE_SEPOLIA_NETWORK,
    asset: BASE_SEPOLIA_USDC_ADDRESS,
    amount: reservation.amount.atomicAmount,
    payTo: reservation.recipientAddress,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { name: "USDC", version: "2" },
  };
}

function sameRequirement(left: PaymentRequirements, right: PaymentRequirements): boolean {
  return left.scheme === right.scheme && left.network === right.network &&
    left.asset.toLowerCase() === right.asset.toLowerCase() && left.amount === right.amount &&
    left.payTo.toLowerCase() === right.payTo.toLowerCase() &&
    left.maxTimeoutSeconds === right.maxTimeoutSeconds;
}

export interface VerifiedX402Payment {
  payload: PaymentPayload;
  paymentReference: string;
}

export interface X402SettlementGateway {
  paymentRequired(reservation: PurchaseReservation, resourceUrl: string): Promise<{ header: string; body: PaymentRequired }>;
  verify(paymentHeader: string, reservation: PurchaseReservation): Promise<VerifiedX402Payment>;
  settle(verified: VerifiedX402Payment, reservation: PurchaseReservation): Promise<SettleResponse>;
  settlementHeader(response: SettleResponse): string;
}

async function paymentReference(header: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(header));
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

export class PublicFacilitatorX402Gateway implements X402SettlementGateway {
  private readonly server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: X402_FACILITATOR_URL, timeoutMs: 30_000 })
  ).register(BASE_SEPOLIA_NETWORK, new ExactEvmScheme());
  private initialized: Promise<void> | undefined;

  private ready(): Promise<void> {
    this.initialized ??= this.server.initialize();
    return this.initialized;
  }

  async paymentRequired(reservation: PurchaseReservation, resourceUrl: string) {
    await this.ready();
    const body = await this.server.createPaymentRequiredResponse(
      [exactRequirements(reservation)],
      { url: resourceUrl, description: `Purchase ${reservation.listingId}`, mimeType: "application/json" }
    );
    return { header: encodePaymentRequiredHeader(body), body };
  }

  async verify(paymentHeader: string, reservation: PurchaseReservation): Promise<VerifiedX402Payment> {
    await this.ready();
    const payload = decodePaymentSignatureHeader(paymentHeader);
    const required = exactRequirements(reservation);
    if (payload.x402Version !== 2 || !sameRequirement(payload.accepted, required)) {
      throw new Error("payment_terms_mismatch");
    }
    const result = await this.server.verifyPayment(payload, required);
    if (!result.isValid || !result.payer || result.payer.toLowerCase() !== reservation.buyerAddress.toLowerCase()) {
      throw new Error("payment_verification_failed");
    }
    return { payload, paymentReference: await paymentReference(paymentHeader) };
  }

  async settle(verified: VerifiedX402Payment, reservation: PurchaseReservation): Promise<SettleResponse> {
    const result = await this.server.settlePayment(verified.payload, exactRequirements(reservation));
    if (!result.success || result.network !== BASE_SEPOLIA_NETWORK ||
      !result.payer || result.payer.toLowerCase() !== reservation.buyerAddress.toLowerCase() ||
      (result.amount !== undefined && result.amount !== reservation.amount.atomicAmount) ||
      !/^0x[a-fA-F0-9]{64}$/.test(result.transaction)) {
      throw new Error("settlement_mismatch");
    }
    return result;
  }

  settlementHeader(response: SettleResponse): string {
    return encodePaymentResponseHeader(response);
  }
}
