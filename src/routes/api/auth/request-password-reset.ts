import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/placeholder-response";

const RESET_RESPONSE = {
  ok: true,
  message: "如果该邮箱已注册，重置方式会发送到邮箱",
};

export const Route = createFileRoute("/api/auth/request-password-reset")({
  server: {
    handlers: {
      POST: async () => jsonResponse(RESET_RESPONSE),
    },
  },
});
