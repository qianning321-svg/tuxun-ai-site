import { createFileRoute } from "@tanstack/react-router";
import { getD1 } from "@/lib/d1";
import { jsonResponse } from "@/lib/placeholder-response";

type ContactInfo = { wechat?: unknown; qq?: unknown };

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const row = await getD1().prepare(
            "SELECT value_json FROM system_settings WHERE key = ? LIMIT 1",
          ).bind("contact_info").first<{ value_json: string }>();
          if (!row) return jsonResponse({ wechat: "", qq: "" });

          try {
            const value = JSON.parse(row.value_json) as ContactInfo;
            return jsonResponse({
              wechat: typeof value.wechat === "string" ? value.wechat : "",
              qq: typeof value.qq === "string" ? value.qq : "",
            });
          } catch {
            return jsonResponse({ wechat: "", qq: "" });
          }
        } catch (error) {
          console.error("Contact lookup failed", error);
          return jsonResponse({ wechat: "", qq: "" });
        }
      },
    },
  },
});
