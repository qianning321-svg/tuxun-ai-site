import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth";
import { AccountUpdateError, updateDisplayName } from "@/lib/account.server";
import { getD1 } from "@/lib/d1";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

export const Route = createFileRoute("/api/account/profile")({
  server: { handlers: { PATCH: async ({ request }) => {
    try {
      const session = await requireAuth(request);
      const payload = await request.json() as { nickname?: unknown };
      const displayName = await updateDisplayName(getD1(), session.user.id, payload.nickname);
      return jsonResponse({ ok: true, display_name: displayName });
    } catch (error) {
      if (error instanceof Response && error.status === 401) return apiError("AUTH_REQUIRED", "请先登录。", 401);
      if (error instanceof AccountUpdateError) return apiError(error.code, error.message, error.status);
      return apiError("ACCOUNT_UPDATE_FAILED", "昵称保存失败，请稍后重试。", 500);
    }
  } } },
});
