import { createFileRoute } from "@tanstack/react-router";
import { getSessionFromRequest } from "@/lib/auth";
import { apiError, jsonResponse } from "@/lib/placeholder-response";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getSessionFromRequest(request);
          return jsonResponse(session ? { ok: true, ...session } : { user: null, profile: null });
        } catch (error) {
          console.error("Session lookup failed", error);
          return apiError("SESSION_LOOKUP_UNAVAILABLE", "Session lookup is temporarily unavailable", 503);
        }
      },
    },
  },
});
