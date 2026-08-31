import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";
import type { MumoCloudflareEnv } from "../env";
import type { D1Database } from "./d1";
import { mergeCloudflareEnv } from "./cloudflare-env.server";
import {
  decryptProviderSecret,
  encryptProviderSecret,
  type EncryptedProviderSecret,
} from "./provider-credentials-crypto.server";

const SUPPORTED_PROVIDERS = new Set(["mock", "vibelearning", "wuyinkeji"]);

type CredentialRow = {
  provider: string;
  base_url: string | null;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  encryption_version: number | string;
  is_enabled: number | string;
  updated_at: string | null;
};

export type ProviderCredentialStatus = {
  provider: string;
  baseUrl: string | null;
  apiKeyConfigured: boolean;
  isEnabled: boolean;
  encryptionVersion: number | null;
  updatedAt: string | null;
};

function normalizeProvider(value: unknown) {
  const provider = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!SUPPORTED_PROVIDERS.has(provider)) throw new Error("供应商无效");
  return provider;
}

function normalizeBaseUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  const candidate = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Base URL 必须是 HTTPS 地址");
  }
}

function asEnv(value: unknown): MumoCloudflareEnv {
  return value && typeof value === "object" ? (value as MumoCloudflareEnv) : {};
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getEnvSources(explicit?: MumoCloudflareEnv) {
  const context = getStartContext({ throwIfNotFound: false });
  const contextValue = context?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  const globalValue = (globalThis as Record<string, unknown>).__MUMO_CLOUDFLARE_ENV__ ??
    (globalThis as Record<string, unknown>).__env__;
  return {
    explicit: asObject(explicit),
    context: asObject(contextValue?.cloudflare?.env ?? contextValue?.cloudflareEnv),
    global: asObject(globalValue),
  };
}

function resolveEnv(explicit?: MumoCloudflareEnv): MumoCloudflareEnv {
  const sources = getEnvSources(explicit);
  return mergeCloudflareEnv(
    sources.global,
    sources.context,
    sources.explicit,
  );
}

function hasNonBlankKey(value: Record<string, unknown>): boolean {
  return typeof value.WUYINKEJI_API_KEY === "string" && value.WUYINKEJI_API_KEY.trim().length > 0;
}

function logWuyinkejiCredentialMissing(sources: ReturnType<typeof getEnvSources>, resolvedEnv: MumoCloudflareEnv, row: CredentialRow | null): void {
  console.error({
    event: "mumo_wuyinkeji_credential_missing_v2",
    diagnosticRevision: "credential-env-v2",
    provider: "wuyinkeji",
    hasExplicitEnv: Object.keys(sources.explicit).length > 0,
    explicitHasKeyProperty: Object.prototype.hasOwnProperty.call(sources.explicit, "WUYINKEJI_API_KEY"),
    explicitHasNonBlankKey: hasNonBlankKey(sources.explicit),
    hasContextEnv: Object.keys(sources.context).length > 0,
    contextHasKeyProperty: Object.prototype.hasOwnProperty.call(sources.context, "WUYINKEJI_API_KEY"),
    contextHasNonBlankKey: hasNonBlankKey(sources.context),
    hasGlobalEnv: Object.keys(sources.global).length > 0,
    globalHasKeyProperty: Object.prototype.hasOwnProperty.call(sources.global, "WUYINKEJI_API_KEY"),
    globalHasNonBlankKey: hasNonBlankKey(sources.global),
    resolvedHasKeyProperty: Object.prototype.hasOwnProperty.call(resolvedEnv, "WUYINKEJI_API_KEY"),
    resolvedHasNonBlankKey: hasNonBlankKey(asObject(resolvedEnv)),
    realProvidersEnabled: resolvedEnv.MUMO_ENABLE_REAL_IMAGE_PROVIDERS === "true",
    hasDatabaseCredentialRow: !!row,
    hasDatabaseCiphertext: !!row?.api_key_ciphertext,
  });
}

function masterKey(env?: MumoCloudflareEnv) {
  return resolveEnv(env).MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1 ?? "";
}

function toStatus(row: CredentialRow): ProviderCredentialStatus {
  return {
    provider: row.provider,
    baseUrl: row.base_url,
    apiKeyConfigured: !!row.api_key_ciphertext && !!row.api_key_iv,
    isEnabled: Number(row.is_enabled) === 1,
    encryptionVersion: Number.isInteger(Number(row.encryption_version)) ? Number(row.encryption_version) : null,
    updatedAt: row.updated_at,
  };
}

export async function getProviderCredentialStatus(db: D1Database, provider: unknown): Promise<ProviderCredentialStatus | null> {
  const normalizedProvider = normalizeProvider(provider);
  const row = await db.prepare(
    `SELECT provider, base_url, api_key_ciphertext, api_key_iv, encryption_version, is_enabled, updated_at
     FROM provider_credentials WHERE provider = ? LIMIT 1`,
  ).bind(normalizedProvider).first<CredentialRow>();
  return row ? toStatus(row) : null;
}

export async function listProviderCredentialStatuses(db: D1Database): Promise<ProviderCredentialStatus[]> {
  const rows = await db.prepare(
    `SELECT provider, base_url, api_key_ciphertext, api_key_iv, encryption_version, is_enabled, updated_at
     FROM provider_credentials ORDER BY provider`,
  ).all<CredentialRow>();
  return rows.results.map(toStatus);
}

export async function upsertProviderCredential(
  db: D1Database,
  input: { provider: unknown; baseUrl?: unknown; apiKey?: unknown; isEnabled?: unknown },
  updatedBy: string,
  env?: MumoCloudflareEnv,
): Promise<ProviderCredentialStatus> {
  const provider = normalizeProvider(input.provider);
  const existing = await getProviderCredentialStatus(db, provider);
  const baseUrl = input.baseUrl === undefined ? existing?.baseUrl ?? null : normalizeBaseUrl(input.baseUrl);
  const enabled = input.isEnabled === undefined ? existing?.isEnabled ?? true : input.isEnabled === true || input.isEnabled === 1 || input.isEnabled === "1";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  let encrypted: EncryptedProviderSecret | null = null;
  if (apiKey) encrypted = await encryptProviderSecret(masterKey(env), provider, apiKey);

  await db.prepare(
    `INSERT INTO provider_credentials
     (provider, base_url, api_key_ciphertext, api_key_iv, encryption_version, is_enabled, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       base_url = excluded.base_url,
       api_key_ciphertext = COALESCE(excluded.api_key_ciphertext, provider_credentials.api_key_ciphertext),
       api_key_iv = COALESCE(excluded.api_key_iv, provider_credentials.api_key_iv),
       encryption_version = CASE WHEN excluded.api_key_ciphertext IS NULL THEN provider_credentials.encryption_version ELSE excluded.encryption_version END,
       is_enabled = excluded.is_enabled,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(provider, baseUrl, encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.encryptionVersion ?? 1, enabled ? 1 : 0, updatedBy).run();
  return (await getProviderCredentialStatus(db, provider))!;
}

export async function clearProviderCredential(db: D1Database, provider: unknown, updatedBy: string): Promise<ProviderCredentialStatus> {
  const normalizedProvider = normalizeProvider(provider);
  await db.prepare(
    `UPDATE provider_credentials SET api_key_ciphertext = NULL, api_key_iv = NULL,
     updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`,
  ).bind(updatedBy, normalizedProvider).run();
  const status = await getProviderCredentialStatus(db, normalizedProvider);
  if (!status) throw new Error("供应商凭证不存在");
  return status;
}

export async function resolveProviderRuntimeCredential(
  db: D1Database,
  provider: unknown,
  env?: MumoCloudflareEnv,
): Promise<{ apiKey: string; baseUrl: string | undefined }> {
  const normalizedProvider = normalizeProvider(provider);
  const sources = getEnvSources(env);
  const resolvedEnv = mergeCloudflareEnv(sources.global, sources.context, sources.explicit);
  const row = await db.prepare(
    `SELECT provider, base_url, api_key_ciphertext, api_key_iv, encryption_version, is_enabled, updated_at
     FROM provider_credentials WHERE provider = ? LIMIT 1`,
  ).bind(normalizedProvider).first<CredentialRow>();
  if (row && Number(row.is_enabled) !== 1) throw new Error("供应商凭证已禁用");
  if (row?.api_key_ciphertext && row.api_key_iv) {
    const apiKey = await decryptProviderSecret(masterKey(resolvedEnv), normalizedProvider, {
      ciphertext: row.api_key_ciphertext,
      iv: row.api_key_iv,
      encryptionVersion: 1,
    });
    return { apiKey, baseUrl: row.base_url ?? undefined };
  }
  if (normalizedProvider === "vibelearning" && resolvedEnv.VIBELEARNING_IMAGE_API_KEY?.trim()) {
    return { apiKey: resolvedEnv.VIBELEARNING_IMAGE_API_KEY.trim(), baseUrl: resolvedEnv.VIBELEARNING_IMAGE_API_BASE_URL?.trim().replace(/\/+$/, "") || undefined };
  }
  if (normalizedProvider === "wuyinkeji" && resolvedEnv.WUYINKEJI_API_KEY?.trim()) {
    return {
      apiKey: resolvedEnv.WUYINKEJI_API_KEY.trim(),
      baseUrl: resolvedEnv.WUYINKEJI_API_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
    };
  }
  if (normalizedProvider === "wuyinkeji") {
    logWuyinkejiCredentialMissing(sources, resolvedEnv, row);
  }
  throw new Error("供应商凭证未配置");
}
