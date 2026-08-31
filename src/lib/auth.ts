import { getD1, type D1Database } from "@/lib/d1";

const PASSWORD_ALGORITHM = "PBKDF2";
const PASSWORD_DIGEST = "SHA-256";
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

export const SESSION_COOKIE_NAME = "mumo_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthProfile = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  credits: number;
};

export type AuthSession = {
  user: AuthUser;
  profile: AuthProfile;
};

type SessionRow = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  credits: number | string | null;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function joinBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hashSaltedSha256(password: string, salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES))): Promise<string> {
  const passwordBytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest(PASSWORD_DIGEST, joinBytes(salt, passwordBytes));
  return `sha256_salted$1$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(digest))}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: PASSWORD_ALGORITHM },
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: PASSWORD_ALGORITHM, hash: PASSWORD_DIGEST, iterations: PASSWORD_ITERATIONS, salt },
      material,
      PASSWORD_KEY_BYTES * 8,
    );
    return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
  } catch (error) {
    console.error("PBKDF2 password hashing unavailable; using salted SHA-256 fallback", error);
    return hashSaltedSha256(password, salt);
  }
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4) return false;

  if (parts[0] === "sha256_salted") {
    try {
      const salt = base64ToBytes(parts[2]);
      const expected = base64ToBytes(parts[3]);
      const candidateHash = await hashSaltedSha256(password, salt);
      const candidate = base64ToBytes(candidateHash.split("$")[3] ?? "");
      return expected.length > 0 && constantTimeEqual(candidate, expected);
    } catch {
      return false;
    }
  }

  if (parts[0] !== "pbkdf2_sha256") return false;

  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;

  try {
    const salt = base64ToBytes(parts[2]);
    const expected = base64ToBytes(parts[3]);
    if (salt.length < 16 || expected.length !== PASSWORD_KEY_BYTES) return false;

    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: PASSWORD_ALGORITHM },
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: PASSWORD_ALGORITHM, hash: PASSWORD_DIGEST, iterations, salt },
      material,
      expected.length * 8,
    );
    return constantTimeEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES)));
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function getSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

function shouldUseSecureCookie(): boolean {
  const globalEnv = (globalThis as Record<string, unknown>).__MUMO_CLOUDFLARE_ENV__;
  const configuredMode = globalEnv && typeof globalEnv === "object"
    ? (globalEnv as { ENVIRONMENT?: string }).ENVIRONMENT
    : undefined;
  const mode = configuredMode ?? (typeof process !== "undefined" ? process.env.NODE_ENV : undefined);
  return mode !== "development" && mode !== "local" && mode !== "test";
}

export function createSessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = shouldUseSecureCookie() ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = shouldUseSecureCookie() ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

export async function createStoredSession(
  db: D1Database,
  userId: string,
  request?: Request,
): Promise<{ token: string; tokenHash: string; expiresAt: Date; statement: ReturnType<D1Database["prepare"]> }> {
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const userAgent = request?.headers.get("user-agent")?.slice(0, 512) ?? null;
  const statement = db.prepare(
    "INSERT INTO sessions (id, user_id, session_token_hash, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), userId, tokenHash, expiresAt.toISOString(), userAgent);
  return { token, tokenHash, expiresAt, statement };
}

export async function getSignupBonusCredits(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value_json FROM system_settings WHERE key = ? LIMIT 1")
    .bind("signup_bonus_credits")
    .first<{ value_json: string }>();
  if (!row) return 10;

  try {
    const parsed = JSON.parse(row.value_json) as unknown;
    const candidate = typeof parsed === "number"
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as { credits?: unknown; value?: unknown }).credits ?? (parsed as { value?: unknown }).value
        : undefined;
    const value = Number(candidate);
    return Number.isSafeInteger(value) && value >= 0 ? value : 10;
  } catch {
    return 10;
  }
}

export async function getSessionFromRequest(request: Request): Promise<AuthSession | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return null;

  const db = getD1();
  const tokenHash = await hashSessionToken(token);
  const row = await db.prepare(
    `SELECT u.id, u.email, u.display_name, u.avatar_url, COALESCE(c.balance, 0) AS credits
     FROM sessions AS s
     INNER JOIN users AS u ON u.id = s.user_id
     LEFT JOIN user_credits AS c ON c.user_id = u.id
     WHERE s.session_token_hash = ?
       AND s.revoked_at IS NULL
       AND datetime(s.expires_at) > CURRENT_TIMESTAMP
       AND u.status = 'active'
     LIMIT 1`,
  ).bind(tokenHash).first<SessionRow>();

  if (!row) return null;
  await db.prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_token_hash = ?")
    .bind(tokenHash)
    .run();

  return {
    user: { id: row.id, email: row.email },
    profile: {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      credits: Number(row.credits ?? 0),
    },
  };
}

export async function requireAuth(request: Request): Promise<AuthSession> {
  const session = await getSessionFromRequest(request);
  if (session) return session;
  throw new Response(JSON.stringify({ ok: false, code: "AUTH_REQUIRED", message: "Authentication required" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
