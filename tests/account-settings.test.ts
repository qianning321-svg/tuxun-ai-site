import { describe, expect, test } from "bun:test";

import { AccountUpdateError, changePassword, normalizeDisplayName, updateDisplayName } from "../src/lib/account.server";
import { hashPassword, verifyPassword } from "../src/lib/auth";
import type { D1Database, D1PreparedStatement } from "../src/lib/d1";

function mockDb(passwordHash = "", userId = "user-a") {
  const bindings: unknown[][] = [];
  let storedHash = passwordHash;
  let storedName: string | null = null;
  const db: D1Database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...next) { values = next; bindings.push(next); return statement; },
        async first<T>() { return query.includes("SELECT password_hash") && values[0] === userId ? { password_hash: storedHash } as T : null; },
        async all<T>() { return { results: [] as T[], success: true }; },
        async raw<T>() { return [] as T[]; },
        async run<T>() {
          if (!query.includes("WHERE id = ?") || values.at(-1) !== userId) return { results: [] as T[], success: false };
          if (query.includes("display_name")) storedName = values[0] as string;
          if (query.includes("password_hash")) storedHash = values[0] as string;
          return { results: [] as T[], success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch<T>() { return [] as Array<{ results: T[]; success: boolean }>; },
    async exec() { return { count: 0, duration: 0 }; },
  };
  return { db, bindings, getName: () => storedName, getHash: () => storedHash };
}

describe("account nickname validation", () => {
  test("trims and accepts a valid display_name", async () => {
    const storage = mockDb();
    await expect(updateDisplayName(storage.db, "user-a", "  沐墨 AI  ")).resolves.toBe("沐墨 AI");
    expect(storage.getName()).toBe("沐墨 AI");
  });

  test("rejects blank and overlong display names", () => {
    expect(() => normalizeDisplayName("   ")).toThrow(AccountUpdateError);
    expect(() => normalizeDisplayName("a".repeat(25))).toThrow(AccountUpdateError);
  });

  test("the update is scoped to the authenticated user ID", async () => {
    const storage = mockDb();
    await updateDisplayName(storage.db, "user-a", "有效昵称");
    expect(storage.bindings.at(-1)).toEqual(["有效昵称", "user-a"]);
  });
});

describe("account password changes", () => {
  test("requires the current password and persists only a replacement PBKDF2 hash", async () => {
    const oldHash = await hashPassword("old-password");
    const storage = mockDb(oldHash);
    await changePassword(storage.db, "user-a", "old-password", "new-password");
    expect(storage.getHash()).not.toBe("new-password");
    await expect(verifyPassword("old-password", storage.getHash())).resolves.toBe(false);
    await expect(verifyPassword("new-password", storage.getHash())).resolves.toBe(true);
  });

  test("rejects wrong, short, and unchanged passwords", async () => {
    const storage = mockDb(await hashPassword("old-password"));
    await expect(changePassword(storage.db, "user-a", "wrong", "new-password")).rejects.toMatchObject({ code: "CURRENT_PASSWORD_INCORRECT" });
    await expect(changePassword(storage.db, "user-a", "old-password", "short")).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(changePassword(storage.db, "user-a", "old-password", "old-password")).rejects.toMatchObject({ code: "PASSWORD_UNCHANGED" });
  });
});

describe("account settings routes", () => {
  test("accept only current-user mutations and private avatar reads", async () => {
    const profileRoute = await Bun.file("src/routes/api/account/profile.ts").text();
    const avatarRoute = await Bun.file("src/routes/api/uploads/avatar.ts").text();
    const dialog = await Bun.file("src/components/auth/SettingsDialog.tsx").text();
    expect(profileRoute).not.toContain("targetUserId");
    expect(avatarRoute).not.toContain("searchParams");
    expect(avatarRoute).toContain('"Cache-Control": "private, max-age=0, no-store"');
    expect(dialog).not.toContain("正在准备中");
    expect(dialog).toContain("refreshProfile");
  });
});
