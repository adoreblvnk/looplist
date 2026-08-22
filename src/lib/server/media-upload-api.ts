import "server-only";
import { ZodError } from "zod";
import { MediaReferenceSchema } from "../domain/marketplace";
import { uploadedMediaPath } from "../persistence/paths";
import { createMarketplaceRepository } from "../persistence/production-repository";
import {
  RepositoryConflictError,
  RepositoryDataError,
  RepositoryUnavailableError,
  type MarketplaceRepository,
} from "../persistence/repository";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_DIMENSION = 12_000;
export const MAX_UPLOAD_PIXELS = 40_000_000;

type ImageMime = "image/jpeg" | "image/png" | "image/webp";
const extensionByMime: Record<ImageMime, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface MediaUploadServices {
  repository: MarketplaceRepository;
  createId: () => string;
  clock: () => string;
}

function productionServices(): MediaUploadServices {
  return {
    repository: createMarketplaceRepository(),
    createId: () => `media_${crypto.randomUUID().replaceAll("-", "")}`,
    clock: () => new Date().toISOString(),
  };
}

class UploadInputError extends Error {
  constructor(readonly status: 400 | 413 | 415, readonly code: string, message: string) {
    super(message);
  }
}

function u16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}
function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536;
}
function u32le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536 + bytes[offset + 3] * 16_777_216;
}
function u32be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function pngDimensions(bytes: Uint8Array): [number, number] | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || !signature.every((value, index) => bytes[index] === value)) return null;

  let offset = 8;
  let dimensions: [number, number] | null = null;
  let sawIdat = false;
  let idatEnded = false;
  let sawPlte = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return null;
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    // Comparing by subtraction avoids overflowing offset + length on hostile lengths.
    if (length > bytes.length - dataOffset - 4) return null;
    const nextOffset = dataOffset + length + 4; // CRC bytes are structurally required but intentionally not recomputed.

    if (!dimensions) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = [u32be(bytes, dataOffset), u32be(bytes, dataOffset + 4)];
    } else if (type === "IHDR") {
      return null;
    }

    if (type === "PLTE") {
      if (sawPlte || sawIdat || length === 0 || length % 3 !== 0) return null;
      sawPlte = true;
    } else if (type === "IDAT") {
      if (length === 0 || idatEnded) return null;
      sawIdat = true;
    } else if (sawIdat && type !== "IEND") {
      idatEnded = true;
    }

    if (type === "IEND") {
      if (length !== 0 || !sawIdat || nextOffset !== bytes.length) return null;
      return dimensions;
    }

    // Reject unknown critical chunks; ancillary chunks remain bounded and may be skipped.
    if (type !== "IHDR" && type !== "PLTE" && type !== "IDAT" && (bytes[offset + 4] & 0x20) === 0) return null;
    offset = nextOffset;
  }
  return null;
}

