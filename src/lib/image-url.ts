export type CompressOpts = {
  /** Reserved for future CDN/R2 image optimization support. */
  quality?: number;
  /** Reserved for future thumbnail sizing support. */
  maxDim?: number;
};

/**
 * Return a display-safe image URL.
 *
 * Mumo uses Cloudflare R2 for generated images. At this stage there is no
 * dedicated image transformation endpoint, so this helper intentionally keeps
 * the original URL unchanged.
 */
export function thumbUrl(url: string | null | undefined, _opts: CompressOpts = {}): string {
  if (!url) return "";
  return url;
}

/**
 * Return a history-list thumbnail URL.
 *
 * This currently returns the original image URL. Future R2/CDN thumbnail
 * optimization can be added here without changing callers.
 */
export function historyThumbUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url;
}

export function generatedImageDownloadUrl(taskId: string): string {
  return `/api/download-image?taskId=${encodeURIComponent(taskId)}`;
}

export function generatedImageUrl(taskId: string, variant?: "canvas" | "large"): string {
  const params = new URLSearchParams({ taskId });
  if (variant) params.set("variant", variant);
  return `/api/generated-image?${params.toString()}`;
}

export function generatedImageDownloadFilename(contentType: string): string {
  return contentType.toLowerCase().split(";", 1)[0] === "image/png"
    ? "mumo-generated-image.png"
    : "mumo-generated-image.jpg";
}

/**
 * Preload a batch of image URLs into the browser cache during idle time,
 * before they enter the viewport.
 */
const preloadedSet = new Set<string>();

export function preloadImages(urls: Array<string | null | undefined>) {
  if (typeof document === "undefined") return;

  const fresh = urls.filter((u): u is string => !!u && !preloadedSet.has(u));
  if (fresh.length === 0) return;

  const schedule =
    (typeof window !== "undefined" && (window as any).requestIdleCallback) ||
    ((cb: () => void) => setTimeout(cb, 200));

  schedule(() => {
    for (const url of fresh) {
      if (preloadedSet.has(url)) continue;

      preloadedSet.add(url);

      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = url;
      (link as any).fetchPriority = "low";
      document.head.appendChild(link);
    }
  });
}
