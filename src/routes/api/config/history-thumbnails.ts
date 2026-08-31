import { createFileRoute } from "@tanstack/react-router";

import { getHistoryThumbnailsEnabled } from "@/lib/history-thumbnails-feature.server";

export const Route = createFileRoute("/api/config/history-thumbnails")({
  server: {
    handlers: {
      GET: async () => Response.json(
        { enabled: getHistoryThumbnailsEnabled() },
        { headers: { "Cache-Control": "private, no-store" } },
      ),
    },
  },
});
