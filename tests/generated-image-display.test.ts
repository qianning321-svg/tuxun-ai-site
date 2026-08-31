import { expect, test } from "bun:test";

import type { ImagesBindingLike } from "../src/env";
import { getGeneratedImageInlineForUser, GenerationPipelineError } from "../src/lib/generation.server";
import {
  createGeneratedImagePreviewResponse,
  type GeneratedImagePreviewVariant,
} from "../src/lib/generated-image-preview.server";
import { generatedImageUrl } from "../src/lib/image-url";

const routeSource = await Bun.file("src/routes/api/generated-image.ts").text();
const canvasSource = await Bun.file("src/components/studio/Canvas.tsx").text();
const studioSource = await Bun.file("src/components/studio/Studio.tsx").text();
const imageUrlSource = await Bun.file("src/lib/image-url.ts").text();

test("generated image display endpoint is task scoped and inline", () => {
  expect(routeSource).toContain('searchParams.get("taskId")');
  expect(routeSource).toContain('searchParams.get("variant")');
  expect(routeSource).toContain('variant !== "canvas" && variant !== "large"');
  expect(routeSource).toContain("requireAuth(request)");
  expect(routeSource).toContain("getGeneratedImageInlineForUser(session.user.id, taskId)");
  expect(routeSource).toContain('"Content-Disposition": "inline"');
  expect(routeSource).toContain('"Cache-Control": "private, no-store"');
  expect(routeSource).not.toContain("result_image_url");
  expect(routeSource).not.toContain("r2Key");
  expect(routeSource).not.toContain("supplierUrl");
});

test("Canvas, lightboxes, and Studio use canonical preview variants", () => {
  expect(imageUrlSource).toContain("new URLSearchParams({ taskId })");
  expect(generatedImageUrl("task 1", "canvas")).toBe("/api/generated-image?taskId=task+1&variant=canvas");
  expect(studioSource).toContain('setGeneratedUrl(generatedImageUrl(task.taskId, "canvas"))');
  expect(canvasSource).toContain('previewImageUrl(generatedTaskId, "canvas")');
  expect(canvasSource).toContain('previewImageUrl(lightbox.generationTaskId, "large")');
  expect(canvasSource).toContain('previewImageUrl(generatedTaskId, "large")');
  expect(canvasSource).toContain("retryResultImage");
  expect(canvasSource).toContain("attempt >= 3");
});

test("display endpoint keeps archive-pending separate from generation failure", () => {
  expect(routeSource).toContain('code === "RESULT_NOT_READY"');
  expect(routeSource).toContain("status: 425");
  expect(routeSource).toContain('"Retry-After": "2"');
});

test("inline display preserves archived R2 MIME without transforming the original", async () => {
  for (const contentType of ["image/jpeg", "image/png", "image/webp"]) {
    const first = async () => ({ status: "succeeded", result_image_r2_key: "generated/user/task.original" });
    const db = {
      prepare() {
        return { bind() { return this; }, first };
      },
    } as any;
    const body = new ReadableStream<Uint8Array>();
    const bucket = {
      get: async () => ({ body, size: 3, httpMetadata: { contentType } }),
    } as any;
    const result = await getGeneratedImageInlineForUser("user-1", "task-1", { db, bucket });
    expect(result.contentType).toBe(contentType);
    expect(result.size).toBe(3);
  }
});

test("inline display rejects non-owned and archive-pending tasks without R2 access", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        first: async () => ({ status: "succeeded", result_image_r2_key: null }),
      };
    },
  } as any;
  const bucket = { get: async () => { throw new Error("R2 must not be read"); } } as any;
  await expect(getGeneratedImageInlineForUser("user-1", "task-pending", { db, bucket })).rejects.toMatchObject({
    code: "RESULT_NOT_READY",
  } satisfies Partial<GenerationPipelineError>);
});

function stream(bytes: number[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function previewTransformer() {
  const transforms: Array<{ width?: number; height?: number; fit?: string }> = [];
  const outputs: Array<{ format: string; quality: number; anim: boolean }> = [];
  let source: ReadableStream | undefined;
  const images: ImagesBindingLike = {
    input(input) {
      source = input;
      return {
        transform(options) {
          transforms.push(options);
          return {
            output(options) {
              outputs.push(options);
              return Promise.resolve({ response: () => new Response(stream([0x52, 0x49, 0x46, 0x46]), { status: 200 }) });
            },
          };
        },
      };
    },
  };
  return { images, transforms, outputs, source: () => source };
}

test("private originals become bounded WebP previews without crop for every source MIME", async () => {
  const variants: Array<[GeneratedImagePreviewVariant, number, number]> = [
    ["canvas", 1600, 85],
    ["large", 2048, 88],
  ];
  for (const sourceMime of ["image/jpeg", "image/png", "image/webp"]) {
    for (const [variant, maxEdge, quality] of variants) {
      const transformer = previewTransformer();
      const original = stream([1, 2, 3]);
      const response = await createGeneratedImagePreviewResponse(
        { body: original, contentType: sourceMime, size: 3 },
        variant,
        transformer.images,
      );
      expect(transformer.source()).toBe(original);
      expect(transformer.transforms).toEqual([{ width: maxEdge, height: maxEdge, fit: "scale-down" }]);
      expect(transformer.outputs).toEqual([{ format: "image/webp", quality, anim: false }]);
      expect(response.headers.get("Content-Type")).toBe("image/webp");
      expect(response.headers.get("Content-Disposition")).toBe("inline");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
    }
  }
});

test("preview rejects unavailable or oversized transforms without exposing an original", async () => {
  await expect(
    createGeneratedImagePreviewResponse({ body: stream([1]), contentType: "image/png" }, "canvas"),
  ).rejects.toThrow("IMAGE_PREVIEW_UNAVAILABLE");
  const transformer = previewTransformer();
  await expect(
    createGeneratedImagePreviewResponse(
      { body: stream([1]), contentType: "image/png", size: 20 * 1024 * 1024 + 1 },
      "canvas",
      transformer.images,
    ),
  ).rejects.toThrow("IMAGE_PREVIEW_INPUT_TOO_LARGE");
  expect(transformer.source()).toBeUndefined();
});
