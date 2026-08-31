import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { R2BucketLike } from "../src/env";
import type { D1Database, D1ExecResult, D1PreparedStatement, D1Result } from "../src/lib/d1";
import {
  createGenerationTaskForUser,
  cleanupGenerationHistoryForUser,
  GenerationPipelineError,
  GENERATION_HISTORY_PAGE_SIZE,
  authorizeGeneratedThumbnailForUser,
  generatedThumbnailKey,
  getGeneratedThumbnailObject,
  listGenerationHistoryForUser,
  getGeneratedImageForUser,
  pollGenerationTaskForUser,
  type GenerationCreateInput,
  type GenerationPipelineDependencies,
} from "../src/lib/generation.server";
import { generatedImageDownloadFilename, generatedImageDownloadUrl } from "../src/lib/image-url";
import { chargeGenerationTask, refundGenerationTask } from "../src/lib/credits.server";
import { cancelGenerationTaskForUser } from "../src/lib/admin.server";
import { normalizeModelBadgeColor, updateModelConfiguration } from "../src/lib/admin.server";
import { getProviderConfigurationStatuses } from "../src/lib/providers/provider-configuration.server";
import type {
  ImageGenerationInput,
  ImageProvider,
  ProviderTaskCreated,
  ProviderTaskResult,
} from "../src/lib/providers/image-provider.server";
import { MockImageProvider } from "../src/lib/providers/mock-image.server";
import {
  createDefaultProviderRegistry,
  ProviderRegistryError,
} from "../src/lib/providers/provider-registry.server";
import { WuyinkejiImageProvider } from "../src/lib/providers/wuyinkeji-image.server";
import { createProviderInputUrl, getSignedProviderInputImage } from "../src/lib/provider-input-image.server";
import {
  MAX_PROVIDER_THUMBNAIL_BYTES,
  claimProviderArchiveJob,
  createProviderArchiveToken,
  getProviderArchiveJob,
  getProviderThumbnailBackfillOriginal,
  ingestProviderArchive,
  ingestProviderArchiveThumbnail,
  ingestProviderThumbnailBackfill,
  listProviderThumbnailBackfillJobs,
  reportProviderArchiveFailure,
} from "../src/lib/provider-result-archive.server";

class MemoryStatement implements D1PreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly database: Database,
    private readonly sql: string,
    private readonly beforeRun: (sql: string) => { success?: boolean; skip?: boolean },
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.database.query(this.sql).get(...this.bindings) as T | null;
    if (!row || !columnName) return row;
    return (row as Record<string, T>)[columnName] ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const results = this.database.query(this.sql).all(...this.bindings) as T[];
    return { results, success: true, meta: { changes: 0 } };
  }

  async run<T>(): Promise<D1Result<T>> {
    const override = this.beforeRun(this.sql);
    if (override.skip) {
      return { results: [], success: override.success ?? true, meta: { changes: 0 } };
    }
    const result = this.database.query(this.sql).run(...this.bindings);
    return {
      results: [],
      success: override.success ?? true,
      meta: { changes: result.changes },
    };
  }

  async raw<T>(): Promise<T[]> {
    return this.database.query(this.sql).values(...this.bindings) as T[];
  }
}

class MemoryD1 implements D1Database {
  failNextStatementMatching: RegExp | null = null;
  returnSuccessFalseNextStatementMatching: RegExp | null = null;
  returnZeroChangesNextStatementMatching: RegExp | null = null;
  private batchTail: Promise<void> = Promise.resolve();

  constructor(readonly database = new Database(":memory:")) {}

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this.database, query, (sql) => {
      if (this.failNextStatementMatching?.test(sql)) {
        this.failNextStatementMatching = null;
        throw new Error("injected D1 statement failure");
      }
      if (this.returnSuccessFalseNextStatementMatching?.test(sql)) {
        this.returnSuccessFalseNextStatementMatching = null;
        return { success: false };
      }
      if (this.returnZeroChangesNextStatementMatching?.test(sql)) {
        this.returnZeroChangesNextStatementMatching = null;
        return { skip: true };
      }
      return {};
    });
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    const previousBatch = this.batchTail;
    let releaseBatch!: () => void;
    this.batchTail = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    await previousBatch;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results: Array<D1Result<T>> = [];
      for (const statement of statements) {
        const result = await statement.run<T>();
        if (result.success !== true) throw new Error("injected D1 unsuccessful result");
        results.push(result);
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      releaseBatch();
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.database.exec(query);
    return { count: 0, duration: 0 };
  }
}

class MemoryR2 implements R2BucketLike {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  getCalls: string[] = [];
  failPut = false;

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    if (this.failPut) throw new Error("mock R2 put failed");
    let bytes: Uint8Array;
    if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      );
    } else {
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    }
    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
  }

  async get(key: string) {
    this.getCalls.push(key);
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new ReadableStream({
        start: (controller) => {
          controller.enqueue(Uint8Array.from(object.bytes));
          controller.close();
        },
      }),
      arrayBuffer: async () => Uint8Array.from(object.bytes).buffer,
      size: object.bytes.byteLength,
      httpMetadata: { contentType: object.contentType },
    };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { size: object.bytes.byteLength, httpMetadata: { contentType: object.contentType } };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class PipelineProvider implements ImageProvider {
  readonly key = "mock";
  readonly capabilities = {
    modes: ["text-to-image", "image-to-image"],
    maxReferenceImages: 5,
    qualities: ["1K", "2K", "4K"],
  } as const;
  createCalls: ImageGenerationInput[] = [];
  createError: Error | null = null;
  pollError: Error | null = null;
  pollResults: ProviderTaskResult[] = [];
  pollResult: ProviderTaskResult = {
    taskId: "provider-task",
    status: "completed",
    images: [
      { kind: "base64", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" },
    ],
  };

  async createTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    this.createCalls.push(input);
    if (this.createError) throw this.createError;
    return {
      taskId: "provider-task",
      mode: input.referenceImages.length ? "image-to-image" : "text-to-image",
      status: "queued",
    };
  }

  async createTextToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    return this.createTask({ ...input, referenceImages: [] });
  }

  async createImageToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    return this.createTask(input);
  }

  async pollTask(): Promise<ProviderTaskResult> {
    if (this.pollError) throw this.pollError;
    return this.pollResults.shift() ?? this.pollResult;
  }

  async getTask(): Promise<ProviderTaskResult> {
    return this.pollTask();
  }

  async pollTextToImageTask(): Promise<ProviderTaskResult> {
    return this.pollTask();
  }

  async pollImageToImageTask(): Promise<ProviderTaskResult> {
    return this.pollTask();
  }
}

const USER_ID = "user-1";
const NOW = new Date("2026-07-14T12:00:00.000Z");

