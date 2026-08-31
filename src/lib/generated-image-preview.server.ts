import "@tanstack/react-start/server-only";

import type { ImagesBindingLike } from "../env";

export type GeneratedImagePreviewVariant = "canvas" | "large";

type GeneratedImage = {
  body: ReadableStream;
  contentType: string;
  size?: number;
};

const MAX_IMAGES_INPUT_BYTES = 20 * 1024 * 1024;

const PREVIEW_OPTIONS: Record<GeneratedImagePreviewVariant, { maxEdge: number; quality: number }> = {
  canvas: { maxEdge: 1600, quality: 85 },
  large: { maxEdge: 2048, quality: 88 },
};

export function isGeneratedImagePreviewVariant(value: string | null): value is GeneratedImagePreviewVariant {
  return value === "canvas" || value === "large";
}

export async function createGeneratedImagePreviewResponse(
  image: GeneratedImage,
  variant: GeneratedImagePreviewVariant,
  images?: ImagesBindingLike,
): Promise<Response> {
  if (!images) throw new Error("IMAGE_PREVIEW_UNAVAILABLE");
  if (image.size !== undefined && image.size > MAX_IMAGES_INPUT_BYTES) {
    throw new Error("IMAGE_PREVIEW_INPUT_TOO_LARGE");
  }

  const options = PREVIEW_OPTIONS[variant];
  const transformed = await images
    .input(image.body)
    .transform({ width: options.maxEdge, height: options.maxEdge, fit: "scale-down" })
    .output({ format: "image/webp", quality: options.quality, anim: false });
  const transformedResponse = transformed.response();
  if (!transformedResponse.ok || !transformedResponse.body) {
    throw new Error("IMAGE_PREVIEW_FAILED");
  }

  return new Response(transformedResponse.body, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
