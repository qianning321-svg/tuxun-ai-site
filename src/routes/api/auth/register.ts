import { createFileRoute } from "@tanstack/react-router";
import {
  createSessionCookie,
  createStoredSession,
  getSignupBonusCredits,
  hashPassword,
  normalizeEmail,
} from "@/lib/auth";
import { getD1 } from "@/lib/d1";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CredentialsBody = { email?: unknown; password?: unknown };

export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let stage = "parse_body";
        let body: CredentialsBody;
        try {
          const parsed = await request.json() as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return apiError("INVALID_JSON", "Invalid JSON body", 400);
          }
          body = parsed as CredentialsBody;
        } catch {
          return apiError("INVALID_JSON", "Invalid JSON body", 400);
        }

        const email = typeof body.email === "string" ? body.email.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const emailNormalized = normalizeEmail(email);
        if (!EMAIL_PATTERN.test(emailNormalized)) return apiError("INVALID_EMAIL", "Invalid email address", 400);
        if (password.length < 8) return apiError("WEAK_PASSWORD", "Password must be at least 8 characters", 400);

        try {
          stage = "get_d1";
          const db = getD1();
          stage = "check_existing_user";
          const existing = await db.prepare("SELECT id FROM users WHERE email_normalized = ? LIMIT 1")
            .bind(emailNormalized)
            .first<{ id: string }>();
          if (existing) return apiError("EMAIL_ALREADY_REGISTERED", "Email is already registered", 409);

          const userId = crypto.randomUUID();
          stage = "hash_password";
          const passwordHash = await hashPassword(password);
          stage = "load_signup_bonus";
          const bonusCredits = await getSignupBonusCredits(db);
          stage = "create_session";
          const session = await createStoredSession(db, userId, request);

          stage = "write_registration_batch";
          const results = await db.batch([
            db.prepare(
              "INSERT INTO users (id, email, email_normalized, password_hash) VALUES (?, ?, ?, ?)",
            ).bind(userId, email, emailNormalized, passwordHash),
            db.prepare(
              "INSERT INTO user_credits (user_id, balance, total_granted, total_used) VALUES (?, ?, ?, 0)",
            ).bind(userId, bonusCredits, bonusCredits),
            db.prepare(
              "INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, ref_type, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ).bind(
              crypto.randomUUID(),
              userId,
              bonusCredits,
              bonusCredits,
              "signup_bonus",
              "system",
              "Initial signup credits",
            ),
            session.statement,
          ]);
          if (results.some((result) => result && result.success === false)) {
            throw new Error("Registration transaction failed");
          }

          return jsonResponse(
            {
              ok: true,
              user: { id: userId, email },
              profile: { id: userId, email, display_name: null, avatar_url: null, credits: bonusCredits },
            },
            201,
            { "set-cookie": createSessionCookie(session.token, session.expiresAt) },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (message.toLowerCase().includes("unique")) {
            return apiError("EMAIL_ALREADY_REGISTERED", "Email is already registered", 409);
          }
          console.error("Registration failed", { stage, error });
          return apiError("REGISTRATION_UNAVAILABLE", "Registration is temporarily unavailable", 503);
        }
      },
    },
  },
});
