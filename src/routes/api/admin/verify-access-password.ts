import { createFileRoute } from "@tanstack/react-router";
import { getSessionFromRequest, verifyPassword } from "@/lib/auth";
import { getD1 } from "@/lib/d1";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

type VerifyBody = {
  password?: unknown;
};

function authFailed() {
  return apiError("ADMIN_VERIFY_FAILED", "管理员验证失败", 401);
}

export const Route = createFileRoute("/api/admin/verify-access-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: VerifyBody;
        try {
          const parsed = await request.json() as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return authFailed();
          body = parsed as VerifyBody;
        } catch {
          return authFailed();
        }

        const password = typeof body.password === "string" ? body.password : "";
        if (!password.trim()) return authFailed();

        try {
          const session = await getSessionFromRequest(request);
          if (!session) return authFailed();

          const db = getD1();
          const admin = await db.prepare(
            "SELECT role FROM admin_users WHERE user_id = ? AND role IN ('admin', 'owner') LIMIT 1",
          ).bind(session.user.id).first<{ role: "admin" | "owner" }>();
          if (!admin) return authFailed();

          const user = await db.prepare(
            "SELECT password_hash, status FROM users WHERE id = ? LIMIT 1",
          ).bind(session.user.id).first<{ password_hash: string; status: string }>();
          if (!user || user.status !== "active") return authFailed();
          if (!(await verifyPassword(password, user.password_hash))) return authFailed();

          return jsonResponse({ ok: true });
        } catch {
          return authFailed();
        }
      },
    },
  },
});

