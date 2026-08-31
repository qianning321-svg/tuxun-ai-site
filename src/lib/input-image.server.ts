import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv, R2BucketLike } from "../env";
import { requireAuth, type AuthSession } from "./auth";
import { getD1, type D1Database } from "./d1";

export const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
export const INPUT_IMAGE_EXPIRY_HOURS = 24;
export const INPUT_IMAGE_EXPIRY_CLEANUP_CONDITION =
  "status = 'ready' AND expires_at IS NOT NULL AND datetime(expires_at) <= CURRENT_TIMESTAMP";
// A future scheduled cleanup must use INPUT_IMAGE_EXPIRY_CLEANUP_CONDITION.

export type InputImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type InputImageAssetResult = {
  assetId: string;
  filename: string;
  mimeType: InputImageMimeType;
  sizeBytes: number;
  status: "ready";
};

export type InputImageDeleteResult = {
  assetId: string;
  status: "deleted";
};

export type InputImageReadResult = {
  body: ArrayBuffer;
  mimeType: InputImageMimeType;
};

export type InputImageUploadDependencies = {
  authenticate?: (request: Request) => Promise<AuthSession>;
  bucket?: R2BucketLike;
  db?: D1Database;
  env?: MumoCloudflareEnv;
  createAssetId?: () => string;
  now?: () => Date;
};

export type InputImageUploadErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_MULTIPART"
  | "IMAGE_FILE_REQUIRED"
  | "EMPTY_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_SIGNATURE_MISMATCH"
  | "INVALID_DELETE_REQUEST"
  | "INPUT_IMAGE_NOT_FOUND"
  | "INPUT_IMAGE_NOT_DELETABLE"
  | "INPUT_IMAGE_READ_FAILED"
  | "UPLOAD_STORAGE_UNAVAILABLE"
  | "INPUT_IMAGE_UPLOAD_FAILED"
  | "INPUT_IMAGE_DELETE_FAILED";

export class InputImageUploadError extends Error {
  readonly code: InputImageUploadErrorCode;
  readonly status: 400 | 401 | 404 | 409 | 500;

  constructor(
    code: InputImageUploadErrorCode,
    message: string,
    status: 400 | 401 | 404 | 409 | 500,
  ) {
    super(message);
    this.name = "InputImageUploadError";
    this.code = code;
    this.status = status;
  }
}

type ValidatedInputImage = {
  mimeType: InputImageMimeType;
  extension: "png" | "jpg" | "webp";
};

type UploadedImageDeleteRow = {
  id: string;
  r2_key: string;
  status: string;
};

function getAffectedRowCount(result: { meta?: Record<string, unknown> }): number | null {
  const changes = result.meta?.changes;
  return typeof changes === "number" && Number.isInteger(changes) && changes >= 0 ? changes : null;
}

const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

const MIME_EXTENSIONS: Record<InputImageMimeType, ValidatedInputImage["extension"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function asCloudflareEnv(value: unknown): MumoCloudflareEnv {
  return value && typeof value === "object" ? (value as MumoCloudflareEnv) : {};
}

function getContextEnv(): MumoCloudflareEnv {
  const startContext = getStartContext({ throwIfNotFound: false });
  const context = startContext?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  return asCloudflareEnv(context?.cloudflare?.env ?? context?.cloudflareEnv);
}

function getGlobalEnv(): MumoCloudflareEnv {
  const globalRecord = globalThis as typeof globalThis & {
    __MUMO_CLOUDFLARE_ENV__?: unknown;
    __env__?: unknown;
  };
  return asCloudflareEnv(globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__);
}

function resolveCloudflareEnv(explicitEnv?: MumoCloudflareEnv): MumoCloudflareEnv {
  return {
    ...getGlobalEnv(),
    ...getContextEnv(),
    ...explicitEnv,
  };
}

function isInputImageMimeType(value: string): value is InputImageMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export async function detectInputImageMimeType(file: File): Promise<InputImageMimeType | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function validateInputImageFile(file: File): Promise<ValidatedInputImage> {
  if (file.size === 0) {
    throw new InputImageUploadError("EMPTY_IMAGE", "图片文件不能为空。", 400);
  }
  if (file.size > MAX_INPUT_IMAGE_BYTES) {
    throw new InputImageUploadError("IMAGE_TOO_LARGE", "单张参考图不能超过 10 MB。", 400);
  }
  if (!isInputImageMimeType(file.type)) {
    throw new InputImageUploadError(
      "UNSUPPORTED_IMAGE_TYPE",
      "仅支持 PNG、JPEG 或 WEBP 图片。",
      400,
    );
  }

  const detectedMimeType = await detectInputImageMimeType(file);
  if (detectedMimeType !== file.type) {
    throw new InputImageUploadError("IMAGE_SIGNATURE_MISMATCH", "图片内容与文件格式不匹配。", 400);
  }

  return {
    mimeType: detectedMimeType,
    extension: MIME_EXTENSIONS[detectedMimeType],
  };
}

function normalizeOriginalFilename(filename: string): string {
  const normalized = filename.trim().slice(0, 255);
  return normalized || "image";
}

function createInputImageKey(
  userId: string,
  assetId: string,
  extension: ValidatedInputImage["extension"],
  now: Date,
): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `inputs/${safeUserId}/${year}/${month}/${assetId}.${extension}`;
}

