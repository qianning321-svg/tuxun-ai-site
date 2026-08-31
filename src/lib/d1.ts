import { getStartContext } from "@tanstack/start-storage-context";

export type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  error?: string;
  meta?: Record<string, unknown>;
};

export type D1ExecResult = {
  count: number;
  duration: number;
};

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
  exec(query: string): Promise<D1ExecResult>;
}

type MumoCloudflareEnv = {
  MUMO_DB?: D1Database;
};

const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

function asEnv(value: unknown): MumoCloudflareEnv {
  return value && typeof value === "object" ? (value as MumoCloudflareEnv) : {};
}

function getContextEnv(): unknown {
  const startContext = getStartContext({ throwIfNotFound: false });
  const context = startContext?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  return context?.cloudflare?.env ?? context?.cloudflareEnv;
}

function getGlobalEnv(): unknown {
  const globalRecord = globalThis as Record<string, unknown>;
  return globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__;
}

export function getD1(explicitEnv?: unknown): D1Database {
  const binding = asEnv(explicitEnv).MUMO_DB ?? asEnv(getContextEnv()).MUMO_DB ?? asEnv(getGlobalEnv()).MUMO_DB;
  if (!binding) {
    throw new Error("D1 binding MUMO_DB is not configured");
  }
  return binding;
}

export const getDb = getD1;
