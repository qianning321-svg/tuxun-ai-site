import { describe, expect, test } from "bun:test";

import {
  REFERENCE_IMAGE_COMPRESSION_QUALITY,
  REFERENCE_IMAGE_COMPRESSION_THRESHOLD_BYTES,
  REFERENCE_IMAGE_MAX_LONG_EDGE,
  compressReferenceImage,
  createReferenceImageWorkQueue,
  type ReferenceImageCompressionAdapter,
} from "../src/lib/client-image-compression";

function fileOfSize(size: number, name: string, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

function adapter(
  width: number,
  height: number,
  outputBytes = 256,
  fail = false,
): ReferenceImageCompressionAdapter & { encodes: Array<Record<string, unknown>> } {
  const encodes: Array<Record<string, unknown>> = [];
  return {
    encodes,
    async decode() {
      if (fail) throw new Error("decode failed");
      return { source: {} as CanvasImageSource, width, height };
    },
    async encode(_image, outputWidth, outputHeight, mimeType, quality) {
      encodes.push({ outputWidth, outputHeight, mimeType, quality });
      return new Blob([new Uint8Array(outputBytes)], { type: mimeType });
    },
  };
}

describe("reference image browser compression", () => {
  test("small JPEG bypasses compression", async () => {
    const file = fileOfSize(1024, "small.jpg", "image/jpeg");
    const codec = adapter(1200, 800);
    const result = await compressReferenceImage(file, codec);
    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(codec.encodes).toHaveLength(0);
  });

  test("large landscape JPEG is resized to a 2048px long edge with its ratio intact", async () => {
    const file = fileOfSize(
      REFERENCE_IMAGE_COMPRESSION_THRESHOLD_BYTES + 1,
      "landscape.jpg",
      "image/jpeg",
    );
    const codec = adapter(4000, 2000);
    const result = await compressReferenceImage(file, codec);
    expect(result.compressed).toBe(true);
    expect([result.outputWidth, result.outputHeight]).toEqual([2048, 1024]);
    expect(codec.encodes[0]).toEqual({
      outputWidth: REFERENCE_IMAGE_MAX_LONG_EDGE,
      outputHeight: 1024,
      mimeType: "image/jpeg",
      quality: REFERENCE_IMAGE_COMPRESSION_QUALITY,
    });
  });

  test("large portrait JPEG keeps portrait orientation and aspect ratio", async () => {
    const file = fileOfSize(2048, "portrait.jpg", "image/jpeg");
    const result = await compressReferenceImage(file, adapter(2000, 4000));
    expect([result.outputWidth, result.outputHeight]).toEqual([1024, 2048]);
  });

  test("transparent-capable PNG remains PNG instead of receiving a JPEG matte", async () => {
    const file = fileOfSize(2048, "transparent.png", "image/png");
    const codec = adapter(4096, 4096);
    const result = await compressReferenceImage(file, codec);
    expect(result.file.type).toBe("image/png");
    expect(codec.encodes[0]?.mimeType).toBe("image/png");
  });

  test("WebP output remains a MIME type accepted by the upload backend", async () => {
    const file = fileOfSize(2048, "reference.webp", "image/webp");
    const result = await compressReferenceImage(file, adapter(4096, 2048));
    expect(["image/png", "image/jpeg", "image/webp"]).toContain(result.file.type);
    expect(result.file.type).toBe("image/webp");
  });

  test("decode or canvas failures fall back to the original File", async () => {
    const file = fileOfSize(2048, "broken.jpg", "image/jpeg");
    const result = await compressReferenceImage(file, adapter(4096, 2048, 100, true));
    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
  });

  test("work queue limits processing and upload work to three concurrent files", async () => {
    const run = createReferenceImageWorkQueue(3);
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tasks = Array.from({ length: 5 }, (_, index) =>
      run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return index;
      }),
    );
    await Promise.resolve();
    expect(peak).toBe(3);
    release();
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);
  });

  test("compression helper is scoped to reference uploads and not result images", async () => {
    const [controlPanel, canvas] = await Promise.all([
      Bun.file("src/components/studio/ControlPanel.tsx").text(),
      Bun.file("src/components/studio/Canvas.tsx").text(),
    ]);
    expect(controlPanel).toContain("compressReferenceImage(file)");
    const compressionIndex = controlPanel.indexOf("compressReferenceImage(file)");
    expect(compressionIndex).toBeGreaterThan(-1);
    expect(compressionIndex).toBeLessThan(
      controlPanel.indexOf('fetch("/api/uploads/input-image"', compressionIndex),
    );
    expect(canvas).not.toContain("compressReferenceImage");
  });
});
