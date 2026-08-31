import { expect, test } from "bun:test";

import {
  parseThumbnailBackfillArgs,
  runThumbnailBackfill,
  THUMBNAIL_BACKFILL_CONCURRENCY,
} from "../src/thumbnail-backfill";

const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("backfill defaults to dry-run and performs zero thumbnail writes", async () => {
  const methods: string[] = [];
  let processorCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const url = String(input);
    if (url.endsWith("thumbnail-backfill")) {
      return Response.json({
        items: [
          { taskId: "missing-thumb", hasThumbnail: false },
          { taskId: "existing-thumb", hasThumbnail: true },
        ],
        nextCursor: "next-page",
        hasMore: true,
        limit: 20,
      });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const summary = await runThumbnailBackfill("https://mumo.test", "service-token", {}, {
    fetchImpl,
    thumbnailProcessor: async () => { processorCalls += 1; return webp; },
  });
  expect(summary).toEqual({
    mode: "dry-run",
    eligible: 2,
    already_has_thumbnail: 1,
    missing_original: 0,
    would_generate: 1,
    generated: 0,
    errors: 0,
    nextCursor: "next-page",
  });
  expect(methods).toEqual(["POST", "HEAD"]);
  expect(processorCalls).toBe(0);
});

test("apply writes only missing thumbnails, reports missing originals, and reruns idempotently", async () => {
  let scanNumber = 0;
  let thumbnailWrites = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("thumbnail-backfill")) {
      scanNumber += 1;
      return Response.json({
        items: scanNumber === 1
          ? [{ taskId: "create-me", hasThumbnail: false }, { taskId: "missing-original", hasThumbnail: false }]
          : [{ taskId: "create-me", hasThumbnail: true }],
        nextCursor: null,
        hasMore: false,
        limit: 20,
      });
    }
    if (url.endsWith("missing-original")) return new Response(null, { status: 404 });
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    if (init?.method === "GET") return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    if (init?.method === "POST") { thumbnailWrites += 1; return Response.json({ ok: true }); }
    return new Response(null, { status: 500 });
  }) as typeof fetch;

  const first = await runThumbnailBackfill("https://mumo.test", "service-token", { apply: true, limit: 20 }, {
    fetchImpl,
    thumbnailProcessor: async () => webp,
  });
  expect(first).toMatchObject({ eligible: 2, generated: 1, missing_original: 1, errors: 0 });
  expect(thumbnailWrites).toBe(1);

  const second = await runThumbnailBackfill("https://mumo.test", "service-token", { apply: true, limit: 20 }, { fetchImpl });
  expect(second).toMatchObject({ eligible: 1, already_has_thumbnail: 1, generated: 0 });
  expect(thumbnailWrites).toBe(1);
});

test("backfill requires explicit apply, bounded limit, cursor, and concurrency two", () => {
  expect(parseThumbnailBackfillArgs([])).toEqual({ apply: false, limit: 20, cursor: null });
  expect(parseThumbnailBackfillArgs(["--apply", "--limit", "20", "--cursor=next"])).toEqual({ apply: true, limit: 20, cursor: "next" });
  expect(() => parseThumbnailBackfillArgs(["--limit", "51"])).toThrow();
  expect(THUMBNAIL_BACKFILL_CONCURRENCY).toBe(2);
});
