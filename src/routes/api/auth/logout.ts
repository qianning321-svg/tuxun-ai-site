import { createFileRoute } from "@tanstack/react-router";
import {
  clearSessionCookie,
  getSessionTokenFromRequest,
  hashSessionToken,
} from "@/lib/auth";
import { getD1 } from "@/lib/d1";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = getSessionTokenFromRequest(request);
        if (token) {
          try {
            const tokenHash = await hashSessionToken(token);
            await getD1().prepare(
              "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_token_hash = ? AND revoked_at IS NULL",
            ).bind(tokenHash).run();
          } catch (error) {
            console.error("Logout revocation failed", error);
            const response = apiError("LOGOUT_UNAVAILABLE", "Logout is temporarily unavailable", 503);
            response.headers.set("set-cookie", clearSessionCookie());
            return response;
          }
        }

        return jsonResponse({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
      },
    },
  },
});
