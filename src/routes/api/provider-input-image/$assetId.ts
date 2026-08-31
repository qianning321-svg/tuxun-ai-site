import { createFileRoute } from "@tanstack/react-router";
import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "@/env";
import { mergeCloudflareEnv } from "@/lib/cloudflare-env.server";
import { getD1 } from "@/lib/d1";
import { getSignedProviderInputImage } from "@/lib/provider-input-image.server";

const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

function asEnv(value: unknown): MumoCloudflareEnv {
  return value && typeof value === "object" ? (value as MumoCloudflareEnv) : {};
}

function resolveEnv(): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  const globalRecord = globalThis as typeof globalThis & { __MUMO_CLOUDFLARE_ENV__?: unknown; __env__?: unknown };
  return mergeCloudflareEnv(
    asEnv(globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__),
    asEnv(context?.cloudflare?.env ?? context?.cloudflareEnv),
  );
}

export async function handleProviderInputImageRequest(
  request: Request,
  assetId: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  const env = resolveEnv();
  const url = new URL(request.url);
  const result = await getSignedProviderInputImage(assetId, url.searchParams.get("exp"), url.searchParams.get("sig"), {
    db: getD1(env),
    bucket: env.MUMO_GENERATED_IMAGES!,
    env,
  });
  if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return new Response(method === "HEAD" ? null : result.body, {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/provider-input-image/$assetId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleProviderInputImageRequest(request, params.assetId, "GET"),
      HEAD: ({ request, params }) => handleProviderInputImageRequest(request, params.assetId, "HEAD"),
    },
  },
});
