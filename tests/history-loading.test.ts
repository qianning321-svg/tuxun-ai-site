import { expect, test } from "bun:test";
import {
  HISTORY_PAGE_SIZE,
  HISTORY_THUMBNAIL_PRELOAD_CONCURRENCY,
  mergeHistoryPages,
  shouldPreloadHistory,
} from "../src/components/studio/history-cache";
import type { ImagesBindingLike } from "../src/env";
import {
  authorizeGeneratedThumbnailForUser,
  getGeneratedThumbnailObject,
} from "../src/lib/generation.server";
import { createGeneratedHistoryThumbnailResponse } from "../src/lib/generated-history-thumbnail.server";
import { historyThumbnailsEnabled } from "../src/lib/history-thumbnails-feature";

const [cacheSource, panelSource, thumbnailRouteSource, historyRouteSource, studioSource, rootSource, featureRouteSource, ingestRouteSource, railwaySource, backfillSource] = await Promise.all([
  Bun.file("src/components/studio/history-cache.tsx").text(),
  Bun.file("src/components/studio/HistoryPanel.tsx").text(),
  Bun.file("src/routes/api/history/thumbnail.ts").text(),
  Bun.file("src/routes/api/history/index.ts").text(),
  Bun.file("src/components/studio/Studio.tsx").text(),
  Bun.file("src/routes/__root.tsx").text(),
  Bun.file("src/routes/api/config/history-thumbnails.ts").text(),
  Bun.file("src/routes/api/provider-result-archive/$jobId/thumbnail.ts").text(),
  Bun.file("services/provider-result-archiver/src/archiver.ts").text(),
  Bun.file("services/provider-result-archiver/src/thumbnail-backfill.ts").text(),
]);

test("history thumbnail feature flag is server-controlled and fails closed", () => {
  expect(historyThumbnailsEnabled(undefined)).toBe(false);
  expect(historyThumbnailsEnabled({})).toBe(false);
  expect(historyThumbnailsEnabled({ MUMO_ENABLE_HISTORY_THUMBNAILS: "false" })).toBe(false);
  expect(historyThumbnailsEnabled({ MUMO_ENABLE_HISTORY_THUMBNAILS: "TRUE" })).toBe(false);
  expect(historyThumbnailsEnabled({ MUMO_ENABLE_HISTORY_THUMBNAILS: "true" })).toBe(true);
  expect(featureRouteSource).toContain("getHistoryThumbnailsEnabled()");
  expect(featureRouteSource).toContain('"Cache-Control": "private, no-store"');
  expect(cacheSource).not.toContain("localStorage");
  expect(cacheSource).not.toContain("searchParams");
});

test("disabled mode keeps original history images and suppresses automatic thumbnail work", () => {
  expect(cacheSource).toContain("if (thumbnailsEnabled && currentUserId)");
  expect(cacheSource).toContain("if (!thumbnailsEnabledRef.current) return");
  expect(panelSource).toContain("thumbnailsEnabled ? item.thumbnailUrl : item.originalImageUrl");
});

test("feature flag does not gate thumbnail backend, Railway, or backfill capabilities", () => {
  for (const source of [thumbnailRouteSource, ingestRouteSource, railwaySource, backfillSource]) {
    expect(source).not.toContain("MUMO_ENABLE_HISTORY_THUMBNAILS");
  }
});

test("login preload is fixed at 20 and same-user profile refresh does not refetch", () => {
  expect(HISTORY_PAGE_SIZE).toBe(20);
  expect(shouldPreloadHistory("user-a", null, "idle")).toBe(true);
  expect(shouldPreloadHistory("user-a", "user-a", "loading")).toBe(false);
  expect(shouldPreloadHistory("user-a", "user-a", "ready")).toBe(false);
  expect(shouldPreloadHistory("user-a", "user-a", "error")).toBe(true);
  expect(shouldPreloadHistory("user-b", "user-a", "ready")).toBe(true);
  expect(rootSource).toContain("<HistoryProvider>");
  expect(cacheSource).toContain("if (thumbnailsEnabled && currentUserId)");
  expect(cacheSource).toContain("void loadFirstPage(currentUserId, false)");
  expect(cacheSource).toContain("preloadPageThumbnails(current.items)");
  expect(cacheSource).toContain("abortPending()");
  expect(cacheSource).not.toContain("profile?.id");
});

