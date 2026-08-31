import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";

import type { MumoCloudflareEnv, R2BucketLike } from "../env";
import {
  chargeGenerationTask,
  GenerationCreditRecoveryError,
  InsufficientCreditsError,
  refundGenerationTask,
} from "./credits.server";
import type { D1Database, D1Result } from "./d1";
import { getD1 } from "./d1";
import { mergeCloudflareEnv } from "./cloudflare-env.server";
import { generatedThumbnailKey } from "./history-thumbnail-key";
import { createProviderInputUrl } from "./provider-input-image.server";
import { GenerationPricingError, getGenerationQuote } from "./generation-pricing.server";
import type {
  ImageGenerationInput,
  ImageProvider,
  ImageQuality,
  NormalizedProviderImage,
  ProviderGenerationMode,
  ProviderReferenceImage,
} from "./providers/image-provider.server";
import {
  createDefaultProviderRegistry,
  type ImageProviderRegistry,
  ProviderRegistryError,
  validateProviderCapabilities,
} from "./providers/provider-registry.server";
import { VibeLearningImageProvider } from "./providers/vibelearning-image.server";
import {
  getWuyinkejiPollErrorDiagnostic,
  getWuyinkejiResultDiagnostic,
  type WuyinkejiGenerationDiagnostic,
} from "./providers/wuyinkeji-image.server";

const MAX_REFERENCE_IMAGES = 5;
const TASK_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_PROVIDER_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const PROVIDER_DOWNLOAD_RETRY_DELAYS_MS = [1000, 2000] as const;
const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";
const WUYINKEJI_STAGE_FAILURE_EVENT = "mumo_wuyinkeji_generation_stage_failure_v1";
const WUYINKEJI_DIAGNOSTIC_REVISION = "wuyinkeji-generation-stage-v1";

type WuyinkejiPipelineStage =
  | "result_download"
  | "result_validation"
  | "r2_archive"
  | "history_write";

type WuyinkejiPipelineDiagnostic = {
  stage: WuyinkejiPipelineStage;
  downloadAttemptCount?: number;
  downloadFetchThrew?: boolean;
  downloadHttpOk?: boolean;
  downloadStatus?: number;
  contentTypeAccepted?: boolean;
  contentLengthAccepted?: boolean;
  r2PutAttempted?: boolean;
  historyWriteAttempted?: boolean;
  errorName?: string;
  internalErrorCode?: string;
};

const pipelineDiagnostics = new WeakMap<object, WuyinkejiPipelineDiagnostic>();

function attachPipelineDiagnostic<T extends Error>(error: T, diagnostic: WuyinkejiPipelineDiagnostic): T {
  pipelineDiagnostics.set(error, diagnostic);
  return error;
}

function getPipelineDiagnostic(error: unknown): WuyinkejiPipelineDiagnostic | undefined {
  return error && typeof error === "object" ? pipelineDiagnostics.get(error) : undefined;
}

function logWuyinkejiStageFailure(
  task: GenerationTaskRow,
  diagnostic: WuyinkejiGenerationDiagnostic | WuyinkejiPipelineDiagnostic,
  error?: unknown,
): void {
  if (task.provider !== "wuyinkeji") return;
  const errorName = error instanceof Error ? error.name : undefined;
  const internalErrorCode = error instanceof GenerationPipelineError ? error.code : undefined;
  console.error({
    event: WUYINKEJI_STAGE_FAILURE_EVENT,
    diagnosticRevision: WUYINKEJI_DIAGNOSTIC_REVISION,
    provider: "wuyinkeji",
    providerModel: task.provider_model ?? "unknown",
    ...diagnostic,
    ...(errorName ? { errorName } : {}),
    ...(internalErrorCode ? { internalErrorCode } : {}),
  });
}

export type GenerationCreateInput = {
  modelKey: string;
  prompt: string;
  referenceImageIds: string[];
  parameters: {
    aspectRatio: string;
    quality: ImageQuality;
  };
  idempotencyKey: string;
};

export type GenerationTaskView = {
  taskId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  prompt: string;
  modelId: string;
  modelName: string;
  generationMode: "text_to_image" | "image_to_image";
  costCredits: number;
  inputParams: {
    aspectRatio: string;
    quality: ImageQuality;
    referenceImageIds: string[];
    costCredits: number;
  };
  resultImageUrl: string | null;
  displayReady: boolean;
  archiveStatus: "not_required" | "pending" | "processing" | "archived" | "failed";
  errorMessage: string | null;
  deductionStatus: "pending" | "charged" | "refunded";
  deductionId: string | null;
  historyId: string | null;
};

export type GenerationPipelineDependencies = {
  db?: D1Database;
  bucket?: R2BucketLike;
  env?: MumoCloudflareEnv;
  provider?: ImageProvider;
  providerRegistry?: ImageProviderRegistry;
  fetchImpl?: typeof fetch;
  downloadSleep?: (milliseconds: number) => Promise<void>;
  idFactory?: () => string;
  now?: () => Date;
};

export const GENERATION_HISTORY_MAX_ITEMS = 100;
export const GENERATION_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const GENERATION_HISTORY_PAGE_SIZE = 20;

