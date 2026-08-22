import "server-only";
import { get, put } from "@vercel/blob";
import { isUploadImagePath, isPathAllowed } from "./path-scoping";
import { validateImageBuffer } from "../domain/image-validation";
import { MAX_FILE_SIZE_BYTES } from "../domain/schemas";
import { ImageValidationError, BlobServiceError } from "../domain/errors";

export const MAX_JSON_SIZE_BYTES = 512 * 1024; // 512 KiB

function isBlobNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const errorObj = err as { status?: number; statusCode?: number; code?: string; message?: string };
  if (errorObj.status === 404 || errorObj.statusCode === 404 || errorObj.code === "blob_not_found") {
    return true;
  }
  if (typeof errorObj.message === "string" && errorObj.message.toLowerCase().includes("not found")) {
    return true;
  }
  return false;
}

export async function uploadRawImageToPrivateBlob(
  fileData: Buffer | Uint8Array,
  declaredContentType: string
): Promise<{ pathname: string; url: string }> {
  const validated = validateImageBuffer(fileData, declaredContentType);
  const uniqueId = crypto.randomUUID();
  const pathname = `uploads/${uniqueId}${validated.extension}`;

  if (!isUploadImagePath(pathname)) {
    throw new ImageValidationError(`Upload pathname '${pathname}' violates security policy`);
  }

  try {
    const buffer = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData);
    const blobResult = await put(pathname, buffer, {
      access: "private",
      contentType: validated.mimeType,
      addRandomSuffix: false,
    });

    return {
      pathname: blobResult.pathname,
      url: blobResult.url,
    };
  } catch (err: unknown) {
    if (err instanceof ImageValidationError) {
      throw err;
    }
    throw new BlobServiceError("Vercel Blob storage service unavailable");
  }
}

export async function loadAndValidateImageBlob(
  pathname: string
): Promise<{ buffer: Buffer; mimeType: string; pathname: string } | null> {
  if (!isUploadImagePath(pathname)) {
    return null;
  }

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || !result.stream) {
      return null;
    }

    const contentType = result.blob.contentType || "";
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        downloadedBytes += value.length;
        if (downloadedBytes > MAX_FILE_SIZE_BYTES) {
          reader.cancel();
          throw new ImageValidationError("Image size exceeds limit of 4 MiB");
        }
        chunks.push(value);
      }
    }

    const combined = new Uint8Array(downloadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const validated = validateImageBuffer(combined, contentType);
    return {
      buffer: Buffer.from(combined),
      mimeType: validated.mimeType,
      pathname,
    };
  } catch (err: unknown) {
    if (isBlobNotFoundError(err)) {
      return null;
    }
    if (err instanceof ImageValidationError) {
      throw err;
    }
    throw new BlobServiceError("Vercel Blob storage service unavailable");
  }
}

export async function putPrivateBlobJson<T>(
  pathname: string,
  data: T
): Promise<{ pathname: string; url: string }> {
  if (!isPathAllowed(pathname)) {
    throw new Error(`Pathname ${pathname} is not allowed.`);
  }

  const jsonContent = JSON.stringify(data, null, 2);
  const encoded = new TextEncoder().encode(jsonContent);
  if (encoded.length > MAX_JSON_SIZE_BYTES) {
    throw new Error(`JSON payload size exceeds limit of 512 KiB (got ${encoded.length} bytes)`);
  }

  try {
    const result = await put(pathname, jsonContent, {
      access: "private",
      contentType: "application/json",
      allowOverwrite: true,
      addRandomSuffix: false,
    });

    return {
      pathname: result.pathname,
      url: result.url,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("512 KiB")) {
      throw err;
    }
    throw new BlobServiceError("Vercel Blob storage service unavailable");
  }
}

export async function getPrivateBlobJson<T>(pathname: string): Promise<T | null> {
  if (!isPathAllowed(pathname)) {
    return null;
  }

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || !result.stream) {
      return null;
    }

    const contentType = (result.blob.contentType || "").toLowerCase().trim();
    if (contentType !== "application/json" && !contentType.startsWith("application/json;")) {
      throw new Error("Blob content type must be application/json");
    }

    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        downloadedBytes += value.length;
        if (downloadedBytes > MAX_JSON_SIZE_BYTES) {
          reader.cancel();
          throw new Error("Blob JSON size exceeds 512 KiB limit");
        }
        chunks.push(value);
      }
    }

    const combined = new Uint8Array(downloadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const text = new TextDecoder().decode(combined);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Blob JSON payload is malformed");
    }
  } catch (err: unknown) {
    if (isBlobNotFoundError(err)) {
      return null;
    }
    if (
      err instanceof Error &&
      (err.message.includes("512 KiB") ||
        err.message.includes("application/json") ||
        err.message.includes("malformed"))
    ) {
      throw err;
    }
    throw new BlobServiceError("Vercel Blob storage service unavailable");
  }
}
