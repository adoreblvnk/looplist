function hasTraversalOrInvalidChars(pathname: string): boolean {
  if (typeof pathname !== "string" || !pathname.trim()) return true;
  const normalized = pathname.trim();
  return (
    normalized.includes("..") ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  );
}

const UPLOAD_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export function isUploadImagePath(pathname: string): boolean {
  if (hasTraversalOrInvalidChars(pathname)) return false;
  const normalized = pathname.trim();
  if (!normalized.startsWith("uploads/")) return false;
  const lower = normalized.toLowerCase();
  return UPLOAD_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isDraftPath(pathname: string): boolean {
  if (hasTraversalOrInvalidChars(pathname)) return false;
  const normalized = pathname.trim();
  if (!normalized.startsWith("drafts/")) return false;
  return normalized.toLowerCase().endsWith(".json");
}

export function isAdapterRecordPath(pathname: string): boolean {
  if (hasTraversalOrInvalidChars(pathname)) return false;
  const normalized = pathname.trim();
  if (!normalized.startsWith("adapter-records/")) return false;
  return normalized.toLowerCase().endsWith(".json");
}

export function isSkillPath(pathname: string): boolean {
  if (hasTraversalOrInvalidChars(pathname)) return false;
  const normalized = pathname.trim();
  if (!normalized.startsWith("skills/")) return false;
  return normalized.toLowerCase().endsWith(".json");
}

export function isRunMarkerPath(pathname: string): boolean {
  if (hasTraversalOrInvalidChars(pathname)) return false;
  const normalized = pathname.trim();
  if (!normalized.startsWith("run-metadata/")) return false;
  return normalized.toLowerCase().endsWith(".json");
}

export function isPathAllowed(pathname: string): boolean {
  return (
    isUploadImagePath(pathname) ||
    isDraftPath(pathname) ||
    isAdapterRecordPath(pathname) ||
    isSkillPath(pathname) ||
    isRunMarkerPath(pathname)
  );
}
