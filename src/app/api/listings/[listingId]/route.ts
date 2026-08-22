import { createListingDeleteHandler, createListingGetHandler } from "@/lib/server/listings-api";

export const GET = createListingGetHandler();
export const DELETE = createListingDeleteHandler();
