"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";

interface LocalPhoto {
  id: string;
  file?: File;
  previewUrl: string;
  serverPathname?: string;
  name: string;
  size: number;
}

interface PhotoIntakeProps {
  onStartAnalysis: (imagePaths: string[]) => void;
  isUploading: boolean;
  error?: string | null;
  onError: (err: string | null) => void;
}

const SEEDED_IMAGES = [
  { path: "/demo/game-boy-front.png", name: "game-boy-front.png" },
  { path: "/demo/game-boy-back.png", name: "game-boy-back.png" },
  { path: "/demo/game-boy-detail.png", name: "game-boy-detail.png" },
];

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export function PhotoIntake({
  onStartAnalysis,
  isUploading,
  error,
  onError,
}: PhotoIntakeProps) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photosRef = useRef<LocalPhoto[]>([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => {
        if (p.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(p.previewUrl);
        }
      });
    };
  }, []);

  const validateFile = (file: File): string | null => {
    const rawType = file.type.toLowerCase().split(";")[0].trim();
    if (!ALLOWED_TYPES.includes(rawType)) {
      return `File '${file.name}' has invalid format. Only PNG, JPEG, and WebP are allowed.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File '${file.name}' exceeds the 4 MiB size limit (${(file.size / (1024 * 1024)).toFixed(2)} MiB).`;
    }
    return null;
  };

  const addFiles = (files: FileList | File[]) => {
    onError(null);
    const newPhotos: LocalPhoto[] = [];
    const createdObjectUrls: string[] = [];
    let validationErr: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const err = validateFile(file);
      if (err) {
        validationErr = err;
        break;
      }

      const objectUrl = URL.createObjectURL(file);
      createdObjectUrls.push(objectUrl);

      newPhotos.push({
        id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        file,
        previewUrl: objectUrl,
        name: file.name,
        size: file.size,
      });
    }

    if (validationErr) {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      onError(validationErr);
      return;
    }

    const total = photos.length + newPhotos.length;
    if (total > 8) {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      onError("Maximum 8 photos allowed. Please select between 3 and 8 photos.");
      return;
    }

    setPhotos((prev) => [...prev, ...newPhotos]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removePhoto = (id: string) => {
    onError(null);
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target && target.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const clearPhotos = () => {
    onError(null);
    photos.forEach((p) => {
      if (p.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(p.previewUrl);
      }
    });
    setPhotos([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUseSeededItem = async () => {
    try {
      onError(null);
      setIsSeeding(true);
      clearPhotos();

      const uploadedPathnames: string[] = [];

      for (const item of SEEDED_IMAGES) {
        const fetchRes = await fetch(item.path);
        if (!fetchRes.ok) {
          throw new Error(`Failed to fetch seeded image ${item.name}`);
        }
        const blob = await fetchRes.blob();

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "image/png",
          },
          body: blob,
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to upload ${item.name} to Vercel Blob`);
        }

        const data: { pathname: string; previewUrl: string } = await uploadRes.json();
        uploadedPathnames.push(data.pathname);
      }

      setIsSeeding(false);
      onStartAnalysis(uploadedPathnames);
    } catch (err: unknown) {
      setIsSeeding(false);
      const msg = err instanceof Error ? err.message : "Failed to load and upload seeded item";
      onError(msg);
    }
  };

  const handleStartAnalysis = async () => {
    if (photos.length < 3 || photos.length > 8) {
      onError("Please select between 3 and 8 photos before starting analysis.");
      return;
    }

    try {
      onError(null);
      const uploadedPathnames: string[] = [];

      for (const photo of photos) {
        if (photo.serverPathname) {
          uploadedPathnames.push(photo.serverPathname);
          continue;
        }

        if (!photo.file) {
          throw new Error(`Missing file object for ${photo.name}`);
        }

        const rawType = photo.file.type.toLowerCase().split(";")[0].trim() || "image/png";
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": rawType,
          },
          body: photo.file,
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}));
          throw new Error(errData.error || `Upload failed for ${photo.name}`);
        }

        const data: { pathname: string; previewUrl: string } = await uploadRes.json();
        uploadedPathnames.push(data.pathname);
      }

      onStartAnalysis(uploadedPathnames);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload images for analysis";
      onError(msg);
    }
  };

  const isBusy = isUploading || isSeeding;
  const canStart = photos.length >= 3 && photos.length <= 8 && !isBusy;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--hairline)] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--ink)]">
            Photo inspection intake
          </h2>
          <p className="text-sm text-[var(--ink-muted)] mt-0.5">
            Provide 3 to 8 clear photos of the item from multiple angles under indoor lighting.
          </p>
        </div>

        <button
          type="button"
          onClick={handleUseSeededItem}
          disabled={isBusy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono font-medium text-[var(--ink)] bg-[var(--paper-raised)] border border-[var(--hairline)] hover:border-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] disabled:opacity-50 cursor-pointer min-h-[44px]"
        >
          {isSeeding ? (
            <>
              <span className="w-3 h-3 border-2 border-[var(--ink)] border-t-transparent rounded-full animate-spin" />
              <span>Uploading seeded photos…</span>
            </>
          ) : (
            <span>✦ Use seeded Game Boy specimen</span>
          )}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3.5 rounded-[4px] bg-[oklch(0.98_0.02_28)] border border-[var(--status-error)] text-xs text-[var(--status-error)] font-mono flex items-center justify-between gap-2"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => onError(null)}
            className="text-[var(--status-error)] hover:opacity-75 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center cursor-pointer"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`paper-card p-8 text-center cursor-pointer transition-colors border-dashed min-h-[160px] flex flex-col items-center justify-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] ${
          isDragOver
            ? "border-[var(--strong-rule)] bg-[var(--paper-raised)]"
            : "border-[var(--hairline)] hover:border-[var(--strong-rule)]"
        }`}
        tabIndex={0}
        role="button"
        aria-label="Upload item photos drop target"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={isBusy}
        />
        <div className="w-10 h-10 rounded-full bg-[var(--paper-raised)] border border-[var(--hairline)] flex items-center justify-center text-[var(--ink)] font-mono text-sm">
          +
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">
            Drop item photos here or click to browse
          </p>
          <p className="text-xs text-[var(--ink-muted)] mt-1 font-mono">
            PNG, JPEG, or WebP • Max 4 MiB each • 3 to 8 photos required
          </p>
        </div>
      </div>

      {photos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-mono text-[var(--ink-muted)]">
            <span>
              Selected photos ({photos.length}/8)
              {photos.length < 3 && (
                <span className="text-[var(--status-warning)] ml-2">
                  (Need at least {3 - photos.length} more)
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={clearPhotos}
              className="text-[var(--status-error)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded px-2 min-h-[44px] inline-flex items-center cursor-pointer"
              disabled={isBusy}
            >
              Clear all
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {photos.map((photo, idx) => (
              <div
                key={photo.id}
                className="group relative paper-card p-1.5 flex flex-col gap-1.5"
              >
                <div className="relative aspect-square w-full bg-[var(--paper-raised)] rounded-[2px] overflow-hidden">
                  <Image
                    src={photo.previewUrl}
                    alt={`Item photograph ${idx + 1}: ${photo.name}`}
                    fill
                    sizes="(max-width: 640px) 50vw, 160px"
                    className="object-cover"
                    unoptimized
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-muted)] px-0.5 truncate">
                  <span className="truncate max-w-[80px]">{photo.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePhoto(photo.id);
                    }}
                    disabled={isBusy}
                    className="text-[var(--ink-muted)] hover:text-[var(--status-error)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] rounded min-w-[44px] min-h-[44px] inline-flex items-center justify-center cursor-pointer shrink-0"
                    aria-label={`Remove photo ${photo.name}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--hairline)]">
        <button
          type="button"
          onClick={handleStartAnalysis}
          disabled={!canStart}
          className="w-full sm:w-auto px-6 py-2.5 text-xs font-mono font-semibold text-[var(--paper)] bg-[var(--ink)] hover:bg-[var(--strong-rule)] rounded-[4px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--strong-rule)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[44px]"
        >
          {isBusy ? "Processing uploads…" : "Analyze item photos (Gemini 3.6 Flash) →"}
        </button>
      </div>
    </div>
  );
}
