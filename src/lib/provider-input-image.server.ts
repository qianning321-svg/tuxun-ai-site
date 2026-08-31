import "@tanstack/react-start/server-only";

import type { MumoCloudflareEnv, R2BucketLike } from "../env";
import type { D1Database } from "./d1";

export const PROVIDER_INPUT_URL_TTL_MS = 60 * 60 * 1000;
const VERSION = "v1";
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type AssetRow = { id: string; r2_key: string; mime_type: string; status: string; expires_at: string | null };

function encoder(value: string) { return new TextEncoder().encode(value); }
function payload(id: string, exp: number) { return `${VERSION}:${id}:${exp}`; }

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64url(bytes: ArrayBuffer) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const text = atob(base64);
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function publicOrigin(env: MumoCloudflareEnv): URL {
  const value = env.MUMO_PUBLIC_ORIGIN?.trim() ?? "";
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("provider input public origin is not configured");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("invalid provider input public origin");
  }
  return origin;
}

export async function createProviderInputUrl(assetId: string, env: MumoCloudflareEnv, now = new Date()): Promise<string> {
  const secret = env.MUMO_PROVIDER_INPUT_SIGNING_KEY_V1;
  if (!secret) throw new Error("provider input signing is not configured");
  const exp = now.getTime() + PROVIDER_INPUT_URL_TTL_MS;
  const signature = base64url(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder(payload(assetId, exp))));
  const url = new URL(`/api/provider-input-image/${encodeURIComponent(assetId)}`, publicOrigin(env));
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", signature);
  return url.toString();
}

export async function getSignedProviderInputImage(
  assetId: string,
  expValue: string | null,
  signature: string | null,
  dependencies: { db: D1Database; bucket: R2BucketLike; env: MumoCloudflareEnv; now?: () => Date },
) {
  const exp = Number(expValue);
  const secret = dependencies.env.MUMO_PROVIDER_INPUT_SIGNING_KEY_V1;
  const now = (dependencies.now ?? (() => new Date()))();
  if (!secret || !signature || !Number.isSafeInteger(exp) || exp <= now.getTime()) return { status: 403 as const };
  let valid = false;
  try { valid = await crypto.subtle.verify("HMAC", await signingKey(secret), decodeBase64url(signature), encoder(payload(assetId, exp))); } catch {}
  if (!valid) return { status: 403 as const };
  const row = await dependencies.db.prepare("SELECT id, r2_key, mime_type, status, expires_at FROM uploaded_images WHERE id = ? LIMIT 1").bind(assetId).first<AssetRow>();
  const usable =
    !!row &&
    (row.status === "consumed" ||
      (row.status === "ready" &&
        (!row.expires_at || Date.parse(row.expires_at) > now.getTime())));
  if (!row || !usable || !MIME_TYPES.has(row.mime_type) || !dependencies.bucket.get) return { status: 404 as const };
  const object = await dependencies.bucket.get(row.r2_key);
  if (!object) return { status: 404 as const };
  return { status: 200 as const, body: await object.arrayBuffer(), mimeType: row.mime_type };
}
