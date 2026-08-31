import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import type { ImagesBindingLike } from "../src/env";
import { createGeneratedImageDownloadResponse } from "../src/lib/generated-image-download.server";

function stream(bytes: number[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function transformer(output = [0xff, 0xd8, 0xff, 0xd9]) {
  const calls: Array<{ background?: string; format?: string; quality?: number; anim?: boolean }> = [];
  let inputSource: ReadableStream | undefined;
  let sourceWasLockedAtInput: boolean | undefined;
  const images: ImagesBindingLike = {
    input(source) {
      inputSource = source;
      sourceWasLockedAtInput = source.locked;
      return {
        transform(options) {
          calls.push(options);
          return {
            output(options) {
              calls.push(options);
              return Promise.resolve({ response: () => new Response(stream(output), { status: 200 }) });
            },
          };
        },
      };
    },
  };
  return {
    images,
    calls,
    inputSource: () => inputSource,
    sourceWasLockedAtInput: () => sourceWasLockedAtInput,
  };
}

describe("generated image downloads", () => {
  test("WebP originals are converted to JPEG with a white transparent-pixel background", async () => {
    const { images, calls, inputSource, sourceWasLockedAtInput } = transformer();
    const originalBody = stream([0x52, 0x49, 0x46, 0x46]);
    const response = await createGeneratedImageDownloadResponse(
      { body: originalBody, contentType: "image/webp" },
      "task-123",
      images,
    );

    expect(inputSource()).toBe(originalBody);
    expect(sourceWasLockedAtInput()).toBe(false);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="mumo-task-123.jpg"');
    expect(calls).toEqual([
      { background: "#ffffff" },
      { format: "image/jpeg", quality: 92, anim: false },
    ]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  test("PNG originals pass through byte-for-byte and retain their filename and MIME", async () => {
    const original = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
    const { images, calls } = transformer();
    const response = await createGeneratedImageDownloadResponse(
      { body: stream(original), contentType: "image/png" },
      "transparent-png",
      images,
    );

    expect(calls).toEqual([]);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="mumo-transparent-png.png"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(original));
  });

  test("JPEG originals pass through without another encode", async () => {
    const { images, calls } = transformer();
    const response = await createGeneratedImageDownloadResponse(
      { body: stream([0xff, 0xd8, 0xff, 0xd9]), contentType: "image/jpeg; charset=binary" },
      "jpeg-task",
      images,
    );

    expect(calls).toEqual([]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  test("missing image transformer fails instead of leaking the original", async () => {
    await expect(
      createGeneratedImageDownloadResponse({ body: stream([1]), contentType: "image/webp" }, "task-123"),
    ).rejects.toThrow("IMAGE_TRANSFORM_UNAVAILABLE");
  });

  test("WebP downloads preserve original 1024 by 768 dimensions without resize parameters", async () => {
    const sourceBytes = await sharp({
      create: { width: 1024, height: 768, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
    }).webp().toBuffer();
    const transforms: Array<{ background?: string; width?: number; height?: number; fit?: string }> = [];
    const images: ImagesBindingLike = {
      input(source) {
        return {
          transform(options) {
            transforms.push(options);
            return {
              output(options) {
                return (async () => {
                  const original = await new Response(source).arrayBuffer();
                  const jpeg = await sharp(Buffer.from(original)).jpeg({ quality: options.quality }).toBuffer();
                  return { response: () => new Response(jpeg, { status: 200 }) };
                })();
              },
            };
          },
        };
      },
    };

    const response = await createGeneratedImageDownloadResponse(
      { body: stream([...sourceBytes]), contentType: "image/webp", size: sourceBytes.byteLength },
      "dimensions",
      images,
    );
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();

    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(768);
    expect(transforms).toEqual([{ background: "#ffffff" }]);
  });

  test("WebP transform failures reject without returning mislabeled source bytes", async () => {
    const images: ImagesBindingLike = {
      input() {
        return {
          transform() {
            return {
              output() {
                return Promise.reject(new Error("binding unavailable"));
              },
            };
          },
        };
      },
    };

    await expect(
      createGeneratedImageDownloadResponse(
        { body: stream([0x52, 0x49, 0x46, 0x46]), contentType: "image/webp" },
        "task-123",
        images,
      ),
    ).rejects.toThrow("binding unavailable");
  });

  test("oversized WebP is rejected before the Images binding receives the source", async () => {
    const { images, inputSource } = transformer();

    await expect(
      createGeneratedImageDownloadResponse(
        {
          body: stream([0x52, 0x49, 0x46, 0x46]),
          contentType: "image/webp",
          size: 20 * 1024 * 1024 + 1,
        },
        "too-large",
        images,
      ),
    ).rejects.toThrow("IMAGE_TRANSFORM_INPUT_TOO_LARGE");
    expect(inputSource()).toBeUndefined();
  });

  test("Canvas and history download only the canonical taskId endpoint", async () => {
    const [canvas, history] = await Promise.all([
      Bun.file("src/components/studio/Canvas.tsx").text(),
      Bun.file("src/components/studio/HistoryPanel.tsx").text(),
    ]);
    expect(canvas).toContain("a.href = generatedImageDownloadUrl(taskId)");
    expect(canvas).toContain('a.download = ""');
    expect(canvas).not.toContain("window.open(url");
    expect(history).toContain("generatedImageDownloadUrl(item.generationTaskId)");
    expect(history).not.toContain("thumbnailUrl)} download");
  });

  test("download route retains task ownership and rejects arbitrary sources", async () => {
    const route = await Bun.file("src/routes/api/download-image.ts").text();
    expect(route).toContain("requireAuth(request)");
    expect(route).toContain("getGeneratedImageForUser(session.user.id, taskId)");
    expect(route).toContain("return await createGeneratedImageDownloadResponse(");
    expect(route).toContain('event: "download_image_transform_failed"');
    expect(route).not.toContain("searchParams.get(\"url\")");
    expect(route).not.toContain("searchParams.get(\"imageUrl\")");
    expect(route).not.toContain("result_image_r2_key");
    const downloadHelper = await Bun.file("src/lib/generated-image-download.server.ts").text();
    expect(downloadHelper).not.toContain("width:");
    expect(downloadHelper).not.toContain("height:");
    expect(downloadHelper).not.toContain("fit:");
    expect(downloadHelper).not.toContain("generated-image-preview");
  });
});
