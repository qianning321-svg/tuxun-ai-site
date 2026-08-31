import "@tanstack/react-start/server-only";

import type { MumoCloudflareEnv, R2BucketLike } from "../env";
import type { D1Database } from "./d1";
import { generatedThumbnailKey } from "./history-thumbnail-key";

// A token is tied to one claim. Keeping it no longer than the claim lease also
// prevents a reclaimed job from being completed by a stale archiver process.
export const PROVIDER_ARCHIVE_TOKEN_TTL_MS = 10 * 60 * 1000;
export const MAX_PROVIDER_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const MAX_PROVIDER_THUMBNAIL_BYTES = 1024 * 1024;
export const PROVIDER_ARCHIVE_LEASE_MS = 10 * 60 * 1000;
export const PROVIDER_ARCHIVE_MAX_ATTEMPTS = 3;
const TOKEN_VERSION = "v1";
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ArchiveRow = {
  id: string;
  archive_job_id: string | null;
  archive_claimed_at: string | null;
  user_id: string;
  provider: string | null;
  status: string;
  result_image_url: string | null;
  result_image_r2_key: string | null;
  archive_status: "not_required" | "pending" | "processing" | "archived" | "failed";
};

function bytes(value: string) { return new TextEncoder().encode(value); }

function base64url(value: ArrayBuffer): string {
  let text = "";
  for (const byte of new Uint8Array(value)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function tokenPayload(jobId: string, taskId: string, claimedAt: string, exp: number): string {
  return [TOKEN_VERSION, jobId, taskId, claimedAt, String(exp)].join(":");
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createProviderArchiveToken(jobId: string, taskId: string, env: MumoCloudflareEnv, now = new Date(), claimedAt = now.toISOString()): Promise<string> {
  const secret = env.MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1;
  if (!secret) throw new Error("provider archive signing is not configured");
  const exp = now.getTime() + PROVIDER_ARCHIVE_TOKEN_TTL_MS;
  const signature = base64url(await crypto.subtle.sign("HMAC", await signingKey(secret), bytes(tokenPayload(jobId, taskId, claimedAt, exp))));
  return [TOKEN_VERSION, String(exp), signature].join(".");
}

async function verifyToken(jobId: string, taskId: string, claimedAt: string | null, token: string | null, env: MumoCloudflareEnv, now: Date): Promise<boolean> {
  const secret = env.MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1;
  if (!secret || !token || !claimedAt) return false;
  const parts = token.split(".");
  const exp = Number(parts[1]);
  if (parts[0] !== TOKEN_VERSION || !parts[2] || !Number.isSafeInteger(exp) || exp <= now.getTime()) return false;
  try {
    const signatureBytes = new Uint8Array(decodeBase64url(parts[2]));
    const payloadBytes = new Uint8Array(bytes(tokenPayload(jobId, taskId, claimedAt, exp)));
    return await crypto.subtle.verify("HMAC", await signingKey(secret), signatureBytes, payloadBytes);
  } catch { return false; }
}

function imageExtension(mimeType: string): "png" | "jpg" | "webp" {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

function hasMagic(value: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => value[index] === byte);
  if (mimeType === "image/jpeg") return value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
  return value[0] === 0x52 && value[1] === 0x49 && value[2] === 0x46 && value[3] === 0x46 && value[8] === 0x57 && value[9] === 0x45 && value[10] === 0x42 && value[11] === 0x50;
}

async function readBoundedBody(request: Request, maxBytes = MAX_PROVIDER_ARCHIVE_BYTES): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("ARCHIVE_SIZE_REJECTED");
  if (!request.body) throw new Error("ARCHIVE_BODY_REJECTED");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("ARCHIVE_SIZE_REJECTED");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function getArchiveRow(db: D1Database, jobId: string): Promise<ArchiveRow | null> {
  return db.prepare("SELECT id, archive_job_id, archive_claimed_at, user_id, provider, status, result_image_url, result_image_r2_key, archive_status FROM generation_tasks WHERE archive_job_id = ? LIMIT 1").bind(jobId).first<ArchiveRow>();
}

function authorizedArchiver(requestToken: string | null, env: MumoCloudflareEnv): boolean {
  const expected = env.MUMO_ARCHIVER_SERVICE_TOKEN_V1;
  return !!expected && !!requestToken && requestToken === expected;
}

function hasWebpMagic(value: Uint8Array): boolean {
  return value[0] === 0x52 && value[1] === 0x49 && value[2] === 0x46 && value[3] === 0x46 &&
    value[8] === 0x57 && value[9] === 0x45 && value[10] === 0x42 && value[11] === 0x50;
}

async function writeThumbnail(
  row: Pick<ArchiveRow, "id" | "user_id">,
  request: Request,
  bucket: R2BucketLike,
): Promise<{ status: 200; thumbnailStatus: "created" | "exists" } | { status: 400 | 413 | 415 | 500 | 502 }> {
  const mimeType = (request.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  if (mimeType !== "image/webp") return { status: 415 };
  let thumbnailBytes: Uint8Array;
  try {
    thumbnailBytes = await readBoundedBody(request, MAX_PROVIDER_THUMBNAIL_BYTES);
  } catch (error) {
    return { status: error instanceof Error && error.message === "ARCHIVE_SIZE_REJECTED" ? 413 : 400 };
  }
  if (!thumbnailBytes.length || !hasWebpMagic(thumbnailBytes)) return { status: 415 };
  const key = generatedThumbnailKey(row.user_id, row.id);
  if (bucket.head && await bucket.head(key)) return { status: 200, thumbnailStatus: "exists" };
  try {
    await bucket.put(key, thumbnailBytes, { httpMetadata: { contentType: "image/webp" } });
    return { status: 200, thumbnailStatus: "created" };
  } catch {
    return { status: 502 };
  }
}

export async function claimProviderArchiveJob(
  requestToken: string | null,
  dependencies: { db: D1Database; env: MumoCloudflareEnv; now?: () => Date },
) {
  if (!authorizedArchiver(requestToken, dependencies.env)) return { status: 401 as const };
  const now = (dependencies.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - PROVIDER_ARCHIVE_LEASE_MS).toISOString();
  const origin = dependencies.env.MUMO_PUBLIC_ORIGIN;
  if (!origin) return { status: 500 as const };
  await dependencies.db.batch([
    dependencies.db.prepare("UPDATE generation_tasks SET archive_status = 'failed', archive_last_error_code = 'ARCHIVE_MAX_ATTEMPTS', updated_at = CURRENT_TIMESTAMP WHERE provider = 'wuyinkeji' AND status = 'succeeded' AND archive_status = 'processing' AND archive_claimed_at < ? AND archive_attempt_count >= ?").bind(cutoff, PROVIDER_ARCHIVE_MAX_ATTEMPTS),
    dependencies.db.prepare("UPDATE generation_history SET archive_status = 'failed', archive_last_error_code = 'ARCHIVE_MAX_ATTEMPTS' WHERE task_id IN (SELECT id FROM generation_tasks WHERE archive_status = 'failed' AND archive_last_error_code = 'ARCHIVE_MAX_ATTEMPTS')").bind(),
  ]);
  const candidate = await dependencies.db.prepare("SELECT id, archive_job_id FROM generation_tasks WHERE provider = 'wuyinkeji' AND status = 'succeeded' AND archive_job_id IS NOT NULL AND archive_attempt_count < ? AND (archive_status = 'pending' OR (archive_status = 'processing' AND archive_claimed_at < ?)) ORDER BY created_at ASC LIMIT 1").bind(PROVIDER_ARCHIVE_MAX_ATTEMPTS, cutoff).first<{ id: string; archive_job_id: string }>();
  if (!candidate) return { status: 204 as const };
  const claimed = await dependencies.db.prepare("UPDATE generation_tasks SET archive_status = 'processing', archive_attempt_count = archive_attempt_count + 1, archive_claimed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'succeeded' AND archive_attempt_count < ? AND (archive_status = 'pending' OR (archive_status = 'processing' AND archive_claimed_at < ?))").bind(now.toISOString(), candidate.id, PROVIDER_ARCHIVE_MAX_ATTEMPTS, cutoff).run();
  if ((claimed.meta?.changes ?? 0) !== 1) return { status: 204 as const };
  await dependencies.db.prepare("UPDATE generation_history SET archive_status = 'processing', archive_attempt_count = (SELECT archive_attempt_count FROM generation_tasks WHERE id = ?), archive_last_error_code = NULL WHERE task_id = ?").bind(candidate.id, candidate.id).run();
  const token = await createProviderArchiveToken(candidate.archive_job_id, candidate.id, dependencies.env, now, now.toISOString());
  const jobUrl = new URL("/api/provider-result-archive/" + encodeURIComponent(candidate.archive_job_id), origin).toString();
  return { status: 200 as const, archiveJobId: candidate.archive_job_id, generationTaskId: candidate.id, mumoJobUrl: jobUrl, archiveToken: token, tokenExpiresAt: new Date(now.getTime() + PROVIDER_ARCHIVE_TOKEN_TTL_MS).toISOString() };
}

const ARCHIVE_FAILURE_CODES = new Set(["DOWNLOAD_NETWORK", "DOWNLOAD_HTTP", "INVALID_MIME", "IMAGE_TOO_LARGE", "UPLOAD_FAILED", "UNKNOWN"]);

export async function reportProviderArchiveFailure(jobId: string, token: string | null, code: string, dependencies: { db: D1Database; env: MumoCloudflareEnv; now?: () => Date }) {
  const now = (dependencies.now ?? (() => new Date()))();
  const row = await getArchiveRow(dependencies.db, jobId);
  if (!row || !(await verifyToken(jobId, row.id, row.archive_claimed_at, token, dependencies.env, now))) return { status: 403 as const };
  if (row.archive_status === "archived") return { status: 200 as const, archiveStatus: "archived" as const };
  if (row.archive_status !== "processing") return { status: 409 as const };
  const safeCode = ARCHIVE_FAILURE_CODES.has(code) ? code : "UNKNOWN";
  const attemptRow = await dependencies.db.prepare("SELECT archive_attempt_count FROM generation_tasks WHERE id = ? LIMIT 1").bind(row.id).first<{ archive_attempt_count: number }>();
  const attemptCount = attemptRow?.archive_attempt_count ?? 0;
  const finalStatus = attemptCount >= PROVIDER_ARCHIVE_MAX_ATTEMPTS ? "failed" : "pending";
  await setArchiveFailure(dependencies.db, row.id, safeCode, finalStatus);
  return { status: 200 as const, archiveStatus: finalStatus as "pending" | "failed" };
}

async function setArchiveFailure(db: D1Database, taskId: string, code: string, archiveStatus: "pending" | "failed"): Promise<void> {
  await db.batch([
    db.prepare("UPDATE generation_tasks SET archive_status = ?, archive_last_error_code = ?, archive_claimed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'succeeded'").bind(archiveStatus, code, taskId),
    db.prepare("UPDATE generation_history SET archive_status = ?, archive_last_error_code = ?, archive_attempt_count = (SELECT archive_attempt_count FROM generation_tasks WHERE id = ?), archived_at = NULL WHERE task_id = ?").bind(archiveStatus, code, taskId, taskId),
  ]);
}

export async function getProviderArchiveJob(jobId: string, token: string | null, dependencies: { db: D1Database; env: MumoCloudflareEnv; now?: () => Date }) {
  const now = (dependencies.now ?? (() => new Date()))();
  const row = await getArchiveRow(dependencies.db, jobId);
  if (!row) return { status: 404 as const };
  if (!(await verifyToken(jobId, row.id, row.archive_claimed_at, token, dependencies.env, now))) return { status: 403 as const };
  if (row.provider !== "wuyinkeji" || row.status !== "succeeded" || row.archive_status !== "processing" || !row.result_image_url) return { status: 404 as const };
  try {
    const source = new URL(row.result_image_url);
    if (source.protocol !== "https:" || source.username || source.password) return { status: 404 as const };
  } catch { return { status: 404 as const }; }
  return { status: 200 as const, jobId, sourceUrl: row.result_image_url, expiresAt: new Date(now.getTime() + PROVIDER_ARCHIVE_TOKEN_TTL_MS).toISOString() };
}

export async function ingestProviderArchive(jobId: string, token: string | null, request: Request, dependencies: { db: D1Database; bucket: R2BucketLike; env: MumoCloudflareEnv; now?: () => Date }) {
  const now = (dependencies.now ?? (() => new Date()))();
  const row = await getArchiveRow(dependencies.db, jobId);
  if (!row) return { status: 404 as const };
  if (!(await verifyToken(jobId, row.id, row.archive_claimed_at, token, dependencies.env, now))) return { status: 403 as const };
  if (row.provider !== "wuyinkeji" || row.status !== "succeeded") return { status: 404 as const };
  if (row.archive_status === "archived" && row.result_image_r2_key) return { status: 200 as const, archiveStatus: "archived" as const };
  if (row.archive_status !== "processing") return { status: 409 as const };
  const history = await dependencies.db.prepare("SELECT id FROM generation_history WHERE task_id = ? AND deleted_at IS NULL LIMIT 1").bind(row.id).first<{ id: string }>();
  if (!history) {
    await dependencies.db.prepare("UPDATE generation_tasks SET archive_status = 'not_required', archive_job_id = NULL, archive_claimed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archive_status = 'processing'").bind(row.id).run();
    return { status: 410 as const };
  }
  const mimeType = (request.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  if (!MIME_TYPES.has(mimeType)) return { status: 415 as const };
  let imageBytes: Uint8Array;
  try { imageBytes = await readBoundedBody(request); } catch (error) {
    const code = error instanceof Error ? error.message : "ARCHIVE_BODY_REJECTED";
    return { status: code === "ARCHIVE_SIZE_REJECTED" ? 413 as const : 400 as const };
  }
  if (!imageBytes.length || !hasMagic(imageBytes, mimeType)) return { status: 415 as const };
  const safeUserId = row.user_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTaskId = row.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const keyName = "generated/" + safeUserId + "/" + now.getUTCFullYear() + "/" + String(now.getUTCMonth() + 1).padStart(2, "0") + "/" + safeTaskId + "." + imageExtension(mimeType);
  try {
    await dependencies.bucket.put(keyName, imageBytes, { httpMetadata: { contentType: mimeType } });
    await dependencies.db.batch([
      dependencies.db.prepare("UPDATE generation_tasks SET result_image_r2_key = ?, archive_status = 'archived', archive_last_error_code = NULL, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'succeeded'").bind(keyName, row.id),
      dependencies.db.prepare("UPDATE generation_history SET result_image_r2_key = ?, archive_status = 'archived', archive_last_error_code = NULL, archived_at = CURRENT_TIMESTAMP WHERE task_id = ?").bind(keyName, row.id),
    ]);
  } catch {
    return { status: 502 as const };
  }
  return { status: 200 as const, archiveStatus: "archived" as const };
}

export async function ingestProviderArchiveThumbnail(
  jobId: string,
  token: string | null,
  request: Request,
  dependencies: { db: D1Database; bucket: R2BucketLike; env: MumoCloudflareEnv; now?: () => Date },
) {
  const now = (dependencies.now ?? (() => new Date()))();
  const row = await getArchiveRow(dependencies.db, jobId);
  if (!row) return { status: 404 as const };
  if (!(await verifyToken(jobId, row.id, row.archive_claimed_at, token, dependencies.env, now))) {
    return { status: 403 as const };
  }
  if (
    row.provider !== "wuyinkeji" ||
    row.status !== "succeeded" ||
    row.archive_status !== "archived" ||
    !row.result_image_r2_key
  ) {
    return { status: 409 as const };
  }
  const history = await dependencies.db.prepare(
    "SELECT id FROM generation_history WHERE task_id = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(row.id).first<{ id: string }>();
  if (!history) return { status: 404 as const };
  return writeThumbnail(row, request, dependencies.bucket);
}

type ThumbnailBackfillCursor = { createdAt: string; id: string };

function encodeThumbnailBackfillCursor(cursor: ThumbnailBackfillCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeThumbnailBackfillCursor(value: string | null | undefined): ThumbnailBackfillCursor | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Partial<ThumbnailBackfillCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.createdAt || !parsed.id) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function listProviderThumbnailBackfillJobs(
  requestToken: string | null,
  input: { limit?: number; cursor?: string | null },
  dependencies: { db: D1Database; bucket: R2BucketLike; env: MumoCloudflareEnv },
) {
  if (!authorizedArchiver(requestToken, dependencies.env)) return { status: 401 as const };
  if (!dependencies.bucket.head) return { status: 500 as const };
  const requestedLimit = Number(input.limit ?? 20);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
    return { status: 400 as const };
  }
  const limit = requestedLimit;
  const cursor = decodeThumbnailBackfillCursor(input.cursor);
  if (input.cursor && !cursor) return { status: 400 as const };
  const rows = await dependencies.db.prepare(
    `SELECT t.id, t.user_id, t.created_at
     FROM generation_tasks t
     INNER JOIN generation_history h ON h.task_id = t.id AND h.deleted_at IS NULL
     WHERE t.status = 'succeeded' AND t.archive_status = 'archived' AND t.result_image_r2_key IS NOT NULL
       AND (? IS NULL OR t.created_at > ? OR (t.created_at = ? AND t.id > ?))
     ORDER BY t.created_at ASC, t.id ASC LIMIT ?`,
  ).bind(
    cursor?.createdAt ?? null,
    cursor?.createdAt ?? null,
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
    limit + 1,
  ).all<{ id: string; user_id: string; created_at: string }>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const items: Array<{ taskId: string; hasThumbnail: boolean }> = [];
  for (const row of page) {
    items.push({
      taskId: row.id,
      hasThumbnail: !!(await dependencies.bucket.head(generatedThumbnailKey(row.user_id, row.id))),
    });
  }
  const last = page.at(-1);
  return {
    status: 200 as const,
    items,
    nextCursor: hasMore && last ? encodeThumbnailBackfillCursor({ createdAt: last.created_at, id: last.id }) : null,
    hasMore,
    limit,
  };
}

async function getArchivedTaskForBackfill(db: D1Database, taskId: string): Promise<ArchiveRow | null> {
  return db.prepare(
    `SELECT t.id, t.archive_job_id, t.archive_claimed_at, t.user_id, t.provider, t.status,
            t.result_image_url, t.result_image_r2_key, t.archive_status
     FROM generation_tasks t
     INNER JOIN generation_history h ON h.task_id = t.id AND h.deleted_at IS NULL
     WHERE t.id = ? AND t.status = 'succeeded' AND t.archive_status = 'archived'
       AND t.result_image_r2_key IS NOT NULL LIMIT 1`,
  ).bind(taskId).first<ArchiveRow>();
}

export async function getProviderThumbnailBackfillOriginal(
  requestToken: string | null,
  taskId: string,
  headOnly: boolean,
  dependencies: { db: D1Database; bucket: R2BucketLike; env: MumoCloudflareEnv },
) {
  if (!authorizedArchiver(requestToken, dependencies.env)) return { status: 401 as const };
  const row = await getArchivedTaskForBackfill(dependencies.db, taskId);
  if (!row?.result_image_r2_key) return { status: 404 as const };
  if (headOnly) {
    const object = await dependencies.bucket.head?.(row.result_image_r2_key);
    return object ? { status: 200 as const, contentType: object.httpMetadata?.contentType ?? "application/octet-stream", size: object.size } : { status: 404 as const };
  }
  const object = await dependencies.bucket.get?.(row.result_image_r2_key);
  if (!object) return { status: 404 as const };
  return { status: 200 as const, body: object.body, contentType: object.httpMetadata?.contentType ?? "application/octet-stream", size: object.size };
}

export async function ingestProviderThumbnailBackfill(
  requestToken: string | null,
  taskId: string,
  request: Request,
  dependencies: { db: D1Database; bucket: R2BucketLike; env: MumoCloudflareEnv },
) {
  if (!authorizedArchiver(requestToken, dependencies.env)) return { status: 401 as const };
  const row = await getArchivedTaskForBackfill(dependencies.db, taskId);
  if (!row?.result_image_r2_key) return { status: 404 as const };
  return writeThumbnail(row, request, dependencies.bucket);
}
