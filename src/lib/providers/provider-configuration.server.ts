import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv } from "../../env";
import type { D1Database } from "../d1";
import { getProviderCredentialStatus } from "../provider-credentials.server";

const DEFAULT_VIBELEARNING_IMAGE_BASE_URL = "https://image1.vibelearning.top/v1";
const DEFAULT_WUYINKEJI_IMAGE_BASE_URL = "https://api.wuyinkeji.com";
const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

export type ProviderConfigurationStatus = {
  provider: string;
  displayName: string;
  baseUrl: string;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  enabled: boolean;
};

function asEnv(value: unknown): MumoCloudflareEnv {
  return value && typeof value === "object" ? (value as MumoCloudflareEnv) : {};
}

function resolveEnv(explicit?: MumoCloudflareEnv): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false });
  const contextValue = context?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  const globalValue = (globalThis as Record<string, unknown>)[CLOUDFLARE_ENV_GLOBAL_KEY];
  return {
    ...asEnv(globalValue),
    ...asEnv(contextValue?.cloudflare?.env ?? contextValue?.cloudflareEnv),
    ...explicit,
  };
}

export async function getProviderConfigurationStatuses(
  db?: D1Database,
  explicitEnv?: MumoCloudflareEnv,
): Promise<ProviderConfigurationStatus[]> {
  const env = resolveEnv(explicitEnv);
  const configuredBaseUrl = env.VIBELEARNING_IMAGE_API_BASE_URL?.trim().replace(/\/+$/, "");
  const configuredWuyinkejiBaseUrl = env.WUYINKEJI_API_BASE_URL?.trim().replace(/\/+$/, "");
  const credential = db ? await getProviderCredentialStatus(db, "vibelearning") : null;
  const wuyinkejiCredential = db ? await getProviderCredentialStatus(db, "wuyinkeji") : null;
  return [
    {
      provider: "vibelearning",
      displayName: "VibeLearning Image",
      baseUrl: credential?.baseUrl || configuredBaseUrl || DEFAULT_VIBELEARNING_IMAGE_BASE_URL,
      baseUrlConfigured: !!credential?.baseUrl || !!configuredBaseUrl,
      apiKeyConfigured: !!credential?.apiKeyConfigured || !!env.VIBELEARNING_IMAGE_API_KEY?.trim(),
      enabled: (credential?.isEnabled ?? true) && env.MUMO_ENABLE_REAL_IMAGE_PROVIDERS === "true",
    },
    {
      provider: "wuyinkeji",
      displayName: "Wuyinkeji Image",
      baseUrl: wuyinkejiCredential?.baseUrl || configuredWuyinkejiBaseUrl || DEFAULT_WUYINKEJI_IMAGE_BASE_URL,
      baseUrlConfigured: !!wuyinkejiCredential?.baseUrl || !!configuredWuyinkejiBaseUrl,
      apiKeyConfigured: !!wuyinkejiCredential?.apiKeyConfigured || !!env.WUYINKEJI_API_KEY?.trim(),
      enabled: (wuyinkejiCredential?.isEnabled ?? true) && env.MUMO_ENABLE_REAL_IMAGE_PROVIDERS === "true",
    },
  ];
}
