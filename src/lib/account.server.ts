import "@tanstack/react-start/server-only";

import { hashPassword, verifyPassword } from "./auth";
import type { D1Database } from "./d1";

export class AccountUpdateError extends Error {
  constructor(
    readonly code: "INVALID_NICKNAME" | "CURRENT_PASSWORD_INCORRECT" | "WEAK_PASSWORD" | "PASSWORD_UNCHANGED" | "ACCOUNT_UPDATE_FAILED",
    readonly message: string,
    readonly status: 400 | 401 | 500,
  ) {
    super(message);
    this.name = "AccountUpdateError";
  }
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AccountUpdateError("INVALID_NICKNAME", "请输入 2 到 24 个字符的昵称。", 400);
  }
  const displayName = value.trim();
  const length = Array.from(displayName).length;
  if (!displayName || length < 2 || length > 24) {
    throw new AccountUpdateError("INVALID_NICKNAME", "昵称需为 2 到 24 个非空白字符。", 400);
  }
  return displayName;
}

export async function updateDisplayName(
  db: D1Database,
  userId: string,
  value: unknown,
): Promise<string> {
  const displayName = normalizeDisplayName(value);
  try {
    const result = await db
      .prepare("UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(displayName, userId)
      .run();
    if (!result.success) throw new Error("update failed");
  } catch (error) {
    if (error instanceof AccountUpdateError) throw error;
    throw new AccountUpdateError("ACCOUNT_UPDATE_FAILED", "昵称保存失败，请稍后重试。", 500);
  }
  return displayName;
}

export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: unknown,
  newPassword: unknown,
): Promise<void> {
  if (typeof currentPassword !== "string" || !currentPassword) {
    throw new AccountUpdateError("CURRENT_PASSWORD_INCORRECT", "当前密码不正确。", 401);
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new AccountUpdateError("WEAK_PASSWORD", "新密码至少需要 8 个字符。", 400);
  }
  if (newPassword === currentPassword) {
    throw new AccountUpdateError("PASSWORD_UNCHANGED", "新密码不能与当前密码相同。", 400);
  }

  let row: { password_hash: string } | null;
  try {
    row = await db
      .prepare("SELECT password_hash FROM users WHERE id = ? LIMIT 1")
      .bind(userId)
      .first<{ password_hash: string }>();
  } catch {
    throw new AccountUpdateError("ACCOUNT_UPDATE_FAILED", "密码修改失败，请稍后重试。", 500);
  }
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new AccountUpdateError("CURRENT_PASSWORD_INCORRECT", "当前密码不正确。", 401);
  }

  const passwordHash = await hashPassword(newPassword);
  try {
    const result = await db
      .prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(passwordHash, userId)
      .run();
    if (!result.success) throw new Error("update failed");
  } catch {
    throw new AccountUpdateError("ACCOUNT_UPDATE_FAILED", "密码修改失败，请稍后重试。", 500);
  }
}
