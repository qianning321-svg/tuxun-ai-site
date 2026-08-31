import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";
import { z } from "zod";

import type { WuyinkejiImageEnv } from "../../env";
import { imageGenerationInputSchema } from "../generation.schemas";
import {
  createProviderTaskFailure,
  ImageProviderError,
  type ImageGenerationInput,
  type ImageProvider,
  type ProviderTaskCreated,
  type ProviderTaskResult,
} from "./image-provider.server";

export const DEFAULT_WUYINKEJI_API_BASE_URL = "https://api.wuyinkeji.com";
const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";
const ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2", "5:4", "4:5", "1:4", "1:8", "4:1", "8:1"] as const;

type Adapter = {
  endpoint: string;
  qualities: readonly ("1K" | "2K" | "4K")[];
  aspectRatios: readonly string[];
  payload(input: ImageGenerationInput, urls: string[]): Record<string, unknown>;
};

const COMMON_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"] as const;
const AUTO_COMMON_ASPECT_RATIOS = ["auto", ...COMMON_ASPECT_RATIOS] as const;
const GPT_ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"] as const;
const NANO_2_ASPECT_RATIOS = ["auto", ...COMMON_ASPECT_RATIOS, "1:4", "1:8", "4:1", "8:1"] as const;

const adapters: Record<string, Adapter> = {
  image_gpt: {
    endpoint: "/api/async/image_gpt",
    qualities: ["1K"],
    aspectRatios: GPT_ASPECT_RATIOS,
    payload: (input, urls) => ({ prompt: input.prompt, size: input.aspectRatio, urls }),
  },
  image_nanoBanana: {
    endpoint: "/api/async/image_nanoBanana",
    qualities: ["1K"],
    aspectRatios: AUTO_COMMON_ASPECT_RATIOS,
    payload: (input, urls) => ({ prompt: input.prompt, imageSize: "1K", aspectRatio: input.aspectRatio, urls }),
  },
  image_nanoBanana_pro: {
    endpoint: "/api/async/image_nanoBanana_pro",
    qualities: ["1K", "2K", "4K"],
    aspectRatios: COMMON_ASPECT_RATIOS,
    payload: (input, urls) => ({ prompt: input.prompt, size: input.quality, aspectRatio: input.aspectRatio, urls }),
  },
  image_nanoBanana2: {
    endpoint: "/api/async/image_nanoBanana2",
    qualities: ["1K", "2K", "4K"],
    aspectRatios: NANO_2_ASPECT_RATIOS,
    payload: (input, urls) => ({ prompt: input.prompt, size: input.quality, aspectRatio: input.aspectRatio, urls }),
  },
  image_nanoBanana2Lite: {
    endpoint: "/api/async/image_nanoBanana2Lite",
    qualities: ["1K"],
    aspectRatios: AUTO_COMMON_ASPECT_RATIOS,
    payload: (input, urls) => ({ prompt: input.prompt, size: "1K", aspectRatio: input.aspectRatio, urls }),
  },
};

const createResponseSchema = z.object({
  code: z.union([z.number(), z.string()]).optional(),
  msg: z.unknown().optional(),
  data: z.unknown().optional(),
}).passthrough();
const pollResponseSchema = z.object({ status: z.unknown().optional(), message: z.unknown().optional(), code: z.unknown().optional(), data: z.unknown().optional() }).passthrough();

function normalizePollStatus(value: unknown): 0 | 1 | 2 | 3 | undefined {
  if (typeof value === "number") {
    return value === 0 || value === 1 || value === 2 || value === 3 ? value : undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized === "0" || normalized === "1" || normalized === "2" || normalized === "3"
      ? Number(normalized) as 0 | 1 | 2 | 3
      : undefined;
  }
  return undefined;
}

