import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import { generatedThumbnailKey } from "../../../src/lib/history-thumbnail-key";
import {
  createHistoryThumbnail,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_WEBP_QUALITY,
} from "../src/thumbnail";

async function fixture(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 220 } },
  }).png().toBuffer());
}

async function dimensions(input: Uint8Array) {
  const metadata = await sharp(input).metadata();
  return { width: metadata.width, height: metadata.height, format: metadata.format, hasAlpha: metadata.hasAlpha };
}

describe("history thumbnail processor", () => {
  test.each([
    ["landscape", 1200, 600, 512, 256],
    ["portrait", 600, 1200, 256, 512],
    ["square", 900, 900, 512, 512],
  ])("resizes %s inside a 512px box without cropping", async (_name, width, height, expectedWidth, expectedHeight) => {
    const output = await createHistoryThumbnail(await fixture(width as number, height as number));
    expect(await dimensions(output)).toMatchObject({
      width: expectedWidth,
      height: expectedHeight,
      format: "webp",
    });
    expect(output.byteLength).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
  });

  test("normalizes JPEG EXIF orientation before resizing", async () => {
    const oriented = await sharp({
      create: { width: 100, height: 200, channels: 3, background: { r: 200, g: 40, b: 80 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await createHistoryThumbnail(new Uint8Array(oriented));
    expect(await dimensions(output)).toMatchObject({ width: 200, height: 100, format: "webp" });
  });

  test("preserves alpha when converting a transparent PNG to WebP", async () => {
    const transparent = await sharp({
      create: { width: 64, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.25 } },
    }).png().toBuffer();
    const output = await createHistoryThumbnail(new Uint8Array(transparent));
    expect(await dimensions(output)).toMatchObject({ width: 64, height: 32, format: "webp", hasAlpha: true });
    expect(Array.from(output.slice(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  test("uses the configured immutable WebP contract and canonical key", () => {
    expect(THUMBNAIL_MAX_EDGE).toBe(512);
    expect(THUMBNAIL_WEBP_QUALITY).toBe(82);
    expect(generatedThumbnailKey("user-a", "task-a")).toBe("generated-thumbs/user-a/task-a/v1.webp");
  });
});
