import { describe, expect, it, vi } from "vitest";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "@x402/core/types";
import { activeListing } from "./domain-fixtures";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import type { PurchaseReservation } from "../lib/domain/marketplace";
import type { VerifiedX402Payment, X402SettlementGateway } from "../lib/payment/x402-server";
import { createPurchaseGetHandler, createPurchasePostHandler, type PurchaseApiServices } from "../lib/server/purchase-api";
import { PurchaseService } from "../lib/payment/purchase-service";

vi.mock("server-only", () => ({}));

const BUYER = "0x2222222222222222222222222222222222222222";
const TX = `0x${"b".repeat(64)}`;

class Gateway implements X402SettlementGateway {
  paymentRequired(reservation: PurchaseReservation): Promise<{ header: string; body: PaymentRequired }> { return Promise.resolve({ header: "required-v2", body: { x402Version: 2, resource: { url: "https://loop.test" }, accepts: [{ scheme: "exact", network: reservation.amount.network, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: reservation.amount.atomicAmount, payTo: reservation.recipientAddress, maxTimeoutSeconds: 300, extra: {} }] } }); }
  verify(header: string, reservation: PurchaseReservation): Promise<VerifiedX402Payment> { if(header!=="valid")return Promise.reject(new Error("payment_verification_failed"));return Promise.resolve({ paymentReference: "sha256:api", payload: { x402Version: 2, accepted: { scheme: "exact", network: reservation.amount.network, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: reservation.amount.atomicAmount, payTo: reservation.recipientAddress, maxTimeoutSeconds: 300, extra: {} }, payload: {} } as PaymentPayload }); }
  settle(_payment: VerifiedX402Payment, reservation: PurchaseReservation): Promise<SettleResponse> { return Promise.resolve({ success: true, payer: reservation.buyerAddress, transaction: TX, network: reservation.amount.network, amount: reservation.amount.atomicAmount }); }
  settlementHeader(): string { return "settled-v2"; }
}

function request(header?:string){return new Request(`https://loop.test/api/purchases/${activeListing.listingId}`,{method:"POST",headers:{"Content-Type":"application/json",...(header?{"PAYMENT-SIGNATURE":header}:{})},body:JSON.stringify({buyerAddress:BUYER,approved:true})})}
const context={params:Promise.resolve({listingId:activeListing.listingId})};

function harness(startMode:"finalize"|"fail"|"hold"="finalize"){
  const repository=new InMemoryMarketplaceRepository({listings:[activeListing]});const gateway=new Gateway();let now="2026-08-21T10:00:00.000Z";
  const services:PurchaseApiServices={repository,gateway,clock:()=>now,recipientAddress:activeListing.recipientAddress,startWorkflow:async(listingId)=>{if(startMode==="fail")throw new Error("lost");if(startMode==="finalize"){now="2026-08-21T10:00:02.000Z";await new PurchaseService(repository,gateway,()=>now,activeListing.recipientAddress).finalize(listingId)}}};
  return {services,setNow(value:string){now=value}};
}

describe("purchase API",()=>{
  it("requires explicit approval before returning bounded x402 v2 exact terms",async()=>{const {services}=harness();const handler=createPurchasePostHandler(()=>services);const invalid=await handler(new Request("https://loop.test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({buyerAddress:BUYER})}),context);expect(invalid.status).toBe(400);const required=await handler(request(),context);expect(required.status).toBe(402);expect(required.headers.get("PAYMENT-REQUIRED")).toBe("required-v2");const body=await required.json();expect(body.accepts[0]).toMatchObject({amount:activeListing.approvedPrice.atomicAmount,payTo:activeListing.recipientAddress,network:"eip155:84532"})});
  it("rejects an invalid wallet payment without exposing the signed payload",async()=>{const {services}=harness();const response=await createPurchasePostHandler(()=>services)(request("wrong"),context);expect(response.status).toBe(402);expect(JSON.stringify(await response.json())).not.toContain("wrong")});
  it("returns settlement confirmation, finalizes the receipt, and reloads sold state",async()=>{const {services}=harness();const handler=createPurchasePostHandler(()=>services);const response=await handler(request("valid"),context);expect(response.status).toBe(202);expect(response.headers.get("PAYMENT-RESPONSE")).toBe("settled-v2");const checkout=await createPurchaseGetHandler(()=>services)(new Request("https://loop.test"),context);expect(await checkout.json()).toMatchObject({status:"sold",receipt:{amount:activeListing.approvedPrice,settlementTransaction:TX}})});
  it("replays a settlement-pending purchase after response loss without another settlement",async()=>{const {services}=harness("hold");let settlements=0;const original=services.gateway.settle.bind(services.gateway);services.gateway.settle=async(...args)=>{settlements++;return original(...args)};const handler=createPurchasePostHandler(()=>services);expect((await handler(request("valid"),context)).status).toBe(202);expect((await handler(request("valid"),context)).status).toBe(202);expect(settlements).toBe(1)});
  it("records a truthful reconciliation failure when durable workflow start fails",async()=>{const {services}=harness("fail");const response=await createPurchasePostHandler(()=>services)(request("valid"),context);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:"reconciliation_failed"}});const checkout=await createPurchaseGetHandler(()=>services)(new Request("https://loop.test"),context);expect(await checkout.json()).toMatchObject({status:"reconciliation_failed",receipt:null})});
  it("does not leak recipient through ordinary listing APIs but intentionally shows it only at checkout",async()=>{const {services}=harness();const checkout=await createPurchaseGetHandler(()=>services)(new Request("https://loop.test"),context);const payload=JSON.stringify(await checkout.json());expect(payload).toContain(activeListing.recipientAddress);expect(payload).not.toMatch(/pathname|media\/seed|workflowRunId|BLOB_READ_WRITE_TOKEN/) });
});
