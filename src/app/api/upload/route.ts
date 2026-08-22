import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/domain/schemas";
import { uploadRawImageToPrivateBlob } from "@/lib/server/blob-client";
import { ImageValidationError, BlobServiceError } from "@/lib/domain/errors";

export async function POST(request: NextRequest) {
  try {
    const contentLengthHeader = request.headers.get("content-length");
    if (!contentLengthHeader || !/^[1-9][0-9]*$/.test(contentLengthHeader)) {
      throw new ImageValidationError(
        "Content-Length header must match /^[1-9][0-9]*$/"
      );
    }

    const declaredLength = parseInt(contentLengthHeader, 10);
    if (declaredLength > MAX_FILE_SIZE_BYTES) {
      throw new ImageValidationError("Declared Content-Length exceeds 4 MiB limit");
    }

    const contentTypeHeader = request.headers.get("content-type")?.toLowerCase() || "";
    const rawMime = contentTypeHeader.split(";")[0].trim();

    if (!ALLOWED_MIME_TYPES.includes(rawMime as typeof ALLOWED_MIME_TYPES[number])) {
      throw new ImageValidationError(
        `Invalid Content-Type '${rawMime}'. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`
      );
    }

    if (!request.body) {
      throw new ImageValidationError("Request body is missing");
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedBytes += value.length;
        if (receivedBytes > declaredLength || receivedBytes > MAX_FILE_SIZE_BYTES) {
          reader.cancel();
          throw new ImageValidationError(
            "Received payload byte count exceeded declared length or 4 MiB limit"
          );
        }
        chunks.push(value);
      }
    }

    if (receivedBytes !== declaredLength) {
      throw new ImageValidationError(
        `Received payload byte count (${receivedBytes}) does not match declared Content-Length (${declaredLength})`
      );
    }

    const combinedBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    const { pathname } = await uploadRawImageToPrivateBlob(combinedBuffer, rawMime);
    const previewUrl = `/api/images?path=${encodeURIComponent(pathname)}`;

    return NextResponse.json(
      {
        pathname,
        previewUrl,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof ImageValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BlobServiceError) {
      return NextResponse.json({ error: "Storage service unavailable" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "An unexpected error occurred during image upload" },
      { status: 500 }
    );
  }
}
