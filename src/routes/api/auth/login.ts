import { createFileRoute } from "@tanstack/react-router";
import {
  createSessionCookie,
  createStoredSession,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth";
import { getD1 } from "@/lib/d1";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

type LoginBody = { email?: unknown; password?: unknown };
type LoginRow = {
  id: string;
  email: string;
  password_hash: string;
  status: string;
  display_name: string | null;
  avatar_url: string | null;
  credits: number | string | null;
};

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: LoginBody;
        try {
          const parsed = await request.json() as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return apiError("INVALID_JSON", "Invalid JSON body", 400);
          }
          body = parsed as LoginBody;
        } catch {
          return apiError("INVALID_JSON", "Invalid JSON body", 400);
        }

        const emailNormalized = normalizeEmail(typeof body.email === "string" ? body.email : "");
        const password = typeof body.password === "string" ? body.password : "";
        if (!emailNormalized || !password) return apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);

        try {
          const db = getD1();
          const user = await db.prepare(
            `SELECT u.id, u.email, u.password_hash, u.status, u.display_name, u.avatar_url,
                    COALESCE(c.balance, 0) AS credits
             FROM users AS u
             LEFT JOIN user_credits AS c ON c.user_id = u.id
             WHERE u.email_normalized = ?
             LIMIT 1`,
          ).bind(emailNormalized).first<LoginRow>();

          if (!user) return apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
          if (user.status !== "active") return apiError("ACCOUNT_DISABLED", "This account is not active", 403);
          if (!(await verifyPassword(password, user.password_hash))) {
            return apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
          }

          const session = await createStoredSession(db, user.id, request);
          const results = await db.batch([
            session.statement,
            db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
              .bind(user.id),
          ]);
          if (results.some((result) => !result.success)) throw new Error("Login transaction failed");

          return jsonResponse(
            {
              ok: true,
              user: { id: user.id, email: user.email },
              profile: {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                avatar_url: user.avatar_url,
                credits: Number(user.credits ?? 0),
              },
            },
            200,
            { "set-cookie": createSessionCookie(session.token, session.expiresAt) },
          );
        } catch (error) {
          console.error("Login failed", error);
          return apiError("LOGIN_UNAVAILABLE", "Login is temporarily unavailable", 503);
        }
      },
    },
  },
});