test("first-page retry, append deduplication, and account isolation are explicit", () => {
  const first = Array.from({ length: 20 }, (_, index) => ({
    id: `history-${index}`,
    generationTaskId: `task-${index}`,
  })) as any[];
  const next = [
    first[19],
    ...Array.from({ length: 19 }, (_, index) => ({ id: `next-${index}`, generationTaskId: `next-task-${index}` })),
  ] as any[];
  expect(mergeHistoryPages(first, next)).toHaveLength(39);
  expect(cacheSource).toContain('current.status === "idle" || current.status === "error"');
  expect(cacheSource).toContain("stateRef.current = { ...EMPTY_STATE, userId: currentUserId }");
  expect(cacheSource).toContain("requestedCursorsRef.current.has(cursor)");
});

test("thumbnail preload is idle, capped at three, and never targets originals", () => {
  expect(HISTORY_THUMBNAIL_PRELOAD_CONCURRENCY).toBe(3);
  expect(cacheSource).toContain("requestIdleCallback");
  expect(cacheSource).toContain("item.thumbnailUrl");
  expect(cacheSource).not.toContain("item.originalImageUrl");
  expect(panelSource).toContain("loading=\"lazy\"");
  expect(panelSource).toContain("decoding=\"async\"");
  expect(panelSource).toContain('rootMargin: "400px 0px"');
  expect(panelSource).toContain("new IntersectionObserver");
});

test("enabled history cards use thumbnails while view uses a large preview and download uses the original", () => {
  expect(panelSource).toContain("thumbnailsEnabled ? item.thumbnailUrl : item.originalImageUrl");
  expect(panelSource).toContain("src={imageSrc}");
  expect(panelSource).toContain('generatedImageUrl(item.generationTaskId, "large")');
  expect(panelSource).toContain("generatedImageDownloadUrl(item.generationTaskId)");
  expect(studioSource).toContain("onReuse={handleReuseHistory}");
  expect(studioSource).not.toContain("handleReuseHistory(item.originalImageUrl");
});

test("thumbnail route authenticates and authorizes before every edge-cache lookup", () => {
  const authIndex = thumbnailRouteSource.indexOf("await requireAuth(request)");
  const ownershipIndex = thumbnailRouteSource.indexOf("await authorizeGeneratedThumbnailForUser");
  const cacheIndex = thumbnailRouteSource.indexOf("edgeCache?.match");
  expect(authIndex).toBeGreaterThan(-1);
  expect(ownershipIndex).toBeGreaterThan(authIndex);
  expect(cacheIndex).toBeGreaterThan(ownershipIndex);
  expect(thumbnailRouteSource).not.toContain('searchParams.get("key")');
  expect(thumbnailRouteSource).not.toContain('searchParams.get("url")');
  expect(thumbnailRouteSource).toContain('"Cache-Control", "private, no-store"');
  expect(thumbnailRouteSource).toContain("30 * 24 * 60 * 60");
  expect(historyRouteSource).toContain('searchParams.get("cursor")');
  expect(thumbnailRouteSource).toContain("status: 425");
  expect(thumbnailRouteSource).toContain('"Retry-After": "2"');
});

