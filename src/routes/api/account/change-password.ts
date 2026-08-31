import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth";
import { AccountUpdateError, changePassword } from "@/lib/account.server";
import { getD1 } from "@/lib/d1";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

export const Route = createFileRoute("/api/account/change-password")({
  server: { handlers: { POST: async ({ request }) => {
    try {
      const session = await requireAuth(request);
      const payload = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
      await changePassword(getD1(), session.user.id, payload.currentPassword, payload.newPassword);
      return jsonResponse({ ok: true });
    } catch (error) {
      if (error instanceof Response && error.status === 401) return apiError("AUTH_REQUIRED", "请先登录。", 401);
      if (error instanceof AccountUpdateError) return apiError(error.code, error.message, error.status);
      return apiError("ACCOUNT_UPDATE_FAILED", "密码修改失败，请稍后重试。", 500);
    }
  } } },
});
