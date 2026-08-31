import { createFileRoute } from "@tanstack/react-router";
import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "@/env";
import { mergeCloudflareEnv } from "@/lib/cloudflare-env.server";
import { getD1 } from "@/lib/d1";
import { getProviderArchiveJob, ingestProviderArchive } from "@/lib/provider-result-archive.server";

const ENV_KEY = "__MUMO_CLOUDFLARE_ENV__";

function env(): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown } | undefined;
  const globals = globalThis as typeof globalThis & { __MUMO_CLOUDFLARE_ENV__?: unknown; __env__?: unknown };
  return mergeCloudflareEnv(globals[ENV_KEY] ?? globals.__env__, context?.cloudflare?.env ?? context?.cloudflareEnv);
}

function token(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("MumoArchive ") ? value.slice("MumoArchive ".length).trim() : null;
}

function response(result: { status: number; [key: string]: unknown }): Response {
  if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
  const { status: _status, ...body } = result;
  return Response.json({ ok: true, ...body }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/provider-result-archive/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const currentEnv = env();
        return response(await getProviderArchiveJob(params.jobId, token(request), { db: getD1(currentEnv), env: currentEnv }));
      },
      POST: async ({ request, params }) => {
        const currentEnv = env();
        const result = await ingestProviderArchive(params.jobId, token(request), request, { db: getD1(currentEnv), bucket: currentEnv.MUMO_GENERATED_IMAGES!, env: currentEnv });
        return response(result);
      },
    },
  },
});