type GenerationHistoryCursor = {
  createdAt: string;
  id: string;
};

export function encodeGenerationHistoryCursor(cursor: GenerationHistoryCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeGenerationHistoryCursor(value: string | null | undefined): GenerationHistoryCursor | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Partial<GenerationHistoryCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string" || !parsed.createdAt || !parsed.id) {
      throw new Error("INVALID_HISTORY_CURSOR");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new GenerationPipelineError("INVALID_HISTORY_CURSOR", "History cursor is invalid.");
  }
}

export { generatedThumbnailKey } from "./history-thumbnail-key";

type UploadedImageRow = {
  id: string;
  r2_key: string;
  original_filename: string | null;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  size_bytes: number | string;
  status: string;
  expires_at: string | null;
};

type GenerationTaskRow = {
  id: string;
  user_id: string;
  model_id: string | null;
  model_key: string;
  task_type: string;
  prompt: string | null;
  status: GenerationTaskView["status"];
  cost_credits: number | string;
  provider_task_id: string | null;
  provider: string | null;
  provider_model: string | null;
  result_image_url: string | null;
  result_image_r2_key: string | null;
  archive_job_id: string | null;
  archive_status: "not_required" | "pending" | "processing" | "archived" | "failed";
  error_message: string | null;
  request_json: string | null;
  idempotency_key: string | null;
  deduction_ledger_id: string | null;
  refund_ledger_id: string | null;
  generation_mode: "text_to_image" | "image_to_image" | null;
  attempt_count: number | string;
  timeout_at: string | null;
};

export class GenerationPipelineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GenerationPipelineError";
    this.code = code;
  }
}

function asEnv(value: unknown): MumoCloudflareEnv {
  return value && typeof value === "object" ? (value as MumoCloudflareEnv) : {};
}

function getContextEnv(): MumoCloudflareEnv {
  const startContext = getStartContext({ throwIfNotFound: false });
  const context = startContext?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  return asEnv(context?.cloudflare?.env ?? context?.cloudflareEnv);
}

function getGlobalEnv(): MumoCloudflareEnv {
  const globalRecord = globalThis as typeof globalThis & {
    __MUMO_CLOUDFLARE_ENV__?: unknown;
    __env__?: unknown;
  };
  return asEnv(globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__);
}

function resolveEnv(explicit?: MumoCloudflareEnv): MumoCloudflareEnv {
  return mergeCloudflareEnv(getGlobalEnv(), getContextEnv(), explicit);
}

/** Runtime bindings for route-only operations that must use the current request context. */
export function getRuntimeCloudflareEnv(): MumoCloudflareEnv {
  return resolveEnv();
}

function resolveDb(dependencies: GenerationPipelineDependencies): D1Database {
  return dependencies.db ?? getD1(dependencies.env);
}

function resolveBucket(dependencies: GenerationPipelineDependencies): R2BucketLike {
  const bucket = dependencies.bucket ?? resolveEnv(dependencies.env).MUMO_GENERATED_IMAGES;
  if (!bucket) throw new GenerationPipelineError("R2_UNAVAILABLE", "图片存储服务暂时不可用。");
  return bucket;
}

function resolveProviderRegistry(
  dependencies: GenerationPipelineDependencies,
): ImageProviderRegistry {
  if (dependencies.providerRegistry) return dependencies.providerRegistry;
  const env = resolveEnv(dependencies.env);
  return createDefaultProviderRegistry({
    allowRealProviders: env.MUMO_ENABLE_REAL_IMAGE_PROVIDERS === "true",
    mockProvider: dependencies.provider,
    vibelearningFactory: () => new VibeLearningImageProvider(),
  });
}

function getChanges(result: D1Result): number {
  const changes = result.meta?.changes;
  return typeof changes === "number" && Number.isInteger(changes) && changes >= 0 ? changes : 0;
}

function parseRequestJson(value: string | null): GenerationTaskView["inputParams"] {
  try {
    const parsed = JSON.parse(value ?? "{}") as {
      aspectRatio?: unknown;
      quality?: unknown;
      referenceImageIds?: unknown;
      costCredits?: unknown;
    };
    const quality =
      parsed.quality === "1K" || parsed.quality === "2K" || parsed.quality === "4K"
        ? parsed.quality
        : "1K";
    return {
      aspectRatio: typeof parsed.aspectRatio === "string" ? parsed.aspectRatio : "1:1",
      quality,
      referenceImageIds: Array.isArray(parsed.referenceImageIds)
        ? parsed.referenceImageIds.filter(
            (item): item is string => typeof item === "string" && !!item,
          )
        : [],
      costCredits: Number(parsed.costCredits ?? 0),
    };
  } catch {
    return { aspectRatio: "1:1", quality: "1K", referenceImageIds: [], costCredits: 0 };
  }
}

