import { getStartContext } from "@tanstack/start-storage-context";

type R2BucketLike = {
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  delete?: (key: string) => Promise<unknown>;
};

type CloudflareEnvLike = {
  MUMO_GENERATED_IMAGES?: R2BucketLike;
  R2_PUBLIC_BASE_URL?: string;
};

type ArchiveGeneratedImageInput = {
  imageUrl: string;
  taskId: string;
  userId?: string | null;
  modelKey?: string | null;
  cloudflareEnv?: unknown;
};

const GENERATED_IMAGE_KEY_PREFIX = "generated/";
const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

function getRawCloudflareGlobalEnv(): unknown {
  const globalRecord = globalThis as Record<string, unknown>;
  return globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__;
}

function getRawCloudflareContextEnv(): unknown {
  const startContext = getStartContext({ throwIfNotFound: false });
  const context = startContext?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  return context?.cloudflare?.env ?? context?.cloudflareEnv;
}

function getCloudflareEnv(explicitEnv?: unknown): CloudflareEnvLike {
  const contextEnv = getRawCloudflareContextEnv();
  const globalEnv = getRawCloudflareGlobalEnv();
  const explicitCloudflareEnv = explicitEnv && typeof explicitEnv === "object" ? (explicitEnv as CloudflareEnvLike) : {};
  const cloudflareContextEnv = contextEnv && typeof contextEnv === "object" ? (contextEnv as CloudflareEnvLike) : {};
  const cloudflareEnv = globalEnv && typeof globalEnv === "object" ? (globalEnv as CloudflareEnvLike) : {};
  const processEnv = typeof process !== "undefined" ? process.env : undefined;
  return {
    ...cloudflareEnv,
    ...cloudflareContextEnv,
    ...explicitCloudflareEnv,
    R2_PUBLIC_BASE_URL:
      explicitCloudflareEnv.R2_PUBLIC_BASE_URL ??
      cloudflareContextEnv.R2_PUBLIC_BASE_URL ??
      cloudflareEnv.R2_PUBLIC_BASE_URL ??
      processEnv?.R2_PUBLIC_BASE_URL,
  };
}


function normalizePublicBaseUrl(value: string | undefined): string | null {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  return trimmed || null;
}

function getExtension(contentType: string): "png" | "jpg" | "webp" {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg")) return "jpg";
  if (normalized.includes("image/webp")) return "webp";
  return "png";
}

function getArchiveKey(taskId: string, extension: string, now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `generated/${year}/${month}/${safeTaskId}.${extension}`;
}

function parseBase64ImageDataUrl(imageUrl: string): { contentType: string; body: Uint8Array } | null {
  const match = imageUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  try {
    const binary = atob(base64);
    const body = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      body[i] = binary.charCodeAt(i);
    }
    return { contentType, body };
  } catch {
    return null;
  }
}

function getImageHost(imageUrl: string): string {
  try {
    return new URL(imageUrl).hostname;
  } catch {
    return "invalid_url";
  }
}

export function getGeneratedR2KeyFromPublicUrl(
  imageUrl: string | null | undefined,
  cloudflareEnv?: unknown,
): string | null {
  if (!imageUrl) return null;

  try {
    const url = new URL(imageUrl);
    const publicBaseUrl = normalizePublicBaseUrl(getCloudflareEnv(cloudflareEnv).R2_PUBLIC_BASE_URL);
    if (!publicBaseUrl) return null;
    const publicHost = new URL(publicBaseUrl).host;
    if (url.protocol !== "https:" || url.host !== publicHost) return null;
    if (!url.pathname.startsWith(`/${GENERATED_IMAGE_KEY_PREFIX}`)) return null;

    const key = decodeURIComponent(url.pathname.slice(1));
    if (!key.startsWith(GENERATED_IMAGE_KEY_PREFIX)) return null;
    if (key.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return key;
  } catch {
    return null;
  }
}

export async function deleteGeneratedImageFromR2Url(
  imageUrl: string | null | undefined,
  cloudflareEnv?: unknown,
): Promise<boolean> {
  const key = getGeneratedR2KeyFromPublicUrl(imageUrl, cloudflareEnv);
  if (!key || !key.startsWith(GENERATED_IMAGE_KEY_PREFIX)) return false;

  const env = getCloudflareEnv(cloudflareEnv);
  const bucket = env.MUMO_GENERATED_IMAGES;
  if (!bucket || typeof bucket.delete !== "function") return false;

  try {
    await bucket.delete(key);
    return true;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error;
    console.warn("[history] r2 delete failed", { errorName });
    return false;
  }
}

export async function archiveGeneratedImageToR2({
  imageUrl,
  taskId,
  modelKey,
  cloudflareEnv,
}: ArchiveGeneratedImageInput): Promise<string> {

  if (!imageUrl) return imageUrl;

  const contextEnv = getRawCloudflareContextEnv();
  const hasContextEnv = !!contextEnv && typeof contextEnv === "object";
  const globalEnv = getRawCloudflareGlobalEnv();
  const hasGlobalEnv = !!globalEnv && typeof globalEnv === "object";
  const hasExplicitEnv = !!cloudflareEnv && typeof cloudflareEnv === "object";
  const env = getCloudflareEnv(cloudflareEnv);
  const bucket = env.MUMO_GENERATED_IMAGES;
  const publicBaseUrl = normalizePublicBaseUrl(env.R2_PUBLIC_BASE_URL);
  if (publicBaseUrl && (imageUrl.startsWith(`${publicBaseUrl}/`) || imageUrl === publicBaseUrl)) {
    return imageUrl;
  }
  if (!bucket || typeof bucket.put !== "function" || !publicBaseUrl) {
    return imageUrl;
  }

  const dataImage = parseBase64ImageDataUrl(imageUrl);
  if (dataImage) {
    try {
      const extension = getExtension(dataImage.contentType);
      const key = getArchiveKey(taskId, extension);
      await bucket.put(key, dataImage.body, { httpMetadata: { contentType: dataImage.contentType } });
      return `${publicBaseUrl}/${key}`;
    } catch {
      return imageUrl;
    }
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      return imageUrl;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      return imageUrl;
    }

    const extension = getExtension(contentType);
    const key = getArchiveKey(taskId, extension);
    const body = await response.arrayBuffer();
    await bucket.put(key, body, { httpMetadata: { contentType } });
    const finalUrl = `${publicBaseUrl}/${key}`;
    return finalUrl;
  } catch (error) {
    return imageUrl;
  }
}
