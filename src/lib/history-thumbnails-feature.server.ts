import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "../env";
import { mergeCloudflareEnv } from "./cloudflare-env.server";
import { historyThumbnailsEnabled } from "./history-thumbnails-feature";

export function getHistoryThumbnailsEnabled(): boolean {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  const globals = globalThis as typeof globalThis & {
    __MUMO_CLOUDFLARE_ENV__?: MumoCloudflareEnv;
    __env__?: MumoCloudflareEnv;
  };
  const env = mergeCloudflareEnv(
    globals.__env__,
    globals.__MUMO_CLOUDFLARE_ENV__,
    context?.cloudflareEnv,
    context?.cloudflare?.env,
  );
  return historyThumbnailsEnabled(env);
}
