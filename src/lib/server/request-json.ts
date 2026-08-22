import "server-only";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export class RequestJsonError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415
  ) {
    super(message);
    this.name = "RequestJsonError";
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestJsonError("Content-Type must be application/json", 415);
  }

  const contentLength = request.headers.get("content-length");
  let declaredLength: number | null = null;

  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new RequestJsonError("Content-Length must be a valid byte count", 400);
    }

    declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new RequestJsonError("Content-Length must be a valid byte count", 400);
    }
    if (declaredLength > maxBytes) {
      throw new RequestJsonError("JSON request body exceeds 64 KiB limit", 413);
    }
  }

  if (!request.body) {
    throw new RequestJsonError("JSON request body is required", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new RequestJsonError("JSON request body exceeds 64 KiB limit", 413);
    }
    chunks.push(value);
  }

  if (declaredLength !== null && receivedBytes !== declaredLength) {
    throw new RequestJsonError("JSON request body length does not match Content-Length", 400);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestJsonError("JSON request body must be valid UTF-8", 400);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RequestJsonError("JSON request body is malformed", 400);
  }
}