async function getHistoryId(db: D1Database, taskId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM generation_history WHERE task_id = ? LIMIT 1")
    .bind(taskId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function toTaskView(
  db: D1Database,
  task: GenerationTaskRow,
  modelName?: string,
): Promise<GenerationTaskView> {
  const inputParams = parseRequestJson(task.request_json);
  return {
    taskId: task.id,
    status: task.status,
    prompt: task.prompt ?? "",
    modelId: task.model_key,
    modelName: modelName ?? task.model_key,
    generationMode: task.generation_mode ?? "text_to_image",
    costCredits: Number(task.cost_credits),
    inputParams: { ...inputParams, costCredits: Number(task.cost_credits) },
    resultImageUrl: task.result_image_url,
    displayReady: Boolean(task.result_image_r2_key),
    archiveStatus: task.archive_status,
    errorMessage: task.error_message,
    deductionStatus: task.refund_ledger_id
      ? "refunded"
      : task.deduction_ledger_id
        ? "charged"
        : "pending",
    deductionId: task.deduction_ledger_id,
    historyId: await getHistoryId(db, task.id),
  };
}

async function getTaskRow(
  db: D1Database,
  taskId: string,
  userId: string,
): Promise<GenerationTaskRow | null> {
  return db
    .prepare("SELECT * FROM generation_tasks WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(taskId, userId)
    .first<GenerationTaskRow>();
}

async function getTaskByIdempotency(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
): Promise<GenerationTaskRow | null> {
  return db
    .prepare("SELECT * FROM generation_tasks WHERE user_id = ? AND idempotency_key = ? LIMIT 1")
    .bind(userId, idempotencyKey)
    .first<GenerationTaskRow>();
}

async function loadReferenceAssets(
  db: D1Database,
  userId: string,
  ids: string[],
  now: Date,
): Promise<UploadedImageRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, r2_key, original_filename, mime_type, size_bytes, status, expires_at
       FROM uploaded_images
       WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .bind(userId, ...ids)
    .all<UploadedImageRow>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  return ids.map((id) => {
    const asset = byId.get(id);
    if (!asset) {
      throw new GenerationPipelineError("REFERENCE_IMAGE_FORBIDDEN", "参考图不存在或无权使用。");
    }
    const expired = asset.expires_at ? Date.parse(asset.expires_at) <= now.getTime() : false;
    const reusable = asset.status === "consumed" || (asset.status === "ready" && !expired);
    if (!reusable) {
      throw new GenerationPipelineError(
        "REFERENCE_IMAGE_UNAVAILABLE",
        "参考图已失效，请重新上传。",
      );
    }
    return asset;
  });
}

async function readReferenceImages(
  bucket: R2BucketLike,
  assets: UploadedImageRow[],
): Promise<ProviderReferenceImage[]> {
  if (assets.length === 0) return [];
  if (typeof bucket.get !== "function") {
    throw new GenerationPipelineError("R2_UNAVAILABLE", "参考图存储服务暂时不可用。");
  }
  return Promise.all(
    assets.map(async (asset) => {
      const object = await bucket.get!(asset.r2_key);
      if (!object) throw new GenerationPipelineError("REFERENCE_IMAGE_MISSING", "参考图读取失败。");
      return {
        bytes: new Uint8Array(await object.arrayBuffer()),
        filename: asset.original_filename ?? `${asset.id}.${asset.mime_type.split("/")[1]}`,
        mimeType: asset.mime_type,
      };
    }),
  );
}

async function prepareReferenceImages(
  providerKey: string,
  assets: UploadedImageRow[],
  dependencies: GenerationPipelineDependencies,
  now: Date,
): Promise<ProviderReferenceImage[]> {
  if (assets.length === 0) return [];
  if (providerKey !== "wuyinkeji") {
    return readReferenceImages(resolveBucket(dependencies), assets);
  }
  const env = resolveEnv(dependencies.env);
  return Promise.all(
    assets.map(async (asset) => ({
      // Wuyinkeji reads this signed endpoint; no private R2 key or bytes leave the service.
      bytes: new Uint8Array(),
      filename: asset.original_filename ?? `${asset.id}.${asset.mime_type.split("/")[1]}`,
      mimeType: asset.mime_type,
      supplierUrl: await createProviderInputUrl(asset.id, env, now),
    })),
  );
}

async function consumeReferenceAssets(
  db: D1Database,
  taskId: string,
  userId: string,
  assets: UploadedImageRow[],
): Promise<void> {
  if (assets.length === 0) return;
  const statements: ReturnType<D1Database["prepare"]>[] = [];
  const readyUpdateIndexes = new Set<number>();
  assets.forEach((asset, index) => {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO generation_task_input_images
           (task_id, uploaded_image_id, sort_order) VALUES (?, ?, ?)`,
        )
        .bind(taskId, asset.id, index),
    );
    if (asset.status === "ready") {
      readyUpdateIndexes.add(statements.length);
      statements.push(
        db
          .prepare(
            `UPDATE uploaded_images
             SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ? AND status = 'ready'`,
          )
          .bind(asset.id, userId),
      );
    }
  });

  const results = await db.batch(statements);
  for (const [index, result] of results.entries()) {
    if (!result.success || (readyUpdateIndexes.has(index) && getChanges(result) !== 1)) {
      throw new GenerationPipelineError("REFERENCE_IMAGE_CONFLICT", "参考图状态已变化，请重试。");
    }
  }
}

function safeErrorMessage(error: unknown): string {
  if (
    error instanceof InsufficientCreditsError ||
    error instanceof GenerationPipelineError ||
    error instanceof GenerationPricingError ||
    error instanceof ProviderRegistryError
  ) {
    return error.message;
  }
  return "图片生成失败，请稍后重试。";
}

async function failTaskAndRefund(
  db: D1Database,
  task: GenerationTaskRow,
  error: unknown,
  dependencies: GenerationPipelineDependencies,
): Promise<GenerationTaskView> {
  if (task.status === "succeeded") return toTaskView(db, task);
  const message = safeErrorMessage(error);
  await db
    .prepare(
      `UPDATE generation_tasks
       SET status = 'failed', error_code = ?, error_message = ?, last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND status != 'succeeded' AND refund_ledger_id IS NULL`,
    )
    .bind("GENERATION_FAILED", message, message, task.id, task.user_id)
    .run();

  const failedTask = (await getTaskRow(db, task.id, task.user_id)) ?? task;
  if (failedTask.deduction_ledger_id && !failedTask.refund_ledger_id) {
    await refundGenerationTask(db, {
      userId: task.user_id,
      taskId: task.id,
      amount: Number(task.cost_credits),
    });
  }

  return toTaskView(db, (await getTaskRow(db, task.id, task.user_id)) ?? task);
}

function imageExtension(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function downloadProviderImage(
  url: string,
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw attachPipelineDiagnostic(
      new GenerationPipelineError("INVALID_PROVIDER_IMAGE", "供应商图片地址无效。"),
      { stage: "result_validation", contentTypeAccepted: false, contentLengthAccepted: false },
    );
  }
  let response: Response | undefined;
  let downloadAttemptCount = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    downloadAttemptCount = attempt;
    try {
      response = await fetchImpl(parsed, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "image/png,image/jpeg,image/webp" },
      });
    } catch {
      if (attempt < 3) {
        await sleep(PROVIDER_DOWNLOAD_RETRY_DELAYS_MS[attempt - 1]);
        continue;
      }
      throw attachPipelineDiagnostic(
        new GenerationPipelineError("PROVIDER_DOWNLOAD_FAILED", "结果图片下载失败。"),
        { stage: "result_download", downloadAttemptCount, downloadFetchThrew: true, downloadHttpOk: false },
      );
    }

    if (response.ok) break;

    const retryable = response.status === 404 || response.status === 408 || response.status === 425 ||
      response.status === 429 || response.status === 500 || response.status === 502 ||
      response.status === 503 || response.status === 504;
    await response.body?.cancel().catch(() => undefined);
    if (retryable && attempt < 3) {
      await sleep(PROVIDER_DOWNLOAD_RETRY_DELAYS_MS[attempt - 1]);
      continue;
    }
    throw attachPipelineDiagnostic(
      new GenerationPipelineError("PROVIDER_DOWNLOAD_FAILED", "结果图片下载失败。"),
      { stage: "result_download", downloadAttemptCount, downloadFetchThrew: false, downloadHttpOk: false, downloadStatus: response.status },
    );
  }
  if (!response) {
    throw new GenerationPipelineError("PROVIDER_DOWNLOAD_FAILED", "结果图片下载失败。");
  }
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    await response.body?.cancel().catch(() => undefined);
    throw attachPipelineDiagnostic(
      new GenerationPipelineError("INVALID_PROVIDER_IMAGE", "供应商返回的图片格式无效。"),
      { stage: "result_validation", downloadAttemptCount, downloadHttpOk: true, downloadStatus: response.status, contentTypeAccepted: false },
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    await response.body?.cancel().catch(() => undefined);
    throw attachPipelineDiagnostic(
      new GenerationPipelineError("PROVIDER_DOWNLOAD_FAILED", "结果图片下载失败。"),
      { stage: "result_download", downloadAttemptCount, downloadFetchThrew: false, downloadHttpOk: true, downloadStatus: response.status },
    );
  }
  if (!bytes.length || bytes.length > MAX_PROVIDER_DOWNLOAD_BYTES) {
    throw attachPipelineDiagnostic(
      new GenerationPipelineError("INVALID_PROVIDER_IMAGE", "供应商返回的图片大小无效。"),
      { stage: "result_validation", downloadAttemptCount, downloadHttpOk: true, downloadStatus: response.status, contentTypeAccepted: true, contentLengthAccepted: false },
    );
  }
  return { bytes, mimeType };
}

async function archiveProviderImage(
  image: NormalizedProviderImage,
  task: GenerationTaskRow,
  dependencies: GenerationPipelineDependencies,
): Promise<{ r2Key: string | null; resultUrl: string }> {
  const source =
    image.kind === "base64"
      ? { bytes: image.bytes, mimeType: image.mimeType }
      : await downloadProviderImage(
        image.url,
        dependencies.fetchImpl ?? fetch,
        dependencies.downloadSleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      );
  const extension = imageExtension(source.mimeType);
  const now = (dependencies.now ?? (() => new Date()))();
  const safeUserId = task.user_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTaskId = task.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = `generated/${safeUserId}/${now.getUTCFullYear()}/${String(
    now.getUTCMonth() + 1,
  ).padStart(2, "0")}/${safeTaskId}.${extension}`;
  const bucket = resolveBucket(dependencies);
  try {
    await bucket.put(key, source.bytes, { httpMetadata: { contentType: source.mimeType } });
  } catch {
    throw attachPipelineDiagnostic(
      new GenerationPipelineError("R2_ARCHIVE_FAILED", "生成结果归档失败。"),
      { stage: "r2_archive", r2PutAttempted: true },
    );
  }
  return {
    r2Key: key,
    resultUrl: `/api/download-image?taskId=${encodeURIComponent(task.id)}`,
  };
}

export async function createGenerationTaskForUser(
  userId: string,
  rawInput: GenerationCreateInput,
  dependencies: GenerationPipelineDependencies = {},
): Promise<GenerationTaskView> {
  const db = resolveDb(dependencies);
  const now = (dependencies.now ?? (() => new Date()))();
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const prompt = rawInput.prompt.trim();
  const modelKey = rawInput.modelKey.trim();
  const idempotencyKey = rawInput.idempotencyKey.trim();
  const referenceImageIds = [...new Set(rawInput.referenceImageIds.map((id) => id.trim()))];
  if (!prompt || prompt.length > 4000) {
    throw new GenerationPipelineError("INVALID_PROMPT", "请输入有效的画面描述。");
  }
  if (!modelKey || !idempotencyKey || idempotencyKey.length > 128) {
    throw new GenerationPipelineError("INVALID_REQUEST", "生成请求参数无效。");
  }
  if (referenceImageIds.length > MAX_REFERENCE_IMAGES) {
    throw new GenerationPipelineError("TOO_MANY_REFERENCE_IMAGES", "参考图最多 5 张。");
  }

  const existing = await getTaskByIdempotency(db, userId, idempotencyKey);
  if (existing) return toTaskView(db, existing);

  const mode = referenceImageIds.length === 0 ? "text_to_image" : "image_to_image";
  const model = await getGenerationQuote(db, {
    modelKey,
    mode,
    referenceImageCount: referenceImageIds.length,
  });
  const provider = await resolveProviderRegistry(dependencies).getRuntime(model.provider, {
    db,
    env: dependencies.env,
    fetchImpl: dependencies.fetchImpl,
  });
  validateProviderCapabilities(provider, {
    mode: mode === "image_to_image" ? "image-to-image" : "text-to-image",
    referenceImageCount: referenceImageIds.length,
    aspectRatio: rawInput.parameters.aspectRatio,
    quality: rawInput.parameters.quality,
  });
  const assets = await loadReferenceAssets(db, userId, referenceImageIds, now);
  const taskId = idFactory();
  const costCredits = model.costCredits;
  const requestJson = JSON.stringify({
    aspectRatio: rawInput.parameters.aspectRatio,
    quality: rawInput.parameters.quality,
    referenceImageIds,
    costCredits,
  });
  const reserved = await db
    .prepare(
      `INSERT OR IGNORE INTO generation_tasks (
         id, user_id, model_id, model_key, task_type, prompt, status, cost_credits,
         request_json, idempotency_key, provider, provider_model, generation_mode, timeout_at
       ) VALUES (?, ?, ?, ?, 'image', ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      taskId,
      userId,
      model.id,
      model.modelKey,
      prompt,
      costCredits,
      requestJson,
      idempotencyKey,
      model.provider,
      model.providerModel,
      mode,
      new Date(now.getTime() + TASK_TIMEOUT_MS).toISOString(),
    )
    .run();
  if (!reserved.success || getChanges(reserved) !== 1) {
    const concurrent = await getTaskByIdempotency(db, userId, idempotencyKey);
    if (concurrent) return toTaskView(db, concurrent, model.displayName);
    throw new GenerationPipelineError("TASK_CREATE_FAILED", "生成任务创建失败。");
  }

  try {
    const charge = await chargeGenerationTask(db, {
      userId,
      taskId,
      amount: costCredits,
    });
    if (!charge.charged) {
      return toTaskView(db, (await getTaskRow(db, taskId, userId))!);
    }
  } catch (error) {
    await db
      .prepare("DELETE FROM generation_tasks WHERE id = ? AND deduction_ledger_id IS NULL")
      .bind(taskId)
      .run();
    throw error;
  }

  let task = await getTaskRow(db, taskId, userId);
  if (!task) throw new GenerationPipelineError("TASK_CREATE_FAILED", "生成任务创建失败。");

  try {
    const referenceImages = await prepareReferenceImages(model.provider, assets, dependencies, now);
    await consumeReferenceAssets(db, taskId, userId, assets);
    const providerInput: ImageGenerationInput = {
      model: model.providerModel,
      prompt,
      aspectRatio: rawInput.parameters.aspectRatio,
      quality: rawInput.parameters.quality,
      referenceImages,
      count: 1,
    };
    const created = await provider.createTask(providerInput);
    await db
      .prepare(
        `UPDATE generation_tasks
         SET provider_task_id = ?, status = 'running', attempt_count = attempt_count + 1,
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status = 'queued'`,
      )
      .bind(created.taskId, taskId, userId)
      .run();
  } catch (error) {
    task = (await getTaskRow(db, taskId, userId)) ?? task;
    return failTaskAndRefund(db, task, error, dependencies);
  }

  task = (await getTaskRow(db, taskId, userId)) ?? task;
  return toTaskView(db, task, model.displayName);
}

export async function pollGenerationTaskForUser(
  userId: string,
  taskId: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<GenerationTaskView> {
  const db = resolveDb(dependencies);
  let task = await getTaskRow(db, taskId, userId);
  if (!task) throw new GenerationPipelineError("TASK_NOT_FOUND", "生成任务不存在。");
  if (task.status === "succeeded" || task.status === "canceled") {
    return toTaskView(db, task);
  }
  if (task.status === "failed") {
    if (task.deduction_ledger_id && !task.refund_ledger_id) {
      return failTaskAndRefund(db, task, new GenerationCreditRecoveryError("生成任务退款待完成。"), dependencies);
    }
    return toTaskView(db, task);
  }
  if (!task.provider_task_id) {
    return failTaskAndRefund(
      db,
      task,
      new GenerationPipelineError("PROVIDER_TASK_MISSING", "生成任务启动失败。"),
      dependencies,
    );
  }
  const now = (dependencies.now ?? (() => new Date()))();
  if (task.timeout_at && Date.parse(task.timeout_at) <= now.getTime()) {
    return failTaskAndRefund(
      db,
      task,
      new GenerationPipelineError("GENERATION_TIMEOUT", "生成任务超时。"),
      dependencies,
    );
  }

  try {
    if (!task.provider) {
      throw new GenerationPipelineError("PROVIDER_MISSING", "任务供应商配置缺失。");
    }
    const provider = await resolveProviderRegistry(dependencies).getRuntime(task.provider, {
      db,
      env: dependencies.env,
      fetchImpl: dependencies.fetchImpl,
    });
    const providerMode: ProviderGenerationMode =
      task.generation_mode === "image_to_image" ? "image-to-image" : "text-to-image";
    let result;
    try {
      result = await provider.getTask({ taskId: task.provider_task_id, mode: providerMode });
    } catch (error) {
      const diagnostic = getWuyinkejiPollErrorDiagnostic(error);
      if (diagnostic) logWuyinkejiStageFailure(task, diagnostic, error);
      return failTaskAndRefund(db, task, error, dependencies);
    }
    if (result.status === "queued" || result.status === "processing") {
      await db
        .prepare(
          `UPDATE generation_tasks SET attempt_count = attempt_count + 1,
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'running'`,
        )
        .bind(task.id, userId)
        .run();
      return toTaskView(db, (await getTaskRow(db, task.id, userId)) ?? task);
    }
    if (result.status === "failed") {
      const diagnostic = getWuyinkejiResultDiagnostic(result);
      if (diagnostic) logWuyinkejiStageFailure(task, diagnostic);
      return failTaskAndRefund(
        db,
        task,
        new GenerationPipelineError("PROVIDER_FAILED", result.error?.message ?? "图片生成失败。"),
        dependencies,
      );
    }
    const image = result.images[0];
    if (!image) throw new GenerationPipelineError("EMPTY_PROVIDER_RESULT", "生成结果为空。");
    let archived: { r2Key: string | null; resultUrl: string; archiveStatus: "not_required" | "pending" | "archived" };
    try {
      archived = task.provider === "wuyinkeji" && image.kind === "url"
        ? { r2Key: null, resultUrl: image.url, archiveStatus: "pending" }
        : { ...(await archiveProviderImage(image, task, dependencies)), archiveStatus: "archived" };
    } catch (error) {
      const diagnostic = getPipelineDiagnostic(error);
      if (diagnostic) logWuyinkejiStageFailure(task, diagnostic, error);
      return failTaskAndRefund(db, task, error, dependencies);
    }
    const newId = dependencies.idFactory ?? (() => crypto.randomUUID());
    const historyId = newId();
    const archiveJobId = archived.archiveStatus === "pending" ? newId() : null;
    try {
      await db
        .prepare(
          `INSERT OR IGNORE INTO generation_history (
             id, task_id, user_id, model_key, task_type, prompt, result_image_url,
             result_image_r2_key, cost_credits, archive_status
           ) VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?)`,
        )
        .bind(
          historyId,
          task.id,
          userId,
          task.model_key,
          task.prompt,
          archived.resultUrl,
          archived.r2Key,
          Number(task.cost_credits),
          archived.archiveStatus,
        )
        .run();
      await db
        .prepare(
          `UPDATE generation_tasks
           SET status = 'succeeded', result_image_url = ?, result_image_r2_key = ?, archive_status = ?, archive_job_id = ?,
               completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
               error_code = NULL, error_message = NULL, last_error = NULL
           WHERE id = ? AND user_id = ? AND status = 'running'`,
        )
        .bind(archived.resultUrl, archived.r2Key, archived.archiveStatus, archiveJobId, task.id, userId)
        .run();
    } catch (error) {
      const diagnostic = attachPipelineDiagnostic(
        error instanceof Error
          ? error
          : new GenerationPipelineError("HISTORY_WRITE_FAILED", "生成历史写入失败。"),
        { stage: "history_write", historyWriteAttempted: true },
      );
      logWuyinkejiStageFailure(task, getPipelineDiagnostic(diagnostic)!, diagnostic);
      return failTaskAndRefund(db, task, diagnostic, dependencies);
    }
  } catch (error) {
    const diagnostic = getPipelineDiagnostic(error);
    if (diagnostic) logWuyinkejiStageFailure(task, diagnostic, error);
    task = (await getTaskRow(db, task.id, userId)) ?? task;
    return failTaskAndRefund(db, task, error, dependencies);
  }

  task = (await getTaskRow(db, task.id, userId)) ?? task;
  if (task.status === "succeeded") {
    await cleanupGenerationHistoryForUser(userId, dependencies).catch(() => {
      console.warn("history_retention_cleanup_failed", { operation: "generation_complete" });
    });
  }
  return toTaskView(db, task);
}

export async function listGenerationTasksForUser(
  userId: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<{ items: GenerationTaskView[] }> {
  const db = resolveDb(dependencies);
  const rows = await db
    .prepare("SELECT * FROM generation_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
    .bind(userId)
    .all<GenerationTaskRow>();
  return { items: await Promise.all(rows.results.map((row) => toTaskView(db, row))) };
}

type HistoryRetentionRow = { id: string; task_id: string | null; result_image_r2_key: string | null; archive_status: string | null };

function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - GENERATION_HISTORY_RETENTION_MS).toISOString();
}

/** Best-effort retention: never fetches supplier URLs and never affects generation success. */
export async function cleanupGenerationHistoryForUser(
  userId: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<{ removed: number; deferred: number }> {
  const db = resolveDb(dependencies);
  const cutoff = retentionCutoff((dependencies.now ?? (() => new Date()))());
  const candidates = await db.prepare(
    `SELECT h.id, h.task_id, h.result_image_r2_key, t.archive_status
     FROM generation_history h
     LEFT JOIN generation_tasks t ON t.id = h.task_id
     WHERE h.user_id = ? AND h.deleted_at IS NULL
       AND (h.created_at < ? OR h.id IN (
         SELECT id FROM generation_history
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT -1 OFFSET ?
       ))
       AND (t.archive_status IS NULL OR t.archive_status <> 'processing')
     ORDER BY h.created_at ASC LIMIT 200`,
  ).bind(userId, cutoff, userId, GENERATION_HISTORY_MAX_ITEMS).all<HistoryRetentionRow>();
  let removed = 0;
  let deferred = 0;
  for (const row of candidates.results) {
    if (row.result_image_r2_key) {
      const bucket = dependencies.bucket ?? resolveEnv(dependencies.env).MUMO_GENERATED_IMAGES;
      if (!bucket?.delete) { deferred += 1; continue; }
      try { await bucket.delete(row.result_image_r2_key); } catch { deferred += 1; continue; }
    }
    await db.batch([
      db.prepare("DELETE FROM generation_history WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(row.id, userId),
      db.prepare("UPDATE generation_tasks SET result_image_r2_key = NULL, archive_status = CASE WHEN archive_status = 'pending' THEN 'not_required' ELSE archive_status END, archive_job_id = CASE WHEN archive_status = 'pending' THEN NULL ELSE archive_job_id END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND archive_status <> 'processing'").bind(row.task_id, userId),
    ]);
    removed += 1;
  }
  return { removed, deferred };
}

export async function listGenerationHistoryForUser(
  userId: string,
  input: { cursor?: string | null } = {},
  dependencies: GenerationPipelineDependencies = {},
) {
  const db = resolveDb(dependencies);
  const cursor = decodeGenerationHistoryCursor(input.cursor);
  await cleanupGenerationHistoryForUser(userId, dependencies).catch(() => console.warn("history_retention_cleanup_failed", { operation: "list" }));
  const cutoff = retentionCutoff((dependencies.now ?? (() => new Date()))());
  const rows = await db
    .prepare(
      `SELECT h.id, h.task_id, h.model_key, h.prompt, h.result_image_url, h.result_image_r2_key,
              h.cost_credits, h.created_at, t.request_json
       FROM generation_history h
       LEFT JOIN generation_tasks t ON t.id = h.task_id
       WHERE h.user_id = ? AND h.deleted_at IS NULL AND h.created_at >= ?
         AND (? IS NULL OR h.created_at < ? OR (h.created_at = ? AND h.id < ?))
       ORDER BY h.created_at DESC, h.id DESC LIMIT ?`,
    )
    .bind(
      userId,
      cutoff,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      GENERATION_HISTORY_PAGE_SIZE + 1,
    )
    .all<{
      id: string;
      task_id: string | null;
      model_key: string;
      prompt: string | null;
      result_image_url: string;
      result_image_r2_key: string | null;
      cost_credits: number;
      created_at: string;
      request_json: string | null;
    }>();
  const hasMore = rows.results.length > GENERATION_HISTORY_PAGE_SIZE;
  const pageRows = rows.results.slice(0, GENERATION_HISTORY_PAGE_SIZE);
  const lastRow = pageRows.at(-1);
  return {
    items: pageRows.map((row) => ({
      id: row.id,
      model: row.model_key,
      modelKey: row.model_key,
      prompt: row.prompt,
      finalPrompt: row.prompt,
      styleName: null,
      aspectRatio: parseRequestJson(row.request_json).aspectRatio,
      createdAt: row.created_at,
      thumbnailUrl: row.task_id ? `/api/history/thumbnail?taskId=${encodeURIComponent(row.task_id)}` : null,
      originalImageUrl: row.result_image_r2_key && row.task_id ? `/api/download-image?taskId=${encodeURIComponent(row.task_id)}` : "",
      generationTaskId: row.task_id,
      inputParams: parseRequestJson(row.request_json),
      cost: Number(row.cost_credits),
      image_url: row.result_image_r2_key && row.task_id ? `/api/download-image?taskId=${encodeURIComponent(row.task_id)}` : "",
      created_at: row.created_at,
    })),
    nextCursor: hasMore && lastRow
      ? encodeGenerationHistoryCursor({ createdAt: lastRow.created_at, id: lastRow.id })
      : null,
    hasMore,
    pageSize: GENERATION_HISTORY_PAGE_SIZE,
    maxKeep: GENERATION_HISTORY_MAX_ITEMS,
    maxDays: 30,
  };
}

export async function authorizeGeneratedThumbnailForUser(
  userId: string,
  taskId: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<{
  thumbnailKey: string;
  displayReady: boolean;
  archiveStatus: GenerationTaskRow["archive_status"];
}> {
  const db = resolveDb(dependencies);
  const task = await db.prepare(
    `SELECT result_image_r2_key, archive_status FROM generation_tasks
     WHERE id = ? AND user_id = ? AND status = 'succeeded' LIMIT 1`,
  ).bind(taskId, userId).first<{
    result_image_r2_key: string | null;
    archive_status: GenerationTaskRow["archive_status"];
  }>();
  if (!task) {
    throw new GenerationPipelineError("THUMBNAIL_NOT_FOUND", "History thumbnail is unavailable.");
  }
  return {
    thumbnailKey: generatedThumbnailKey(userId, taskId),
    displayReady: Boolean(task.result_image_r2_key),
    archiveStatus: task.archive_status,
  };
}

export async function getGeneratedThumbnailObject(
  thumbnailKey: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<{ body: ReadableStream; contentType: string; size?: number }> {
  const bucket = resolveBucket(dependencies);
  if (typeof bucket.get !== "function") {
    throw new GenerationPipelineError("R2_UNAVAILABLE", "Thumbnail storage is unavailable.");
  }
  const object = await bucket.get(thumbnailKey);
  if (!object) throw new GenerationPipelineError("THUMBNAIL_NOT_FOUND", "History thumbnail is unavailable.");
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "image/webp",
    size: object.size,
  };
}

export async function getGeneratedImageForUser(
  userId: string,
  taskId: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<{ body: ReadableStream; contentType: string; size?: number }> {
  const db = resolveDb(dependencies);
  const task = await db
    .prepare(
      `SELECT result_image_r2_key FROM generation_tasks
       WHERE id = ? AND user_id = ? AND status = 'succeeded' LIMIT 1`,
    )
    .bind(taskId, userId)
    .first<{ result_image_r2_key: string | null }>();
  if (!task?.result_image_r2_key) {
    throw new GenerationPipelineError("RESULT_NOT_FOUND", "生成结果不存在。");
  }
  const bucket = resolveBucket(dependencies);
  if (typeof bucket.get !== "function") {
    throw new GenerationPipelineError("R2_UNAVAILABLE", "图片存储服务暂时不可用。");
  }
  const object = await bucket.get(task.result_image_r2_key);
  if (!object) throw new GenerationPipelineError("RESULT_NOT_FOUND", "生成结果不存在。");
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "image/png",
    size: object.size,
  };
}

export async function getGeneratedImageInlineForUser(
  userId: string,
  taskId: string,
  dependencies: GenerationPipelineDependencies = {},
): Promise<{ body: ReadableStream; contentType: string; size?: number }> {
  const db = resolveDb(dependencies);
  const task = await db
    .prepare(
      `SELECT status, result_image_r2_key FROM generation_tasks
       WHERE id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(taskId, userId)
    .first<{ status: string; result_image_r2_key: string | null }>();
  if (!task) {
    throw new GenerationPipelineError("RESULT_NOT_FOUND", "生成结果不存在。");
  }
  if (task.status !== "succeeded" || !task.result_image_r2_key) {
    throw new GenerationPipelineError("RESULT_NOT_READY", "生成结果尚未归档。");
  }
  const bucket = resolveBucket(dependencies);
  if (typeof bucket.get !== "function") {
    throw new GenerationPipelineError("R2_UNAVAILABLE", "图片存储服务暂时不可用。");
  }
  const object = await bucket.get(task.result_image_r2_key);
  if (!object) throw new GenerationPipelineError("RESULT_NOT_FOUND", "生成结果不存在。");
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "image/png",
    size: object.size,
  };
}
