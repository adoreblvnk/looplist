import { NextRequest, NextResponse } from "next/server";
import { isUploadImagePath } from "@/lib/domain/path-predicates";
import { loadAndValidateImageBlob } from "@/lib/server/blob-client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pathname = searchParams.get("path");

    if (!pathname || !isUploadImagePath(pathname)) {
      return NextResponse.json(
        { error: "Invalid or out-of-scope image pathname" },
        { status: 400 }
      );
    }

    const validatedImage = await loadAndValidateImageBlob(pathname);

    if (!validatedImage) {
      return NextResponse.json(
        { error: "Image resource not found" },
        { status: 404 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", validatedImage.mimeType);
    headers.set("Content-Length", validatedImage.buffer.length.toString());
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");

    return new Response(new Uint8Array(validatedImage.buffer), {
      status: 200,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred while retrieving image" },
      { status: 500 }
    );
  }
}