export type WuyinkejiImageProviderOptions = {
  env?: WuyinkejiImageEnv;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

type Configuration = { apiBaseUrl: string; apiKey: string };

export type WuyinkejiGenerationDiagnostic = {
  stage: "provider_status_3" | "provider_result_parse";
  providerStatus: 2 | 3;
  resultPropertyPresent?: boolean;
  resultIsArray?: boolean;
  resultCount?: number;
  allResultItemsStrings?: boolean;
  safeHttpsResultCount?: number;
};

const resultDiagnostics = new WeakMap<object, WuyinkejiGenerationDiagnostic>();
const pollErrorDiagnostics = new WeakMap<object, WuyinkejiGenerationDiagnostic>();

export function getWuyinkejiResultDiagnostic(
  result: ProviderTaskResult,
): WuyinkejiGenerationDiagnostic | undefined {
  return resultDiagnostics.get(result);
}

export function getWuyinkejiPollErrorDiagnostic(
  error: unknown,
): WuyinkejiGenerationDiagnostic | undefined {
  return error && typeof error === "object" ? pollErrorDiagnostics.get(error) : undefined;
}

function asEnv(value: unknown): WuyinkejiImageEnv {
  return value && typeof value === "object" ? value as WuyinkejiImageEnv : {};
}

function resolveConfiguration(options: Pick<WuyinkejiImageProviderOptions, "env" | "apiKey" | "baseUrl">): Configuration {
  const context = getStartContext({ throwIfNotFound: false });
  const contextValue = context?.contextAfterGlobalMiddlewares as { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown } | undefined;
  const globalRecord = globalThis as Record<string, unknown>;
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  const contextEnv = asEnv(contextValue?.cloudflare?.env ?? contextValue?.cloudflareEnv);
  const globalEnv = asEnv(globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__);
  const apiKey = String(options.apiKey ?? options.env?.WUYINKEJI_API_KEY ?? contextEnv.WUYINKEJI_API_KEY ?? globalEnv.WUYINKEJI_API_KEY ?? processEnv?.WUYINKEJI_API_KEY ?? "").trim();
  if (!apiKey) throw providerError("CONFIGURATION_ERROR", "Wuyinkeji image API key is not configured.");
  const baseUrl = String(options.baseUrl ?? options.env?.WUYINKEJI_API_BASE_URL ?? contextEnv.WUYINKEJI_API_BASE_URL ?? globalEnv.WUYINKEJI_API_BASE_URL ?? processEnv?.WUYINKEJI_API_BASE_URL ?? DEFAULT_WUYINKEJI_API_BASE_URL).trim().replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw providerError("CONFIGURATION_ERROR", "Wuyinkeji image API base URL is invalid.");
  }
  return { apiBaseUrl: baseUrl, apiKey };
}

function providerError(code: "CONFIGURATION_ERROR" | "INVALID_PROVIDER_INPUT" | "UNSUPPORTED_PROVIDER_SIZE" | "INVALID_PROVIDER_RESPONSE" | "PROVIDER_REQUEST_REJECTED", message: string, options?: { providerCode?: string }): ImageProviderError {
  return new ImageProviderError({ code, message, retryable: false, ...(options?.providerCode ? { providerCode: options.providerCode } : {}) });
}

function adapterFor(model: string): Adapter {
  const adapter = adapters[model.trim()];
  if (!adapter) throw providerError("INVALID_PROVIDER_INPUT", "Unsupported Wuyinkeji provider model.");
  return adapter;
}

function cleanMessage(value: unknown, apiKey: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/(?:authorization|api[_-]?key|user_ip|debug|exec_time|stack|ip)\s*[:=][^,\s]+/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return clean || undefined;
}

function isUnsafeImageHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/[\[\]]/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0" || host === "::" || host === "127.0.0.1") return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = octets;
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

function isSafeHttpsResult(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && !isUnsafeImageHostname(url.hostname);
  } catch {
    return false;
  }
}

function resultParseDiagnostic(dataRecord: Record<string, unknown>): WuyinkejiGenerationDiagnostic {
  const result = dataRecord.result;
  const resultIsArray = Array.isArray(result);
  const resultItems = resultIsArray ? result : [];
  return {
    stage: "provider_result_parse",
    providerStatus: 2,
    resultPropertyPresent: Object.prototype.hasOwnProperty.call(dataRecord, "result"),
    resultIsArray,
    resultCount: resultIsArray ? resultItems.length : 0,
    allResultItemsStrings: resultIsArray && resultItems.every((item) => typeof item === "string"),
    safeHttpsResultCount: resultIsArray ? resultItems.filter(isSafeHttpsResult).length : 0,
  };
}

