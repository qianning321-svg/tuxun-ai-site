import { createFileRoute } from "@tanstack/react-router";
import { AvatarError, readAvatarFromRequest, uploadAvatarFromRequest } from "@/lib/avatar.server";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

export const Route = createFileRoute("/api/uploads/avatar")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        const avatar = await readAvatarFromRequest(request);
        return new Response(avatar.body, { headers: { "Content-Type": avatar.mimeType, "Cache-Control": "private, max-age=0, no-store", "X-Content-Type-Options": "nosniff" } });
      } catch (error) {
        if (error instanceof AvatarError) return apiError(error.code, error.message, error.status);
        return apiError("AVATAR_READ_FAILED", "头像读取失败，请稍后重试。", 500);
      }
    },
    POST: async ({ request }) => {
      try {
        await uploadAvatarFromRequest(request);
        return jsonResponse({ ok: true }, 201);
      } catch (error) {
        if (error instanceof AvatarError) return apiError(error.code, error.message, error.status);
        return apiError("AVATAR_UPLOAD_FAILED", "头像上传失败，请稍后重试。", 500);
      }
    },
  } },
});
