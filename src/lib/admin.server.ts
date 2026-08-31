import "@tanstack/react-start/server-only";
import { getRequest } from "@tanstack/react-start/server";
import { getStartContext } from "@tanstack/start-storage-context";
import { getSessionFromRequest, hashPassword, normalizeEmail, verifyPassword } from "@/lib/auth";
import { getD1, type D1Database } from "@/lib/d1";
import type { MumoCloudflareEnv } from "@/env";
import { createDefaultProviderRegistry } from "@/lib/providers/provider-registry.server";
import { VibeLearningImageProvider, type ProviderTaskDiagnostic } from "@/lib/providers/vibelearning-image.server";

type Input = Record<string, any>;
type AdminContext = { db: D1Database; userId: string; role: "owner" | "admin" };
type AdminRole = "owner" | "admin";

export class AdminProviderDiagnosticError extends Error {
  constructor(readonly code: "INVALID_GENERATION_TASK_ID" | "GENERATION_TASK_NOT_FOUND" | "PROVIDER_TASK_UNAVAILABLE" | "PROVIDER_DIAGNOSTIC_UNSUPPORTED") {
    super("供应商任务诊断请求无效。 ");
    this.name = "AdminProviderDiagnosticError";
  }
}

export function getD1ServerOnly(): D1Database {
  return getD1();
}

export function getSessionServerOnly() {
  return getSessionFromRequest(getRequest());
}

export function normalizeEmailServerOnly(email: string) {
  return normalizeEmail(email);
}

function serverFn<T>(handler: (data: Input) => Promise<T>, _method: "GET" | "POST" = "POST"): (data: Input) => Promise<T> {
  return handler;
}

function pendingServerFn(name: string, method: "GET" | "POST" = "POST"): any {
  return serverFn(async () => {
    throw new Error(`功能暂未开放（${name}）`);
  }, method);
}

function friendlyError(error: unknown): Error {
  const message = String((error as { message?: unknown })?.message ?? error ?? "");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("mumo_db") ||
    normalized.includes("d1 binding") ||
    normalized.includes("no such table") ||
    normalized.includes("schema") && normalized.includes("table")
  ) return new Error("后台数据服务未配置");
  return error instanceof Error ? error : new Error(message || "操作失败");
}

async function withDb<T>(operation: (db: D1Database) => Promise<T>): Promise<T> {
  try {
    return await operation(await getD1ServerOnly());
  } catch (error) {
    throw friendlyError(error);
  }
}

async function withAdmin<T>(operation: (context: AdminContext) => Promise<T>, ownerOnly = false): Promise<T> {
  return withDb(async (db) => {
    const session = await getSessionServerOnly();
    if (!session) throw new Error("请先登录");
    const admin = await db.prepare("SELECT role FROM admin_users WHERE user_id = ? LIMIT 1")
      .bind(session.user.id)
      .first<{ role: "owner" | "admin" }>();
    if (!admin || ownerOnly && admin.role !== "owner") throw new Error("无权执行此操作");
    return operation({ db, userId: session.user.id, role: admin.role });
  });
}

async function withUser<T>(operation: (context: { db: D1Database; userId: string }) => Promise<T>): Promise<T> {
  return withDb(async (db) => {
    const session = await getSessionServerOnly();
    if (!session) throw new Error("请先登录");
    return operation({ db, userId: session.user.id });
  });
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function getSetting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare("SELECT value_json FROM system_settings WHERE key = ? LIMIT 1")
    .bind(key)
    .first<{ value_json: string }>();
  return parseJson(row?.value_json, fallback);
}

async function setSetting(db: D1Database, key: string, value: unknown, userId: string | null) {
  await db.prepare(
    `INSERT INTO system_settings (key, value_json, updated_at, updated_by)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`,
  ).bind(key, JSON.stringify(value), userId).run();
}

function boolInt(value: unknown, fallback = true) {
  return value === undefined ? (fallback ? 1 : 0) : value ? 1 : 0;
}

function makeId() { return crypto.randomUUID(); }

function parseAdminRole(value: unknown): AdminRole {
  const role = String(value ?? "admin").trim();
  if (role !== "owner" && role !== "admin") throw new Error("管理员角色无效");
  return role;
}

function getStringInput(data: Input, key: string): string {
  const direct = data[key];
  if (typeof direct === "string") return direct;
  const nested = data.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedValue = (nested as Input)[key];
    if (typeof nestedValue === "string") return nestedValue;
  }
  return "";
}

function resolveAdminEnv(): MumoCloudflareEnv {
  const startContext = getStartContext({ throwIfNotFound: false });
  const context = startContext?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  const globalRecord = globalThis as typeof globalThis & {
    __MUMO_CLOUDFLARE_ENV__?: unknown;
    __env__?: unknown;
  };
  const asEnv = (value: unknown): MumoCloudflareEnv =>
    value && typeof value === "object" ? value as MumoCloudflareEnv : {};
  return {
    ...asEnv(globalRecord.__MUMO_CLOUDFLARE_ENV__ ?? globalRecord.__env__),
    ...asEnv(context?.cloudflare?.env ?? context?.cloudflareEnv),
  };
}

function requireGenerationTaskId(value: string): string {
  const taskId = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
    throw new AdminProviderDiagnosticError("INVALID_GENERATION_TASK_ID");
  }
  return taskId;
}

