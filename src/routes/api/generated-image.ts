import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/generated-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const taskId = requestUrl.searchParams.get("taskId")?.trim();
        const variant = requestUrl.searchParams.get("variant");
        if (!taskId) return new Response("Not found", { status: 404 });
        if (variant !== null && variant !== "canvas" && variant !== "large") {
          return new Response("Not found", { status: 404 });
        }

        try {
          const [
            { requireAuth },
            { getGeneratedImageInlineForUser, getRuntimeCloudflareEnv },
            { createGeneratedImagePreviewResponse },
          ] = await Promise.all([
            import("@/lib/auth"),
            import("@/lib/generation.server"),
            import("@/lib/generated-image-preview.server"),
          ]);
          const session = await requireAuth(request);
          const image = await getGeneratedImageInlineForUser(session.user.id, taskId);
          if (variant === "canvas" || variant === "large") {
            return await createGeneratedImagePreviewResponse(
              image,
              variant,
              getRuntimeCloudflareEnv().IMAGES,
            );
          }
          return new Response(image.body, {
            headers: {
              "Content-Type": image.contentType,
              ...(image.size === undefined ? {} : { "Content-Length": String(image.size) }),
              "Content-Disposition": "inline",
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          if (error instanceof Response && error.status === 401) return error;
          if (error instanceof Error && (error as Error & { code?: string }).code === "RESULT_NOT_READY") {
            return new Response("Image archive not ready", {
              status: 425,
              headers: { "Cache-Control": "private, no-store", "Retry-After": "2" },
            });
          }
          return new Response("Image unavailable", {
            status: 404,
            headers: { "Cache-Control": "private, no-store" },
          });
        }
      },
    },
  },
});
