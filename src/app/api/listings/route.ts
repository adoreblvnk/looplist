import { createListingsGetHandler, createListingsPostHandler } from "@/lib/server/listings-api";

export const GET = createListingsGetHandler();
export const POST = createListingsPostHandler();
