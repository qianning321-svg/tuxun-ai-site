import { createFileRoute } from "@tanstack/react-router";

const EDGE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

type CacheStorageWithDefault = CacheStorage & { default?: Cache };

function privateThumbnailResponse(source: Response): Response {
  const headers = new Headers(source.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.delete("Content-Disposition");
  return new Response(source.body, { status: source.status, headers });
}

export const Route = createFileRoute("/api/history/thumbnail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const taskId = requestUrl.searchParams.get("taskId")?.trim();
        if (!taskId) return new Response("Not found", { status: 404 });

        try {
          const [
            { requireAuth },
            {
              authorizeGeneratedThumbnailForUser,
              getGeneratedImageForUser,
              getGeneratedThumbnailObject,
              getRuntimeCloudflareEnv,
            },
            { createGeneratedHistoryThumbnailResponse },
          ] = await Promise.all([
            import("@/lib/auth"),
            import("@/lib/generation.server"),
            import("@/lib/generated-history-thumbnail.server"),
          ]);

          const session = await requireAuth(request);
          // Ownership is always established before an edge-cache lookup.
          const { thumbnailKey, displayReady, archiveStatus } = await authorizeGeneratedThumbnailForUser(
            session.user.id,
            taskId,
          );
          if (!displayReady) {
            if (archiveStatus === "pending" || archiveStatus === "processing") {
              return new Response("Thumbnail archive not ready", {
                status: 425,
                headers: { "Cache-Control": "private, no-store", "Retry-After": "2" },
              });
            }
            return new Response("Thumbnail unavailable", {
              status: 404,
              headers: { "Cache-Control": "private, no-store" },
            });
          }
          const cacheUrl = new URL(
            `/__mumo_internal/history-thumbnail/v1/${encodeURIComponent(session.user.id)}/${encodeURIComponent(taskId)}`,
            requestUrl.origin,
          );
          const cacheRequest = new Request(cacheUrl, { method: "GET" });
          const edgeCache = (globalThis.caches as CacheStorageWithDefault | undefined)?.default;
          const cached = await edgeCache?.match(cacheRequest);
          if (cached) return privateThumbnailResponse(cached);

          let body: ReadableStream;
          let contentType: string;
          let size: number | undefined;
          try {
            const thumbnail = await getGeneratedThumbnailObject(thumbnailKey);
            body = thumbnail.body;
            contentType = thumbnail.contentType;
            size = thumbnail.size;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              (error as Error & { code?: string }).code !== "THUMBNAIL_NOT_FOUND"
            ) {
              throw error;
            }
            const original = await getGeneratedImageForUser(session.user.id, taskId);
            const fallback = await createGeneratedHistoryThumbnailResponse(
              original,
              getRuntimeCloudflareEnv().IMAGES,
            );
            if (!fallback.body) throw new Error("HISTORY_THUMBNAIL_TRANSFORM_FAILED");
            body = fallback.body;
            contentType = "image/webp";
            size = undefined;
          }
          const edgeResponse = new Response(body, {
            headers: {
              "Content-Type": contentType,
              ...(size === undefined ? {} : { "Content-Length": String(size) }),
              "Cache-Control": `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
              "X-Content-Type-Options": "nosniff",
            },
          });
          await edgeCache?.put(cacheRequest, edgeResponse.clone());
          return privateThumbnailResponse(edgeResponse);
        } catch (error) {
          if (error instanceof Response && error.status === 401) return error;
          return new Response("Thumbnail unavailable", {
            status: 404,
            headers: { "Cache-Control": "private, no-store" },
          });
        }
      },
    },
  },
});
