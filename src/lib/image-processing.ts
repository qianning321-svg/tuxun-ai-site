/**
 * Image processing utilities for uploads.
 *
 * Two presets:
 *  - "ai-model"  : reference images sent to AI models. Always convert to JPEG,
 *                  max 1600px on longest side, target good quality (q ~0.85).
 *                  Transparency is flattened on white background.
 *  - "community" : user-published cases / admin templates. Preserve original
 *                  format when sensible (PNG keeps transparency, WEBP stays
 *                  WEBP, JPEG stays JPEG). Only resize/recompress if the file
 *                  is large (> 2MB) or huge (> 2560px).
 *
 * All work happens off the main JS path via `createImageBitmap` and async
 * canvas encoding, so the UI stays smooth on mobile.
 */

export type ProcessPreset = "ai-model" | "community";

export interface ProcessedImage {
  /** Processed binary, ready to upload. */
  blob: Blob;
  /** MIME type of `blob`. */
  contentType: string;
  /** File extension (no leading dot). */
  ext: string;
  /** Local object URL for instant preview. Caller must revoke when done. */
  previewUrl: string;
  /** Original vs processed byte size (for logging). */
  originalSize: number;
  processedSize: number;
}

const AI_MAX_DIM = 1600;
const AI_QUALITY = 0.85;

const COMMUNITY_MAX_DIM = 2560;
const COMMUNITY_SIZE_THRESHOLD = 2 * 1024 * 1024; // 2 MB
const COMMUNITY_QUALITY = 0.88;

const SUPPORTED_COMMUNITY_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/** Create instant object URL preview without touching pixels. */
export function makePreviewUrl(file: File | Blob): string {
  return URL.createObjectURL(file);
}

function extFromType(type: string): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
}

async function decode(file: File): Promise<ImageBitmap> {
  // createImageBitmap is async + off-thread; far smoother than <img> + drawImage on mobile.
  return await createImageBitmap(file);
}

function fitDimensions(w: number, h: number, maxDim: number) {
  if (w <= maxDim && h <= maxDim) return { w, h, resized: false };
  const scale = Math.min(maxDim / w, maxDim / h);
  return { w: Math.round(w * scale), h: Math.round(h * scale), resized: true };
}

async function canvasEncode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality: number,
  flattenBg: string | null,
): Promise<Blob> {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  if (flattenBg) {
    ctx.fillStyle = flattenBg;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  if (canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob({ type, quality });
  }
  return await new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encode failed"))),
      type,
      quality,
    ),
  );
}

/** Yield to the browser so React can repaint loading states. */
const nextFrame = () =>
  new Promise<void>((r) =>
    typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(() => r()) : setTimeout(r, 0),
  );

export async function processImage(file: File, preset: ProcessPreset): Promise<ProcessedImage> {
  const previewUrl = makePreviewUrl(file);
  const originalSize = file.size;

  await nextFrame(); // let the preview paint first

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    // Unable to decode (rare) → upload original.
    return {
      blob: file,
      contentType: file.type || "application/octet-stream",
      ext: (file.name.split(".").pop() || extFromType(file.type)).toLowerCase(),
      previewUrl,
      originalSize,
      processedSize: originalSize,
    };
  }

  try {
    if (preset === "ai-model") {
      const { w, h } = fitDimensions(bitmap.width, bitmap.height, AI_MAX_DIM);
      const blob = await canvasEncode(bitmap, w, h, "image/jpeg", AI_QUALITY, "#ffffff");
      return {
        blob,
        contentType: "image/jpeg",
        ext: "jpg",
        previewUrl,
        originalSize,
        processedSize: blob.size,
      };
    }

    // community
    const type = SUPPORTED_COMMUNITY_TYPES.has(file.type) ? file.type : "image/jpeg";
    const isPng = type === "image/png";
    const isWebp = type === "image/webp";
    const tooBig =
      file.size > COMMUNITY_SIZE_THRESHOLD ||
      bitmap.width > COMMUNITY_MAX_DIM ||
      bitmap.height > COMMUNITY_MAX_DIM;

    if (!tooBig) {
      // small enough → upload original bytes, preserving format & transparency.
      return {
        blob: file,
        contentType: type,
        ext: extFromType(type),
        previewUrl,
        originalSize,
        processedSize: originalSize,
      };
    }

    const { w, h } = fitDimensions(bitmap.width, bitmap.height, COMMUNITY_MAX_DIM);
    // PNG stays PNG (preserves alpha); WEBP stays WEBP (also alpha-capable).
    // Other types get re-encoded as JPEG.
    const outType = isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg";
    const flatten = outType === "image/jpeg" ? "#ffffff" : null;
    const blob = await canvasEncode(bitmap, w, h, outType, COMMUNITY_QUALITY, flatten);
    return {
      blob,
      contentType: outType,
      ext: extFromType(outType),
      previewUrl,
      originalSize,
      processedSize: blob.size,
    };
  } finally {
    bitmap.close?.();
  }
}

/** Common client-side validation for image uploads. */
export function validateImageFile(
  f: File,
  opts: { maxMB?: number; preset: ProcessPreset } = { preset: "community" },
): string | null {
  const maxMB = opts.maxMB ?? 15;
  if (!/^image\//i.test(f.type)) return "仅支持图片文件";
  if (opts.preset === "community" && !SUPPORTED_COMMUNITY_TYPES.has(f.type)) {
    return "社区上传仅支持 JPG / PNG / WEBP";
  }
  if (f.size > maxMB * 1024 * 1024) return `图片大小请小于 ${maxMB}MB`;
  return null;
}