function resolveDatabase(dependencies: InputImageUploadDependencies): D1Database {
  const env = resolveCloudflareEnv(dependencies.env);
  let db: D1Database | undefined = dependencies.db ?? env.MUMO_DB;
  if (!db) {
    try {
      db = getD1(env);
    } catch {
      db = undefined;
    }
  }
  if (!db) {
    throw new InputImageUploadError(
      "UPLOAD_STORAGE_UNAVAILABLE",
      "参考图上传服务暂时不可用。",
      500,
    );
  }
  return db;
}

function resolveBucket(dependencies: InputImageUploadDependencies): R2BucketLike {
  const env = resolveCloudflareEnv(dependencies.env);
  const bucket = dependencies.bucket ?? env.MUMO_GENERATED_IMAGES;
  if (!bucket) {
    throw new InputImageUploadError(
      "UPLOAD_STORAGE_UNAVAILABLE",
      "参考图上传服务暂时不可用。",
      500,
    );
  }
  return bucket;
}

function resolveStorage(dependencies: InputImageUploadDependencies): {
  bucket: R2BucketLike;
  db: D1Database;
} {
  return {
    bucket: resolveBucket(dependencies),
    db: resolveDatabase(dependencies),
  };
}

async function tryDeleteUploadedObject(bucket: R2BucketLike, key: string): Promise<void> {
  if (typeof bucket.delete !== "function") return;
  try {
    await bucket.delete(key);
  } catch {
    // Cleanup is best-effort. Do not log storage keys or binding details.
  }
}

async function authenticateInputImageRequest(
  request: Request,
  dependencies: InputImageUploadDependencies,
): Promise<AuthSession> {
  try {
    return await (dependencies.authenticate ?? requireAuth)(request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw new InputImageUploadError("AUTH_REQUIRED", "请先登录后管理参考图。", 401);
    }
    throw error;
  }
}

export async function storeInputImageAsset(
  file: File,
  userId: string,
  dependencies: InputImageUploadDependencies = {},
): Promise<InputImageAssetResult> {
  const validated = await validateInputImageFile(file);
  const { bucket, db } = resolveStorage(dependencies);
  const assetId = (dependencies.createAssetId ?? (() => crypto.randomUUID()))();
  const now = (dependencies.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + INPUT_IMAGE_EXPIRY_HOURS * 60 * 60 * 1000);
  const r2Key = createInputImageKey(userId, assetId, validated.extension, now);
  const filename = normalizeOriginalFilename(file.name);

  try {
    await bucket.put(r2Key, file, {
      httpMetadata: { contentType: validated.mimeType },
    });
  } catch {
    throw new InputImageUploadError(
      "INPUT_IMAGE_UPLOAD_FAILED",
      "参考图上传失败，请稍后重试。",
      500,
    );
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO uploaded_images (
           id, user_id, r2_key, original_filename, mime_type, size_bytes,
           status, created_at, expires_at, consumed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        assetId,
        userId,
        r2Key,
        filename,
        validated.mimeType,
        file.size,
        "ready",
        now.toISOString(),
        expiresAt.toISOString(),
      )
      .run();
    if (!result.success) throw new Error("asset insert failed");
  } catch {
    await tryDeleteUploadedObject(bucket, r2Key);
    throw new InputImageUploadError(
      "INPUT_IMAGE_UPLOAD_FAILED",
      "参考图上传失败，请稍后重试。",
      500,
    );
  }

  return {
    assetId,
    filename,
    mimeType: validated.mimeType,
    sizeBytes: file.size,
    status: "ready",
  };
}