function isSofMarker(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf);
}

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let dimensions: [number, number] | null = null;
  let sawScan = false;
  let pendingMarker: number | null = null;

  while (offset < bytes.length || pendingMarker !== null) {
    let marker: number;
    if (pendingMarker !== null) {
      marker = pendingMarker;
      pendingMarker = null;
    } else {
      if (bytes[offset++] !== 0xff) return null;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return null;
      marker = bytes[offset++];
    }

    if (marker === 0x00 || marker === 0xd8) return null;
    if (marker === 0xd9) return sawScan && dimensions !== null && offset === bytes.length ? dimensions : null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (offset + 2 > bytes.length) return null;
    const length = u16be(bytes, offset);
    if (length < 2 || length > bytes.length - offset) return null;

    if (isSofMarker(marker)) {
      if (dimensions || length < 11 || bytes[offset + 7] === 0 || length !== 8 + bytes[offset + 7] * 3) return null;
      dimensions = [u16be(bytes, offset + 5), u16be(bytes, offset + 3)];
    }
    if (marker === 0xda && (length < 8 || bytes[offset + 2] === 0 || length !== 6 + bytes[offset + 2] * 2)) return null;
    offset += length;
    if (marker !== 0xda) continue;
    if (!dimensions) return null;

    let entropyBytes = 0;
    while (offset < bytes.length) {
      const value = bytes[offset++];
      if (value !== 0xff) {
        entropyBytes += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return null;
      const escaped = bytes[offset++];
      if (escaped === 0x00) {
        entropyBytes += 1;
      } else if (escaped >= 0xd0 && escaped <= 0xd7) {
        continue;
      } else {
        pendingMarker = escaped;
        break;
      }
    }
    if (entropyBytes === 0 || pendingMarker === null) return null;
    sawScan = true;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  if (u32le(bytes, 4) !== bytes.length - 8) return null;

  let offset = 12;
  let canvasDimensions: [number, number] | null = null;
  let imageDimensions: [number, number] | null = null;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) return null;
    const type = ascii(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (size > bytes.length - dataOffset) return null;
    const paddedSize = size + (size % 2);
    if (paddedSize > bytes.length - dataOffset) return null;

    let dimensions: [number, number] | null = null;
    if (type === "VP8X") {
      if (canvasDimensions || offset !== 12 || size !== 10) return null;
      dimensions = [1 + u24le(bytes, dataOffset + 4), 1 + u24le(bytes, dataOffset + 7)];
      canvasDimensions = dimensions;
    } else if (type === "VP8L") {
      if (imageDimensions || size < 5 || bytes[dataOffset] !== 0x2f) return null;
      const bits = u32le(bytes, dataOffset + 1);
      dimensions = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      imageDimensions = dimensions;
    } else if (type === "VP8 ") {
      if (imageDimensions || size < 10 || bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) return null;
      dimensions = [(bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff,
        (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff];
      imageDimensions = dimensions;
    }
    offset = dataOffset + paddedSize;
  }
  if (offset !== bytes.length || !imageDimensions) return null;
  if (canvasDimensions && (canvasDimensions[0] !== imageDimensions[0] || canvasDimensions[1] !== imageDimensions[1])) return null;
  return imageDimensions;
}

export function inspectImage(bytes: Uint8Array, mimeType: ImageMime): { width: number; height: number } {
  const dimensions = mimeType === "image/png"
    ? pngDimensions(bytes)
    : mimeType === "image/jpeg"
      ? jpegDimensions(bytes)
      : webpDimensions(bytes);
  if (!dimensions) throw new UploadInputError(415, "invalid_image", "Image content does not match its declared type");
  const [width, height] = dimensions;
  if (width < 1 || height < 1) throw new UploadInputError(415, "invalid_image", "Image dimensions are invalid");
  if (width > MAX_UPLOAD_DIMENSION || height > MAX_UPLOAD_DIMENSION || width * height > MAX_UPLOAD_PIXELS) {
    throw new UploadInputError(413, "image_dimensions_too_large", "Image dimensions exceed the upload limit");
  }
  return { width, height };
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_UPLOAD_BYTES)) {
    throw new UploadInputError(413, "image_too_large", "Image exceeds the upload byte limit");
  }
  if (!request.body) throw new UploadInputError(400, "empty_image", "An image body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      try { await reader.cancel(); } catch { /* byte limit remains authoritative */ }
      throw new UploadInputError(413, "image_too_large", "Image exceeds the upload byte limit");
    }
    chunks.push(value);
  }
  if (size === 0) throw new UploadInputError(400, "empty_image", "An image body is required");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

export function createMediaPostHandler(servicesFactory: () => MediaUploadServices = productionServices) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const rawType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (rawType !== "image/jpeg" && rawType !== "image/png" && rawType !== "image/webp") {
        throw new UploadInputError(415, "unsupported_image_type", "Only JPEG, PNG, and WebP images are accepted");
      }
      const bytes = await readBoundedBody(request);
      const { width, height } = inspectImage(bytes, rawType);
      const services = servicesFactory();
      const mediaId = services.createId();
      const media = MediaReferenceSchema.parse({
        id: mediaId,
        pathname: uploadedMediaPath(mediaId, mediaId, extensionByMime[rawType]),
        mediaType: "image",
        mimeType: rawType,
        alt: "Seller-uploaded product photo",
        width,
        height,
      });
      await services.repository.createPrivateMedia(media, bytes, services.clock());
      const { pathname: _pathname, ...publicReference } = media;
      void _pathname;
      return json(publicReference, 201);
    } catch (cause) {
      if (cause instanceof UploadInputError) return failure(cause.status, cause.code, cause.message);
      if (cause instanceof RepositoryConflictError) return failure(503, "media_unavailable", "Media service is unavailable");
      if (cause instanceof RepositoryDataError || cause instanceof ZodError) return failure(400, "invalid_image", "Image could not be accepted");
      if (cause instanceof RepositoryUnavailableError) return failure(503, "media_unavailable", "Media service is unavailable");
      return failure(503, "media_unavailable", "Media service is unavailable");
    }
  };
}
