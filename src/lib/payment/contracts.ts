import { z } from "zod";
import { BASE_SEPOLIA_NETWORK, ListingConditionSchema, MoneySchema, SettlementReceiptSchema } from "../domain/marketplace";

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org" as const;
export const BASE_SEPOLIA_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const X402_FACILITATOR_URL = "https://x402.org/facilitator" as const;
export const PURCHASE_RESERVATION_SECONDS = 5 * 60;

const IdentifierSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const EvmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const PurchaseApprovalRequestSchema = z.object({
  buyerAddress: EvmAddressSchema,
  approved: z.literal(true),
}).strict();

export const CheckoutSnapshotSchema = z.object({
  listingId: IdentifierSchema,
  title: z.string().trim().min(5).max(80),
  condition: ListingConditionSchema,
  conditionSummary: z.string().trim().min(1).max(500),
  amount: MoneySchema,
  recipientAddress: EvmAddressSchema,
  network: z.literal(BASE_SEPOLIA_NETWORK),
  chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
  asset: z.literal(BASE_SEPOLIA_USDC_ADDRESS),
  reservationExpiresAt: z.string().nullable(),
  status: z.enum(["active", "payment_pending", "settlement_pending", "reconciliation_failed", "sold"]),
  receipt: SettlementReceiptSchema.nullable(),
}).strict();
export type CheckoutSnapshot = z.infer<typeof CheckoutSnapshotSchema>;