export const adminDiagnoseGenerationProviderTask = serverFn(async (data) => withAdmin(async ({ db }) => {
  const generationTaskId = requireGenerationTaskId(getStringInput(data, "generationTaskId"));
  const task = await db.prepare(
    `SELECT id, provider, provider_task_id, generation_mode
     FROM generation_tasks WHERE id = ? LIMIT 1`,
  ).bind(generationTaskId).first<{
    id: string;
    provider: string | null;
    provider_task_id: string | null;
    generation_mode: "text_to_image" | "image_to_image" | null;
  }>();
  if (!task) throw new AdminProviderDiagnosticError("GENERATION_TASK_NOT_FOUND");
  if (!task.provider || !task.provider_task_id || !task.generation_mode) {
    throw new AdminProviderDiagnosticError("PROVIDER_TASK_UNAVAILABLE");
  }

  const env = resolveAdminEnv();
  const registry = createDefaultProviderRegistry({
    allowRealProviders: env.MUMO_ENABLE_REAL_IMAGE_PROVIDERS === "true",
  });
  const provider = await registry.getRuntime(task.provider, { db, env });
  if (!(provider instanceof VibeLearningImageProvider)) {
    throw new AdminProviderDiagnosticError("PROVIDER_DIAGNOSTIC_UNSUPPORTED");
  }

  return provider.diagnoseProviderTask({
    generationTaskId: task.id,
    taskId: task.provider_task_id,
    mode: task.generation_mode === "image_to_image" ? "image-to-image" : "text-to-image",
  }) satisfies ProviderTaskDiagnostic;
}, "GET"));

async function countOwners(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS value FROM admin_users WHERE role = 'owner'")
    .first<{ value: number }>();
  return Number(row?.value ?? 0);
}

async function getAdminRoleByUserId(db: D1Database, userId: string): Promise<AdminRole | null> {
  const row = await db.prepare("SELECT role FROM admin_users WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ role: AdminRole }>();
  return row?.role ?? null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCodeGroup(length = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
function makeRedeemCode() { return `MUMO-${randomCodeGroup()}-${randomCodeGroup()}`; }

export const checkIsAdmin = serverFn(async () => {
  try {
    const session = await getSessionServerOnly();
    if (!session) return { isAdmin: false, isFounder: false };
    return withDb(async (db) => {
      const row = await db.prepare("SELECT role FROM admin_users WHERE user_id = ? LIMIT 1")
        .bind(session.user.id)
        .first<{ role: string }>();
      return { isAdmin: !!row, isFounder: row?.role === "owner" };
    });
  } catch {
    return { isAdmin: false, isFounder: false };
  }
});

export const verifyAdminAccessPassword = serverFn(async (data) => {
  try {
    return await withAdmin(async ({ db, userId }) => {
      const submittedPassword = getStringInput(data, "password");
      if (!submittedPassword.trim()) throw new Error("invalid");

      const user = await db.prepare("SELECT password_hash FROM users WHERE id = ? AND status = 'active' LIMIT 1")
        .bind(userId)
        .first<{ password_hash: string }>();
      if (!user?.password_hash) throw new Error("invalid");
      if (!(await verifyPassword(submittedPassword, user.password_hash))) throw new Error("invalid");

      return { ok: true };
    });
  } catch {
    throw new Error("管理员验证失败");
  }
});

export const founderGetAccessPassword = serverFn(async () => withAdmin(async ({ db }) => {
  const row = await db.prepare("SELECT updated_at FROM system_settings WHERE key = ? LIMIT 1")
    .bind("admin_access_password")
    .first<{ updated_at: string }>();
  return { configured: !!row, updated_at: row?.updated_at ?? null };
}, true));

export const founderSetAccessPassword = serverFn(async () => withAdmin(async () => {
  throw new Error("后台入口已改为管理员账号密码验证");
}, true));

export const adminGetAnalytics = serverFn(async () => withAdmin(async ({ db }) => {
  const [todayUsers, totalUsers, todayCost, unusedCodes, registrations, models] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS value FROM users WHERE date(created_at) = date('now')").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM users").first<{ value: number }>(),
    db.prepare("SELECT COALESCE(SUM(ABS(amount)), 0) AS value FROM credit_ledger WHERE amount < 0 AND date(created_at) = date('now')").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM redeem_codes WHERE status = 'unused'").first<{ value: number }>(),
    db.prepare("SELECT id, email, COALESCE((SELECT balance FROM user_credits WHERE user_id = users.id), 0) AS credits, created_at FROM users WHERE date(created_at) = date('now') ORDER BY created_at DESC LIMIT 50").all(),
    db.prepare(`SELECT model_key AS model,
      SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS todayCount,
      COUNT(*) AS totalCount, COALESCE(SUM(cost_credits), 0) AS totalCost
      FROM generation_history WHERE deleted_at IS NULL GROUP BY model_key ORDER BY totalCount DESC`).all(),
  ]);
  return {
    metrics: {
      todayUsers: Number(todayUsers?.value ?? 0),
      todayCost: Number(todayCost?.value ?? 0),
      totalUsers: Number(totalUsers?.value ?? 0),
      unusedCoupons: Number(unusedCodes?.value ?? 0),
    },
    models: models.results ?? [],
    todayRegistrations: registrations.results ?? [],
    dayRange: { timezone: "UTC", startUtc: new Date().toISOString().slice(0, 10), endUtc: null },
  };
}));

