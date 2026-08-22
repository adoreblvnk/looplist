import { describe, expect, it, vi } from "vitest";
import { InMemoryMarketplaceRepository } from "../lib/persistence/in-memory-marketplace-repository";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_DIMENSION,
  createMediaPostHandler,
  inspectImage,
  type MediaUploadServices,
} from "../lib/server/media-upload-api";

vi.mock("server-only", () => ({}));

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function png(width = 640, height = 480): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const bytes = new Uint8Array(12 + data.length);
    new DataView(bytes.buffer).setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(type), 4);
    bytes.set(data, 8);
    return bytes; // Four zero CRC bytes are present; validation intentionally does not recompute CRC.
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", [...ihdr]),
    chunk("IDAT", [0x01]),
    chunk("IEND", []),
  );
}

function jpeg(width = 640, height = 480): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0,
    0x01, 0xff, 0x00, 0x02,
    0xff, 0xd9,
  ]);
}

function webp(width = 640, height = 480): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8], 20);
  return bytes;
}

function services(repository = new InMemoryMarketplaceRepository()): MediaUploadServices {
  return { repository, createId: () => "media_0123456789abcdef", clock: () => "2026-08-21T10:00:00.000Z" };
}
function request(bytes: Uint8Array, contentType: string, headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/media", { method: "POST", headers: { "content-type": contentType, ...headers }, body: new Blob([bytes.slice().buffer as ArrayBuffer]) });
}

describe("private seller media upload", () => {
  it.each([
    ["image/png", png(), 640, 480],
    ["image/jpeg", jpeg(), 640, 480],
    ["image/webp", webp(), 640, 480],
  ] as const)("parses complete %s containers and dimensions without client metadata", (mime, bytes, width, height) => {
    expect(inspectImage(bytes, mime)).toEqual({ width, height });
  });

  it("writes immutable private media and returns only the analysis MediaReference", async () => {
    const dependencies = services();
    const response = await createMediaPostHandler(() => dependencies)(request(png(), "image/png; charset=binary"));
    expect(response.status).toBe(201);
    const media = await response.json();
    expect(media).toEqual({
      id: "media_0123456789abcdef",
      pathname: "media/uploads/media_0123456789abcdef/media_0123456789abcdef.png",
      mediaType: "image",
      mimeType: "image/png",
      alt: "Seller-uploaded product photo",
      width: 640,
      height: 480,
    });
    expect(JSON.stringify(media)).not.toMatch(/url|token|bytes/i);
    expect((await dependencies.repository.readPrivateMediaContent(media)).bytes).toEqual(png());
    const collision = await createMediaPostHandler(() => dependencies)(request(png(), "image/png"));
    expect(collision.status).toBe(503);
  });

  it.each([
    ["PNG header only", png().slice(0, 33), "image/png"],
    ["PNG missing IEND", png().slice(0, -12), "image/png"],
    ["PNG truncated chunk", png().slice(0, -1), "image/png"],
    ["PNG hostile chunk size", (() => { const value = png(); new DataView(value.buffer).setUint32(33, 0xffffffff); return value; })(), "image/png"],
    ["JPEG SOF then EOI", concat(jpeg().slice(0, 15), new Uint8Array([0xff, 0xd9])), "image/jpeg"],
    ["JPEG empty scan", concat(jpeg().slice(0, 25), new Uint8Array([0xff, 0xd9])), "image/jpeg"],
    ["JPEG missing EOI", jpeg().slice(0, -2), "image/jpeg"],
    ["JPEG truncated segment", jpeg().slice(0, 12), "image/jpeg"],
    ["WebP VP8X only", (() => { const value = new Uint8Array(30); value.set(new TextEncoder().encode("RIFF")); new DataView(value.buffer).setUint32(4, 22, true); value.set(new TextEncoder().encode("WEBPVP8X"), 8); new DataView(value.buffer).setUint32(16, 10, true); return value; })(), "image/webp"],
    ["WebP missing payload bytes", webp().slice(0, -1), "image/webp"],
    ["WebP hostile chunk size", (() => { const value = webp(); new DataView(value.buffer).setUint32(16, 0xffffffff, true); return value; })(), "image/webp"],
    ["WebP trailing data", concat(webp(), new Uint8Array([0])), "image/webp"],
  ] as const)("rejects incomplete or malformed %s before persistence", async (_case, bytes, mime) => {
    const dependencies = services();
    const upload = vi.spyOn(dependencies.repository, "createPrivateMedia");
    const response = await createMediaPostHandler(() => dependencies)(request(bytes, mime));
    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe("invalid_image");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    [new Uint8Array(), "image/png", 400, "empty_image"],
    [png(), "image/svg+xml", 415, "unsupported_image_type"],
    [jpeg(), "image/png", 415, "invalid_image"],
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg", 415, "invalid_image"],
    [png(MAX_UPLOAD_DIMENSION + 1, 1), "image/png", 413, "image_dimensions_too_large"],
  ] as const)("returns stable hostile input errors", async (bytes, mime, status, code) => {
    const response = await createMediaPostHandler(() => services())(request(bytes, mime));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it("rejects declared and streamed byte overflow before persistence", async () => {
    const dependencies = services();
    const upload = vi.spyOn(dependencies.repository, "createPrivateMedia");
    const declared = await createMediaPostHandler(() => dependencies)(request(png(), "image/png", { "content-length": String(MAX_UPLOAD_BYTES + 1) }));
    expect(declared.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    const streamed = await createMediaPostHandler(() => dependencies)(new Request("http://localhost/api/media", { method: "POST", headers: { "content-type": "image/png" }, body: stream, duplex: "half" } as RequestInit));
    expect(streamed.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });
});
