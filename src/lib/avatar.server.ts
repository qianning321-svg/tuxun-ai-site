import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv, R2BucketLike } from "../env";
import { requireAuth, type AuthSession } from "./auth";
import { getD1, type D1Database } from "./d1";
import { InputImageUploadError, type InputImageMimeType, validateInputImageFile } from "./input-image.server";

export type AvatarDependencies = {
  authenticate?: (request: Request) => Promise<AuthSession>;
  bucket?: R2BucketLike;
  db?: D1Database;
  env?: MumoCloudflareEnv;
  createId?: () => string;
};

export class AvatarError extends Error {
  constructor(readonly code: string, readonly message: string, readonly status: 400 | 401 | 404 | 500) {
    super(message);
    this.name = "AvatarError";
  }
}

function getEnv(explicit?: MumoCloudflareEnv): MumoCloudflareEnv {
  const context = getStartContext({ throwIfNotFound: false })?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: MumoCloudflareEnv }; cloudflareEnv?: MumoCloudflareEnv }
    | undefined;
  const globals = globalThis as typeof globalThis & { __MUMO_CLOUDFLARE_ENV__?: MumoCloudflareEnv; __env__?: MumoCloudflareEnv };
  return { ...globals.__env__, ...globals.__MUMO_CLOUDFLARE_ENV__, ...context?.cloudflareEnv, ...context?.cloudflare?.env, ...explicit };
}

function getStorage(deps: AvatarDependencies): { db: D1Database; bucket: R2BucketLike } {
  const env = getEnv(deps.env);
  const db = deps.db ?? env.MUMO_DB ?? (() => { try { return getD1(env); } catch { return undefined; } })();
  const bucket = deps.bucket ?? env.MUMO_GENERATED_IMAGES;
  if (!db || !bucket) throw new AvatarError("AVATAR_STORAGE_UNAVAILABLE", "头像服务暂时不可用，请稍后重试。", 500);
  return { db, bucket };
}

async function authenticate(request: Request, deps: AvatarDependencies): Promise<AuthSession> {
  try {
    return await (deps.authenticate ?? requireAuth)(request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw new AvatarError("AUTH_REQUIRED", "请先登录后再管理头像。", 401);
    }
    throw error;
  }
}

function avatarKey(userId: string, id: string, extension: "png" | "jpg" | "webp"): string {
  return `avatars/${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}/${id}.${extension}`;
}

function isOwnedAvatarKey(value: string | null | undefined, userId: string): value is string {
  return !!value && /^avatars\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(value) && value.startsWith(`avatars/${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}/`);
}

function extensionFor(mimeType: InputImageMimeType): "png" | "jpg" | "webp" {
  return mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
}

function getAvatarFile(formData: FormData): File {
  const files = Array.from(formData.values()).filter((value): value is File => value instanceof File);
  const avatar = formData.get("avatar");
  if (files.length !== 1 || !(avatar instanceof File)) {
    throw new AvatarError("AVATAR_FILE_REQUIRED", "请选择一张 PNG、JPEG 或 WebP 图片。", 400);
  }
  return avatar;
}

export async function uploadAvatarFromRequest(request: Request, deps: AvatarDependencies = {}): Promise<void> {
  const session = await authenticate(request, deps);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    throw new AvatarError("INVALID_MULTIPART", "头像上传请求无效。", 400);
  }
  let formData: FormData;
  try { formData = await request.formData(); } catch { throw new AvatarError("INVALID_MULTIPART", "头像上传请求无效。", 400); }
  const file = getAvatarFile(formData);
  let validated: Awaited<ReturnType<typeof validateInputImageFile>>;
  try { validated = await validateInputImageFile(file); } catch (error) {
    if (error instanceof InputImageUploadError) {
      throw new AvatarError(error.code, error.message, error.status === 409 ? 400 : error.status);
    }
    throw error;
  }
  const { db, bucket } = getStorage(deps);
  const key = avatarKey(session.user.id, (deps.createId ?? (() => crypto.randomUUID()))(), extensionFor(validated.mimeType));
  try { await bucket.put(key, file, { httpMetadata: { contentType: validated.mimeType } }); } catch {
    throw new AvatarError("AVATAR_UPLOAD_FAILED", "头像上传失败，请稍后重试。", 500);
  }
  try {
    const result = await db.prepare("UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(key, session.user.id).run();
    if (!result.success) throw new Error("update failed");
  } catch {
    try { await bucket.delete?.(key); } catch { /* best-effort cleanup */ }
    throw new AvatarError("AVATAR_UPLOAD_FAILED", "头像上传失败，请稍后重试。", 500);
  }
}

export async function readAvatarFromRequest(request: Request, deps: AvatarDependencies = {}): Promise<{ body: ArrayBuffer; mimeType: InputImageMimeType }> {
  const session = await authenticate(request, deps);
  const { db, bucket } = getStorage(deps);
  let row: { avatar_url: string | null } | null;
  try { row = await db.prepare("SELECT avatar_url FROM users WHERE id = ? LIMIT 1").bind(session.user.id).first<{ avatar_url: string | null }>(); } catch {
    throw new AvatarError("AVATAR_READ_FAILED", "头像读取失败，请稍后重试。", 500);
  }
  if (!isOwnedAvatarKey(row?.avatar_url, session.user.id) || !bucket.get) throw new AvatarError("AVATAR_NOT_FOUND", "暂未设置头像。", 404);
  const object = await bucket.get(row.avatar_url);
  if (!object) throw new AvatarError("AVATAR_NOT_FOUND", "暂未设置头像。", 404);
  const mimeType = object.httpMetadata?.contentType as InputImageMimeType | undefined;
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") throw new AvatarError("AVATAR_NOT_FOUND", "暂未设置头像。", 404);
  return { body: await object.arrayBuffer(), mimeType };
}