export const adminListUsers = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare(`SELECT u.id, u.email, u.display_name, u.created_at,
    COALESCE(c.balance, 0) AS credits, COALESCE(c.total_used, 0) AS total_spent,
    CASE WHEN u.status IN ('banned', 'disabled') THEN 1 ELSE 0 END AS is_banned
    FROM users u LEFT JOIN user_credits c ON c.user_id = u.id ORDER BY u.created_at DESC`).all();
  return rows.results ?? [];
}));

export const adminGetUserCreditUsageLogs = serverFn(async (data) => withAdmin(async ({ db }) => {
  const userId = String(data.userId ?? "");
  const limit = Math.min(100, Math.max(1, Number(data.limit ?? 50)));
  const offset = Math.max(0, Number(data.offset ?? 0));
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT id, user_id, amount, reason AS source, NULL AS model_key, NULL AS model_name,
      CASE WHEN ref_type = 'generation_history' THEN ref_id END AS generation_history_id,
      CASE WHEN ref_type = 'generation_task' THEN ref_id END AS generation_task_id,
      NULL AS image_url, id AS idempotency_key, created_at, note AS metadata
      FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(userId, limit, offset).all(),
    db.prepare("SELECT COUNT(*) AS value FROM credit_ledger WHERE user_id = ?").bind(userId).first<{ value: number }>(),
  ]);
  return { items: rows.results ?? [], total: Number(count?.value ?? 0) };
}));

