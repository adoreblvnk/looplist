import { createMediaPostHandler } from "@/lib/server/media-upload-api";

export const runtime = "nodejs";
export const POST = createMediaPostHandler();
