import { createFileRoute } from "@tanstack/react-router";
import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "@/env";
import { mergeCloudflareEnv } from "@/lib/cloudflare-env.server";
import { getD1 } from "@/lib/d1";
import {
  getProviderThumbnailBackfillOriginal,
  ingestProviderThumbnailBackfill,
} from "@/lib/provider-result-archive.server";

function resolveEnv(): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown } | undefined;
  const globals = globalThis as typeof globalThis & { __MUMO_CLOUDFLARE_ENV__?: unknown; __env__?: unknown };
  return mergeCloudflareEnv(globals.__MUMO_CLOUDFLARE_ENV__ ?? globals.__env__, context?.cloudflare?.env ?? context?.cloudflareEnv);
}

function serviceToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

async function originalResponse(request: Request, taskId: string, headOnly: boolean): Promise<Response> {
  const env = resolveEnv();
  const result = await getProviderThumbnailBackfillOriginal(serviceToken(request), taskId, headOnly, {
    db: getD1(env),
    bucket: env.MUMO_GENERATED_IMAGES!,
    env,
  });
  if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return new Response(headOnly ? null : result.body, {
    headers: {
      "Content-Type": result.contentType,
      ...(result.size === undefined ? {} : { "Content-Length": String(result.size) }),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/provider-result-archive/thumbnail-backfill/$taskId")({
  server: { handlers: {
    HEAD: async ({ request, params }) => originalResponse(request, params.taskId, true),
    GET: async ({ request, params }) => originalResponse(request, params.taskId, false),
    POST: async ({ request, params }) => {
      const env = resolveEnv();
      const result = await ingestProviderThumbnailBackfill(serviceToken(request), params.taskId, request, {
        db: getD1(env),
        bucket: env.MUMO_GENERATED_IMAGES!,
        env,
      });
      if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
      return Response.json({ ok: true, thumbnailStatus: result.thumbnailStatus }, { headers: { "Cache-Control": "no-store" } });
    },
  } },
});
