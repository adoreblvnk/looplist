import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrivateBlobTransport } from "./vercel-blob-marketplace-repository";

export const LOCAL_MARKETPLACE_DATA_ROOT = path.resolve(
  process.env.LOOPLIST_LOCAL_DATA_DIR || path.join(process.cwd(), ".looplist-data")
);

function localPath(pathname: string): string {
  if (
    !pathname ||
    path.isAbsolute(pathname) ||
    pathname.includes("\\") ||
    pathname.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw Object.assign(new Error("Invalid local storage pathname"), { status: 400 });
  }
  const resolved = path.resolve(LOCAL_MARKETPLACE_DATA_ROOT, pathname);
  if (!resolved.startsWith(`${LOCAL_MARKETPLACE_DATA_ROOT}${path.sep}`)) {
    throw Object.assign(new Error("Invalid local storage pathname"), { status: 400 });
  }
  return resolved;
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".json")) return "application/json";
  if (/\.jpe?g$/i.test(pathname)) return "image/jpeg";
  if (/\.png$/i.test(pathname)) return "image/png";
  if (/\.webp$/i.test(pathname)) return "image/webp";
  return "application/octet-stream";
}

async function metadata(pathname: string) {
  try {
    const details = await stat(localPath(pathname));
    return {
      pathname,
      contentType: contentType(pathname),
      size: details.size,
      uploadedAt: details.birthtimeMs > 0 ? details.birthtime : details.mtime,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error("Local object not found"), { status: 404 });
    }
    throw error;
  }
}

async function storedPathnames(): Promise<string[]> {
  const results: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (directory === LOCAL_MARKETPLACE_DATA_ROOT && entry.name === ".tmp") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) results.push(path.relative(LOCAL_MARKETPLACE_DATA_ROOT, absolute).split(path.sep).join("/"));
    }
  }
  await walk(LOCAL_MARKETPLACE_DATA_ROOT);
  return results.sort();
}

export const localPrivateBlobTransport: PrivateBlobTransport = {
  async put(pathname, body, options) {
    const destination = localPath(pathname);
    await mkdir(path.dirname(destination), { recursive: true });
    const source = typeof body === "string" ? body : Buffer.from(body);
    try {
      if (!options.allowOverwrite) {
        await writeFile(destination, source, { flag: "wx" });
      } else {
        const temporaryDirectory = path.join(LOCAL_MARKETPLACE_DATA_ROOT, ".tmp");
        await mkdir(temporaryDirectory, { recursive: true });
        const temporary = path.join(temporaryDirectory, randomUUID());
        await writeFile(temporary, source, { flag: "wx" });
        await rename(temporary, destination);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw Object.assign(new Error("Local object already exists"), { status: 409 });
      }
      throw error;
    }
    return { pathname };
  },

  async get(pathname) {
    try {
      const bytes = await readFile(localPath(pathname));
      return {
        stream: new Blob([bytes]).stream(),
        blob: await metadata(pathname),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as { status?: number }).status === 404) return null;
      throw error;
    }
  },

  async head(pathname) {
    return metadata(pathname);
  },

  async list({ prefix, limit, cursor }) {
    const all = (await storedPathnames()).filter((pathname) => pathname.startsWith(prefix));
    const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    if (!Number.isSafeInteger(start) || start < 0) {
      throw Object.assign(new Error("Invalid local storage cursor"), { status: 400 });
    }
    const selected = all.slice(start, start + limit);
    const next = start + selected.length;
    return {
      blobs: await Promise.all(selected.map((pathname) => metadata(pathname))),
      hasMore: next < all.length,
      ...(next < all.length ? { cursor: String(next) } : {}),
    };
  },

  async del(pathname) {
    await rm(localPath(pathname), { force: true });
  },
};