function throwResultParseError(dataRecord: Record<string, unknown>, message: string): never {
  const error = providerError("INVALID_PROVIDER_RESPONSE", message);
  pollErrorDiagnostics.set(error, resultParseDiagnostic(dataRecord));
  throw error;
}

function parseCompletedResult(dataRecord: Record<string, unknown>): ProviderTaskResult["images"] {
  const result = dataRecord.result;
  if (!Array.isArray(result) || result.length === 0 || result.some((item) => typeof item !== "string")) {
    throwResultParseError(dataRecord, "Wuyinkeji completed response has an invalid result.");
  }
  return result.map((item) => {
    const value = item.trim();
    if (!value) throwResultParseError(dataRecord, "Wuyinkeji completed response has an empty result.");
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || isUnsafeImageHostname(url.hostname)) throw new Error("unsafe image URL");
      return { kind: "url", url: url.toString() } as const;
    } catch {
      throwResultParseError(dataRecord, "Wuyinkeji completed response has an unsafe image URL.");
    }
  });
}

export class WuyinkejiImageProvider implements ImageProvider {
  readonly key = "wuyinkeji";
  readonly capabilities = { modes: ["text-to-image", "image-to-image"], maxReferenceImages: 5, aspectRatios: ASPECT_RATIOS, qualities: ["1K", "2K", "4K"] } as const;
  private readonly options: WuyinkejiImageProviderOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WuyinkejiImageProviderOptions = {}) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async createTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    return this.createTextToImageTask(input);
  }

  async createTextToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    const parsed = imageGenerationInputSchema.safeParse(input);
    if (!parsed.success) throw providerError("INVALID_PROVIDER_INPUT", "Wuyinkeji input is invalid.");
    const adapter = adapterFor(parsed.data.model);
    if (!adapter.aspectRatios.includes(parsed.data.aspectRatio)) throw providerError("UNSUPPORTED_PROVIDER_SIZE", "Unsupported Wuyinkeji aspect ratio.");
    if (!adapter.qualities.includes(parsed.data.quality)) throw providerError("UNSUPPORTED_PROVIDER_SIZE", "Unsupported Wuyinkeji image size.");
    const configuration = resolveConfiguration(this.options);
    const urls = parsed.data.referenceImages.map((image) => image.supplierUrl).filter((url): url is string => !!url);
    if (urls.length !== parsed.data.referenceImages.length || urls.some((url) => {
      try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol !== "https:" || !!parsedUrl.username || !!parsedUrl.password;
      } catch {
        return true;
      }
    })) throw providerError("INVALID_PROVIDER_INPUT", "Wuyinkeji reference images require signed HTTPS supplier URLs.");
    const payload = await this.requestJson(adapter.endpoint, { method: "POST", body: JSON.stringify(adapter.payload(parsed.data, urls)) }, configuration);
    const response = createResponseSchema.safeParse(payload);
    if (!response.success) throw providerError("INVALID_PROVIDER_RESPONSE", "Wuyinkeji create response is invalid.");
    const providerCode = response.data.code;
    if (providerCode !== 200) {
      const message = cleanMessage(response.data.msg, configuration.apiKey) ?? "Wuyinkeji rejected the image request.";
      throw providerError("PROVIDER_REQUEST_REJECTED", message, {
        providerCode: providerCode === undefined ? undefined : String(providerCode),
      });
    }
    const topLevel = response.data as Record<string, unknown>;
    const data = topLevel.data;
    const dataRecord = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : undefined;
    const taskId = dataRecord?.id ?? dataRecord?.task_id;
    const fallbackTaskId = topLevel.id ?? topLevel.task_id;
    const normalizedTaskId = taskId ?? fallbackTaskId;
    if (typeof normalizedTaskId !== "string" || !normalizedTaskId.trim()) {
      throw providerError("INVALID_PROVIDER_RESPONSE", "Wuyinkeji success response did not contain data.id.");
    }
    return { taskId: normalizedTaskId.trim(), mode: "text-to-image", status: "queued" };
  }

  async createImageToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    return this.createTextToImageTask(input);
  }

  async pollTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult> {
    return this.pollTextToImageTask(task.taskId);
  }

  async getTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult> {
    return this.pollTask(task);
  }

  async pollTextToImageTask(taskId: string): Promise<ProviderTaskResult> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) throw providerError("INVALID_PROVIDER_INPUT", "A Wuyinkeji task ID is required.");
    const configuration = resolveConfiguration(this.options);
    const url = new URL("/api/async/detail", `${configuration.apiBaseUrl}/`);
    url.searchParams.set("id", normalizedTaskId);
    const payload = await this.requestJson(url.toString(), { method: "GET" }, configuration, true);
    const response = pollResponseSchema.safeParse(payload);
    if (!response.success) throw providerError("INVALID_PROVIDER_RESPONSE", "Wuyinkeji poll response has an invalid status.");
    const dataRecord = response.data.data && typeof response.data.data === "object" && !Array.isArray(response.data.data)
      ? response.data.data as Record<string, unknown>
      : undefined;
    const rawStatus = dataRecord?.status ?? response.data.status;
    const status = normalizePollStatus(rawStatus);
    if (status === 0) return { taskId: normalizedTaskId, status: "queued", images: [] };
    if (status === 1) return { taskId: normalizedTaskId, status: "processing", images: [] };
    if (status === 3) {
      const message = dataRecord?.message ?? response.data.message;
      const code = dataRecord?.code ?? response.data.code;
      const result = createProviderTaskFailure(normalizedTaskId, message ? new Error(cleanMessage(message, configuration.apiKey) ?? "Wuyinkeji task failed.") : undefined, { apiKey: configuration.apiKey, providerCode: typeof code === "string" || typeof code === "number" ? String(code) : undefined });
      resultDiagnostics.set(result, { stage: "provider_status_3", providerStatus: 3 });
      return result;
    }
    if (status === 2) {
      if (!dataRecord) {
        const error = providerError("INVALID_PROVIDER_RESPONSE", "Wuyinkeji completed response has no verified image result.");
        pollErrorDiagnostics.set(error, {
          stage: "provider_result_parse",
          providerStatus: 2,
          resultPropertyPresent: false,
          resultIsArray: false,
          resultCount: 0,
          allResultItemsStrings: false,
          safeHttpsResultCount: 0,
        });
        throw error;
      }
      return { taskId: normalizedTaskId, status: "completed", images: parseCompletedResult(dataRecord) };
    }
    throw providerError("INVALID_PROVIDER_RESPONSE", "Wuyinkeji poll response has an unknown status.");
  }

  async pollImageToImageTask(): Promise<ProviderTaskResult> {
    throw providerError("INVALID_PROVIDER_INPUT", "Wuyinkeji reference images are not enabled.");
  }

  private async requestJson(pathOrUrl: string, init: RequestInit, configuration: Configuration, absolute = false): Promise<unknown> {
    const url = absolute ? pathOrUrl : new URL(pathOrUrl, `${configuration.apiBaseUrl}/`).toString();
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, headers: { authorization: configuration.apiKey, "content-type": "application/json" } });
    } catch (error) {
      throw new ImageProviderError({ code: "PROVIDER_NETWORK_ERROR", message: "Unable to connect to Wuyinkeji image service.", retryable: true }, { cause: error });
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (!response.ok) {
      const message = payload && typeof payload === "object" ? cleanMessage((payload as Record<string, unknown>).msg ?? (payload as Record<string, unknown>).message, configuration.apiKey) : undefined;
      throw new ImageProviderError({ code: "PROVIDER_HTTP_ERROR", message: message || `Wuyinkeji image service returned HTTP ${response.status}.`, retryable: response.status === 429 || response.status >= 500, httpStatus: response.status });
    }
    if (payload === undefined) throw providerError("INVALID_PROVIDER_RESPONSE", "Wuyinkeji returned a non-JSON response.");
    return payload;
  }
}