function stream(bytes: number[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

test("stored thumbnail is returned directly when it exists", async () => {
  const result = await getGeneratedThumbnailObject("generated-thumbs/user/task/v1.webp", {
    bucket: {
      get: async (key: string) => key === "generated-thumbs/user/task/v1.webp"
        ? { body: stream([1, 2, 3]), size: 3, httpMetadata: { contentType: "image/webp" } }
        : null,
    },
  });
  expect(result.contentType).toBe("image/webp");
  expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test("missing stored thumbnail falls back to a bounded 512px WebP, never a canvas preview", async () => {
  const transforms: Array<{ width?: number; height?: number; fit?: string }> = [];
  const outputs: Array<{ format: string; quality: number; anim: boolean }> = [];
  const images: ImagesBindingLike = {
    input() {
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
  const response = await createGeneratedHistoryThumbnailResponse({ body: stream([1, 2, 3]), size: 3 }, images);
  expect(transforms).toEqual([{ width: 512, height: 512, fit: "scale-down" }]);
  expect(outputs).toEqual([{ format: "image/webp", quality: 82, anim: false }]);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(thumbnailRouteSource).toContain("getGeneratedThumbnailObject(thumbnailKey)");
  expect(thumbnailRouteSource).toContain("createGeneratedHistoryThumbnailResponse(");
  expect(thumbnailRouteSource).not.toContain('variant: "canvas"');
});

test("thumbnail authorization blocks cross-user tasks before any R2 read", async () => {
  const db = {
    prepare() {
      return { bind() { return this; }, first: async () => null };
    },
  } as any;
  await expect(authorizeGeneratedThumbnailForUser("user-a", "other-task", { db })).rejects.toMatchObject({
    code: "THUMBNAIL_NOT_FOUND",
  });
});

test("a succeeded task without an archived original returns a retryable thumbnail state", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        first: async () => ({ result_image_r2_key: null, archive_status: "pending" }),
      };
    },
  } as any;
  await expect(authorizeGeneratedThumbnailForUser("user-a", "pending-task", { db })).resolves.toMatchObject({
    displayReady: false,
    archiveStatus: "pending",
  });
  expect(thumbnailRouteSource).toContain("if (!displayReady)");
});

test("a missing thumbnail only marks its own card unavailable", () => {
  const thumbnailSource = panelSource.split("function Thumbnail")[1]?.split("function HistoryLightbox")[0] ?? "";
  expect(panelSource).toContain("const [failed, setFailed] = useState(false)");
  expect(panelSource).toContain("const retryThumbnail = () =>");
  expect(panelSource).toContain("onError={retryThumbnail}");
  expect(panelSource).toContain("[1000, 2000, 3000, ...Array(17).fill(5000)]");
  expect(panelSource).toContain("if (retryTimerRef.current) clearTimeout(retryTimerRef.current)");
  expect(thumbnailSource).not.toContain("history.");
});

test("Studio waits for display readiness before setting the canonical Canvas preview", () => {
  expect(studioSource).toContain("const waitingForDisplay = task.status === \"succeeded\" && !displayReady;");
  expect(studioSource).toContain("const displayWaitExpired = waitingForDisplay");
  expect(studioSource).toContain("90_000");
  expect(studioSource).toContain('message: "正在准备结果，请稍候..."');
  expect(studioSource).toContain("task.resultImageUrl && displayReady && isCurrentTask");
  expect(studioSource).toContain('setGeneratedUrl(generatedImageUrl(task.taskId, "canvas"))');
  expect(studioSource).toContain("displayWaitStartedAtRef.current.clear()");
  expect(studioSource).not.toContain('provider === "wuyinkeji"');
});

test("History lightbox is a nested body portal above the Sheet and closes independently", () => {
  expect(panelSource).toContain('import * as DialogPrimitive from "@radix-ui/react-dialog"');
  expect(panelSource).toContain("<DialogPrimitive.Portal>");
  expect(panelSource).toContain("data-history-lightbox-backdrop");
  expect(panelSource).toContain('className="fixed inset-0 z-[1000] bg-black/90"');
  expect(panelSource).toContain("data-history-lightbox-root");
  expect(panelSource).toContain('className="fixed inset-0 z-[1001] grid place-items-center p-4 outline-none"');
  expect(panelSource).toContain("z-[1002]");
  expect(panelSource).toContain("onOpenChange={(nextOpen) => !nextOpen && onClose()}");
  expect(panelSource).toContain("if (event.target === event.currentTarget) onClose();");
  expect(panelSource).toContain("{lightboxItem && <HistoryLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />}");
  expect(panelSource).not.toContain("onOpenChange(false)");
});
