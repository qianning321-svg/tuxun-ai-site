import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { D1Database, D1ExecResult, D1PreparedStatement, D1Result } from "../src/lib/d1";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "../src/lib/provider-credentials-crypto.server";
import {
  clearProviderCredential,
  getProviderCredentialStatus,
  resolveProviderRuntimeCredential,
  upsertProviderCredential,
} from "../src/lib/provider-credentials.server";
import { mergeCloudflareEnv } from "../src/lib/cloudflare-env.server";
import { createDefaultProviderRegistry } from "../src/lib/providers/provider-registry.server";
import { getProviderConfigurationStatuses } from "../src/lib/providers/provider-configuration.server";

const TEST_MASTER_KEY = btoa("test-master-key-0000000000000000");
const TEST_PROVIDER_KEY = "test-provider-key";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return this.database.query(this.sql).get(...this.values) as T | null; }
  async all<T>(): Promise<D1Result<T>> { return { results: this.database.query(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  async run<T>(): Promise<D1Result<T>> { const result = this.database.query(this.sql).run(...this.values); return { results: [], success: true, meta: { changes: result.changes } }; }
  async raw<T>(): Promise<T[]> { return this.database.query(this.sql).values(...this.values) as T[]; }
}

class FakeD1 implements D1Database {
  readonly database = new Database(":memory:");
  constructor() {
    this.database.exec(`CREATE TABLE provider_credentials (
      provider TEXT PRIMARY KEY, base_url TEXT, api_key_ciphertext TEXT, api_key_iv TEXT,
      encryption_version INTEGER NOT NULL DEFAULT 1, is_enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  prepare(query: string) { return new Statement(this.database, query); }
  async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map((statement) => statement.run<T>())); }
  async exec(): Promise<D1ExecResult> { return { count: 0, duration: 0 }; }
}

describe("provider credential encryption", () => {
  test("encrypts with unique IVs and decrypts with the same provider", async () => {
    const first = await encryptProviderSecret(TEST_MASTER_KEY, "vibelearning", TEST_PROVIDER_KEY);
    const second = await encryptProviderSecret(TEST_MASTER_KEY, "vibelearning", TEST_PROVIDER_KEY);
    expect(first.ciphertext).not.toContain(TEST_PROVIDER_KEY);
    expect(second.ciphertext).not.toBe(first.ciphertext);
    expect(second.iv).not.toBe(first.iv);
    await expect(decryptProviderSecret(TEST_MASTER_KEY, "vibelearning", first)).resolves.toBe(TEST_PROVIDER_KEY);
  });

  test("rejects tampering, wrong provider binding, and invalid master keys", async () => {
    const encrypted = await encryptProviderSecret(TEST_MASTER_KEY, "vibelearning", TEST_PROVIDER_KEY);
    await expect(decryptProviderSecret(TEST_MASTER_KEY, "mock", encrypted)).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_DECRYPTION_FAILED" });
    await expect(decryptProviderSecret(TEST_MASTER_KEY, "vibelearning", { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + "AA" })).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_DECRYPTION_FAILED" });
    await expect(decryptProviderSecret(TEST_MASTER_KEY, "vibelearning", { ...encrypted, iv: encrypted.iv.slice(0, -2) + "AA" })).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_DECRYPTION_FAILED" });
    await expect(encryptProviderSecret(btoa("short"), "vibelearning", TEST_PROVIDER_KEY)).rejects.toMatchObject({ code: "PROVIDER_CREDENTIALS_MASTER_KEY_INVALID" });
  });
});

describe("provider credential storage", () => {
  test("stores only ciphertext and status responses omit secrets", async () => {
    const db = new FakeD1();
    const status = await upsertProviderCredential(db, { provider: "vibelearning", baseUrl: "https://provider.test/v1/", apiKey: TEST_PROVIDER_KEY, isEnabled: true }, "admin-1", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY });
    const stored = db.database.query("SELECT * FROM provider_credentials WHERE provider = 'vibelearning'").get() as Record<string, unknown>;
    expect(status).toMatchObject({ provider: "vibelearning", baseUrl: "https://provider.test/v1", apiKeyConfigured: true, isEnabled: true });
    expect(stored.api_key_ciphertext).not.toBe(TEST_PROVIDER_KEY);
    expect(stored.api_key_iv).toBeTruthy();
    expect(JSON.stringify(status)).not.toContain("ciphertext");
    expect(JSON.stringify(status)).not.toContain(TEST_PROVIDER_KEY);
  });

  test("keeps a key on empty input, clears only explicitly, and resolves database credentials first", async () => {
    const db = new FakeD1();
    await upsertProviderCredential(db, { provider: "vibelearning", apiKey: TEST_PROVIDER_KEY }, "admin-1", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY });
    await upsertProviderCredential(db, { provider: "vibelearning", apiKey: "", isEnabled: false }, "admin-2", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY });
    await expect(resolveProviderRuntimeCredential(db, "vibelearning", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY, VIBELEARNING_IMAGE_API_KEY: "test-environment-provider-key" })).rejects.toThrow("供应商凭证已禁用");
    await upsertProviderCredential(db, { provider: "vibelearning", isEnabled: true }, "admin-2", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY });
    await expect(resolveProviderRuntimeCredential(db, "vibelearning", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY, VIBELEARNING_IMAGE_API_KEY: "test-environment-provider-key" })).resolves.toMatchObject({ apiKey: TEST_PROVIDER_KEY });
    await clearProviderCredential(db, "vibelearning", "admin-2");
    await expect(getProviderCredentialStatus(db, "vibelearning")).resolves.toMatchObject({ apiKeyConfigured: false });
  });

  test("merges encrypted credential and environment secret status without decrypting", async () => {
    const d1Credential = new FakeD1();
    await upsertProviderCredential(d1Credential, { provider: "vibelearning", apiKey: TEST_PROVIDER_KEY, isEnabled: false }, "admin-1", { MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1: TEST_MASTER_KEY });
    const d1Status = await getProviderConfigurationStatuses(d1Credential, { MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true" });
    const environmentStatus = await getProviderConfigurationStatuses(new FakeD1(), { VIBELEARNING_IMAGE_API_KEY: "test-environment-provider-key", MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true" });
    const emptyStatus = await getProviderConfigurationStatuses(new FakeD1(), { MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true" });

    expect(d1Status[0]).toMatchObject({ apiKeyConfigured: true, enabled: false });
    expect(environmentStatus[0]).toMatchObject({ apiKeyConfigured: true, enabled: true });
    expect(emptyStatus[0]).toMatchObject({ apiKeyConfigured: false, enabled: true });
    expect(JSON.stringify(d1Status[0])).not.toContain("ciphertext");
    expect(JSON.stringify(d1Status[0])).not.toContain('"apiKey":');
    expect(JSON.stringify(d1Status[0])).not.toContain("Authorization");
  });
});

describe("Worker environment source precedence", () => {
  const sourceKey = (value: string) => ({ WUYINKEJI_API_KEY: value, MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true" as const });

  test("keeps the highest-precedence non-blank secret across global, context, and explicit sources", async () => {
    const cases = [
      [{ global: sourceKey("global-test-key") }, "global"],
      [{ context: sourceKey("context-test-key") }, "context"],
      [{ explicit: sourceKey("explicit-test-key") }, "explicit"],
      [{ global: sourceKey("global-test-key"), context: {}, explicit: {} }, "global"],
      [{ global: sourceKey("global-test-key"), context: { WUYINKEJI_API_KEY: undefined }, explicit: {} }, "global"],
      [{ global: sourceKey("global-test-key"), context: { WUYINKEJI_API_KEY: "   " }, explicit: {} }, "global"],
      [{ context: sourceKey("context-test-key"), explicit: {} }, "context"],
      [{ context: sourceKey("context-test-key"), explicit: { WUYINKEJI_API_KEY: undefined } }, "context"],
      [{ context: sourceKey("context-test-key"), explicit: { WUYINKEJI_API_KEY: "" } }, "context"],
      [{ global: sourceKey("global-test-key"), context: sourceKey("context-test-key"), explicit: sourceKey("explicit-test-key") }, "explicit"],
    ] as const;

    for (const [sources, expected] of cases) {
      const merged = mergeCloudflareEnv(sources.global, sources.context, sources.explicit);
      expect(merged.WUYINKEJI_API_KEY?.startsWith(`${expected}-test-`)).toBe(true);
      expect(merged.MUMO_ENABLE_REAL_IMAGE_PROVIDERS).toBe("true");
    }

    const db = new FakeD1();
    const resolved = await resolveProviderRuntimeCredential(
      db,
      "wuyinkeji",
      mergeCloudflareEnv({ WUYINKEJI_API_KEY: "global-test-key" }, { WUYINKEJI_API_KEY: "   " }, undefined),
    );
    expect(resolved.apiKey.startsWith("global-test-")).toBe(true);
  });

  test("fails safely when all environment sources lack a non-blank key", async () => {
    const db = new FakeD1();
    await expect(resolveProviderRuntimeCredential(
      db,
      "wuyinkeji",
      mergeCloudflareEnv({ WUYINKEJI_API_KEY: "   " }, { WUYINKEJI_API_KEY: undefined }, { WUYINKEJI_API_KEY: "" }),
    )).rejects.toThrow("供应商凭证未配置");
  });

  test("initializes Wuyinkeji through the runtime registry without exposing the key", async () => {
    const db = new FakeD1();
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const provider = await createDefaultProviderRegistry({ allowRealProviders: true }).getRuntime("wuyinkeji", {
      db,
      env: { WUYINKEJI_API_KEY: "runtime-test-key", MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true" },
      fetchImpl: (async (input, init) => {
        calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ code: 200, data: { id: "provider-task-test" } }), { status: 200 });
      }) as typeof fetch,
    });
    await provider.createTask({ model: "image_nanoBanana", prompt: "fixture", aspectRatio: "1:1", quality: "1K", referenceImages: [], count: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization?.startsWith("runtime-test-")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("MUMO_ENABLE_REAL_IMAGE_PROVIDERS");
  });

  test("runtime registry reads the Worker global env when explicit env is omitted", async () => {
    const db = new FakeD1();
    const globalRecord = globalThis as Record<string, unknown>;
    const previous = globalRecord.__MUMO_CLOUDFLARE_ENV__;
    globalRecord.__MUMO_CLOUDFLARE_ENV__ = {
      WUYINKEJI_API_KEY: "global-runtime-test-key",
      MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true",
    };
    try {
      const provider = await createDefaultProviderRegistry({ allowRealProviders: true }).getRuntime("wuyinkeji", {
        db,
        fetchImpl: (async () => new Response(JSON.stringify({ code: 200, data: { id: "provider-task-global" } }), { status: 200 })) as typeof fetch,
      });
      await expect(provider.createTask({ model: "image_nanoBanana", prompt: "fixture", aspectRatio: "1:1", quality: "1K", referenceImages: [], count: 1 })).resolves.toMatchObject({ taskId: "provider-task-global" });
    } finally {
      if (previous === undefined) delete globalRecord.__MUMO_CLOUDFLARE_ENV__;
      else globalRecord.__MUMO_CLOUDFLARE_ENV__ = previous;
    }
  });

  test("only exact true enables the real provider registry", () => {
    for (const value of [undefined, "false", "TRUE", "True", "1"]) {
      const allowReal = value === "true";
      expect(() => createDefaultProviderRegistry({ allowRealProviders: allowReal }).get("wuyinkeji")).toThrow();
    }
  });

  test("logs one allowlisted diagnostic for missing Wuyinkeji credentials", async () => {
    const db = new FakeD1();
    const entries: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => entries.push(args);
    try {
      await expect(resolveProviderRuntimeCredential(db, "wuyinkeji", {
        WUYINKEJI_API_KEY: "   ",
        MUMO_ENABLE_REAL_IMAGE_PROVIDERS: "true",
      })).rejects.toThrow();
    } finally {
      console.error = originalError;
    }

    expect(entries).toHaveLength(1);
    const diagnostic = entries[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(diagnostic).sort()).toEqual([
      "contextHasKeyProperty", "contextHasNonBlankKey", "diagnosticRevision", "event",
      "explicitHasKeyProperty", "explicitHasNonBlankKey", "globalHasKeyProperty",
      "globalHasNonBlankKey", "hasContextEnv", "hasDatabaseCredentialRow",
      "hasDatabaseCiphertext", "hasExplicitEnv", "hasGlobalEnv", "provider",
      "realProvidersEnabled", "resolvedHasKeyProperty", "resolvedHasNonBlankKey",
    ].sort());
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("WUYINKEJI_API_KEY");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("taskId");
    expect(serialized).not.toContain("runtime-test-key");
    expect(diagnostic.event).toBe("mumo_wuyinkeji_credential_missing_v2");
    expect(diagnostic.hasExplicitEnv).toBe(true);
    expect(diagnostic.explicitHasKeyProperty).toBe(true);
    expect(diagnostic.explicitHasNonBlankKey).toBe(false);
    expect(diagnostic.hasDatabaseCredentialRow).toBe(false);
    expect(diagnostic.hasDatabaseCiphertext).toBe(false);
  });

  test("does not log the missing diagnostic for configured Wuyinkeji or VibeLearning", async () => {
    const db = new FakeD1();
    const entries: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => entries.push(args);
    try {
      await expect(resolveProviderRuntimeCredential(db, "wuyinkeji", { WUYINKEJI_API_KEY: "configured-test-key" })).resolves.toMatchObject({ apiKey: "configured-test-key" });
      await expect(resolveProviderRuntimeCredential(db, "vibelearning", { VIBELEARNING_IMAGE_API_KEY: "vibe-test-key" })).resolves.toMatchObject({ apiKey: "vibe-test-key" });
    } finally {
      console.error = originalError;
    }
    expect(entries).toHaveLength(0);
  });
});
