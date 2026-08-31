import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/download-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const taskId = requestUrl.searchParams.get("taskId")?.trim();
        if (taskId) {
          let image: { contentType: string; size?: number } | undefined;
          try {
            const [
              { requireAuth },
              { getGeneratedImageForUser, getRuntimeCloudflareEnv },
              { createGeneratedImageDownloadResponse },
            ] = await Promise.all([
              import("@/lib/auth"),
              import("@/lib/generation.server"),
              import("@/lib/generated-image-download.server"),
            ]);
            const session = await requireAuth(request);
            const result = await getGeneratedImageForUser(session.user.id, taskId);
            image = result;
            return await createGeneratedImageDownloadResponse(result, taskId, getRuntimeCloudflareEnv().IMAGES);
          } catch (error) {
            if (error instanceof Response && error.status === 401) return error;
            if (
              error instanceof Error &&
              (error as Error & { code?: string }).code === "RESULT_NOT_FOUND"
            ) {
              return new Response("Image archive not ready", { status: 425 });
            }
            if (image?.contentType.toLowerCase().split(";", 1)[0] === "image/webp") {
              const errorCode = error instanceof Error ? error.message : "IMAGE_TRANSFORM_FAILED";
              console.error({
                event: "download_image_transform_failed",
                taskId,
                sourceMime: image.contentType,
                sourceSize: image.size,
                errorName: error instanceof Error ? error.name : "UnknownError",
                safeMessage: /^IMAGE_TRANSFORM_[A-Z_]+$/.test(errorCode)
                  ? errorCode
                  : "IMAGE_TRANSFORM_FAILED",
              });
            }
            return new Response("Result unavailable", { status: 404 });
          }
        }
        return new Response("Forbidden", { status: 403 });
      },
    },
  },
});