export const adminAdjustCredits = serverFn(async (data) => withAdmin(async ({ db, userId: adminId }) => {
  const userId = String(data.userId ?? "");
  const delta = Math.trunc(Number(data.delta ?? 0));
  if (!userId || !Number.isSafeInteger(delta) || delta === 0) throw new Error("积分调整值无效");
  await db.prepare("INSERT OR IGNORE INTO user_credits (user_id, balance, total_granted, total_used) VALUES (?, 0, 0, 0)").bind(userId).run();
  const current = await db.prepare("SELECT balance FROM user_credits WHERE user_id = ?").bind(userId).first<{ balance: number }>();
  const next = Number(current?.balance ?? 0) + delta;
  if (next < 0) throw new Error("用户创作点不足，无法扣减");
  const ledgerId = makeId();
  await db.batch([
    db.prepare(`UPDATE user_credits SET balance = ?,
      total_granted = total_granted + ?, total_used = total_used + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
      .bind(next, delta > 0 ? delta : 0, delta < 0 ? Math.abs(delta) : 0, userId),
    db.prepare(`INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, ref_type, note, created_by_admin_id)
      VALUES (?, ?, ?, ?, 'admin_adjustment', 'admin', ?, ?)`)
      .bind(ledgerId, userId, delta, next, String(data.note ?? "后台调整"), adminId),
  ]);
  return { credits: next };
}));

export const adminBanUser = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(data.banned ? "banned" : "active", String(data.userId ?? ""))
    .run();
  return { ok: true };
}));

export const adminDeleteUser = serverFn(async (data) => withAdmin(async ({ db }) => {
  const userId = String(data.userId ?? "");
  await db.batch([
    db.prepare("UPDATE users SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(userId),
    db.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL").bind(userId),
  ]);
  return { ok: true, softDeleted: true };
}));

export const adminResetPassword = serverFn(async () => ({ ok: false, message: "暂不支持在后台重置密码" }));

export const listActiveAds = serverFn(async () => withDb(async (db) => {
  const rows = await db.prepare("SELECT id, title, link_url, image_url, sort_order FROM ads WHERE is_enabled = 1 ORDER BY sort_order, created_at DESC").all();
  return rows.results ?? [];
}), "GET");

export const adminListAds = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare("SELECT id, title, link_url, image_url, sort_order, is_enabled, is_enabled AS is_active, created_at, updated_at FROM ads ORDER BY sort_order, created_at DESC").all();
  return rows.results ?? [];
}));

export const adminUpsertAd = serverFn(async (data) => withAdmin(async ({ db }) => {
  const id = String(data.id ?? makeId());
  await db.prepare(`INSERT INTO ads (id, title, link_url, image_url, sort_order, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, link_url = excluded.link_url, image_url = excluded.image_url,
      sort_order = excluded.sort_order, is_enabled = excluded.is_enabled, updated_at = CURRENT_TIMESTAMP`)
    .bind(id, String(data.title ?? "").trim(), data.link_url ?? null, data.image_url ?? null, Number(data.sort_order ?? 0), boolInt(data.is_enabled ?? data.is_active))
    .run();
  return { id };
}));

export const adminDeleteAd = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM ads WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

function normalizeAnnouncementCtaUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return url;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export const listAnnouncements = serverFn(async () => withDb(async (db) => {
  const rows = await db.prepare("SELECT id, title, content, cta_label, cta_url, sort_order, is_enabled, created_at, updated_at FROM announcements WHERE is_enabled = 1 ORDER BY sort_order, created_at DESC").all();
  return rows.results ?? [];
}), "GET");

export const adminListAnnouncements = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare("SELECT id, title, content, cta_label, cta_url, sort_order, is_enabled, created_at, updated_at FROM announcements ORDER BY sort_order, created_at DESC").all();
  return rows.results ?? [];
}));

export const adminUpsertAnnouncement = serverFn(async (data) => withAdmin(async ({ db }) => {
  const id = String(data.id ?? makeId());
  const title = String(data.title ?? "").trim();
  const content = String(data.content ?? "").trim();
  const ctaLabel = String(data.cta_label ?? "").trim() || null;
  const submittedCtaUrl = String(data.cta_url ?? "").trim();
  const ctaUrl = normalizeAnnouncementCtaUrl(submittedCtaUrl);
  if (!title || !content) throw new Error("Announcement title and content are required");
  if (submittedCtaUrl && !ctaUrl) throw new Error("CTA URL must be an internal path or HTTPS URL");
  await db.prepare(`INSERT INTO announcements (id, title, content, cta_label, cta_url, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, cta_label = excluded.cta_label,
      cta_url = excluded.cta_url, sort_order = excluded.sort_order, is_enabled = excluded.is_enabled, updated_at = CURRENT_TIMESTAMP`)
    .bind(id, title, content, ctaLabel, ctaUrl, Number(data.sort_order ?? 0), boolInt(data.is_enabled ?? data.enabled))
    .run();
  return { id };
}));

export const adminDeleteAnnouncement = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM announcements WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

export const listVisibleRechargePackages = serverFn(async () => withDb(async (db) => {
  const rows = await db.prepare(`SELECT id, name, credits, price_text, badge, description, button_text,
    is_popular, is_highlighted, benefits_text, sort_order, buy_url
    FROM recharge_packages WHERE is_enabled = 1 ORDER BY sort_order, created_at`).all();
  return rows.results ?? [];
}), "GET");

export const listAdminRechargePackages = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare(`SELECT id, name, credits, price_text, badge, description, button_text,
    is_popular, is_highlighted, benefits_text, sort_order, is_enabled, buy_url, created_at, updated_at
    FROM recharge_packages ORDER BY sort_order, created_at`).all();
  return rows.results ?? [];
}));

export const upsertAdminRechargePackage = serverFn(async (data) => withAdmin(async ({ db }) => {
  const id = String(data.id ?? makeId());
  await db.prepare(`INSERT INTO recharge_packages (
      id, name, credits, price_text, badge, description, button_text, is_popular,
      is_highlighted, benefits_text, sort_order, is_enabled, buy_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, credits = excluded.credits, price_text = excluded.price_text,
      badge = excluded.badge, description = excluded.description, button_text = excluded.button_text,
      is_popular = excluded.is_popular, is_highlighted = excluded.is_highlighted,
      benefits_text = excluded.benefits_text, sort_order = excluded.sort_order,
      is_enabled = excluded.is_enabled, buy_url = excluded.buy_url, updated_at = CURRENT_TIMESTAMP`)
    .bind(
      id,
      String(data.name ?? data.title ?? "").trim(),
      Math.max(0, Number(data.credits ?? 0)),
      String(data.price_text ?? data.price ?? "").trim(),
      String(data.badge ?? data.badgeText ?? "").trim() || null,
      String(data.description ?? data.subtitle ?? "").trim() || null,
      String(data.button_text ?? data.buttonText ?? "前往购买").trim() || "前往购买",
      boolInt(data.is_popular ?? data.isPopular),
      boolInt(data.is_highlighted ?? data.isHighlighted),
      String(data.benefits_text ?? data.benefitsText ?? "").trim() || null,
      Number(data.sort_order ?? data.sortOrder ?? 0),
      boolInt(data.is_enabled ?? data.isVisible),
      String(data.buy_url ?? "").trim() || null,
    )
    .run();
  return { id };
}));

export const hideAdminRechargePackage = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("UPDATE recharge_packages SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

export const deleteAdminRechargePackage = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM recharge_packages WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

export const adminListRedeemCodes = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare("SELECT id, code, credits, status, used_by_user_id, used_by_label, used_at, created_at, updated_at, created_by_admin_id, note FROM redeem_codes ORDER BY created_at DESC").all();
  return rows.results ?? [];
}));

export const adminGenerateRedeemCodes = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  const count = Math.min(200, Math.max(1, Math.trunc(Number(data.count ?? 1))));
  const credits = Math.max(1, Math.trunc(Number(data.credits ?? data.amount ?? 1)));
  const created = Array.from({ length: count }, () => ({ id: makeId(), code: makeRedeemCode(), credits }));
  await db.batch(created.map((item) => db.prepare(
    "INSERT INTO redeem_codes (id, code, credits, status, created_by_admin_id, note) VALUES (?, ?, ?, 'unused', ?, ?)",
  ).bind(item.id, item.code, item.credits, userId, data.note ?? null)));
  return created;
}));

export const adminUpdateRedeemCodeStatus = serverFn(async (data) => withAdmin(async ({ db }) => {
  const status = String(data.status ?? "");
  if (status !== "unused" && status !== "disabled") throw new Error("兑换码状态无效");
  await db.prepare("UPDATE redeem_codes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'used'")
    .bind(status, String(data.id ?? ""))
    .run();
  return { ok: true };
}));

export const adminDeleteRedeemCode = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM redeem_codes WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

export const adminClearDisabledRedeemCodes = serverFn(async () => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM redeem_codes WHERE status = 'disabled'").run(); return { ok: true };
}));

export const redeemCode = serverFn(async (data) => withDb(async (db) => {
  const session = await getSessionServerOnly();
  if (!session) throw new Error("请先登录后再兑换");
  const code = String(data.code ?? "").trim().toUpperCase();
  if (!/^MUMO-[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})+$/.test(code)) return { success: false, reason: "format", message: "兑换码格式不正确" };
  const item = await db.prepare("SELECT id, credits, status FROM redeem_codes WHERE code = ? LIMIT 1")
    .bind(code).first<{ id: string; credits: number; status: string }>();
  if (!item) return { success: false, reason: "missing", message: "兑换码不存在或已失效" };
  if (item.status === "used") return { success: false, reason: "used", message: "该兑换码已被使用" };
  if (item.status === "disabled") return { success: false, reason: "disabled", message: "该兑换码已失效" };
  const updated = await db.prepare(`UPDATE redeem_codes SET status = 'used', used_by_user_id = ?, used_by_label = ?,
    used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'unused'`)
    .bind(session.user.id, session.user.email, item.id).run();
  if (Number(updated.meta?.changes ?? 0) < 1) return { success: false, reason: "used", message: "该兑换码已被使用" };
  await db.prepare("INSERT OR IGNORE INTO user_credits (user_id, balance, total_granted, total_used) VALUES (?, 0, 0, 0)").bind(session.user.id).run();
  const current = await db.prepare("SELECT balance FROM user_credits WHERE user_id = ?").bind(session.user.id).first<{ balance: number }>();
  const balance = Number(current?.balance ?? 0) + Number(item.credits ?? 0);
  await db.batch([
    db.prepare("UPDATE user_credits SET balance = ?, total_granted = total_granted + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
      .bind(balance, item.credits, session.user.id),
    db.prepare(`INSERT INTO credit_ledger (id, user_id, amount, balance_after, reason, ref_type, ref_id, note)
      VALUES (?, ?, ?, ?, 'redeem_code', 'redeem_code', ?, ?)`)
      .bind(makeId(), session.user.id, item.credits, balance, item.id, code),
  ]);
  return { success: true, credits: Number(item.credits), balance };
}));

export const redeemCoupon = redeemCode;

export const listModelsConfig = serverFn(async () => withDb(async (db) => {
  const rows = await db.prepare(`SELECT model_key, display_name, cost_credits, sort_order, description,
      badge_label, badge_variant, badge_color, badge_text_color, supported_modes, max_reference_images, created_at
    FROM models_config WHERE is_enabled = 1 ORDER BY sort_order, created_at`).all(); return rows.results ?? [];
}), "GET");
export const adminListModelsConfig = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare("SELECT * FROM models_config ORDER BY sort_order, created_at").all(); return rows.results ?? [];
}));
export const adminUpdateModelPrice = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("UPDATE models_config SET cost_credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? OR model_key = ?")
    .bind(Math.max(0, Number(data.cost_credits ?? data.credits ?? 0)), String(data.id ?? ""), String(data.model_key ?? "")).run(); return { ok: true };
}));

type ModelConfigurationUpdate = Record<string, unknown>;
const MODEL_BADGE_VARIANTS = new Set(["red", "green", "amber", "blue", "purple", "gray"]);

function hasOwn(input: ModelConfigurationUpdate, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function requiredText(value: unknown, label: string, maxLength = 128) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw new Error(`${label}无效`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength) throw new Error("Field value is too long");
  return text || null;
}

function optionalBadgeVariant(value: unknown): string | null {
  const variant = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!variant) return null;
  if (!MODEL_BADGE_VARIANTS.has(variant)) throw new Error("Invalid badge variant");
  return variant;
}

export function normalizeModelBadgeColor(value: unknown): string | null {
  const color = typeof value === "string" ? value.trim() : "";
  if (!color) return null;
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    throw new Error("Invalid badge color");
  }
  const hex = color.slice(1);
  const expanded = hex.length === 3 ? hex.split("").map((part) => `${part}${part}`).join("") : hex;
  return `#${expanded.toUpperCase()}`;
}

function parseSupportedModes(value: unknown): string {
  const modes = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : null;
  if (!Array.isArray(modes) || modes.length === 0 || modes.some((mode) => mode !== "text_to_image" && mode !== "image_to_image")) {
    throw new Error("支持模式无效");
  }
  return JSON.stringify([...new Set(modes)]);
}

export async function updateModelConfiguration(
  db: D1Database,
  input: ModelConfigurationUpdate,
): Promise<{ ok: true }> {
  if (hasOwn(input, "apiKey") || hasOwn(input, "api_key")) throw new Error("不接受 API Key");
  const id = requiredText(input.id, "模型 ID");
  const updates: Array<{ column: string; value: unknown }> = [];
  if (hasOwn(input, "display_name")) updates.push({ column: "display_name", value: requiredText(input.display_name, "显示名称") });
  if (hasOwn(input, "provider")) {
    const provider = requiredText(input.provider, "供应商").toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(provider)) throw new Error("供应商无效");
    updates.push({ column: "provider", value: provider });
  }
  if (hasOwn(input, "provider_model")) updates.push({ column: "provider_model", value: requiredText(input.provider_model, "供应商模型 ID") });
  if (hasOwn(input, "cost_credits")) {
    const value = Number(input.cost_credits);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("创作点无效");
    updates.push({ column: "cost_credits", value });
  }
  if (hasOwn(input, "is_enabled")) {
    const value = input.is_enabled === true || input.is_enabled === 1 || input.is_enabled === "1" ? 1 : input.is_enabled === false || input.is_enabled === 0 || input.is_enabled === "0" ? 0 : null;
    if (value === null) throw new Error("启用状态无效");
    updates.push({ column: "is_enabled", value });
  }
  if (hasOwn(input, "sort_order")) {
    const value = Number(input.sort_order);
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000) throw new Error("排序值无效");
    updates.push({ column: "sort_order", value });
  }
  if (hasOwn(input, "badge_label")) updates.push({ column: "badge_label", value: optionalText(input.badge_label, 40) });
  if (hasOwn(input, "badge_variant")) updates.push({ column: "badge_variant", value: optionalBadgeVariant(input.badge_variant) });
  if (hasOwn(input, "badge_color")) updates.push({ column: "badge_color", value: normalizeModelBadgeColor(input.badge_color) });
  if (hasOwn(input, "badge_text_color")) updates.push({ column: "badge_text_color", value: normalizeModelBadgeColor(input.badge_text_color) });
  if (hasOwn(input, "supported_modes")) updates.push({ column: "supported_modes", value: parseSupportedModes(input.supported_modes) });
  if (hasOwn(input, "max_reference_images")) {
    const value = Number(input.max_reference_images);
    if (!Number.isSafeInteger(value) || value < 0 || value > 5) throw new Error("最大参考图数量无效");
    updates.push({ column: "max_reference_images", value });
  }
  if (hasOwn(input, "description")) updates.push({ column: "description", value: typeof input.description === "string" ? input.description.trim().slice(0, 1000) || null : null });
  if (updates.length === 0) throw new Error("没有可更新的模型字段");

  const assignments = updates.map(({ column }) => `${column} = ?`).join(", ");
  const result = await db.prepare(
    `UPDATE models_config SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(...updates.map(({ value }) => value), id).run();
  if (!result.success || result.meta?.changes !== 1) throw new Error("模型不存在或未更新");
  return { ok: true };
}

export const adminUpdateModel = serverFn(async (data) => withAdmin(async ({ db }) => {
  return updateModelConfiguration(db, data);
}));
export const adminCreateModel = serverFn(async (data) => withAdmin(async ({ db }) => {
  const id = String(data.id ?? makeId());
  const key = String(data.model_key ?? "").trim();
  if (!key) throw new Error("模型标识不能为空");
  await db.prepare(`INSERT INTO models_config (id, model_key, display_name, provider, provider_model, task_type, cost_credits, is_enabled, sort_order, description, badge_label, badge_variant, input_schema_json, extra_config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, key, requiredText(data.display_name ?? key, "Display name", 80), String(data.provider ?? "configured"), String(data.provider_model ?? key), String(data.task_type ?? "image"), Math.max(0, Number(data.cost_credits ?? 0)), boolInt(data.is_enabled), Number(data.sort_order ?? 0), data.description ?? null, optionalText(data.badge_label, 40), optionalBadgeVariant(data.badge_variant), data.input_schema_json ?? null, data.extra_config_json ?? null).run();
  return { id };
}));
export const adminDeleteModel = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM models_config WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

export const adminGetProviderConfigurationStatuses = serverFn(async () => withAdmin(async ({ db }) => {
  const { getProviderConfigurationStatuses } = await import("@/lib/providers/provider-configuration.server");
  return getProviderConfigurationStatuses(db);
}), "GET");

export const adminListProviderCredentials = serverFn(async () => withAdmin(async ({ db }) => {
  const { listProviderCredentialStatuses } = await import("@/lib/provider-credentials.server");
  return listProviderCredentialStatuses(db);
}), "GET");

export const adminUpsertProviderCredential = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  const { upsertProviderCredential } = await import("@/lib/provider-credentials.server");
  return upsertProviderCredential(db, {
    provider: data.provider,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    isEnabled: data.isEnabled,
  }, userId);
}));

export const adminClearProviderCredential = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  const { clearProviderCredential } = await import("@/lib/provider-credentials.server");
  return clearProviderCredential(db, data.provider, userId);
}));

