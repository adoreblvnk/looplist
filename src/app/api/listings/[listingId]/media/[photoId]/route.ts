import { createListingMediaGetHandler } from "@/lib/server/listings-api";

export const runtime = "nodejs";
export const GET = createListingMediaGetHandler();
