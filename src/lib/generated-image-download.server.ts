import "@tanstack/react-start/server-only";

import type { ImagesBindingLike } from "../env";

type GeneratedImage = {
  body: ReadableStream;
  contentType: string;
  size?: number;
};

const JPEG_CONTENT_TYPE = "image/jpeg";
const PNG_CONTENT_TYPE = "image/png";
const WEBP_CONTENT_TYPE = "image/webp";
const JPEG_QUALITY = 92;
const MAX_IMAGES_INPUT_BYTES = 20 * 1024 * 1024;

function normalizedContentType(contentType: string): string {
  return contentType.toLowerCase().split(";", 1)[0];
}

export async function createGeneratedImageDownloadResponse(
  image: GeneratedImage,
  taskId: string,
  images?: ImagesBindingLike,
): Promise<Response> {
  const sourceContentType = normalizedContentType(image.contentType);
  let body = image.body;
  let contentType = sourceContentType;
  let extension = sourceContentType === PNG_CONTENT_TYPE ? "png" : "jpg";

  if (sourceContentType === WEBP_CONTENT_TYPE) {
    if (!images) throw new Error("IMAGE_TRANSFORM_UNAVAILABLE");
    if (image.size !== undefined && image.size > MAX_IMAGES_INPUT_BYTES) {
      throw new Error("IMAGE_TRANSFORM_INPUT_TOO_LARGE");
    }
    const transformed = await images
      .input(image.body)
      // JPEG has no alpha channel. Explicitly flatten transparent PNG/WebP pixels to white.
      .transform({ background: "#ffffff" })
      .output({ format: JPEG_CONTENT_TYPE, quality: JPEG_QUALITY, anim: false });
    const transformedResponse = transformed.response();
    if (!transformedResponse.ok || !transformedResponse.body) {
      throw new Error("IMAGE_TRANSFORM_FAILED");
    }
    body = transformedResponse.body;
    contentType = JPEG_CONTENT_TYPE;
    extension = "jpg";
  } else if (sourceContentType !== JPEG_CONTENT_TYPE && sourceContentType !== PNG_CONTENT_TYPE) {
    throw new Error("UNSUPPORTED_IMAGE_TYPE");
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="mumo-${taskId}.${extension}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