export const adminGetGlobalConfig = serverFn(async () => withAdmin(async ({ db }) => ({
  site: await getSetting(db, "site_brand", {}),
  contact: await getSetting(db, "contact_info", {}),
  purchase: await getSetting(db, "recharge_purchase_config", {}),
  redeem: await getSetting(db, "redeem_config", {}),
})));
export const getGlobalConfig = serverFn(async () => withDb(async (db) => ({
  site: await getSetting(db, "site_brand", { brandName: "TuXun AI", logoPath: "/mumo-logo.png", subtitle: "TUXUN AI VISUAL STUDIO" }),
  contact: await getSetting(db, "contact_info", {}),
  purchase: await getSetting(db, "recharge_purchase_config", {}),
  redeem: await getSetting(db, "redeem_config", {}),
})), "GET");
export const adminUpdateGlobalConfig = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  if (data.site !== undefined) await setSetting(db, "site_brand", data.site, userId);
  if (data.contact !== undefined) await setSetting(db, "contact_info", data.contact, userId);
  if (data.purchase !== undefined) await setSetting(db, "recharge_purchase_config", data.purchase, userId);
  if (data.redeem !== undefined) await setSetting(db, "redeem_config", data.redeem, userId);
  if (data.key) await setSetting(db, String(data.key), data.value, userId);
  return { ok: true };
}));

