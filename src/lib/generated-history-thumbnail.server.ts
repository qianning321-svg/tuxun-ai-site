import "@tanstack/react-start/server-only";

import type { ImagesBindingLike } from "../env";

type GeneratedImage = {
  body: ReadableStream;
  size?: number;
};

const MAX_IMAGES_INPUT_BYTES = 20 * 1024 * 1024;
const THUMBNAIL_MAX_EDGE = 512;
const THUMBNAIL_QUALITY = 82;

export async function createGeneratedHistoryThumbnailResponse(
  image: GeneratedImage,
  images?: ImagesBindingLike,
): Promise<Response> {
  if (!images) throw new Error("HISTORY_THUMBNAIL_TRANSFORM_UNAVAILABLE");
  if (image.size !== undefined && image.size > MAX_IMAGES_INPUT_BYTES) {
    throw new Error("HISTORY_THUMBNAIL_TRANSFORM_INPUT_TOO_LARGE");
  }

  const transformed = await images
    .input(image.body)
    .transform({ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE, fit: "scale-down" })
    .output({ format: "image/webp", quality: THUMBNAIL_QUALITY, anim: false });
  const transformedResponse = transformed.response();
  if (!transformedResponse.ok || !transformedResponse.body) {
    throw new Error("HISTORY_THUMBNAIL_TRANSFORM_FAILED");
  }

  return new Response(transformedResponse.body, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
