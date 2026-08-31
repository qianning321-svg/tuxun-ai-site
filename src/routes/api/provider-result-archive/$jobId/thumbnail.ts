import { createFileRoute } from "@tanstack/react-router";
import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "@/env";
import { mergeCloudflareEnv } from "@/lib/cloudflare-env.server";
import { getD1 } from "@/lib/d1";
import { ingestProviderArchiveThumbnail } from "@/lib/provider-result-archive.server";

function resolveEnv(): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown } | undefined;
  const globals = globalThis as typeof globalThis & { __MUMO_CLOUDFLARE_ENV__?: unknown; __env__?: unknown };
  return mergeCloudflareEnv(globals.__MUMO_CLOUDFLARE_ENV__ ?? globals.__env__, context?.cloudflare?.env ?? context?.cloudflareEnv);
}

export const Route = createFileRoute("/api/provider-result-archive/$jobId/thumbnail")({
  server: { handlers: {
    POST: async ({ request, params }) => {
      const auth = request.headers.get("authorization") ?? "";
      const token = auth.startsWith("MumoArchive ") ? auth.slice("MumoArchive ".length).trim() : null;
      const env = resolveEnv();
      const result = await ingestProviderArchiveThumbnail(params.jobId, token, request, {
        db: getD1(env),
        bucket: env.MUMO_GENERATED_IMAGES!,
        env,
      });
      if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
      return Response.json({ ok: true, thumbnailStatus: result.thumbnailStatus }, { headers: { "Cache-Control": "no-store" } });
    },
  } },
});
