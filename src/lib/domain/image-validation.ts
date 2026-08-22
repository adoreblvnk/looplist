import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "./schemas";
import { ImageValidationError } from "./errors";

export interface DetectedImageFormat {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: ".jpg" | ".png" | ".webp";
}

export function detectImageFormat(buffer: Uint8Array): DetectedImageFormat | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: ".png" };
  }

  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: ".webp" };
  }

  return null;
}

export function validateImageBuffer(
  buffer: Uint8Array,
  declaredMimeType: string
): DetectedImageFormat {
  if (!buffer || buffer.length === 0) {
    throw new ImageValidationError("Image buffer is empty");
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new ImageValidationError(`Image size ${buffer.length} exceeds 4 MiB limit`);
  }

  const detected = detectImageFormat(buffer);
  if (!detected) {
    throw new ImageValidationError("Invalid or unsupported image magic bytes");
  }

  const normalizedDeclared = declaredMimeType.trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(normalizedDeclared as typeof ALLOWED_MIME_TYPES[number])) {
    throw new ImageValidationError(`Declared MIME type '${declaredMimeType}' is not allowed`);
  }

  if (normalizedDeclared === "image/jpg" || normalizedDeclared === "image/jpeg") {
    if (detected.mimeType !== "image/jpeg") {
      throw new ImageValidationError("Mismatched image magic bytes for JPEG Content-Type");
    }
  } else if (normalizedDeclared === "image/png") {
    if (detected.mimeType !== "image/png") {
      throw new ImageValidationError("Mismatched image magic bytes for PNG Content-Type");
    }
  } else if (normalizedDeclared === "image/webp") {
    if (detected.mimeType !== "image/webp") {
      throw new ImageValidationError("Mismatched image magic bytes for WebP Content-Type");
    }
  } else {
    throw new ImageValidationError("Content-Type and magic byte mismatch");
  }

  return detected;
}