function getSingleImageFile(formData: FormData): File {
  const images = formData.getAll("image");
  const files = Array.from(formData.values()).filter(
    (value): value is File => value instanceof File,
  );
  if (images.length !== 1 || files.length !== 1 || !(images[0] instanceof File)) {
    throw new InputImageUploadError(
      "IMAGE_FILE_REQUIRED",
      "请通过 image 字段上传一张图片文件。",
      400,
    );
  }
  return images[0];
}

export async function uploadInputImageFromRequest(
  request: Request,
  dependencies: InputImageUploadDependencies = {},
): Promise<InputImageAssetResult> {
  const session = await authenticateInputImageRequest(request, dependencies);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new InputImageUploadError(
      "INVALID_MULTIPART",
      "上传请求必须使用 multipart/form-data。",
      400,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new InputImageUploadError("INVALID_MULTIPART", "无法解析上传的图片文件。", 400);
  }

  return storeInputImageAsset(getSingleImageFile(formData), session.user.id, dependencies);
}

export async function getInputImageAssetForUser(
  assetId: string,
  userId: string,
  dependencies: InputImageUploadDependencies = {},
): Promise<InputImageReadResult> {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId || normalizedAssetId.length > 128) {
    throw new InputImageUploadError("INPUT_IMAGE_NOT_FOUND", "参考图资产不存在。", 404);
  }

  const now = (dependencies.now ?? (() => new Date()))();
  let asset: (UploadedImageDeleteRow & { mime_type: string; expires_at: string | null }) | null;
  try {
    asset = await resolveDatabase(dependencies)
      .prepare(
        `SELECT id, r2_key, status, mime_type, expires_at
         FROM uploaded_images
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
      )
      .bind(normalizedAssetId, userId)
      .first<UploadedImageDeleteRow & { mime_type: string; expires_at: string | null }>();
  } catch {
    throw new InputImageUploadError(
      "INPUT_IMAGE_READ_FAILED",
      "参考图读取失败，请稍后重试。",
      500,
    );
  }

  const expiredReadyAsset =
    asset?.status === "ready" &&
    !!asset.expires_at &&
    Date.parse(asset.expires_at) <= now.getTime();
  if (
    !asset ||
    (asset.status !== "ready" && asset.status !== "consumed") ||
    expiredReadyAsset ||
    !isInputImageMimeType(asset.mime_type)
  ) {
    throw new InputImageUploadError("INPUT_IMAGE_NOT_FOUND", "参考图资产不存在。", 404);
  }

  try {
    const bucket = resolveBucket(dependencies);
    if (typeof bucket.get !== "function") throw new Error("R2 get unavailable");
    const object = await bucket.get(asset.r2_key);
    if (!object) throw new InputImageUploadError("INPUT_IMAGE_NOT_FOUND", "参考图资产不存在。", 404);
    return { body: await object.arrayBuffer(), mimeType: asset.mime_type };
  } catch (error) {
    if (error instanceof InputImageUploadError) throw error;
    throw new InputImageUploadError(
      "INPUT_IMAGE_READ_FAILED",
      "参考图读取失败，请稍后重试。",
      500,
    );
  }
}

export async function getInputImageAssetFromRequest(
  request: Request,
  assetId: string,
  dependencies: InputImageUploadDependencies = {},
): Promise<InputImageReadResult> {
  const session = await authenticateInputImageRequest(request, dependencies);
  return getInputImageAssetForUser(assetId, session.user.id, dependencies);
}

export async function deleteInputImageAsset(
  assetId: string,
  userId: string,
  dependencies: InputImageUploadDependencies = {},
): Promise<InputImageDeleteResult> {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId || normalizedAssetId.length > 128) {
    throw new InputImageUploadError("INVALID_DELETE_REQUEST", "参考图资产 ID 无效。", 400);
  }

  const db = resolveDatabase(dependencies);
  const readOwnedAsset = async (): Promise<UploadedImageDeleteRow | null> => {
    return db
      .prepare(
        `SELECT id, r2_key, status
         FROM uploaded_images
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
      )
      .bind(normalizedAssetId, userId)
      .first<UploadedImageDeleteRow>();
  };

  let asset: UploadedImageDeleteRow | null;
  try {
    asset = await readOwnedAsset();
  } catch {
    throw new InputImageUploadError(
      "INPUT_IMAGE_DELETE_FAILED",
      "参考图删除失败，请稍后重试。",
      500,
    );
  }

  if (!asset) {
    throw new InputImageUploadError("INPUT_IMAGE_NOT_FOUND", "参考图资产不存在。", 404);
  }
  if (asset.status === "deleted") {
    return { assetId: normalizedAssetId, status: "deleted" };
  }
  if (asset.status !== "ready") {
    throw new InputImageUploadError(
      "INPUT_IMAGE_NOT_DELETABLE",
      asset.status === "consumed" ? "已使用的参考图不能删除。" : "该参考图当前不能删除。",
      409,
    );
  }

  let affectedRows: number | null;
  try {
    const result = await db
      .prepare(
        `UPDATE uploaded_images
         SET status = 'deleted'
         WHERE id = ? AND user_id = ? AND status = 'ready'`,
      )
      .bind(normalizedAssetId, userId)
      .run();
    if (!result.success) throw new Error("asset update failed");
    affectedRows = getAffectedRowCount(result);
  } catch {
    throw new InputImageUploadError(
      "INPUT_IMAGE_DELETE_FAILED",
      "参考图删除失败，请稍后重试。",
      500,
    );
  }

  if (affectedRows === 0 || affectedRows === null) {
    let latestAsset: UploadedImageDeleteRow | null;
    try {
      latestAsset = await readOwnedAsset();
    } catch {
      throw new InputImageUploadError(
        "INPUT_IMAGE_DELETE_FAILED",
        "参考图删除失败，请稍后重试。",
        500,
      );
    }

    if (!latestAsset) {
      throw new InputImageUploadError("INPUT_IMAGE_NOT_FOUND", "参考图资产不存在。", 404);
    }
    if (latestAsset.status === "deleted") {
      if (affectedRows === 0) {
        return { assetId: normalizedAssetId, status: "deleted" };
      }
      asset = latestAsset;
    } else if (latestAsset.status !== "ready") {
      throw new InputImageUploadError(
        "INPUT_IMAGE_NOT_DELETABLE",
        latestAsset.status === "consumed" ? "已使用的参考图不能删除。" : "该参考图当前不能删除。",
        409,
      );
    } else {
      throw new InputImageUploadError(
        "INPUT_IMAGE_DELETE_FAILED",
        "参考图删除失败，请稍后重试。",
        500,
      );
    }
  }

  // D1 is authoritative. A future cleanup job must retry residual R2 objects for status = 'deleted'.
  try {
    const bucket = resolveBucket(dependencies);
    if (typeof bucket.delete === "function") {
      await bucket.delete(asset.r2_key);
    }
  } catch {
    // Best-effort only: never roll the database state back to ready or expose storage details.
  }

  return { assetId: normalizedAssetId, status: "deleted" };
}

export async function deleteInputImageAssetFromRequest(
  request: Request,
  dependencies: InputImageUploadDependencies = {},
): Promise<InputImageDeleteResult> {
  const session = await authenticateInputImageRequest(request, dependencies);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new InputImageUploadError(
      "INVALID_DELETE_REQUEST",
      "删除请求必须使用 application/json。",
      400,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new InputImageUploadError("INVALID_DELETE_REQUEST", "无法解析删除请求。", 400);
  }
  const candidate =
    payload && !Array.isArray(payload) && typeof payload === "object"
      ? (payload as { assetId?: unknown })
      : undefined;
  if (typeof candidate?.assetId !== "string") {
    throw new InputImageUploadError("INVALID_DELETE_REQUEST", "删除请求缺少 assetId。", 400);
  }

  return deleteInputImageAsset(candidate.assetId, session.user.id, dependencies);
}
