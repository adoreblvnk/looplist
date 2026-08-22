import "server-only";
import { z, ZodError } from "zod";
import type { SettleResponse } from "@x402/core/types";
import { start } from "workflow/api";
import { BASE_SEPOLIA_NETWORK } from "../domain/marketplace";
import { createMarketplaceRepository } from "../persistence/production-repository";
import {
  RepositoryDataError,
  RepositoryNotFoundError,
  RepositoryUnavailableError,
  type MarketplaceRepository,
} from "../persistence/repository";
import { CheckoutSnapshotSchema, PurchaseApprovalRequestSchema } from "../payment/contracts";
import { PurchaseError, PurchaseService } from "../payment/purchase-service";
import { PublicFacilitatorX402Gateway, type X402SettlementGateway } from "../payment/x402-server";
import { readBoundedJson, RequestJsonError } from "./request-json";
import { purchaseWorkflow } from "../../workflows/purchase-workflow";

const IdentifierSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export interface PurchaseApiServices {
  repository: MarketplaceRepository;
  gateway: X402SettlementGateway;
  clock: () => string;
  recipientAddress: string;
  startWorkflow: (listingId: string) => Promise<void>;
}

class PurchaseConfigurationError extends Error {}

function productionServices(): PurchaseApiServices {
  const recipient = EvmAddressSchema.safeParse(process.env.X402_PAY_TO_ADDRESS);
  if (!recipient.success || process.env.X402_NETWORK !== BASE_SEPOLIA_NETWORK) {
    throw new PurchaseConfigurationError();
  }
  return {
    repository: createMarketplaceRepository(), gateway: new PublicFacilitatorX402Gateway(),
    clock: () => new Date().toISOString(), recipientAddress: recipient.data,
    startWorkflow: async (listingId) => { await start(purchaseWorkflow, [listingId]); },
  };
}

function response(value: unknown, status: number, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
function failure(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return response({ error: { code, message } }, status, headers);
}

function service(dependencies: PurchaseApiServices): PurchaseService {
  return new PurchaseService(dependencies.repository, dependencies.gateway, dependencies.clock, dependencies.recipientAddress);
}

function routeId(context: { params: Promise<{ listingId: string }> }): Promise<string | null> {
  return context.params.then(({ listingId }) => IdentifierSchema.safeParse(listingId)).then((result) => result.success ? result.data : null);
}

function storedSettlementResponse(run: Awaited<ReturnType<PurchaseService["readRun"]>>): SettleResponse | null {
  if (run.status !== "settlement_pending" && run.status !== "reconciliation_failed" && run.status !== "succeeded") return null;
  return {
    success: true, payer: run.reservation.buyerAddress,
    transaction: run.settlement.settlementTransaction,
    network: BASE_SEPOLIA_NETWORK, amount: run.reservation.amount.atomicAmount,
  };
}

export function createPurchaseGetHandler(factory: () => PurchaseApiServices = productionServices) {
  return async function GET(_request: Request, context: { params: Promise<{ listingId: string }> }): Promise<Response> {
    const listingId = await routeId(context);
    if (!listingId) return failure(404, "listing_not_found", "Listing was not found");
    try {
      return response(CheckoutSnapshotSchema.parse(await service(factory()).checkout(listingId)), 200);
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createPurchasePostHandler(factory: () => PurchaseApiServices = productionServices) {
  return async function POST(request: Request, context: { params: Promise<{ listingId: string }> }): Promise<Response> {
    const listingId = await routeId(context);
    if (!listingId) return failure(404, "listing_not_found", "Listing was not found");
    try {
      const input = PurchaseApprovalRequestSchema.parse(await readBoundedJson(request));
      const dependencies = factory();
      const purchases = service(dependencies);
      let run = await purchases.reserve(listingId, input.buyerAddress);
      if (run.status === "succeeded") return response({ status: "sold", receipt: run.receipt }, 200);
      const stored = storedSettlementResponse(run);
      if (stored) {
        return response({ status: run.status }, 202, { "PAYMENT-RESPONSE": dependencies.gateway.settlementHeader(stored) });
      }
      const paymentHeader = request.headers.get("PAYMENT-SIGNATURE");
      if (!paymentHeader) {
        const required = await purchases.paymentRequired(run, request.url);
        return response(required.body, 402, { "PAYMENT-REQUIRED": required.header });
      }
      const verified = await purchases.verify(run, paymentHeader);
      const result = await purchases.settle(listingId, verified);
      run = result.run;
      const settled = result.settled ?? storedSettlementResponse(run);
      if (!settled) throw new PurchaseError("settlement_invalid", 502, "Settlement response was invalid");
      try {
        await dependencies.startWorkflow(listingId);
      } catch {
        await purchases.markReconciliationFailed(listingId);
        return failure(503, "reconciliation_failed", "Payment settled, but receipt reconciliation needs a retry", {
          "PAYMENT-RESPONSE": dependencies.gateway.settlementHeader(settled),
        });
      }
      return response({ status: "settlement_pending" }, 202, {
        "PAYMENT-RESPONSE": dependencies.gateway.settlementHeader(settled),
      });
    } catch (error) {
      return mapError(error);
    }
  };
}

export function createPurchaseReconcilePostHandler(factory: () => PurchaseApiServices = productionServices) {
  return async function POST(_request: Request, context: { params: Promise<{ listingId: string }> }): Promise<Response> {
    const listingId = await routeId(context);
    if (!listingId) return failure(404, "listing_not_found", "Listing was not found");
    try {
      const dependencies = factory();
      const run = await service(dependencies).readRun(listingId);
      if (run.status !== "settlement_pending" && run.status !== "reconciliation_failed") {
        throw new PurchaseError("settlement_not_pending", 409, "Settlement is not ready for reconciliation");
      }
      await dependencies.startWorkflow(listingId);
      return response({ status: "settlement_pending" }, 202);
    } catch (error) {
      return mapError(error);
    }
  };
}

function mapError(error: unknown): Response {
  if (error instanceof PurchaseError) return failure(error.status, error.code, error.message);
  if (error instanceof PurchaseConfigurationError) return failure(503, "checkout_unavailable", "Checkout configuration is unavailable");
  if (error instanceof RepositoryNotFoundError) return failure(404, "listing_not_found", "Listing was not found");
  if (error instanceof RepositoryDataError) return failure(500, "purchase_data_invalid", "Stored purchase data is invalid");
  if (error instanceof RepositoryUnavailableError) return failure(503, "checkout_unavailable", "Checkout is unavailable");
  if (error instanceof RequestJsonError) return failure(error.status, "invalid_request", "Invalid purchase approval request");
  if (error instanceof ZodError || error instanceof TypeError) return failure(400, "invalid_request", "Invalid purchase approval request");
  if (error instanceof Error && (error.message === "payment_terms_mismatch" || error.message === "payment_verification_failed")) {
    return failure(402, "payment_invalid", "Payment authorization did not match the approved checkout");
  }
  if (error instanceof Error && error.message === "settlement_mismatch") {
    return failure(502, "settlement_mismatch", "Settlement did not match the approved checkout");
  }
  return failure(503, "checkout_unavailable", "Checkout is unavailable");
}