export const getContactInfo = serverFn(async () => withDb((db) => getSetting(db, "contact_info", { description: "", wechat: "", email: "", serviceHours: "", enabled: false })), "GET");
export const adminGetContactInfo = serverFn(async () => withAdmin(async ({ db }) => getSetting(db, "contact_info", { description: "", wechat: "", email: "", serviceHours: "", enabled: false })));
export const adminSetContactInfo = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  await setSetting(db, "contact_info", data, userId); return { ok: true };
}));

export const listStyleTemplates = serverFn(async () => withDb(async (db) => {
  const rows = await db.prepare("SELECT id, name, category, prompt, preview_url, sort_order, is_enabled FROM style_templates WHERE is_enabled = 1 ORDER BY sort_order, created_at").all(); return rows.results ?? [];
}), "GET");
export const adminListStyleTemplates = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare("SELECT * FROM style_templates ORDER BY sort_order, created_at").all(); return rows.results ?? [];
}));
export const adminCreateStyleTemplate = serverFn(async (data) => withAdmin(async ({ db }) => {
  const id = String(data.id ?? makeId());
  await db.prepare("INSERT INTO style_templates (id, name, category, prompt, preview_url, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, String(data.name ?? "").trim(), data.category ?? null, data.prompt ?? null, data.preview_url ?? null, Number(data.sort_order ?? 0), boolInt(data.is_enabled)).run(); return { id };
}));
export const adminUpdateStyleTemplate = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare(`UPDATE style_templates SET name = ?, category = ?, prompt = ?, preview_url = ?, sort_order = ?,
    is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(String(data.name ?? "").trim(), data.category ?? null, data.prompt ?? null, data.preview_url ?? null, Number(data.sort_order ?? 0), boolInt(data.is_enabled), String(data.id ?? "")).run(); return { ok: true };
}));
export const adminDeleteStyleTemplate = serverFn(async (data) => withAdmin(async ({ db }) => {
  await db.prepare("DELETE FROM style_templates WHERE id = ?").bind(String(data.id ?? "")).run(); return { ok: true };
}));

export const listAdminUsers = serverFn(async () => withAdmin(async ({ db }) => {
  const rows = await db.prepare(`SELECT a.user_id, a.role, u.email, u.display_name, a.created_at, a.created_by
    FROM admin_users a INNER JOIN users u ON u.id = a.user_id
    ORDER BY CASE WHEN a.role = 'owner' THEN 0 ELSE 1 END, a.created_at`).all();
  return rows.results ?? [];
}, true));

export const addAdminUserByEmail = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  const email = String(data.email ?? "").trim();
  if (!email) throw new Error("请输入邮箱");
  const role = parseAdminRole(data.role ?? "admin");
  const user = await db.prepare("SELECT id FROM users WHERE email_normalized = ? LIMIT 1")
    .bind(await normalizeEmailServerOnly(email))
    .first<{ id: string }>();
  if (!user) throw new Error("请先让该邮箱注册账号");

  await db.prepare(`INSERT INTO admin_users (id, user_id, role, created_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET role = excluded.role`)
    .bind(makeId(), user.id, role, userId)
    .run();
  return { ok: true };
}, true));

export const updateAdminUserRole = serverFn(async (data) => withAdmin(async ({ db, userId: currentUserId }) => {
  const targetUserId = String(data.userId ?? "").trim();
  if (!targetUserId) throw new Error("管理员不存在");
  const nextRole = parseAdminRole(data.role);
  const currentRole = await getAdminRoleByUserId(db, targetUserId);
  if (!currentRole) throw new Error("管理员不存在");
  if (targetUserId === currentUserId && currentRole === "owner" && nextRole !== "owner") {
    throw new Error("不能降低自己的 owner 权限");
  }
  if (currentRole === "owner" && nextRole !== "owner" && await countOwners(db) <= 1) {
    throw new Error("至少保留一个 owner");
  }

  await db.prepare("UPDATE admin_users SET role = ? WHERE user_id = ?")
    .bind(nextRole, targetUserId)
    .run();
  return { ok: true };
}, true));

export const removeAdminUser = serverFn(async (data) => withAdmin(async ({ db, userId: currentUserId }) => {
  const targetUserId = String(data.userId ?? "").trim();
  if (!targetUserId) throw new Error("管理员不存在");
  if (targetUserId === currentUserId) throw new Error("不能移除自己");
  const role = await getAdminRoleByUserId(db, targetUserId);
  if (!role) throw new Error("管理员不存在");
  if (role === "owner") throw new Error("不能直接移除 owner，请先将其改为 admin");

  await db.prepare("DELETE FROM admin_users WHERE user_id = ? AND role = 'admin'")
    .bind(targetUserId)
    .run();
  return { ok: true };
}, true));

export const resetAdminUserPassword = serverFn(async (data) => withAdmin(async ({ db }) => {
  const targetUserId = getStringInput(data, "userId").trim();
  const password = getStringInput(data, "password").trim();
  if (!targetUserId) throw new Error("管理员不存在");
  if (password.length < 8) throw new Error("密码至少 8 位");
  const role = await getAdminRoleByUserId(db, targetUserId);
  if (!role) throw new Error("管理员不存在");

  const passwordHash = await hashPassword(password);
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(passwordHash, targetUserId),
    db.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL")
      .bind(targetUserId),
  ]);
  return { ok: true };
}, true));

export const founderListAdmins = serverFn(async (data) => {
  const rows = await listAdminUsers(data);
  return rows.map((row: any) => ({ ...row, role: row.role === "owner" ? "founder" : row.role }));
});
export const founderAddAdmin = serverFn(async (data) => addAdminUserByEmail({ ...data, role: "admin" }));
export const founderRemoveAdmin = removeAdminUser;

export const adminGetSystemPrompt = serverFn(async () => withAdmin(async ({ db }) => getSetting(db, "system_prompt", { prompt: "" })));
export const adminSetSystemPrompt = serverFn(async (data) => withAdmin(async ({ db, userId }) => {
  await setSetting(db, "system_prompt", { prompt: String(data.prompt ?? "") }, userId); return { ok: true };
}));

export const getMyGenerationHistory = serverFn(async (data) => withUser(async ({ db, userId }) => {
  const { listGenerationHistoryForUser } = await import("@/lib/generation.server");
  const page = await listGenerationHistoryForUser(userId, {
    cursor: typeof data.cursor === "string" ? data.cursor : null,
  }, { db });
  return { ...page, limit: page.pageSize, offset: 0 };
}), "GET");

export const getMyGenerationTasks = serverFn(async () => withUser(async ({ db, userId }) => {
  const { listGenerationTasksForUser } = await import("@/lib/generation.server");
  return listGenerationTasksForUser(userId, { db });
}), "GET");

export const createGenerationTask = serverFn(async (data) => withUser(async ({ db, userId }) => {
  const { createGenerationTaskForUser } = await import("@/lib/generation.server");
  const parameters = data.parameters && typeof data.parameters === "object" ? data.parameters : {};
  return createGenerationTaskForUser(userId, {
    modelKey: String(data.modelKey ?? ""),
    prompt: String(data.prompt ?? ""),
    referenceImageIds: Array.isArray(data.referenceImageIds)
      ? data.referenceImageIds.filter((id): id is string => typeof id === "string")
      : [],
    parameters: {
      aspectRatio: String(parameters.aspectRatio ?? "1:1"),
      quality:
        parameters.quality === "2K" || parameters.quality === "4K" ? parameters.quality : "1K",
    },
    idempotencyKey: String(data.idempotencyKey ?? ""),
  }, { db });
}));

export const pollGenerationTask = serverFn(async (data) => withUser(async ({ db, userId }) => {
  const { pollGenerationTaskForUser } = await import("@/lib/generation.server");
  return pollGenerationTaskForUser(userId, String(data.taskId ?? ""), { db });
}));

export const cancelMyQueuedGenerationTasks = serverFn(async () => withUser(async ({ db, userId }) => {
  await db.prepare(
    `UPDATE generation_tasks SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND status = 'queued' AND deduction_ledger_id IS NULL`,
  ).bind(userId).run();
  return { ok: true };
}));

export async function cancelGenerationTaskForUser(
  db: D1Database,
  userId: string,
  rawTaskId: unknown,
): Promise<{ taskId: string; status: "canceled" }> {
  const taskId = String(rawTaskId ?? "").trim();
  const result = await db.prepare(
    `UPDATE generation_tasks SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND status = 'queued' AND deduction_ledger_id IS NULL`,
  ).bind(taskId, userId).run();
  if (result.success === true && result.meta?.changes === 1) {
    return { taskId, status: "canceled" };
  }

  const task = await db.prepare(
    "SELECT status, deduction_ledger_id FROM generation_tasks WHERE id = ? AND user_id = ? LIMIT 1",
  ).bind(taskId, userId).first<{ status: string; deduction_ledger_id: string | null }>();
  if (!task) throw new Error("任务不存在或无权操作");
  if (task.status !== "queued" || task.deduction_ledger_id !== null) {
    throw new Error("任务已开始或已扣费，无法取消");
  }
  throw new Error("任务状态已变化，请重试");
}

export const cancelGenerationTask = serverFn(async (data) => withUser(async ({ db, userId }) => {
  return cancelGenerationTaskForUser(db, userId, data.taskId);
}));

export const startGenerationTask = pollGenerationTask;
export const consumeGeneration = createGenerationTask;
export const generateImage = createGenerationTask;
export const checkImageStatus = pendingServerFn("checkImageStatus");
export const generateRandomPrompt = pendingServerFn("generateRandomPrompt");
export const adminTestModel = pendingServerFn("adminTestModel");

// Compatibility exports retained for older UI imports; the active UI uses the D1 redeem functions above.
export const adminListCoupons = adminListRedeemCodes;
export const adminDeleteCoupon = adminDeleteRedeemCode;
export const adminGenerateCoupons = adminGenerateRedeemCodes;