function schema(database: Database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE models_config (
       id TEXT PRIMARY KEY, model_key TEXT UNIQUE, display_name TEXT, provider TEXT,
       provider_model TEXT, cost_credits INTEGER, is_enabled INTEGER, sort_order INTEGER,
       supported_modes TEXT, max_reference_images INTEGER, description TEXT, badge_text_color TEXT, updated_at TEXT
    );
    CREATE TABLE user_credits (
      user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL, total_granted INTEGER DEFAULT 0,
      total_used INTEGER DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE credit_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, amount INTEGER, balance_after INTEGER,
      reason TEXT, ref_type TEXT, ref_id TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE uploaded_images (
      id TEXT PRIMARY KEY, user_id TEXT, r2_key TEXT UNIQUE, original_filename TEXT,
      mime_type TEXT, size_bytes INTEGER, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT, consumed_at TEXT
    );
    CREATE TABLE generation_tasks (
      id TEXT PRIMARY KEY, user_id TEXT, model_id TEXT, model_key TEXT, task_type TEXT,
      prompt TEXT, status TEXT, cost_credits INTEGER, provider_task_id TEXT,
      result_image_url TEXT, result_image_r2_key TEXT, error_code TEXT, error_message TEXT,
      request_json TEXT, response_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT, started_at TEXT, completed_at TEXT, idempotency_key TEXT,
      provider TEXT, provider_model TEXT, deduction_ledger_id TEXT, refund_ledger_id TEXT, generation_mode TEXT,
      attempt_count INTEGER DEFAULT 0, last_error TEXT, timeout_at TEXT,
      archive_status TEXT NOT NULL DEFAULT 'not_required', archive_attempt_count INTEGER NOT NULL DEFAULT 0,
      archive_last_error_code TEXT, archived_at TEXT, archive_job_id TEXT, archive_claimed_at TEXT
    );
    CREATE TABLE generation_history (
      id TEXT PRIMARY KEY, task_id TEXT, user_id TEXT, model_key TEXT, task_type TEXT,
      prompt TEXT, result_image_url TEXT, result_image_r2_key TEXT, cost_credits INTEGER,
      archive_status TEXT NOT NULL DEFAULT 'not_required', archive_attempt_count INTEGER NOT NULL DEFAULT 0,
      archive_last_error_code TEXT, archived_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
    );
    CREATE TABLE generation_task_input_images (
      task_id TEXT, uploaded_image_id TEXT, sort_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(task_id, uploaded_image_id)
    );
    CREATE UNIQUE INDEX task_idempotency ON generation_tasks(user_id, idempotency_key);
    CREATE UNIQUE INDEX ledger_generation ON credit_ledger(ref_type, ref_id, reason);
    CREATE UNIQUE INDEX history_task ON generation_history(task_id);
  `);
  database.query("INSERT INTO users (id) VALUES (?)").run(USER_ID);
  database
    .query(
      `INSERT INTO models_config
       (id, model_key, display_name, provider, provider_model, cost_credits, is_enabled,
        supported_modes, max_reference_images)
       VALUES ('model-1', 'test-model', 'Test Model', 'mock', 'mock-image', 7, 1,
        '["text_to_image","image_to_image"]', 5)`,
    )
    .run();
  database
    .query(
      `INSERT INTO models_config
       (id, model_key, display_name, provider, provider_model, cost_credits, is_enabled,
        supported_modes, max_reference_images)
       VALUES ('model-pro', 'gpt-image-2-pro', 'GPT-IMAGE-2.0 PRO', 'vibelearning', 'gpt-image-2', 7, 1,
        '["text_to_image","image_to_image"]', 5)`,
    )
    .run();
  database
    .query("INSERT INTO user_credits (user_id, balance, total_used) VALUES (?, 20, 0)")
    .run(USER_ID);
}

function setup() {
  const db = new MemoryD1();
  schema(db.database);
  const bucket = new MemoryR2();
  const provider = new PipelineProvider();
  let id = 0;
  const dependencies: GenerationPipelineDependencies = {
    db,
    bucket,
    provider,
    now: () => NOW,
    idFactory: () => `id-${++id}`,
    downloadSleep: async () => undefined,
  };
  return { db, bucket, provider, dependencies };
}

type StageFailureEvent = Record<string, unknown>;

function captureStageFailureEvents() {
  const events: StageFailureEvent[] = [];
  const original = console.error;
  console.error = ((value: unknown) => {
    if (value && typeof value === "object" && (value as Record<string, unknown>).event === "mumo_wuyinkeji_generation_stage_failure_v1") {
      events.push(value as StageFailureEvent);
    }
  }) as typeof console.error;
  return {
    events,
    restore: () => { console.error = original; },
  };
}

function configureWuyinkejiPipeline(
  db: MemoryD1,
  dependencies: GenerationPipelineDependencies,
  provider: ImageProvider,
) {
  db.database.query("UPDATE models_config SET provider = 'wuyinkeji', provider_model = 'image_gpt', supported_modes = '[\"text_to_image\",\"image_to_image\"]', max_reference_images = 5 WHERE model_key = 'test-model'").run();
  dependencies.providerRegistry = createDefaultProviderRegistry({
    allowRealProviders: true,
    wuyinkejiFactory: () => provider,
  });
}

function expectSafeStageEvent(event: StageFailureEvent, stage: string) {
  expect(event).toMatchObject({
    event: "mumo_wuyinkeji_generation_stage_failure_v1",
    diagnosticRevision: "wuyinkeji-generation-stage-v1",
    provider: "wuyinkeji",
    providerModel: "image_gpt",
    stage,
  });
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain("wuyinkeji-test-key");
  expect(serialized).not.toContain("https://fixture.example/result.webp");
  expect(serialized).not.toContain("A product on a clean background");
  expect(serialized).not.toContain(USER_ID);
  expect(serialized).not.toContain("generation-task");
}

function input(overrides: Partial<GenerationCreateInput> = {}): GenerationCreateInput {
  return {
    modelKey: "test-model",
    prompt: "A product on a clean background",
    referenceImageIds: [],
    parameters: { aspectRatio: "1:1", quality: "1K" },
    idempotencyKey: "request-1",
    ...overrides,
  };
}

function balance(db: MemoryD1): number {
  const row = db.database
    .query("SELECT balance FROM user_credits WHERE user_id = ?")
    .get(USER_ID) as { balance: number };
  return row.balance;
}

function count(db: MemoryD1, table: string): number {
  const allowed = new Set(["generation_tasks", "credit_ledger", "generation_history"]);
  if (!allowed.has(table)) throw new Error("invalid table");
  const row = db.database.query(`SELECT COUNT(*) AS value FROM ${table}`).get() as {
    value: number;
  };
  return row.value;
}

function taskRow(db: MemoryD1) {
  return db.database.query(
    "SELECT status, deduction_ledger_id, refund_ledger_id FROM generation_tasks LIMIT 1",
  ).get() as { status: string; deduction_ledger_id: string | null; refund_ledger_id: string | null };
}

function addAsset(
  db: MemoryD1,
  bucket: MemoryR2,
  options: { id?: string; userId?: string; status?: string; expiresAt?: string } = {},
) {
  const userId = options.userId ?? USER_ID;
  const id = options.id ?? "asset-1";
  const key = `inputs/user/${id}.png`;
  db.database
    .query(
      `INSERT INTO uploaded_images
       (id, user_id, r2_key, original_filename, mime_type, size_bytes, status, expires_at)
       VALUES (?, ?, ?, 'asset.png', 'image/png', 4, ?, ?)`,
    )
    .run(id, userId, key, options.status ?? "ready", options.expiresAt ?? "2026-07-15T12:00:00.000Z");
  bucket.objects.set(key, {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    contentType: "image/png",
  });
}

function addTask(
  db: MemoryD1,
  options: { id: string; userId?: string; status?: string; deductionLedgerId?: string | null },
) {
  db.database
    .query(
      `INSERT INTO generation_tasks
       (id, user_id, model_key, task_type, prompt, status, cost_credits, deduction_ledger_id)
       VALUES (?, ?, 'test-model', 'image', 'task', ?, 7, ?)`,
    )
    .run(
      options.id,
      options.userId ?? USER_ID,
      options.status ?? "queued",
      options.deductionLedgerId ?? null,
    );
}

describe("signed provider input image URLs", () => {
  test("serve only the signed ready asset and never expose its private R2 key", async () => {
    const { db, bucket } = setup();
    addAsset(db, bucket);
    const env = {
      MUMO_PUBLIC_ORIGIN: "https://mumo.test",
      MUMO_PROVIDER_INPUT_SIGNING_KEY_V1: "test-provider-input-signing-key",
    };
    const url = new URL(await createProviderInputUrl("asset-1", env, NOW));
    expect(url.origin).toBe("https://mumo.test");
    expect(url.pathname).toBe("/api/provider-input-image/asset-1");
    expect(url.toString()).not.toContain("inputs/user/asset-1.png");
    expect(url.toString()).not.toContain("wuyinkeji-test-key");
    expect(url.toString()).not.toContain("cookie");

    const result = await getSignedProviderInputImage("asset-1", url.searchParams.get("exp"), url.searchParams.get("sig"), { db, bucket, env, now: () => NOW });
    expect(result.status).toBe(200);
    if (result.status === 200) expect(result.mimeType).toBe("image/png");

    const badSignature = await getSignedProviderInputImage("asset-1", url.searchParams.get("exp"), "invalid", { db, bucket, env, now: () => NOW });
    expect(badSignature.status).toBe(403);
    const tamperedId = await getSignedProviderInputImage("other-asset", url.searchParams.get("exp"), url.searchParams.get("sig"), { db, bucket, env, now: () => NOW });
    expect(tamperedId.status).toBe(403);
    const missing = await getSignedProviderInputImage("missing-asset", String(NOW.getTime() + 1000), "invalid", { db, bucket, env, now: () => NOW });
    expect(missing.status).toBe(403);
    const expired = await getSignedProviderInputImage("asset-1", String(NOW.getTime() - 1), url.searchParams.get("sig"), { db, bucket, env, now: () => NOW });
    expect(expired.status).toBe(403);
  });

  test("returns 404 for a correctly signed missing asset", async () => {
    const { db, bucket } = setup();
    const env = { MUMO_PUBLIC_ORIGIN: "https://mumo.test", MUMO_PROVIDER_INPUT_SIGNING_KEY_V1: "test-provider-input-signing-key" };
    const url = new URL(await createProviderInputUrl("missing-asset", env, NOW));
    const result = await getSignedProviderInputImage("missing-asset", url.searchParams.get("exp"), url.searchParams.get("sig"), { db, bucket, env, now: () => NOW });
    expect(result.status).toBe(404);
  });

  test("serves a correctly signed consumed asset for persistent reference reuse", async () => {
    const { db, bucket } = setup();
    addAsset(db, bucket, { status: "consumed", expiresAt: "2026-07-01T00:00:00.000Z" });
    const env = {
      MUMO_PUBLIC_ORIGIN: "https://mumo.test",
      MUMO_PROVIDER_INPUT_SIGNING_KEY_V1: "test-provider-input-signing-key",
    };
    const url = new URL(await createProviderInputUrl("asset-1", env, NOW));
    const result = await getSignedProviderInputImage(
      "asset-1",
      url.searchParams.get("exp"),
      url.searchParams.get("sig"),
      { db, bucket, env, now: () => NOW },
    );
    expect(result.status).toBe(200);
  });
});

describe("generation task cancellation", () => {
  test("cancels a queued task that has not been charged", async () => {
    const { db } = setup();
    addTask(db, { id: "cancelable" });

    await expect(cancelGenerationTaskForUser(db, USER_ID, "cancelable")).resolves.toEqual({
      taskId: "cancelable",
      status: "canceled",
    });
    expect(taskRow(db).status).toBe("canceled");
  });

  test("does not falsely cancel a running task", async () => {
    const { db } = setup();
    addTask(db, { id: "running-task", status: "running" });

    await expect(cancelGenerationTaskForUser(db, USER_ID, "running-task")).rejects.toThrow(
      "任务已开始或已扣费，无法取消",
    );
    expect(taskRow(db).status).toBe("running");
  });

  test("does not cancel a queued task that has already been charged", async () => {
    const { db } = setup();
    addTask(db, { id: "charged-task", deductionLedgerId: "deduction:generation-task:charged-task" });

    await expect(cancelGenerationTaskForUser(db, USER_ID, "charged-task")).rejects.toThrow(
      "任务已开始或已扣费，无法取消",
    );
    expect(taskRow(db)).toMatchObject({ status: "queued", deduction_ledger_id: "deduction:generation-task:charged-task" });
  });

  test("does not disclose or cancel another user's task", async () => {
    const { db } = setup();
    addTask(db, { id: "other-user-task", userId: "other-user" });

    await expect(cancelGenerationTaskForUser(db, USER_ID, "other-user-task")).rejects.toThrow(
      "任务不存在或无权操作",
    );
    expect(taskRow(db).status).toBe("queued");
  });

  test("does not return canceled for a nonexistent task", async () => {
    const { db } = setup();

    await expect(cancelGenerationTaskForUser(db, USER_ID, "missing-task")).rejects.toThrow(
      "任务不存在或无权操作",
    );
  });

  test("does not return canceled when the conditional update affects zero rows", async () => {
    const { db } = setup();
    addTask(db, { id: "raced-task" });
    db.returnZeroChangesNextStatementMatching = /SET status = 'canceled'/;

    await expect(cancelGenerationTaskForUser(db, USER_ID, "raced-task")).rejects.toThrow(
      "任务状态已变化，请重试",
    );
    expect(taskRow(db).status).toBe("queued");
  });
});

describe("admin model configuration", () => {
  test("normalizes safe badge colors and rejects arbitrary CSS values", () => {
    expect(normalizeModelBadgeColor("#abc")).toBe("#AABBCC");
    expect(normalizeModelBadgeColor(" #12aBcF ")).toBe("#12ABCF");
    expect(normalizeModelBadgeColor("")).toBeNull();
    expect(() => normalizeModelBadgeColor("rgb(0, 0, 0)")).toThrow("Invalid badge color");
    expect(() => normalizeModelBadgeColor("url(https://example.com/x)")).toThrow("Invalid badge color");
    expect(() => normalizeModelBadgeColor("var(--color)")).toThrow("Invalid badge color");
    expect(() => normalizeModelBadgeColor("transparent")).toThrow("Invalid badge color");
    expect(() => normalizeModelBadgeColor("javascript:alert(1)")).toThrow("Invalid badge color");
  });

  test("normalizes and persists a safe badge text color", async () => {
    const { db } = setup();
    await updateModelConfiguration(db, { id: "model-1", badge_text_color: "#abc" });
    const row = db.database.query("SELECT badge_text_color FROM models_config WHERE id = 'model-1'").get() as { badge_text_color: string };
    expect(row.badge_text_color).toBe("#AABBCC");
    await expect(updateModelConfiguration(db, { id: "model-1", badge_text_color: "rgb(1,2,3)" })).rejects.toThrow("Invalid badge color");
  });

  test("updates submitted model fields without changing model_key or unsubmitted fields", async () => {
    const { db } = setup();
    await updateModelConfiguration(db, {
      id: "model-1",
      model_key: "forged-model-key",
      display_name: "Updated Model",
      provider: "vibelearning",
      provider_model: "gpt-image-2",
      cost_credits: 12,
      is_enabled: 0,
      sort_order: 9,
      supported_modes: ["text_to_image"],
      max_reference_images: 2,
    });
    const row = db.database.query(
      `SELECT model_key, display_name, provider, provider_model, cost_credits, is_enabled,
              sort_order, supported_modes, max_reference_images
       FROM models_config WHERE id = 'model-1'`,
    ).get() as Record<string, unknown>;

    expect(row).toMatchObject({
      model_key: "test-model",
      display_name: "Updated Model",
      provider: "vibelearning",
      provider_model: "gpt-image-2",
      cost_credits: 12,
      is_enabled: 0,
      sort_order: 9,
      supported_modes: '["text_to_image"]',
      max_reference_images: 2,
    });
  });

  test("rejects API key fields from model updates", async () => {
    const { db } = setup();
    await expect(updateModelConfiguration(db, {
      id: "model-1",
      display_name: "No Secret",
      apiKey: "test-only-secret",
    })).rejects.toThrow("不接受 API Key");
    const row = db.database.query("SELECT display_name FROM models_config WHERE id = 'model-1'").get() as { display_name: string };
    expect(row.display_name).toBe("Test Model");
  });

  test("returns provider configuration statuses without exposing API key values", async () => {
    const secret = "test-only-provider-secret";
    const statuses = await getProviderConfigurationStatuses(undefined, {
      VIBELEARNING_IMAGE_API_KEY: secret,
      VIBELEARNING_IMAGE_API_BASE_URL: "https://provider.example/v1/",
      MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true",
    });
    const serialized = JSON.stringify(statuses);

    expect(statuses).toEqual(expect.arrayContaining([{
      provider: "vibelearning",
      displayName: "VibeLearning Image",
      baseUrl: "https://provider.example/v1",
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      enabled: true,
    }, {
      provider: "wuyinkeji",
      displayName: "Wuyinkeji Image",
      baseUrl: "https://api.wuyinkeji.com",
      baseUrlConfigured: false,
      apiKeyConfigured: false,
      enabled: true,
    }]));
    expect(statuses).toHaveLength(2);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("VIBELEARNING_IMAGE_API_KEY");
  });

  test("keeps model update entry point behind withAdmin", async () => {
    const source = await Bun.file("src/lib/admin.server.ts").text();
    expect(source).toContain("export const adminUpdateModel = serverFn(async (data) => withAdmin");
  });
});

describe("provider registry", () => {
  test("selects mock and simulates asynchronous processing", async () => {
    const provider = createDefaultProviderRegistry().get("mock");
    expect(provider).toBeInstanceOf(MockImageProvider);
    const created = await provider.createTask({
      model: "mock-image",
      prompt: "fixture",
      aspectRatio: "1:1",
      quality: "1K",
      referenceImages: [],
      count: 1,
    });
    expect((await provider.getTask(created)).status).toBe("processing");
    expect((await provider.getTask(created)).status).toBe("completed");
  });

  test("does not instantiate VibeLearning unless real providers are enabled", () => {
    let vibeFactoryCalls = 0;
    const registry = createDefaultProviderRegistry({
      vibelearningFactory: () => {
        vibeFactoryCalls += 1;
        return new PipelineProvider();
      },
    });
    expect(() => registry.get("vibelearning")).toThrow(ProviderRegistryError);
    expect(vibeFactoryCalls).toBe(0);
  });

  test("routes only the configured PRO model through VibeLearning with its configured provider model", async () => {
    const { db, provider, dependencies } = setup();
    dependencies.providerRegistry = createDefaultProviderRegistry({
      allowRealProviders: true,
      mockProvider: provider,
      vibelearningFactory: () => provider,
    });

    const task = await createGenerationTaskForUser(
      USER_ID,
      {
        ...input({ modelKey: "gpt-image-2-pro", idempotencyKey: "pro-model" }),
        provider: "mock",
        providerModel: "forged-model",
        costCredits: 0,
      },
      dependencies,
    );
    const pro = db.database.query(
      "SELECT provider, provider_model FROM models_config WHERE model_key = 'gpt-image-2-pro'",
    ).get() as { provider: string; provider_model: string };
    expect(task.modelId).toBe("gpt-image-2-pro");
    expect(pro).toEqual({ provider: "vibelearning", provider_model: "gpt-image-2" });
    expect(provider.createCalls[0].model).toBe("gpt-image-2");
    expect(task.costCredits).toBe(7);
  });

  test("routes the supported PRO ratio and quality combinations through the configured provider", async () => {
    const { db, provider, dependencies } = setup();
    db.database.query("UPDATE user_credits SET balance = 100 WHERE user_id = ?").run(USER_ID);
    dependencies.providerRegistry = createDefaultProviderRegistry({
      allowRealProviders: true,
      mockProvider: provider,
      vibelearningFactory: () => provider,
    });

    const cases = [
      ["4:3", "1K"],
      ["16:9", "2K"],
      ["9:16", "4K"],
    ] as const;
    for (const [index, [aspectRatio, quality]] of cases.entries()) {
      await createGenerationTaskForUser(
        USER_ID,
        {
          ...input({
            modelKey: "gpt-image-2-pro",
            idempotencyKey: `pro-size-${index}`,
            parameters: { aspectRatio, quality },
          }),
          provider: "mock",
          providerModel: "forged-model",
          costCredits: 0,
        },
        dependencies,
      );
    }

    expect(provider.createCalls.map(({ model, aspectRatio, quality }) => ({ model, aspectRatio, quality }))).toEqual([
      { model: "gpt-image-2", aspectRatio: "4:3", quality: "1K" },
      { model: "gpt-image-2", aspectRatio: "16:9", quality: "2K" },
      { model: "gpt-image-2", aspectRatio: "9:16", quality: "4K" },
    ]);
    expect(balance(db)).toBe(79);
  });

  test("does not fetch or create a PRO task while real providers are disabled", async () => {
    const { provider, dependencies } = setup();
    let fetched = 0;
    dependencies.fetchImpl = (async () => {
      fetched += 1;
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    await expect(
      createGenerationTaskForUser(
        USER_ID,
        input({ modelKey: "gpt-image-2-pro", idempotencyKey: "pro-disabled" }),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "REAL_PROVIDER_DISABLED" });
    expect(provider.createCalls).toHaveLength(0);
    expect(fetched).toBe(0);
  });

  test("rejects unknown provider keys", () => {
    expect(() => createDefaultProviderRegistry().get("missing-provider")).toThrow(
      "模型供应商配置无效",
    );
  });
});

describe("generation pipeline", () => {
  test("rejects a disabled model before charging or calling a provider", async () => {
    const { db, provider, dependencies } = setup();
    db.database.query("UPDATE models_config SET is_enabled = 0 WHERE model_key = 'test-model'").run();

    await expect(createGenerationTaskForUser(USER_ID, input(), dependencies)).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
    expect(count(db, "generation_tasks")).toBe(0);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(balance(db)).toBe(20);
    expect(provider.createCalls).toHaveLength(0);
  });

  test("creates a text-to-image task with authoritative pricing", async () => {
    const { db, provider, dependencies } = setup();
    const tampered = { ...input(), costCredits: 999 } as GenerationCreateInput & {
      costCredits: number;
    };
    const task = await createGenerationTaskForUser(USER_ID, tampered, dependencies);
    expect(task.status).toBe("running");
    expect(task.generationMode).toBe("text_to_image");
    expect(task.costCredits).toBe(7);
    expect(balance(db)).toBe(13);
    expect(provider.createCalls[0].model).toBe("mock-image");
    expect(provider.createCalls[0].referenceImages).toHaveLength(0);
  });

  test("creates image-to-image tasks, preserves order, and consumes references", async () => {
    const { db, bucket, provider, dependencies } = setup();
    addAsset(db, bucket);
    const task = await createGenerationTaskForUser(
      USER_ID,
      input({ referenceImageIds: ["asset-1"] }),
      dependencies,
    );
    expect(task.generationMode).toBe("image_to_image");
    expect(provider.createCalls[0].referenceImages).toHaveLength(1);
    const asset = db.database.query("SELECT status FROM uploaded_images").get() as {
      status: string;
    };
    expect(asset.status).toBe("consumed");
    const link = db.database.query("SELECT sort_order FROM generation_task_input_images").get() as {
      sort_order: number;
    };
    expect(link.sort_order).toBe(0);
  });

  test("reuses an owned consumed reference without uploading a duplicate asset", async () => {
    const { db, bucket, provider, dependencies } = setup();
    addAsset(db, bucket);
    await createGenerationTaskForUser(
      USER_ID,
      input({ idempotencyKey: "first-reference-use", referenceImageIds: ["asset-1"] }),
      dependencies,
    );

    const reused = await createGenerationTaskForUser(
      USER_ID,
      input({ idempotencyKey: "second-reference-use", referenceImageIds: ["asset-1"] }),
      dependencies,
    );

    expect(reused.generationMode).toBe("image_to_image");
    expect(provider.createCalls).toHaveLength(2);
    expect(provider.createCalls[1].referenceImages).toHaveLength(1);
    expect(
      (db.database.query("SELECT COUNT(*) AS value FROM uploaded_images").get() as {
        value: number;
      }).value,
    ).toBe(1);
    expect(
      (
        db.database
          .query("SELECT COUNT(*) AS value FROM generation_task_input_images")
          .get() as { value: number }
      ).value,
    ).toBe(2);
  });

  test("rejects references owned by another user", async () => {
    const { db, bucket, dependencies } = setup();
    addAsset(db, bucket, { userId: "other-user" });
    await expect(
      createGenerationTaskForUser(USER_ID, input({ referenceImageIds: ["asset-1"] }), dependencies),
    ).rejects.toMatchObject({ code: "REFERENCE_IMAGE_FORBIDDEN" });
  });

  test("rejects an entire mixed own-and-foreign reference list before task creation", async () => {
    const { db, bucket, provider, dependencies } = setup();
    addAsset(db, bucket, { id: "own-image" });
    addAsset(db, bucket, { id: "foreign-image", userId: "other-user" });

    await expect(
      createGenerationTaskForUser(
        USER_ID,
        input({ referenceImageIds: ["own-image", "foreign-image"] }),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "REFERENCE_IMAGE_FORBIDDEN" });
    expect(count(db, "generation_tasks")).toBe(0);
    expect(provider.createCalls).toHaveLength(0);
  });

  test("rejects a nonexistent reference ID before task creation", async () => {
    const { db, provider, dependencies } = setup();
    await expect(
      createGenerationTaskForUser(
        USER_ID,
        input({ referenceImageIds: ["missing-image"] }),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "REFERENCE_IMAGE_FORBIDDEN" });
    expect(count(db, "generation_tasks")).toBe(0);
    expect(provider.createCalls).toHaveLength(0);
  });

  test("deduplicates repeated IDs before validation and provider input", async () => {
    const { db, bucket, provider, dependencies } = setup();
    addAsset(db, bucket);
    const task = await createGenerationTaskForUser(
      USER_ID,
      input({ referenceImageIds: ["asset-1", "asset-1", "asset-1"] }),
      dependencies,
    );
    expect(task.generationMode).toBe("image_to_image");
    expect(provider.createCalls[0].referenceImages).toHaveLength(1);
    expect(
      (
        db.database
          .query("SELECT COUNT(*) AS value FROM generation_task_input_images")
          .get() as { value: number }
    ).value,
    ).toBe(1);
  });

  test("rejects more than five unique reference IDs before any task or provider work", async () => {
    const { db, provider, dependencies } = setup();
    await expect(
      createGenerationTaskForUser(
        USER_ID,
        input({ referenceImageIds: ["a", "b", "c", "d", "e", "f"] }),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "TOO_MANY_REFERENCE_IMAGES" });
    expect(count(db, "generation_tasks")).toBe(0);
    expect(provider.createCalls).toHaveLength(0);
  });

  test("rejects expired and deleted references", async () => {
    const expired = setup();
    addAsset(expired.db, expired.bucket, { expiresAt: "2026-07-13T12:00:00.000Z" });
    await expect(
      createGenerationTaskForUser(
        USER_ID,
        input({ referenceImageIds: ["asset-1"] }),
        expired.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REFERENCE_IMAGE_UNAVAILABLE" });

    const deleted = setup();
    addAsset(deleted.db, deleted.bucket, { status: "deleted" });
    await expect(
      createGenerationTaskForUser(
        USER_ID,
        input({ referenceImageIds: ["asset-1"] }),
        deleted.dependencies,
      ),
    ).rejects.toMatchObject({ code: "REFERENCE_IMAGE_UNAVAILABLE" });
  });

  test("does not create a task when balance is insufficient", async () => {
    const { db, provider, dependencies } = setup();
    db.database.query("UPDATE user_credits SET balance = 6").run();
    await expect(createGenerationTaskForUser(USER_ID, input(), dependencies)).rejects.toThrow(
      "创作点不足",
    );
    expect(count(db, "generation_tasks")).toBe(0);
    expect(balance(db)).toBe(6);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(provider.createCalls).toHaveLength(0);
  });

  test("does not charge, write a ledger, or call a provider when a task is no longer queued", async () => {
    const { db, provider } = setup();
    db.database
      .query(
        `INSERT INTO generation_tasks (id, user_id, model_key, task_type, prompt, status, cost_credits)
         VALUES ('already-running', ?, 'test-model', 'image', 'existing', 'running', 7)`,
      )
      .run(USER_ID);

    await expect(
      chargeGenerationTask(db, { userId: USER_ID, taskId: "already-running", amount: 7 }),
    ).rejects.toMatchObject({ name: "GenerationCreditRecoveryError" });
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(taskRow(db)).toMatchObject({ deduction_ledger_id: null });
    expect(provider.createCalls).toHaveLength(0);
  });

  test("rolls back a success false deduction result before a provider can run", async () => {
    const { db, provider } = setup();
    db.database
      .query(
        `INSERT INTO generation_tasks (id, user_id, model_key, task_type, prompt, status, cost_credits)
         VALUES ('success-false-deduction', ?, 'test-model', 'image', 'pending', 'queued', 7)`,
      )
      .run(USER_ID);
    db.returnSuccessFalseNextStatementMatching = /SET deduction_ledger_id/;

    await expect(
      chargeGenerationTask(db, { userId: USER_ID, taskId: "success-false-deduction", amount: 7 }),
    ).rejects.toThrow("injected D1 unsuccessful result");
    expect(provider.createCalls).toHaveLength(0);
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(taskRow(db)).toMatchObject({ deduction_ledger_id: null });
  });

  test("rolls back a success false refund result without increasing balance", async () => {
    const { db } = setup();
    db.database.query("UPDATE user_credits SET balance = 13, total_used = 7").run();
    db.database
      .query(
        `INSERT INTO generation_tasks
         (id, user_id, model_key, task_type, prompt, status, cost_credits, deduction_ledger_id)
         VALUES ('success-false-refund', ?, 'test-model', 'image', 'failed', 'failed', 7,
                 'deduction:generation-task:success-false-refund')`,
      )
      .run(USER_ID);
    db.returnSuccessFalseNextStatementMatching = /SET refund_ledger_id/;

    await expect(
      refundGenerationTask(db, { userId: USER_ID, taskId: "success-false-refund", amount: 7 }),
    ).rejects.toThrow("injected D1 unsuccessful result");
    expect(balance(db)).toBe(13);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(taskRow(db)).toMatchObject({ refund_ledger_id: null });
  });

  test("same idempotency key and concurrent calls deduct only once", async () => {
    const { db, provider, dependencies } = setup();
    const [first, second] = await Promise.all([
      createGenerationTaskForUser(USER_ID, input(), dependencies),
      createGenerationTaskForUser(USER_ID, input(), dependencies),
    ]);
    expect(first.taskId).toBe(second.taskId);
    expect(balance(db)).toBe(13);
    expect(count(db, "credit_ledger")).toBe(1);
    expect(count(db, "generation_tasks")).toBe(1);
    expect(provider.createCalls).toHaveLength(1);
  });

  test("rolls back the deduction when its ledger insert fails", async () => {
    const { db, dependencies } = setup();
    db.failNextStatementMatching = /INSERT INTO credit_ledger/;

    await expect(createGenerationTaskForUser(USER_ID, input(), dependencies)).rejects.toThrow(
      "injected D1 statement failure",
    );
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(count(db, "generation_tasks")).toBe(0);
  });

  test("rolls back the deduction when task ledger association fails", async () => {
    const { db, dependencies } = setup();
    db.failNextStatementMatching = /SET deduction_ledger_id/;

    await expect(createGenerationTaskForUser(USER_ID, input(), dependencies)).rejects.toThrow(
      "injected D1 statement failure",
    );
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(0);
    expect(count(db, "generation_tasks")).toBe(0);
  });

  test("provider create failure refunds exactly once", async () => {
    const { db, provider, dependencies } = setup();
    provider.createError = new Error("mock provider create failed");
    const task = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    expect(task.status).toBe("failed");
    expect(task.deductionStatus).toBe("refunded");
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("provider polling failure refunds once across repeated polls", async () => {
    const { db, provider, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    provider.pollError = new Error("mock poll failed");
    const first = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const second = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(first.status).toBe("failed");
    expect(second.status).toBe("failed");
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("retries a refund after the refund ledger write fails", async () => {
    const { db, provider, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    provider.pollResult = { taskId: "provider-task", status: "failed", images: [] };
    db.failNextStatementMatching = /generation_refund/;

    await expect(pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).rejects.toThrow(
      "injected D1 statement failure",
    );
    expect(balance(db)).toBe(13);
    expect(count(db, "credit_ledger")).toBe(1);
    expect(taskRow(db)).toMatchObject({ status: "failed", refund_ledger_id: null });

    const retried = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(retried.deductionStatus).toBe("refunded");
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("retries a refund after the balance update fails", async () => {
    const { db, provider, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    provider.pollResult = { taskId: "provider-task", status: "failed", images: [] };
    db.failNextStatementMatching = /SET balance = balance \+/;

    await expect(pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).rejects.toThrow(
      "injected D1 statement failure",
    );
    expect(balance(db)).toBe(13);
    expect(taskRow(db)).toMatchObject({ status: "failed", refund_ledger_id: null });

    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("refunds a provider final failed result exactly once", async () => {
    const { db, provider, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    provider.pollResult = { taskId: "provider-task", status: "failed", images: [] };

    const first = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const second = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(first.deductionStatus).toBe("refunded");
    expect(second.deductionStatus).toBe("refunded");
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("serializes concurrent refund retries so the balance increases once", async () => {
    const { db, provider, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    provider.pollResult = { taskId: "provider-task", status: "failed", images: [] };
    db.failNextStatementMatching = /generation_refund/;

    await expect(pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).rejects.toThrow(
      "injected D1 statement failure",
    );
    await expect(
      Promise.all([
        pollGenerationTaskForUser(USER_ID, created.taskId, dependencies),
        pollGenerationTaskForUser(USER_ID, created.taskId, dependencies),
      ]),
    ).resolves.toHaveLength(2);
    const refundCount = db.database.query(
      "SELECT COUNT(*) AS value FROM credit_ledger WHERE reason = 'generation_refund'",
    ).get() as { value: number };
    expect(balance(db)).toBe(20);
    expect(refundCount.value).toBe(1);
    expect(taskRow(db).refund_ledger_id).toBe("refund:generation-task:id-1");

    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(balance(db)).toBe(20);
    const refundCountAfterRetry = db.database.query(
      "SELECT COUNT(*) AS value FROM credit_ledger WHERE reason = 'generation_refund'",
    ).get() as { value: number };
    expect(refundCountAfterRetry.value).toBe(1);
  });

  test("refunds a timed out task", async () => {
    const { db, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    dependencies.now = () => new Date(NOW.getTime() + 16 * 60 * 1000);

    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(result.status).toBe("failed");
    expect(result.deductionStatus).toBe("refunded");
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("keeps a delayed provider result running, then archives its URL without refunding", async () => {
    const { db, bucket, provider, dependencies } = setup();
    provider.pollResults = [
      { taskId: "provider-task", status: "processing", images: [] },
      {
        taskId: "provider-task",
        status: "completed",
        images: [{ kind: "url", url: "https://fixture.example/delayed.webp" }],
      },
    ];
    dependencies.fetchImpl = (async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/webp" },
    })) as typeof fetch;
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);

    const waiting = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(waiting.status).toBe("running");
    expect(taskRow(db)).toMatchObject({ status: "running", refund_ledger_id: null });
    expect(count(db, "generation_history")).toBe(0);
    expect(bucket.objects.size).toBe(0);
    const providerTask = db.database.query(
      "SELECT provider_task_id FROM generation_tasks WHERE id = ?",
    ).get(created.taskId) as { provider_task_id: string };
    expect(providerTask.provider_task_id).toBe("provider-task");

    const completed = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(completed.status).toBe("succeeded");
    expect(taskRow(db)).toMatchObject({ status: "succeeded", refund_ledger_id: null });
    expect(count(db, "generation_history")).toBe(1);
    expect(bucket.objects.size).toBe(1);
    expect(balance(db)).toBe(13);
  });

  test("archives a delayed provider base64 result without refunding", async () => {
    const { db, bucket, provider, dependencies } = setup();
    provider.pollResults = [
      { taskId: "provider-task", status: "processing", images: [] },
      {
        taskId: "provider-task",
        status: "completed",
        images: [{ kind: "base64", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" }],
      },
    ];
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);

    expect((await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).status).toBe("running");
    expect(provider.createCalls).toHaveLength(1);
    expect(taskRow(db)).toMatchObject({ status: "running", refund_ledger_id: null });
    expect(count(db, "credit_ledger")).toBe(1);
    expect(balance(db)).toBe(13);
    expect(bucket.objects.size).toBe(0);

    expect((await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).status).toBe("succeeded");
    expect(taskRow(db)).toMatchObject({ status: "succeeded", refund_ledger_id: null });
    expect(count(db, "generation_history")).toBe(1);
    expect(bucket.objects.size).toBe(1);
    expect(count(db, "credit_ledger")).toBe(1);
    expect(balance(db)).toBe(13);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(provider.createCalls).toHaveLength(1);
    expect(count(db, "generation_history")).toBe(1);
    expect(bucket.objects.size).toBe(1);
  });

  test("refunds a delayed provider result once after the existing task timeout", async () => {
    const { db, provider, dependencies } = setup();
    provider.pollResult = { taskId: "provider-task", status: "processing", images: [] };
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);

    expect((await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).status).toBe("running");
    dependencies.now = () => new Date(NOW.getTime() + 16 * 60 * 1000);
    expect((await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).deductionStatus).toBe("refunded");
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(taskRow(db)).toMatchObject({ status: "failed", refund_ledger_id: expect.any(String) });
    expect(balance(db)).toBe(20);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("successful repeated polling writes history once and archives base64", async () => {
    const { db, bucket, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    const first = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const second = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(count(db, "generation_history")).toBe(1);
    expect([...bucket.objects.keys()].some((key) => key.startsWith("generated/user-1/"))).toBe(
      true,
    );
  });

  test("downloads URL results through controlled fetch before R2 archive", async () => {
    const { db, bucket, provider, dependencies } = setup();
    provider.pollResult = {
      taskId: "provider-task",
      status: "completed",
      images: [{ kind: "url", url: "https://fixture.example/result.webp" }],
    };
    let fetched = 0;
    dependencies.fetchImpl = (async () => {
      fetched += 1;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    }) as typeof fetch;
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(result.status).toBe("succeeded");
    expect(fetched).toBe(1);
    expect([...bucket.objects.keys()].some((key) => key.endsWith(".webp"))).toBe(true);
    expect(count(db, "generation_history")).toBe(1);
  });

  test("R2 archive failure prevents success and refunds", async () => {
    const { db, bucket, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    bucket.failPut = true;
    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(result.status).toBe("failed");
    expect(balance(db)).toBe(20);
    expect(count(db, "generation_history")).toBe(0);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("history write failure never marks the task successful and refunds once", async () => {
    const { db, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
    db.failNextStatementMatching = /INSERT OR IGNORE INTO generation_history/;

    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(result.status).toBe("failed");
    expect(result.deductionStatus).toBe("refunded");
    expect(count(db, "generation_history")).toBe(0);
    expect(balance(db)).toBe(20);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(count(db, "credit_ledger")).toBe(2);
  });

  test("successful tasks never receive a refund", async () => {
    const { db, dependencies } = setup();
    const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);

    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(taskRow(db)).toMatchObject({ status: "succeeded", refund_ledger_id: null });
    expect(balance(db)).toBe(13);
    expect(count(db, "credit_ledger")).toBe(1);
  });

  test("default local provider is mock and does not call fetch or require an API key", async () => {
    const { db, bucket } = setup();
    let fetched = 0;
    const dependencies: GenerationPipelineDependencies = {
      db,
      bucket,
      now: () => NOW,
      fetchImpl: (async () => {
        fetched += 1;
        throw new Error("unexpected fetch");
      }) as typeof fetch,
    };
    const created = await createGenerationTaskForUser(
      USER_ID,
      input({ idempotencyKey: "default-mock" }),
      dependencies,
    );
    const processing = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(processing.status).toBe("running");
    expect(result.status).toBe("succeeded");
    expect(fetched).toBe(0);
    const clientSource = await Bun.file("src/components/studio/Studio.tsx").text();
    expect(clientSource).not.toContain("VIBELEARNING_IMAGE_API_KEY");
  });

  test.each([
    ["status=3", { data: { status: 3 } }, "provider_status_3"],
    ["status=2 non-array result", { data: { status: 2, result: "https://fixture.example/result.webp" } }, "provider_result_parse"],
    ["status=2 empty result", { data: { status: 2, result: [] } }, "provider_result_parse"],
    ["status=2 unsafe result", { data: { status: 2, result: ["http://fixture.example/result.webp"] } }, "provider_result_parse"],
  ])("logs one safe Wuyinkeji diagnostic for %s", async (_name, pollPayload, expectedStage) => {
    const { db, dependencies } = setup();
    let requestCount = 0;
    const provider = new WuyinkejiImageProvider({
      apiKey: "wuyinkeji-test-key",
      fetchImpl: (async () => {
        requestCount += 1;
        return Response.json(requestCount === 1 ? { code: 200, data: { id: "provider-task" } } : pollPayload);
      }) as typeof fetch,
    });
    configureWuyinkejiPipeline(db, dependencies, provider);
    const captured = captureStageFailureEvents();
    try {
      const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
      const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
      expect(result).toMatchObject({ status: "failed", deductionStatus: "refunded" });
      expect(captured.events).toHaveLength(1);
      expectSafeStageEvent(captured.events[0], expectedStage);
      expect(balance(db)).toBe(20);
      expect(count(db, "credit_ledger")).toBe(2);
    } finally {
      captured.restore();
    }
  });

  test.each([
    ["R2 archive failure", "r2_archive", (db: MemoryD1, bucket: MemoryR2) => { bucket.failPut = true; }],
    ["history write failure", "history_write", (db: MemoryD1) => { db.failNextStatementMatching = /INSERT OR IGNORE INTO generation_history/; }],
  ])("logs one safe Wuyinkeji diagnostic for %s", async (_name, expectedStage, injectFailure) => {
    const { db, bucket, provider, dependencies } = setup();
    configureWuyinkejiPipeline(db, dependencies, provider);
    injectFailure(db, bucket);
    const captured = captureStageFailureEvents();
    try {
      const created = await createGenerationTaskForUser(USER_ID, input(), dependencies);
      const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
      expect(result).toMatchObject({ status: "failed", deductionStatus: "refunded" });
      expect(captured.events).toHaveLength(1);
      expectSafeStageEvent(captured.events[0], expectedStage);
      expect(balance(db)).toBe(20);
      expect(count(db, "credit_ledger")).toBe(2);
    } finally {
      captured.restore();
    }
  });

  async function runDownloadRetryScenario(
    responses: Array<Response | Error>,
    expectedStatus: "succeeded" | "failed",
    expectedFetches: number,
    expectedFailureStage: "result_download" | "result_validation" = "result_download",
  ) {
    const { db, provider, dependencies } = setup();
    provider.pollResult = {
      taskId: "provider-task",
      status: "completed",
      images: [{ kind: "url", url: "https://scapi.net/result.jpg?signature=redacted" }],
    };
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    dependencies.fetchImpl = (async (inputValue, init) => {
      requests.push({ input: inputValue, init });
      const next = responses.shift();
      if (!next) throw new Error("unexpected extra download");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch;
    const captured = captureStageFailureEvents();
    try {
      const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: `retry-${expectedStatus}-${expectedFetches}` }), dependencies);
      const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
      expect(result.status).toBe(expectedStatus);
      expect(requests).toHaveLength(expectedFetches);
      expect(requests.every((request) => !new Headers(request.init?.headers).has("authorization"))).toBe(true);
      expect(captured.events).toHaveLength(0);
      if (expectedStatus === "failed") {
        expect(balance(db)).toBe(20);
      } else {
        expect(balance(db)).toBe(13);
      }
      expect(provider.createCalls).toHaveLength(1);
    } finally {
      captured.restore();
    }
  }

  test("retries a network throw once and succeeds without refund", async () => {
    await runDownloadRetryScenario([
      new Error("transient network"),
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    ], "succeeded", 2);
  });

  test("retries a 404 once and succeeds", async () => {
    await runDownloadRetryScenario([
      new Response(null, { status: 404 }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    ], "succeeded", 2);
  });

  test("retries two 503 responses and succeeds on the third attempt", async () => {
    await runDownloadRetryScenario([
      new Response(null, { status: 503 }),
      new Response(null, { status: 503 }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    ], "succeeded", 3);
  });

  test.each([
    ["three network failures", [new Error("network-1"), new Error("network-2"), new Error("network-3")], 3],
    ["three 503 responses", [new Response(null, { status: 503 }), new Response(null, { status: 503 }), new Response(null, { status: 503 })], 3],
    ["403 does not retry", [new Response(null, { status: 403 })], 1],
    ["400 does not retry", [new Response(null, { status: 400 })], 1],
  ])("preserves failure/refund semantics for %s", async (_name, responses, expectedFetches) => {
    await runDownloadRetryScenario(responses, "failed", expectedFetches);
  });

  test("continues into existing validation after a 200 response", async () => {
    await runDownloadRetryScenario([
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "text/plain" } }),
    ], "failed", 1, "result_validation");
  });

  test("Wuyinkeji external HTTPS result succeeds without fetch or R2 archive", async () => {
    const { db, bucket, provider, dependencies } = setup();
    provider.pollResult = {
      taskId: "provider-task",
      status: "completed",
      images: [{ kind: "url", url: "https://scapi.net/result.jpg?signature=redacted" }],
    };
    dependencies.fetchImpl = (async () => { throw new Error("external result must not be fetched"); }) as typeof fetch;
    configureWuyinkejiPipeline(db, dependencies, provider);
    const captured = captureStageFailureEvents();
    try {
      const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "wuyinkeji-external" }), dependencies);
      const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
      expect(result).toMatchObject({ status: "succeeded", deductionStatus: "charged", resultImageUrl: "https://scapi.net/result.jpg?signature=redacted" });
      expect(bucket.objects.size).toBe(0);
      expect(count(db, "generation_history")).toBe(1);
      const row = db.database.query("SELECT result_image_url, result_image_r2_key FROM generation_tasks LIMIT 1").get() as { result_image_url: string; result_image_r2_key: string | null };
      expect(row).toEqual({ result_image_url: "https://scapi.net/result.jpg?signature=redacted", result_image_r2_key: null });
      expect(captured.events).toHaveLength(0);
      expect(balance(db)).toBe(13);
    } finally {
      captured.restore();
    }
  });

  test("archives a completed Wuyinkeji result asynchronously through the ingest path", async () => {
    const { db, bucket, provider, dependencies } = setup();
    dependencies.env = { MUMO_PUBLIC_ORIGIN: "https://mumo.test", MUMO_ARCHIVER_SERVICE_TOKEN_V1: "service-token", MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1: "archive-test-key" };
    provider.pollResult = { taskId: "provider-task", status: "completed", images: [{ kind: "url", url: "https://scapi.net/result.jpg?signature=redacted" }] };
    dependencies.fetchImpl = (async () => { throw new Error("the Worker must not fetch the supplier result"); }) as typeof fetch;
    configureWuyinkejiPipeline(db, dependencies, provider);
    const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "archive-pending" }), dependencies);
    const pendingView = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(pendingView).toMatchObject({
      status: "succeeded",
      displayReady: false,
      archiveStatus: "pending",
    });
    const pending = db.database.query("SELECT archive_status FROM generation_tasks WHERE id = ?").get(created.taskId) as { archive_status: string };
    expect(pending.archive_status).toBe("pending");
    expect(bucket.objects.size).toBe(0);

    const archiveJobId = (db.database.query("SELECT archive_job_id FROM generation_tasks WHERE id = ?").get(created.taskId) as { archive_job_id: string }).archive_job_id;
    const claim = await claimProviderArchiveJob("service-token", { db, env: dependencies.env, now: () => NOW });
    if (claim.status !== 200) throw new Error("claim failed");
    const token = claim.archiveToken;
    const job = await getProviderArchiveJob(archiveJobId, token, { db, env: dependencies.env, now: () => NOW });
    expect(job).toMatchObject({ status: 200, jobId: archiveJobId, sourceUrl: "https://scapi.net/result.jpg?signature=redacted" });
    const ingest = await ingestProviderArchive(archiveJobId, token, new Request("https://archiver.test", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }), { db, bucket, env: dependencies.env, now: () => NOW });
    expect(ingest).toEqual({ status: 200, archiveStatus: "archived" });
    const archived = db.database.query("SELECT status, archive_status, result_image_r2_key FROM generation_tasks WHERE id = ?").get(created.taskId) as { status: string; archive_status: string; result_image_r2_key: string | null };
    expect(archived.status).toBe("succeeded");
    expect(archived.archive_status).toBe("archived");
    expect(archived.result_image_r2_key).not.toBeNull();
    expect(await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies)).toMatchObject({
      status: "succeeded",
      displayReady: true,
      archiveStatus: "archived",
    });
  });

  test("rejects invalid or expired archive tokens without changing generation success", async () => {
    const { db, bucket, provider, dependencies } = setup();
    dependencies.env = { MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1: "archive-test-key" };
    provider.pollResult = { taskId: "provider-task", status: "completed", images: [{ kind: "url", url: "https://scapi.net/result.jpg" }] };
    configureWuyinkejiPipeline(db, dependencies, provider);
    const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "archive-token" }), dependencies);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const archiveJobId = (db.database.query("SELECT archive_job_id FROM generation_tasks WHERE id = ?").get(created.taskId) as { archive_job_id: string }).archive_job_id;
    const token = await createProviderArchiveToken(archiveJobId, created.taskId, dependencies.env, NOW);
    const invalid = await ingestProviderArchive(archiveJobId, "invalid", new Request("https://archiver.test", { method: "POST", body: new Uint8Array([1]) }), { db, bucket, env: dependencies.env, now: () => NOW });
    expect(invalid.status).toBe(403);
    const wrongJobToken = await createProviderArchiveToken(archiveJobId, "other-task", dependencies.env, NOW);
    const wrongJob = await getProviderArchiveJob(archiveJobId, wrongJobToken, { db, env: dependencies.env, now: () => NOW });
    expect(wrongJob.status).toBe(403);
    const expired = await ingestProviderArchive(archiveJobId, token, new Request("https://archiver.test", { method: "POST", body: new Uint8Array([1]) }), { db, bucket, env: dependencies.env, now: () => new Date(NOW.getTime() + 60 * 60 * 1000) });
    expect(expired.status).toBe(403);
    expect((db.database.query("SELECT status, archive_status FROM generation_tasks WHERE id = ?").get(created.taskId) as { status: string; archive_status: string })).toEqual({ status: "succeeded", archive_status: "pending" });
  });

  test("claims atomically, honors the lease, and fails after three attempts", async () => {
    const { db, provider, dependencies } = setup();
    dependencies.env = { MUMO_PUBLIC_ORIGIN: "https://mumo.test", MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1: "archive-test-key", MUMO_ARCHIVER_SERVICE_TOKEN_V1: "service-token" };
    provider.pollResult = { taskId: "provider-task", status: "completed", images: [{ kind: "url", url: "https://scapi.net/result.jpg" }] };
    configureWuyinkejiPipeline(db, dependencies, provider);
    const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "archive-claim" }), dependencies);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const first = await claimProviderArchiveJob("service-token", { db, env: dependencies.env, now: () => NOW });
    expect(first).toMatchObject({ status: 200 });
    if (first.status !== 200) throw new Error("claim failed");
    expect(first).not.toHaveProperty("sourceUrl");
    expect((db.database.query("SELECT archive_status, archive_attempt_count FROM generation_tasks WHERE id = ?").get(created.taskId) as { archive_status: string; archive_attempt_count: number })).toEqual({ archive_status: "processing", archive_attempt_count: 1 });
    expect((await claimProviderArchiveJob("service-token", { db, env: dependencies.env, now: () => NOW })).status).toBe(204);
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      db.database.query("UPDATE generation_tasks SET archive_claimed_at = ? WHERE id = ?").run("2026-07-14T11:00:00.000Z", created.taskId);
      const next = await claimProviderArchiveJob("service-token", { db, env: dependencies.env, now: () => NOW });
      expect(next.status).toBe(200);
      expect((db.database.query("SELECT archive_attempt_count FROM generation_tasks WHERE id = ?").get(created.taskId) as { archive_attempt_count: number }).archive_attempt_count).toBe(attempt);
    }
    db.database.query("UPDATE generation_tasks SET archive_claimed_at = ? WHERE id = ?").run("2026-07-14T11:00:00.000Z", created.taskId);
    expect((await claimProviderArchiveJob("service-token", { db, env: dependencies.env, now: () => NOW })).status).toBe(204);
    expect((db.database.query("SELECT status, archive_status FROM generation_tasks WHERE id = ?").get(created.taskId) as { status: string; archive_status: string })).toEqual({ status: "succeeded", archive_status: "failed" });
  });

  test("rejects malformed ingest without bypassing the archive retry protocol", async () => {
    const { db, bucket, provider, dependencies } = setup();
    dependencies.env = { MUMO_PUBLIC_ORIGIN: "https://mumo.test", MUMO_ARCHIVER_SERVICE_TOKEN_V1: "service-token", MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1: "archive-test-key" };
    provider.pollResult = { taskId: "provider-task", status: "completed", images: [{ kind: "url", url: "https://scapi.net/result.jpg" }] };
    configureWuyinkejiPipeline(db, dependencies, provider);
    const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "archive-failure" }), dependencies);
    await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    const archiveJobId = (db.database.query("SELECT archive_job_id FROM generation_tasks WHERE id = ?").get(created.taskId) as { archive_job_id: string }).archive_job_id;
    const claim = await claimProviderArchiveJob("service-token", { db, env: dependencies.env, now: () => NOW });
    if (claim.status !== 200) throw new Error("claim failed");
    const token = claim.archiveToken;
    const rejected = await ingestProviderArchive(archiveJobId, token, new Request("https://archiver.test", { method: "POST", headers: { "content-type": "text/plain" }, body: "not image" }), { db, bucket, env: dependencies.env, now: () => NOW });
    expect(rejected.status).toBe(415);
    expect((db.database.query("SELECT status, archive_status, refund_ledger_id FROM generation_tasks WHERE id = ?").get(created.taskId) as { status: string; archive_status: string; refund_ledger_id: string | null })).toEqual({ status: "succeeded", archive_status: "processing", refund_ledger_id: null });
    expect(await reportProviderArchiveFailure(archiveJobId, token, "INVALID_MIME", { db, env: dependencies.env, now: () => NOW })).toEqual({ status: 200, archiveStatus: "pending" });
    expect((db.database.query("SELECT status, archive_status, refund_ledger_id FROM generation_tasks WHERE id = ?").get(created.taskId) as { status: string; archive_status: string; refund_ledger_id: string | null })).toEqual({ status: "succeeded", archive_status: "pending", refund_ledger_id: null });
  });

  test("Wuyinkeji references use a signed endpoint and completed results keep the external URL path", async () => {
    const { db, bucket, provider, dependencies } = setup();
    addAsset(db, bucket);
    dependencies.env = {
      MUMO_PUBLIC_ORIGIN: "https://mumo.test",
      MUMO_PROVIDER_INPUT_SIGNING_KEY_V1: "test-provider-input-signing-key",
    };
    bucket.get = async () => { throw new Error("Wuyinkeji references must not read private bytes into the provider request"); };
    provider.pollResult = {
      taskId: "provider-task",
      status: "completed",
      images: [{ kind: "url", url: "https://scapi.net/result.jpg?signature=redacted" }],
    };
    dependencies.fetchImpl = (async () => { throw new Error("Wuyinkeji result URL must not be fetched"); }) as typeof fetch;
    configureWuyinkejiPipeline(db, dependencies, provider);

    const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "wuyinkeji-reference", referenceImageIds: ["asset-1"] }), dependencies);
    expect(provider.createCalls).toHaveLength(1);
    const supplierUrl = provider.createCalls[0].referenceImages[0]?.supplierUrl;
    expect(supplierUrl).toMatch(/^https:\/\/mumo\.test\/api\/provider-input-image\/asset-1\?exp=\d+&sig=/);
    expect(JSON.stringify(provider.createCalls[0])).not.toContain("inputs/user/asset-1.png");
    expect(JSON.stringify(provider.createCalls[0])).not.toContain("test-provider-input-signing-key");

    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(result).toMatchObject({ status: "succeeded", deductionStatus: "charged", resultImageUrl: "https://scapi.net/result.jpg?signature=redacted" });
    expect(bucket.objects.size).toBe(1);
    const row = db.database.query("SELECT result_image_r2_key FROM generation_tasks LIMIT 1").get() as { result_image_r2_key: string | null };
    expect(row.result_image_r2_key).toBeNull();
  });

  test("non-Wuyinkeji URL results still download and archive", async () => {
    const { db, bucket, provider, dependencies } = setup();
    provider.pollResult = {
      taskId: "provider-task",
      status: "completed",
      images: [{ kind: "url", url: "https://fixture.example/result.webp" }],
    };
    let fetched = 0;
    dependencies.fetchImpl = (async () => {
      fetched += 1;
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/webp" } });
    }) as typeof fetch;
    const created = await createGenerationTaskForUser(USER_ID, input({ idempotencyKey: "mock-url-archive" }), dependencies);
    const result = await pollGenerationTaskForUser(USER_ID, created.taskId, dependencies);
    expect(result.status).toBe("succeeded");
    expect(fetched).toBe(1);
    expect(bucket.objects.size).toBe(1);
  });

  test("retains only a user's recent 100 history results and deletes expired R2 objects", async () => {
    const { db, bucket, dependencies } = setup();
    db.database.query("INSERT INTO users (id) VALUES ('user-2')").run();
    bucket.objects.set("generated/user-1/old.png", { bytes: new Uint8Array([1]), contentType: "image/png" });
    db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, result_image_r2_key, cost_credits, created_at) VALUES ('old', ?, 'model', 'https://safe.example/old.png', 'generated/user-1/old.png', 1, '2026-06-14T12:00:00.000Z')").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, cost_credits, created_at) VALUES ('other', 'user-2', 'model', 'https://safe.example/other.png', 1, '2026-07-15T12:00:00.000Z')").run();
    for (let index = 0; index < 101; index += 1) {
      db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, cost_credits, created_at) VALUES (?, ?, 'model', 'https://safe.example/image.png', 1, ?)").run(`recent-${index}`, USER_ID, `2026-07-15T12:${String(index % 60).padStart(2, "0")}:${String(index).padStart(2, "0")}.000Z`);
    }
    const cleaned = await cleanupGenerationHistoryForUser(USER_ID, { ...dependencies, now: () => NOW });
    expect(cleaned.removed).toBe(2);
    expect(bucket.objects.has("generated/user-1/old.png")).toBe(false);
    let cursor: string | null = null;
    const allItems: Array<{ id: string }> = [];
    do {
      const page = await listGenerationHistoryForUser(USER_ID, { cursor }, { ...dependencies, now: () => NOW });
      expect(page.items.length).toBeLessThanOrEqual(GENERATION_HISTORY_PAGE_SIZE);
      allItems.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(allItems).toHaveLength(100);
    expect(new Set(allItems.map((item) => item.id)).size).toBe(100);
    expect((await listGenerationHistoryForUser("user-2", {}, { ...dependencies, now: () => NOW })).items).toHaveLength(1);
  });

  test("retention cancels a pending archive without fetching a supplier or resurrecting history", async () => {
    const { db, bucket, dependencies } = setup();
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, archive_job_id, archive_attempt_count, refund_ledger_id, result_image_url, result_image_r2_key) VALUES ('pending-race', ?, 'model', 'succeeded', 'pending', 'job-pending', 0, NULL, 'https://scapi.net/never-fetch.png', NULL)").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, task_id, user_id, model_key, result_image_url, result_image_r2_key, archive_status, created_at) VALUES ('history-pending', 'pending-race', ?, 'model', 'https://scapi.net/never-fetch.png', NULL, 'pending', '2020-01-01T00:00:00.000Z')").run(USER_ID);
    const cleanup = await cleanupGenerationHistoryForUser(USER_ID, { ...dependencies, now: () => NOW });
    expect(cleanup).toEqual({ removed: 1, deferred: 0 });
    expect(bucket.objects.size).toBe(0);
    expect(db.database.query("SELECT status, archive_status, refund_ledger_id FROM generation_tasks WHERE id = 'pending-race'").get()).toEqual({ status: "succeeded", archive_status: "not_required", refund_ledger_id: null });
    expect(db.database.query("SELECT COUNT(*) AS value FROM generation_history WHERE task_id = 'pending-race'").get()).toEqual({ value: 0 });
  });

  test("retention skips a processing archive and leaves its lease, attempts, history, and R2 untouched", async () => {
    const { db, bucket, dependencies } = setup();
    bucket.objects.set("generated/user-1/processing.png", { bytes: new Uint8Array([1]), contentType: "image/png" });
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, archive_attempt_count, archive_claimed_at, refund_ledger_id, result_image_r2_key) VALUES ('processing-race', ?, 'model', 'succeeded', 'processing', 2, '2026-07-15T11:55:00.000Z', NULL, 'generated/user-1/processing.png')").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, task_id, user_id, model_key, result_image_url, result_image_r2_key, archive_status, archive_attempt_count, created_at) VALUES ('history-processing', 'processing-race', ?, 'model', 'https://scapi.net/processing.png', 'generated/user-1/processing.png', 'processing', 2, '2026-06-14T12:00:00.000Z')").run(USER_ID);
    expect(await cleanupGenerationHistoryForUser(USER_ID, { ...dependencies, now: () => NOW })).toEqual({ removed: 0, deferred: 0 });
    expect(bucket.objects.has("generated/user-1/processing.png")).toBe(true);
    expect(db.database.query("SELECT status, archive_status, archive_attempt_count, archive_claimed_at, refund_ledger_id FROM generation_tasks WHERE id = 'processing-race'").get()).toEqual({ status: "succeeded", archive_status: "processing", archive_attempt_count: 2, archive_claimed_at: "2026-07-15T11:55:00.000Z", refund_ledger_id: null });
    expect(db.database.query("SELECT COUNT(*) AS value FROM generation_history WHERE task_id = 'processing-race'").get()).toEqual({ value: 1 });
  });

  test("a stale ingest after retention deletion is idempotently discarded without R2 or history resurrection", async () => {
    const { db, bucket, dependencies } = setup();
    dependencies.env = { MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1: "archive-test-key" };
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, provider, status, archive_status, archive_job_id, archive_attempt_count, archive_claimed_at, refund_ledger_id, result_image_url, result_image_r2_key) VALUES ('stale-race', ?, 'model', 'wuyinkeji', 'succeeded', 'processing', 'job-stale', 1, ?, NULL, 'https://scapi.net/stale.png', NULL)").run(USER_ID, NOW.toISOString());
    const staleToken = await createProviderArchiveToken("job-stale", "stale-race", dependencies.env, NOW, NOW.toISOString());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const first = await ingestProviderArchive("job-stale", staleToken, new Request("https://archiver.test", { method: "POST", headers: { "content-type": "image/png" }, body: png }), { db, bucket, env: dependencies.env, now: () => NOW });
    const second = await ingestProviderArchive("job-stale", staleToken, new Request("https://archiver.test", { method: "POST", headers: { "content-type": "image/png" }, body: png }), { db, bucket, env: dependencies.env, now: () => NOW });
    expect(first.status).toBe(410);
    expect(second.status).toBe(404);
    expect(bucket.objects.size).toBe(0);
    expect(db.database.query("SELECT status, archive_status, result_image_r2_key, refund_ledger_id FROM generation_tasks WHERE id = 'stale-race'").get()).toEqual({ status: "succeeded", archive_status: "not_required", result_image_r2_key: null, refund_ledger_id: null });
    expect(db.database.query("SELECT COUNT(*) AS value FROM generation_history WHERE task_id = 'stale-race'").get()).toEqual({ value: 0 });
  });

  test("current-result downloads use taskId and retrieve only the owner's archived R2 object", async () => {
    const { db, bucket, dependencies } = setup();
    const taskId = "archived-download";
    const r2Key = "generated/user-1/archived-download.png";
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, result_image_r2_key) VALUES (?, ?, 'model', 'succeeded', 'archived', ?)").run(taskId, USER_ID, r2Key);
    bucket.objects.set(r2Key, { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });

    const downloadUrl = generatedImageDownloadUrl(taskId);
    expect(downloadUrl).toBe(`/api/download-image?taskId=${taskId}`);
    expect(downloadUrl).not.toContain("scapi.net");
    expect(downloadUrl).not.toContain("result_image_r2_key");
    expect(generatedImageDownloadFilename("image/png")).toBe("mumo-generated-image.png");
    expect(generatedImageDownloadFilename("image/jpeg; charset=binary")).toBe("mumo-generated-image.jpg");
    expect(generatedImageDownloadFilename("image/webp")).toBe("mumo-generated-image.jpg");

    const image = await getGeneratedImageForUser(USER_ID, taskId, dependencies);
    expect(new Uint8Array(await new Response(image.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(image.contentType).toBe("image/png");
    expect(bucket.getCalls).toEqual([r2Key]);
    await expect(getGeneratedImageForUser("user-2", taskId, dependencies)).rejects.toMatchObject({
      code: "RESULT_NOT_FOUND",
    });
  });

  test("unarchived task download is not proxied to its supplier URL", async () => {
    const { db, bucket, dependencies } = setup();
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, result_image_url, result_image_r2_key) VALUES ('archive-pending-download', ?, 'model', 'succeeded', 'pending', 'https://scapi.net/supplier.png?signature=redacted', NULL)").run(USER_ID);

    await expect(getGeneratedImageForUser(USER_ID, "archive-pending-download", dependencies)).rejects.toMatchObject({
      code: "RESULT_NOT_FOUND",
    });
    expect(bucket.getCalls).toEqual([]);
    const downloadRouteSource = await Bun.file("src/routes/api/download-image.ts").text();
    expect(downloadRouteSource).not.toContain("fetch(");
    expect(downloadRouteSource).not.toContain("arrayBuffer(");
    expect(downloadRouteSource).toContain("createGeneratedImageDownloadResponse(result, taskId");
    expect(downloadRouteSource).not.toContain("searchParams.get(\"url\")");
    expect(downloadRouteSource).not.toContain("searchParams.get(\"imageUrl\")");
    const canvasSource = await Bun.file("src/components/studio/Canvas.tsx").text();
    expect(canvasSource).not.toContain("res.blob(");
    expect(canvasSource).not.toContain("URL.createObjectURL(");
  });

  test("history payload is user-scoped, newest-first, R2-safe, and excludes expired records", async () => {
    const { db, dependencies } = setup();
    db.database.query("INSERT INTO users (id) VALUES ('user-2')").run();
    db.database.query("INSERT INTO generation_history (id, task_id, user_id, model_key, prompt, result_image_url, result_image_r2_key, cost_credits, created_at) VALUES ('archived-history', 'task-archived', ?, 'model', 'newest', 'https://supplier.example/new.png', 'generated/user-1/new.png', 1, '2026-07-14T11:00:00.000Z')").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, user_id, model_key, prompt, result_image_url, cost_credits, created_at) VALUES ('fallback-history', ?, 'model', 'older', 'https://supplier.example/old.png', 1, '2026-07-14T10:00:00.000Z')").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, cost_credits, created_at) VALUES ('expired-history', ?, 'model', 'https://supplier.example/expired.png', 1, '2026-06-01T10:00:00.000Z')").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, cost_credits, created_at) VALUES ('other-history', 'user-2', 'model', 'https://supplier.example/other.png', 1, '2026-07-14T11:30:00.000Z')").run();

    const ownHistory = await listGenerationHistoryForUser(USER_ID, {}, { ...dependencies, now: () => NOW });
    expect(ownHistory.items.map((item) => item.id)).toEqual(["archived-history", "fallback-history"]);
    expect(ownHistory.items[0]).toMatchObject({
      generationTaskId: "task-archived",
      originalImageUrl: "/api/download-image?taskId=task-archived",
    });
    expect(Object.hasOwn(ownHistory.items[0], "result_image_r2_key")).toBe(false);
    expect((await listGenerationHistoryForUser("user-2", {}, { ...dependencies, now: () => NOW })).items.map((item) => item.id)).toEqual(["other-history"]);
  });

  test("history cursor pages are fixed at 20, stable on ties, and tolerate a new insertion", async () => {
    const { db, dependencies } = setup();
    for (let index = 0; index < 40; index += 1) {
      const id = `history-${String(index).padStart(2, "0")}`;
      db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, cost_credits, created_at) VALUES (?, ?, 'model', '', 1, '2026-07-14T11:00:00.000Z')").run(id, USER_ID);
    }

    const first = await listGenerationHistoryForUser(USER_ID, {}, dependencies);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items.map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `history-${String(39 - index).padStart(2, "0")}`),
    );

    db.database.query("INSERT INTO generation_history (id, user_id, model_key, result_image_url, cost_credits, created_at) VALUES ('history-new', ?, 'model', '', 1, '2026-07-14T12:00:00.000Z')").run(USER_ID);
    const second = await listGenerationHistoryForUser(USER_ID, { cursor: first.nextCursor }, dependencies);
    expect(second.items).toHaveLength(20);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(40);
    expect(second.items.some((item) => item.id === "history-new")).toBe(false);
  });

  test("thumbnail ownership is user-scoped and resolves only a deterministic private sidecar", async () => {
    const { db, bucket, dependencies } = setup();
    const taskId = "thumbnail-task";
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, result_image_r2_key) VALUES (?, ?, 'model', 'succeeded', 'generated/user/original.png')").run(taskId, USER_ID);
    const thumbnailKey = generatedThumbnailKey(USER_ID, taskId);
    bucket.objects.set(thumbnailKey, { bytes: new Uint8Array([1, 2]), contentType: "image/webp" });

    expect(await authorizeGeneratedThumbnailForUser(USER_ID, taskId, dependencies)).toEqual({
      thumbnailKey,
      displayReady: true,
      archiveStatus: "not_required",
    });
    await expect(authorizeGeneratedThumbnailForUser("user-2", taskId, dependencies)).rejects.toMatchObject({ code: "THUMBNAIL_NOT_FOUND" });
    const thumbnail = await getGeneratedThumbnailObject(thumbnailKey, dependencies);
    expect(thumbnail.contentType).toBe("image/webp");
    expect(bucket.getCalls).toEqual([thumbnailKey]);
  });

  test("signed thumbnail ingest validates task state, MIME, size, magic, and canonical destination", async () => {
    const { db, bucket, dependencies } = setup();
    const claimedAt = NOW.toISOString();
    dependencies.env = { MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1: "thumbnail-signing-key" };
    db.database.query(`INSERT INTO generation_tasks
      (id, user_id, model_key, provider, status, archive_status, archive_job_id, archive_claimed_at, result_image_r2_key)
      VALUES ('thumb-task', ?, 'model', 'wuyinkeji', 'succeeded', 'archived', 'thumb-job', ?, 'generated/user/original.png')`).run(USER_ID, claimedAt);
    db.database.query("INSERT INTO generation_history (id, task_id, user_id, model_key, result_image_url, result_image_r2_key, archive_status) VALUES ('thumb-history', 'thumb-task', ?, 'model', '', 'generated/user/original.png', 'archived')").run(USER_ID);
    const token = await createProviderArchiveToken("thumb-job", "thumb-task", dependencies.env, NOW, claimedAt);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

    expect((await ingestProviderArchiveThumbnail("thumb-job", null, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: webp }), dependencies)).status).toBe(403);
    expect((await ingestProviderArchiveThumbnail("thumb-job", "invalid", new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: webp }), dependencies)).status).toBe(403);
    expect((await ingestProviderArchiveThumbnail("missing-job", token, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: webp }), dependencies)).status).toBe(404);
    expect((await ingestProviderArchiveThumbnail("thumb-job", token, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/png" }, body: webp }), dependencies)).status).toBe(415);
    expect((await ingestProviderArchiveThumbnail("thumb-job", token, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: new Uint8Array([1, 2, 3]) }), dependencies)).status).toBe(415);
    expect((await ingestProviderArchiveThumbnail("thumb-job", token, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp", "content-length": String(MAX_PROVIDER_THUMBNAIL_BYTES + 1) }, body: webp }), dependencies)).status).toBe(413);

    expect(await ingestProviderArchiveThumbnail("thumb-job", token, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: webp }), dependencies)).toEqual({ status: 200, thumbnailStatus: "created" });
    const expectedKey = generatedThumbnailKey(USER_ID, "thumb-task");
    expect(bucket.objects.get(expectedKey)).toEqual({ bytes: webp, contentType: "image/webp" });
    expect(await ingestProviderArchiveThumbnail("thumb-job", token, new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: webp }), dependencies)).toEqual({ status: 200, thumbnailStatus: "exists" });
    const source = await Bun.file("src/routes/api/provider-result-archive/$jobId/thumbnail.ts").text();
    expect(source).not.toContain('searchParams.get("key")');
    expect(source).not.toContain('searchParams.get("userId")');
  });

  test("thumbnail backfill APIs require the service token and reject tasks without an archived original", async () => {
    const { db, bucket, dependencies } = setup();
    dependencies.env = { MUMO_ARCHIVER_SERVICE_TOKEN_V1: "service-token" };
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, result_image_r2_key, created_at) VALUES ('backfill-task', ?, 'model', 'succeeded', 'archived', 'generated/user/backfill.png', '2026-07-14T10:00:00.000Z')").run(USER_ID);
    db.database.query("INSERT INTO generation_history (id, task_id, user_id, model_key, result_image_url, result_image_r2_key, archive_status) VALUES ('backfill-history', 'backfill-task', ?, 'model', '', 'generated/user/backfill.png', 'archived')").run(USER_ID);
    db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, result_image_r2_key) VALUES ('pending-original', ?, 'model', 'succeeded', 'pending', NULL)").run(USER_ID);

    expect((await listProviderThumbnailBackfillJobs(null, { limit: 20 }, dependencies)).status).toBe(401);
    expect((await listProviderThumbnailBackfillJobs("wrong", { limit: 20 }, dependencies)).status).toBe(401);
    expect((await listProviderThumbnailBackfillJobs("service-token", { limit: 51 }, dependencies)).status).toBe(400);
    expect((await getProviderThumbnailBackfillOriginal("service-token", "backfill-task", true, dependencies)).status).toBe(404);
    expect((await getProviderThumbnailBackfillOriginal("service-token", "pending-original", true, dependencies)).status).toBe(404);
    expect((await ingestProviderThumbnailBackfill("service-token", "pending-original", new Request("https://mumo.test", { method: "POST", headers: { "content-type": "image/webp" }, body: new Uint8Array([1]) }), dependencies)).status).toBe(404);

    bucket.objects.set("generated/user/backfill.png", { bytes: new Uint8Array([1]), contentType: "image/png" });
    const page = await listProviderThumbnailBackfillJobs("service-token", { limit: 20 }, dependencies);
    expect(page).toMatchObject({ status: 200, items: [{ taskId: "backfill-task", hasThumbnail: false }], hasMore: false, limit: 20 });
    expect((await getProviderThumbnailBackfillOriginal("service-token", "backfill-task", true, dependencies)).status).toBe(200);

    for (let index = 0; index < 21; index += 1) {
      const taskId = `backfill-page-${String(index).padStart(2, "0")}`;
      const originalKey = `generated/user/${taskId}.png`;
      db.database.query("INSERT INTO generation_tasks (id, user_id, model_key, status, archive_status, result_image_r2_key, created_at) VALUES (?, ?, 'model', 'succeeded', 'archived', ?, ?)").run(taskId, USER_ID, originalKey, `2026-07-15T10:00:${String(index).padStart(2, "0")}.000Z`);
      db.database.query("INSERT INTO generation_history (id, task_id, user_id, model_key, result_image_url, result_image_r2_key, archive_status) VALUES (?, ?, ?, 'model', '', ?, 'archived')").run(`history-${taskId}`, taskId, USER_ID, originalKey);
    }
    const limited = await listProviderThumbnailBackfillJobs("service-token", { limit: 20 }, dependencies);
    expect(limited.status).toBe(200);
    if (limited.status !== 200) throw new Error("backfill page failed");
    expect(limited.items).toHaveLength(20);
    expect(limited.hasMore).toBe(true);
    expect(limited.nextCursor).toBeTruthy();
  });

  test("history entry is authenticated and Studio disables the legacy Canvas history fetch", async () => {
    const [topBar, studio, historyServer] = await Promise.all([
      Bun.file("src/components/studio/TopBar.tsx").text(),
      Bun.file("src/components/studio/Studio.tsx").text(),
      Bun.file("src/lib/admin.server.ts").text(),
    ]);
    expect(topBar).toContain("onOpenHistory &&");
    expect(topBar).toContain("onClick={onOpenHistory}");
    expect(studio).toContain("onOpenHistory={session ? () => setHistoryOpen(true) : undefined}");
    expect(studio).toContain("historyOpen={false}");
    expect(studio).toContain("<HistoryPanel");
    expect(historyServer).toContain("getMyGenerationHistory = serverFn(async (data) => withUser");
  });
});
