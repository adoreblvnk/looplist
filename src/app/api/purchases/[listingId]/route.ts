import { createPurchaseGetHandler, createPurchasePostHandler } from "@/lib/server/purchase-api";

export const GET = createPurchaseGetHandler();
export const POST = createPurchasePostHandler();
