import { createFileRoute } from "@tanstack/react-router";
import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "@/env";
import { mergeCloudflareEnv } from "@/lib/cloudflare-env.server";
import { getD1 } from "@/lib/d1";
import { reportProviderArchiveFailure } from "@/lib/provider-result-archive.server";

function resolveEnv(): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown } | undefined;
  const globals = globalThis as typeof globalThis & { __MUMO_CLOUDFLARE_ENV__?: unknown; __env__?: unknown };
  return mergeCloudflareEnv(globals.__MUMO_CLOUDFLARE_ENV__ ?? globals.__env__, context?.cloudflare?.env ?? context?.cloudflareEnv);
}

export const Route = createFileRoute("/api/provider-result-archive/$jobId/fail")({
  server: { handlers: {
    POST: async ({ request, params }) => {
      const auth = request.headers.get("authorization") ?? "";
      const token = auth.startsWith("MumoArchive ") ? auth.slice("MumoArchive ".length).trim() : null;
      let code = "UNKNOWN";
      try {
        const body = await request.json() as { code?: unknown };
        if (typeof body.code === "string") code = body.code;
      } catch {}
      const env = resolveEnv();
      const result = await reportProviderArchiveFailure(params.jobId, token, code, { db: getD1(env), env });
      if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
      return Response.json({ ok: true, archiveStatus: result.archiveStatus }, { headers: { "Cache-Control": "no-store" } });
    },
  } },
});
