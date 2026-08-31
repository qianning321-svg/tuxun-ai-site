export const REFERENCE_IMAGE_COMPRESSION_THRESHOLD_BYTES = Math.floor(1.5 * 1024 * 1024);
export const REFERENCE_IMAGE_MAX_LONG_EDGE = 2048;
export const REFERENCE_IMAGE_COMPRESSION_QUALITY = 0.88;
export const REFERENCE_IMAGE_WORK_CONCURRENCY = 3;
export const AVATAR_IMAGE_MAX_LONG_EDGE = 512;
export const AVATAR_IMAGE_COMPRESSION_QUALITY = 0.88;

type SupportedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type DecodedReferenceImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

export type ReferenceImageCompressionAdapter = {
  decode: (file: File) => Promise<DecodedReferenceImage>;
  encode: (
    image: DecodedReferenceImage,
    width: number,
    height: number,
    mimeType: SupportedImageMimeType,
    quality: number,
  ) => Promise<Blob | null>;
};

export type ReferenceImageCompressionResult = {
  file: File;
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
  originalWidth: number | null;
  originalHeight: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
};

export function calculateReferenceImageDimensions(
  width: number,
  height: number,
  maxLongEdge = REFERENCE_IMAGE_MAX_LONG_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function createBrowserAdapter(): ReferenceImageCompressionAdapter {
  return {
    async decode(file) {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    },
    encode(image, width, height, mimeType, quality) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return Promise.resolve(null);
      context.drawImage(image.source, 0, 0, width, height);
      return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
    },
  };
}

function originalResult(
  file: File,
  width: number | null = null,
  height: number | null = null,
): ReferenceImageCompressionResult {
  return {
    file,
    compressed: false,
    originalBytes: file.size,
    outputBytes: file.size,
    originalWidth: width,
    originalHeight: height,
    outputWidth: width,
    outputHeight: height,
  };
}

export async function compressReferenceImage(
  file: File,
  adapter: ReferenceImageCompressionAdapter = createBrowserAdapter(),
): Promise<ReferenceImageCompressionResult> {
  if (!isSupportedImageMimeType(file.type)) return originalResult(file);

  let decoded: DecodedReferenceImage | null = null;
  try {
    decoded = await adapter.decode(file);
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
      return originalResult(file);
    }

    const dimensions = calculateReferenceImageDimensions(decoded.width, decoded.height);
    const needsResize =
      dimensions.width !== decoded.width || dimensions.height !== decoded.height;
    const needsCompression =
      needsResize || file.size > REFERENCE_IMAGE_COMPRESSION_THRESHOLD_BYTES;
    if (!needsCompression) return originalResult(file, decoded.width, decoded.height);

    // PNG stays PNG so transparent reference images never receive an opaque matte.
    const blob = await adapter.encode(
      decoded,
      dimensions.width,
      dimensions.height,
      file.type,
      REFERENCE_IMAGE_COMPRESSION_QUALITY,
    );
    if (!blob || blob.size === 0 || blob.type !== file.type) {
      return originalResult(file, decoded.width, decoded.height);
    }

    if (!needsResize && blob.size >= file.size) {
      return originalResult(file, decoded.width, decoded.height);
    }

    const output = new File([blob], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
    return {
      file: output,
      compressed: true,
      originalBytes: file.size,
      outputBytes: output.size,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      outputWidth: dimensions.width,
      outputHeight: dimensions.height,
    };
  } catch {
    return originalResult(file, decoded?.width ?? null, decoded?.height ?? null);
  } finally {
    decoded?.close?.();
  }
}

/** Avatar uploads intentionally use separate dimensions from reference images. */
export async function compressAvatarImage(
  file: File,
  adapter: ReferenceImageCompressionAdapter = createBrowserAdapter(),
): Promise<ReferenceImageCompressionResult> {
  if (!isSupportedImageMimeType(file.type)) return originalResult(file);
  let decoded: DecodedReferenceImage | null = null;
  try {
    decoded = await adapter.decode(file);
    if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) return originalResult(file);
    const dimensions = calculateReferenceImageDimensions(decoded.width, decoded.height, AVATAR_IMAGE_MAX_LONG_EDGE);
    if (dimensions.width === decoded.width && dimensions.height === decoded.height) return originalResult(file, decoded.width, decoded.height);
    // Preserve PNG output to keep transparent avatars transparent.
    const blob = await adapter.encode(decoded, dimensions.width, dimensions.height, file.type, AVATAR_IMAGE_COMPRESSION_QUALITY);
    if (!blob || blob.size === 0 || blob.type !== file.type) return originalResult(file, decoded.width, decoded.height);
    const output = new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
    return { file: output, compressed: true, originalBytes: file.size, outputBytes: output.size, originalWidth: decoded.width, originalHeight: decoded.height, outputWidth: dimensions.width, outputHeight: dimensions.height };
  } catch {
    return originalResult(file, decoded?.width ?? null, decoded?.height ?? null);
  } finally { decoded?.close?.(); }
}

type QueuedWork = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export function createReferenceImageWorkQueue(
  concurrency = REFERENCE_IMAGE_WORK_CONCURRENCY,
): <T>(work: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(concurrency));
  const queue: QueuedWork[] = [];
  let active = 0;

  const drain = () => {
    while (active < limit && queue.length > 0) {
      const item = queue.shift()!;
      active += 1;
      void item
        .run()
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  return <T>(work: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push({
        run: work,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      drain();
    });
}
