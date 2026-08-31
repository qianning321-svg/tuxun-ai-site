import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/history/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [{ requireAuth }, { listGenerationHistoryForUser }] = await Promise.all([
            import("@/lib/auth"),
            import("@/lib/generation.server"),
          ]);
          const session = await requireAuth(request);
          const cursor = new URL(request.url).searchParams.get("cursor");
          const result = await listGenerationHistoryForUser(session.user.id, { cursor });
          return Response.json(result, {
            headers: { "Cache-Control": "private, no-store" },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof Error && (error as Error & { code?: string }).code === "INVALID_HISTORY_CURSOR") {
            return Response.json({ error: "INVALID_HISTORY_CURSOR" }, { status: 400 });
          }
          return Response.json({ error: "HISTORY_UNAVAILABLE" }, { status: 500 });
        }
      },
    },
  },
});
