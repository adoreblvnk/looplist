import "server-only";
import { PurchaseService } from "../lib/payment/purchase-service";
import { PublicFacilitatorX402Gateway } from "../lib/payment/x402-server";
import { createMarketplaceRepository } from "../lib/persistence/production-repository";

export async function finalizePurchaseStep(listingId: string): Promise<void> {
  "use step";
  const recipient = process.env.X402_PAY_TO_ADDRESS;
  if (!recipient) throw new Error("Purchase recipient configuration is unavailable");
  const service = new PurchaseService(
    createMarketplaceRepository(), new PublicFacilitatorX402Gateway(),
    () => new Date().toISOString(), recipient,
  );
  await service.finalize(listingId);
}
finalizePurchaseStep.maxRetries = 2;

export async function purchaseWorkflow(listingId: string): Promise<void> {
  "use workflow";
  await finalizePurchaseStep(listingId);
}
