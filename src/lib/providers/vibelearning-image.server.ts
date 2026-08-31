import "@tanstack/react-start/server-only";

import { getStartContext } from "@tanstack/start-storage-context";
import { z } from "zod";

import type { VibeLearningImageEnv } from "../../env";
import { imageGenerationInputSchema } from "../generation.schemas";
import {
  createProviderTaskFailure,
  ImageProviderError,
  type ImageGenerationInput,
  type ImageProvider,
  type ProviderTaskStatus,
  isImageToImageMode,
  normalizeImageResults,
  normalizeProviderError,
  normalizeTaskStatus,
  type ProviderGenerationMode,
  type ProviderTaskCreated,
  type ProviderTaskResult,
} from "./image-provider.server";

const DEFAULT_API_BASE_URL = "https://image1.vibelearning.top/v1";
const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

const TASK_PATHS: Record<ProviderGenerationMode, string> = {
  "text-to-image": "/images/generations/tasks",
  "image-to-image": "/images/edits/tasks",
};

const PROVIDER_SIZE_MAP: Readonly<Record<string, string>> = {
  "1:1|1K": "1024x1024",
  "1:1|2K": "2048x2048",
  "1:1|4K": "4096x4096",
  "4:3|1K": "1024x768",
  "4:3|2K": "2048x1536",
  "4:3|4K": "4096x3072",
  "3:4|1K": "768x1024",
  "3:4|2K": "1536x2048",
  "3:4|4K": "3072x4096",
  "16:9|1K": "1024x576",
  "16:9|2K": "2048x1152",
  "16:9|4K": "4096x2304",
  "9:16|1K": "576x1024",
  "9:16|2K": "1152x2048",
  "9:16|4K": "2304x4096",
};

export const vibeLearningTaskRequestSchema = z
  .object({
    model: z.string().min(1),
    prompt: z.string().min(1),
    size: z.string().min(1),
    n: z.literal(1),
  })
  .strict();

export const vibeLearningTaskCreatedResponseSchema = z
  .object({
    task_id: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    data: z
      .object({
        task_id: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const vibeLearningTaskPollResponseSchema = z
  .object({
    status: z.string().min(1),
    data: z.unknown().optional(),
    response: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
    message: z.unknown().optional(),
    code: z.unknown().optional(),
  })
  .passthrough();

export type VibeLearningProviderOptions = {
  env?: VibeLearningImageEnv;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxReferenceImages?: number;
};

type ResolvedConfiguration = {
  apiBaseUrl: string;
  apiKey: string;
};

type ProviderTaskHttpResponse = {
  httpStatus: number;
  responseIsJson: boolean;
  payload: unknown;
};

type ProviderTaskValueSummary = {
  type: "null" | "array" | "object" | "string" | "other";
  keys: string[];
  count: number | null;
  status: string | null;
  state: string | null;
};

type DiagnosticImageType = "png" | "jpeg" | "webp" | "unknown" | null;

type ResponseDataItemDiagnostic = {
  type: ProviderTaskValueSummary["type"];
  keys: string[];
  urlType: ProviderTaskValueSummary["type"];
  urlIsHttps: boolean;
  b64Type: ProviderTaskValueSummary["type"];
  b64Length: number | null;
  b64HasDataUrlPrefix: boolean;
  b64HasWhitespace: boolean;
  b64LengthMod4: 0 | 1 | 2 | 3 | null;
  b64AlphabetValid: boolean;
  b64PaddingValid: boolean;
  b64DecodedPrefixValid: boolean;
  detectedImageType: DiagnosticImageType;
  magicValid: boolean;
  likelyTruncated: boolean;
};

export type ProviderTaskDiagnostic = {
  generationTaskId: string;
  provider: string;
  providerTaskIdPresent: boolean;
  generationMode: string;
  httpStatus: number;
  responseIsJson: boolean;
  topLevelKeys: string[];
  topStatus: string | null;
  topState: string | null;
  topCode: string | number | null;
  dataType: ProviderTaskValueSummary["type"];
  dataKeys: string[];
  dataCount: number | null;
  dataStatus: string | null;
  dataState: string | null;
  nestedDataType: ProviderTaskValueSummary["type"];
  nestedDataKeys: string[];
  nestedDataCount: number | null;
  resultType: ProviderTaskValueSummary["type"];
  resultKeys: string[];
  resultStatus: string | null;
  resultState: string | null;
  resultDataType: ProviderTaskValueSummary["type"];
  resultDataKeys: string[];
  resultDataCount: number | null;
  responseType: ProviderTaskValueSummary["type"];
  responseKeys: string[];
  responseCount: number | null;
  responseStatus: string | null;
  responseState: string | null;
  responseItemType: ProviderTaskValueSummary["type"];
  responseItemKeys: string[];
  responseDataType: ProviderTaskValueSummary["type"];
  responseDataKeys: string[];
  responseDataCount: number | null;
  responseDataItemType: ResponseDataItemDiagnostic["type"];
  responseDataItemKeys: string[];
  responseDataItemUrlType: ResponseDataItemDiagnostic["urlType"];
  responseDataItemUrlIsHttps: boolean;
  responseDataItemB64Type: ResponseDataItemDiagnostic["b64Type"];
  responseDataItemB64Length: number | null;
  responseDataItemB64HasDataUrlPrefix: boolean;
  responseDataItemB64HasWhitespace: boolean;
  responseDataItemB64LengthMod4: ResponseDataItemDiagnostic["b64LengthMod4"];
  responseDataItemB64AlphabetValid: boolean;
  responseDataItemB64PaddingValid: boolean;
  responseDataItemB64DecodedPrefixValid: boolean;
  responseDataItemDetectedImageType: DiagnosticImageType;
  responseDataItemMagicValid: boolean;
  responseDataItemLikelyTruncated: boolean;
  responseOutputType: ProviderTaskValueSummary["type"];
  responseOutputKeys: string[];
  responseOutputCount: number | null;
  knownResultFlags: {
    topUrl: boolean;
    topB64Json: boolean;
    dataUrl: boolean;
    dataB64Json: boolean;
    dataDataUrl: boolean;
    dataDataB64Json: boolean;
    resultUrl: boolean;
    resultB64Json: boolean;
    resultDataUrl: boolean;
    resultDataB64Json: boolean;
    responseUrl: boolean;
    responseB64Json: boolean;
    responseImageUrl: boolean;
    responseOutputUrl: boolean;
    responseItemUrl: boolean;
    responseItemB64Json: boolean;
    responseItemImageUrl: boolean;
    responseItemOutputUrl: boolean;
    responseDataUrl: boolean;
    responseDataB64Json: boolean;
    responseDataImageUrl: boolean;
    responseDataOutputUrl: boolean;
    responseOutputB64Json: boolean;
    responseOutputImageUrl: boolean;
  };
  normalizedStatus: string | null;
  normalizationErrorCode: string | null;
};

type ExtractedProviderError = {
  message?: string;
  code?: string;
};

function asEnv(value: unknown): VibeLearningImageEnv {
  return value && typeof value === "object" ? (value as VibeLearningImageEnv) : {};
}

function getContextEnv(): VibeLearningImageEnv {
  const startContext = getStartContext({ throwIfNotFound: false });
  const context = startContext?.contextAfterGlobalMiddlewares as
    | { cloudflare?: { env?: unknown }; cloudflareEnv?: unknown }
    | undefined;
  return asEnv(context?.cloudflare?.env ?? context?.cloudflareEnv);
}

function getGlobalEnv(): VibeLearningImageEnv {
  const globalRecord = globalThis as Record<string, unknown>;
  return asEnv(globalRecord[CLOUDFLARE_ENV_GLOBAL_KEY] ?? globalRecord.__env__);
}

function resolveConfiguration(options: Pick<VibeLearningProviderOptions, "env" | "apiKey" | "baseUrl">): ResolvedConfiguration {
  const explicitEnv = options.env;
  const contextEnv = getContextEnv();
  const globalEnv = getGlobalEnv();
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  const apiKey = String(
    options.apiKey ?? explicitEnv?.VIBELEARNING_IMAGE_API_KEY ??
      contextEnv.VIBELEARNING_IMAGE_API_KEY ??
      globalEnv.VIBELEARNING_IMAGE_API_KEY ??
      processEnv?.VIBELEARNING_IMAGE_API_KEY ??
      "",
  ).trim();

  if (!apiKey) {
    throw new ImageProviderError({
      code: "CONFIGURATION_ERROR",
      message: "VibeLearning 图片 API Key 未配置。",
      retryable: false,
    });
  }

  const configuredBaseUrl = String(
    options.baseUrl ?? explicitEnv?.VIBELEARNING_IMAGE_API_BASE_URL ??
      contextEnv.VIBELEARNING_IMAGE_API_BASE_URL ??
      globalEnv.VIBELEARNING_IMAGE_API_BASE_URL ??
      processEnv?.VIBELEARNING_IMAGE_API_BASE_URL ??
      DEFAULT_API_BASE_URL,
  )
    .trim()
    .replace(/\/+$/, "");

  try {
    const url = new URL(configuredBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("unsupported protocol");
  } catch (error) {
    throw new ImageProviderError(
      {
        code: "CONFIGURATION_ERROR",
        message: "VibeLearning 图片 API Base URL 配置无效。",
        retryable: false,
      },
      { cause: error },
    );
  }

  return { apiBaseUrl: configuredBaseUrl, apiKey };
}

export function resolveProviderSize(aspectRatio: string, quality: string): string {
  const resolved = PROVIDER_SIZE_MAP[`${aspectRatio.trim()}|${quality.trim()}`];
  if (!resolved) {
    throw new ImageProviderError({
      code: "UNSUPPORTED_PROVIDER_SIZE",
      message: "该比例与质量的供应商尺寸映射尚未确认。",
      retryable: false,
    });
  }
  return resolved;
}

function normalizeVibeLearningTaskStatus(status: unknown): ProviderTaskStatus {
  const normalized = typeof status === "string"
    ? status.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : status;
  if (normalized === "done") return "completed";
  if (normalized === "rejected" || normalized === "expired") return "failed";
  return normalizeTaskStatus(status);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeDiagnosticKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record)
    .filter((key) => key !== "__proto__" && key !== "prototype" && key !== "constructor")
    .sort();
}

function safeDiagnosticLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return label.length > 0 && label.length <= 128 && !label.includes("://") ? label : null;
}

function summarizeProviderTaskValue(value: unknown): ProviderTaskValueSummary {
  if (value === null || value === undefined) {
    return { type: "null", keys: [], count: null, status: null, state: null };
  }
  if (Array.isArray(value)) {
    return { type: "array", keys: [], count: value.length, status: null, state: null };
  }
  const record = asRecord(value);
  if (record) {
    return {
      type: "object",
      keys: safeDiagnosticKeys(record),
      count: null,
      status: safeDiagnosticLabel(record.status),
      state: safeDiagnosticLabel(record.state),
    };
  }
  return { type: typeof value === "string" ? "string" : "other", keys: [], count: null, status: null, state: null };
}

function hasKnownImageField(value: unknown, field: "url" | "b64_json" | "image_url"): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKnownImageField(item, field));
  const record = asRecord(value);
  return !!record && typeof record[field] === "string" && record[field].trim().length > 0;
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function hasKnownDirectImageField(value: unknown, field: "url" | "b64_json" | "image_url" | "output"): boolean {
  const record = asRecord(value);
  return !!record && typeof record[field] === "string" && record[field].trim().length > 0;
}

function extractProviderError(payload: unknown): ExtractedProviderError {
  const record = asRecord(payload);
  if (!record) return {};
  const nestedError = record.error;
  const nestedRecord = asRecord(nestedError);
  const response = asRecord(record.response);
  const responseError = response?.error;
  const responseErrorRecord = asRecord(responseError);
  const message =
    (typeof nestedError === "string" ? nestedError : undefined) ??
    (typeof nestedRecord?.message === "string" ? nestedRecord.message : undefined) ??
    (typeof record.message === "string" ? record.message : undefined) ??
    (typeof responseError === "string" ? responseError : undefined) ??
    (typeof responseErrorRecord?.message === "string" ? responseErrorRecord.message : undefined);
  const code =
    (typeof nestedRecord?.code === "string" ? nestedRecord.code : undefined) ??
    (typeof record.code === "string" ? record.code : undefined) ??
    (typeof responseErrorRecord?.code === "string" ? responseErrorRecord.code : undefined);
  return { message, code };
}

function getCompletedImageData(payload: {
  data?: unknown;
  response?: unknown;
  result?: unknown;
  url?: unknown;
  b64_json?: unknown;
}): unknown {
  const response = asRecord(payload.response);
  const result = asRecord(payload.result);
  return response?.data ?? payload.data ?? result?.data ?? (
    typeof payload.url === "string" || typeof payload.b64_json === "string" ? payload : undefined
  );
}

const MAX_DIAGNOSTIC_BASE64_CHARS = 4096;

function diagnosticValueType(value: unknown): ProviderTaskValueSummary["type"] {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (asRecord(value)) return "object";
  return typeof value === "string" ? "string" : "other";
}

function decodeBase64DiagnosticPrefix(value: string): Uint8Array | null {
  let candidate = value.slice(0, 64).replace(/\s/g, "");
  if (candidate.length % 4 === 1) candidate = candidate.slice(0, -1);
  if (candidate.length < 2) return null;
  try {
    const binary = atob(candidate.padEnd(candidate.length + ((4 - (candidate.length % 4)) % 4), "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function detectDiagnosticImageType(bytes: Uint8Array | null): DiagnosticImageType {
  if (!bytes) return null;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return "unknown";
}

function summarizeResponseDataItem(value: unknown): ResponseDataItemDiagnostic {
  const item = asRecord(value);
  const url = item?.url;
  const b64 = item?.b64_json;
  const urlType = diagnosticValueType(url);
  const b64Type = diagnosticValueType(b64);
  const empty: ResponseDataItemDiagnostic = {
    type: diagnosticValueType(value), keys: item ? safeDiagnosticKeys(item) : [],
    urlType, urlIsHttps: typeof url === "string" && url.startsWith("https://"),
    b64Type, b64Length: null, b64HasDataUrlPrefix: false, b64HasWhitespace: false,
    b64LengthMod4: null, b64AlphabetValid: false, b64PaddingValid: false,
    b64DecodedPrefixValid: false, detectedImageType: null, magicValid: false, likelyTruncated: false,
  };
  if (typeof b64 !== "string") return empty;

  const prefix = b64.slice(0, 128);
  const dataUrlMatch = prefix.match(/^data:image\/[a-z0-9.+-]+;base64,/i);
  const payloadStart = dataUrlMatch?.[0].length ?? 0;
  const bounded = b64.slice(payloadStart, payloadStart + MAX_DIAGNOSTIC_BASE64_CHARS);
  const compact = bounded.replace(/\s/g, "");
  const paddingIndex = compact.indexOf("=");
  const unpadded = compact.replace(/=/g, "");
  const alphabetValid = /^[A-Za-z0-9+/]*$/.test(unpadded);
  const paddingValid = alphabetValid && (
    paddingIndex < 0 || (/^=+$/.test(compact.slice(paddingIndex)) && compact.length - paddingIndex <= 2)
  ) && compact.length % 4 !== 1;
  const decoded = alphabetValid && paddingValid ? decodeBase64DiagnosticPrefix(compact) : null;
  const detectedImageType = detectDiagnosticImageType(decoded);
  const exceedsDiagnosticBound = b64.length - payloadStart > MAX_DIAGNOSTIC_BASE64_CHARS;

  return {
    ...empty,
    b64Length: Math.min(b64.length - payloadStart, MAX_DIAGNOSTIC_BASE64_CHARS),
    b64HasDataUrlPrefix: !!dataUrlMatch,
    b64HasWhitespace: /\s/.test(bounded),
    b64LengthMod4: (compact.length % 4) as 0 | 1 | 2 | 3,
    b64AlphabetValid: alphabetValid,
    b64PaddingValid: paddingValid,
    b64DecodedPrefixValid: decoded !== null,
    detectedImageType,
    magicValid: detectedImageType === "png" || detectedImageType === "jpeg" || detectedImageType === "webp",
    likelyTruncated: !exceedsDiagnosticBound && compact.length % 4 === 1,
  };
}

function safeDiagnosticErrorCode(error: unknown): string {
  if (error instanceof ImageProviderError) return error.code;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : "PROVIDER_DIAGNOSTIC_ERROR";
}

function selectVibeLearningImageCandidates(data: unknown): Record<string, unknown>[] {
  const items = Array.isArray(data) ? data : data == null ? [] : [data];
  return items.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    if (typeof record.b64_json === "string" && record.b64_json.trim()) {
      return [{
        b64_json: record.b64_json,
        ...(typeof record.mime_type === "string" ? { mime_type: record.mime_type } : {}),
      }];
    }
    if (typeof record.url === "string" && record.url.trim()) return [{ url: record.url }];
    return [];
  });
}

function requireHttpsImages(images: ReturnType<typeof normalizeImageResults>) {
  for (const image of images) {
    if (image.kind === "url" && !image.url.startsWith("https://")) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_IMAGE",
        message: "供应商返回的图片地址必须使用 HTTPS。",
        retryable: false,
      });
    }
  }
  return images;
}

function createCommonRequest(input: ImageGenerationInput, size: string) {
  return vibeLearningTaskRequestSchema.parse({
    model: input.model,
    prompt: input.prompt,
    size,
    n: input.count,
  });
}

function createReferenceBlob(image: ImageGenerationInput["referenceImages"][number]): Blob {
  const bytes = Uint8Array.from(image.bytes);
  return new Blob([bytes.buffer], { type: image.mimeType });
}

export class VibeLearningImageProvider implements ImageProvider {
  readonly key = "vibelearning";
  readonly capabilities = {
    modes: ["text-to-image", "image-to-image"],
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    qualities: ["1K", "2K", "4K"],
  } as const;
  private readonly explicitEnv?: VibeLearningImageEnv;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxReferenceImages?: number;

  constructor(options: VibeLearningProviderOptions = {}) {
    if (
      options.maxReferenceImages !== undefined &&
      (!Number.isInteger(options.maxReferenceImages) || options.maxReferenceImages < 1)
    ) {
      throw new ImageProviderError({
        code: "CONFIGURATION_ERROR",
        message: "VibeLearning 参考图上限必须是正整数。",
        retryable: false,
      });
    }
    this.explicitEnv = options.env;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxReferenceImages = options.maxReferenceImages;
  }

  async createTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    const parsedInput = this.parseInput(input);
    return parsedInput.referenceImages.length === 0
      ? this.createTextToImageTask(parsedInput)
      : this.createImageToImageTask(parsedInput);
  }

  async pollTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult> {
    return isImageToImageMode(task.mode)
      ? this.pollImageToImageTask(task.taskId)
      : this.pollTextToImageTask(task.taskId);
  }

  async getTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult> {
    return this.pollTask(task);
  }

  async diagnoseProviderTask(input: {
    generationTaskId: string;
    taskId: string;
    mode: ProviderGenerationMode;
  }): Promise<ProviderTaskDiagnostic> {
    const normalizedTaskId = this.requireTaskId(input.taskId);
    const configuration = resolveConfiguration({ env: this.explicitEnv, apiKey: this.apiKey, baseUrl: this.baseUrl });
    const response = await this.fetchProviderTaskResponse(input.mode, normalizedTaskId, configuration);
    return this.summarizeProviderTaskResponse(input.generationTaskId, input.mode, normalizedTaskId, response, configuration);
  }

  async createTextToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    const parsedInput = this.parseInput(input);
    if (parsedInput.referenceImages.length !== 0) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_INPUT",
        message: "文生图请求不能包含参考图。",
        retryable: false,
      });
    }

    const size = resolveProviderSize(parsedInput.aspectRatio, parsedInput.quality);
    const request = createCommonRequest(parsedInput, size);
    return this.createProviderTask("text-to-image", JSON.stringify(request), {
      "content-type": "application/json",
    });
  }

  async createImageToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated> {
    const parsedInput = this.parseInput(input);
    if (parsedInput.referenceImages.length === 0) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_INPUT",
        message: "图生图请求至少需要一张参考图。",
        retryable: false,
      });
    }
    if (
      this.maxReferenceImages !== undefined &&
      parsedInput.referenceImages.length > this.maxReferenceImages
    ) {
      throw new ImageProviderError({
        code: "TOO_MANY_REFERENCE_IMAGES",
        message: `参考图数量超过当前配置上限（${this.maxReferenceImages} 张）。`,
        retryable: false,
      });
    }

    const size = resolveProviderSize(parsedInput.aspectRatio, parsedInput.quality);
    const commonRequest = createCommonRequest(parsedInput, size);
    const formData = new FormData();
    for (const [field, value] of Object.entries(commonRequest)) {
      formData.append(field, String(value));
    }

    const imageField = parsedInput.referenceImages.length === 1 ? "image" : "image[]";
    for (const image of parsedInput.referenceImages) {
      formData.append(imageField, createReferenceBlob(image), image.filename);
    }

    return this.createProviderTask("image-to-image", formData);
  }

  async pollTextToImageTask(taskId: string): Promise<ProviderTaskResult> {
    return this.pollProviderTask("text-to-image", taskId);
  }

  async pollImageToImageTask(taskId: string): Promise<ProviderTaskResult> {
    return this.pollProviderTask("image-to-image", taskId);
  }

  private parseInput(input: ImageGenerationInput): ImageGenerationInput {
    const result = imageGenerationInputSchema.safeParse(input);
    if (!result.success) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_INPUT",
        message: "图片生成输入不符合 Provider Schema。",
        retryable: false,
      });
    }
    return result.data;
  }

  private async createProviderTask(
    mode: ProviderGenerationMode,
    body: BodyInit,
    headers?: HeadersInit,
  ): Promise<ProviderTaskCreated> {
    const configuration = resolveConfiguration({ env: this.explicitEnv, apiKey: this.apiKey, baseUrl: this.baseUrl });
    const payload = await this.requestJson(
      TASK_PATHS[mode],
      {
        method: "POST",
        headers,
        body,
      },
      configuration,
    );
    const parsed = vibeLearningTaskCreatedResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_RESPONSE",
        message: "供应商创建任务响应格式无效。",
        retryable: false,
      });
    }

    const taskId =
      parsed.data.task_id ?? parsed.data.id ?? parsed.data.data?.task_id ?? parsed.data.data?.id;
    if (!taskId) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_RESPONSE",
        message: "供应商创建任务响应缺少 task_id。",
        retryable: false,
      });
    }
    const rawStatus = parsed.data.status ?? parsed.data.data?.status ?? "queued";
    return { taskId, mode, status: normalizeVibeLearningTaskStatus(rawStatus) };
  }

  private async pollProviderTask(
    mode: ProviderGenerationMode,
    taskId: string,
  ): Promise<ProviderTaskResult> {
    const normalizedTaskId = this.requireTaskId(taskId);

    const configuration = resolveConfiguration({ env: this.explicitEnv, apiKey: this.apiKey, baseUrl: this.baseUrl });
    const response = await this.fetchProviderTaskResponse(mode, normalizedTaskId, configuration);
    return this.normalizeProviderTaskResponse(normalizedTaskId, response, configuration);
  }

  private requireTaskId(taskId: string): string {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_INPUT",
        message: "轮询任务必须提供 taskId。",
        retryable: false,
      });
    }
    return normalizedTaskId;
  }

  private async fetchProviderTaskResponse(
    mode: ProviderGenerationMode,
    taskId: string,
    configuration: ResolvedConfiguration,
  ): Promise<ProviderTaskHttpResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${configuration.apiBaseUrl}${TASK_PATHS[mode]}/${encodeURIComponent(taskId)}`,
        { method: "GET", headers: { authorization: `Bearer ${configuration.apiKey}` } },
      );
    } catch (error) {
      throw new ImageProviderError(
        normalizeProviderError(error, {
          apiKey: configuration.apiKey,
          fallbackCode: "PROVIDER_NETWORK_ERROR",
          fallbackMessage: "无法连接到 VibeLearning 图片服务。",
          retryable: true,
        }),
        { cause: error },
      );
    }

    try {
      return { httpStatus: response.status, responseIsJson: true, payload: await response.json() };
    } catch {
      return { httpStatus: response.status, responseIsJson: false, payload: undefined };
    }
  }

  private normalizeProviderTaskResponse(
    normalizedTaskId: string,
    response: ProviderTaskHttpResponse,
    configuration: ResolvedConfiguration,
  ): ProviderTaskResult {
    if (response.httpStatus < 200 || response.httpStatus >= 300) {
      const extractedError = extractProviderError(response.payload);
      const message = extractedError.message
        ? new Error(extractedError.message)
        : new Error(`VibeLearning 图片服务返回 HTTP ${response.httpStatus}。`);
      throw new ImageProviderError(
        normalizeProviderError(message, {
          apiKey: configuration.apiKey,
          fallbackCode: "PROVIDER_HTTP_ERROR",
          retryable: response.httpStatus === 429 || response.httpStatus >= 500,
          httpStatus: response.httpStatus,
          providerCode: extractedError.code,
        }),
      );
    }
    if (!response.responseIsJson) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_RESPONSE",
        message: "供应商返回了无法解析的 JSON 响应。",
        retryable: false,
      });
    }

    const parsed = vibeLearningTaskPollResponseSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new ImageProviderError({
        code: "INVALID_PROVIDER_RESPONSE",
        message: "供应商任务查询响应格式无效。",
        retryable: false,
      });
    }

    const status = normalizeVibeLearningTaskStatus(parsed.data.status);
    if (status === "completed") {
      const completedData = getCompletedImageData(parsed.data);
      const candidates = selectVibeLearningImageCandidates(completedData);
      if (!candidates.length) {
        return { taskId: normalizedTaskId, status: "processing", images: [] };
      }
      let images;
      try {
        images = requireHttpsImages(
          normalizeImageResults(candidates, "image/webp"),
        );
      } catch (error) {
        if (error instanceof ImageProviderError && error.code === "EMPTY_PROVIDER_RESULT") {
          return { taskId: normalizedTaskId, status: "processing", images: [] };
        }
        throw error;
      }
      return {
        taskId: normalizedTaskId,
        status,
        images,
      };
    }
    if (status === "failed") {
      const extractedError = extractProviderError(parsed.data);
      return createProviderTaskFailure(
        normalizedTaskId,
        extractedError.message ? new Error(extractedError.message) : undefined,
        {
          apiKey: configuration.apiKey,
          providerCode: extractedError.code,
        },
      );
    }
    return { taskId: normalizedTaskId, status, images: [] };
  }

  private summarizeProviderTaskResponse(
    generationTaskId: string,
    mode: ProviderGenerationMode,
    taskId: string,
    response: ProviderTaskHttpResponse,
    configuration: ResolvedConfiguration,
  ): ProviderTaskDiagnostic {
    const top = asRecord(response.payload);
    const data = top?.data;
    const dataRecord = asRecord(data);
    const nestedData = dataRecord?.data;
    const result = top?.result;
    const resultRecord = asRecord(result);
    const resultData = resultRecord?.data;
    const providerResponse = top?.response;
    const responseRecord = asRecord(providerResponse);
    const responseItem = firstArrayItem(providerResponse);
    const responseData = responseRecord?.data;
    const responseDataItem = firstArrayItem(responseData);
    const responseOutput = responseRecord?.output;
    const dataSummary = summarizeProviderTaskValue(data);
    const nestedDataSummary = summarizeProviderTaskValue(nestedData);
    const resultSummary = summarizeProviderTaskValue(result);
    const resultDataSummary = summarizeProviderTaskValue(resultData);
    const responseSummary = summarizeProviderTaskValue(providerResponse);
    const responseItemSummary = summarizeProviderTaskValue(responseItem);
    const responseDataSummary = summarizeProviderTaskValue(responseData);
    const responseDataItemSummary = summarizeResponseDataItem(responseDataItem);
    const responseOutputSummary = summarizeProviderTaskValue(responseOutput);

    let normalizedStatus: string | null = null;
    let normalizationErrorCode: string | null = null;
    try {
      normalizedStatus = this.normalizeProviderTaskResponse(taskId, response, configuration).status;
    } catch (error) {
      normalizationErrorCode = safeDiagnosticErrorCode(error);
    }

    return {
      generationTaskId,
      provider: this.key,
      providerTaskIdPresent: taskId.length > 0,
      generationMode: mode,
      httpStatus: response.httpStatus,
      responseIsJson: response.responseIsJson,
      topLevelKeys: top ? safeDiagnosticKeys(top) : [],
      topStatus: safeDiagnosticLabel(top?.status),
      topState: safeDiagnosticLabel(top?.state),
      topCode: typeof top?.code === "number" ? top.code : safeDiagnosticLabel(top?.code),
      dataType: dataSummary.type,
      dataKeys: dataSummary.keys,
      dataCount: dataSummary.count,
      dataStatus: dataSummary.status,
      dataState: dataSummary.state,
      nestedDataType: nestedDataSummary.type,
      nestedDataKeys: nestedDataSummary.keys,
      nestedDataCount: nestedDataSummary.count,
      resultType: resultSummary.type,
      resultKeys: resultSummary.keys,
      resultStatus: resultSummary.status,
      resultState: resultSummary.state,
      resultDataType: resultDataSummary.type,
      resultDataKeys: resultDataSummary.keys,
      resultDataCount: resultDataSummary.count,
      responseType: responseSummary.type,
      responseKeys: responseSummary.keys,
      responseCount: responseSummary.count,
      responseStatus: responseSummary.status,
      responseState: responseSummary.state,
      responseItemType: responseItemSummary.type,
      responseItemKeys: responseItemSummary.keys,
      responseDataType: responseDataSummary.type,
      responseDataKeys: responseDataSummary.keys,
      responseDataCount: responseDataSummary.count,
      responseDataItemType: responseDataItemSummary.type,
      responseDataItemKeys: responseDataItemSummary.keys,
      responseDataItemUrlType: responseDataItemSummary.urlType,
      responseDataItemUrlIsHttps: responseDataItemSummary.urlIsHttps,
      responseDataItemB64Type: responseDataItemSummary.b64Type,
      responseDataItemB64Length: responseDataItemSummary.b64Length,
      responseDataItemB64HasDataUrlPrefix: responseDataItemSummary.b64HasDataUrlPrefix,
      responseDataItemB64HasWhitespace: responseDataItemSummary.b64HasWhitespace,
      responseDataItemB64LengthMod4: responseDataItemSummary.b64LengthMod4,
      responseDataItemB64AlphabetValid: responseDataItemSummary.b64AlphabetValid,
      responseDataItemB64PaddingValid: responseDataItemSummary.b64PaddingValid,
      responseDataItemB64DecodedPrefixValid: responseDataItemSummary.b64DecodedPrefixValid,
      responseDataItemDetectedImageType: responseDataItemSummary.detectedImageType,
      responseDataItemMagicValid: responseDataItemSummary.magicValid,
      responseDataItemLikelyTruncated: responseDataItemSummary.likelyTruncated,
      responseOutputType: responseOutputSummary.type,
      responseOutputKeys: responseOutputSummary.keys,
      responseOutputCount: responseOutputSummary.count,
      knownResultFlags: {
        topUrl: hasKnownImageField(top, "url"),
        topB64Json: hasKnownImageField(top, "b64_json"),
        dataUrl: hasKnownImageField(data, "url"),
        dataB64Json: hasKnownImageField(data, "b64_json"),
        dataDataUrl: hasKnownImageField(nestedData, "url"),
        dataDataB64Json: hasKnownImageField(nestedData, "b64_json"),
        resultUrl: hasKnownImageField(result, "url"),
        resultB64Json: hasKnownImageField(result, "b64_json"),
        resultDataUrl: hasKnownImageField(resultData, "url"),
        resultDataB64Json: hasKnownImageField(resultData, "b64_json"),
        responseUrl: hasKnownDirectImageField(providerResponse, "url"),
        responseB64Json: hasKnownDirectImageField(providerResponse, "b64_json"),
        responseImageUrl: hasKnownDirectImageField(providerResponse, "image_url"),
        responseOutputUrl: hasKnownDirectImageField(Array.isArray(responseOutput) ? responseOutput[0] : responseOutput, "url"),
        responseItemUrl: hasKnownDirectImageField(responseItem, "url"),
        responseItemB64Json: hasKnownDirectImageField(responseItem, "b64_json"),
        responseItemImageUrl: hasKnownDirectImageField(responseItem, "image_url"),
        responseItemOutputUrl: hasKnownDirectImageField(responseItem, "output"),
        responseDataUrl: hasKnownDirectImageField(Array.isArray(responseData) ? responseData[0] : responseData, "url"),
        responseDataB64Json: hasKnownDirectImageField(Array.isArray(responseData) ? responseData[0] : responseData, "b64_json"),
        responseDataImageUrl: hasKnownDirectImageField(Array.isArray(responseData) ? responseData[0] : responseData, "image_url"),
        responseDataOutputUrl: hasKnownDirectImageField(Array.isArray(responseData) ? responseData[0] : responseData, "output"),
        responseOutputB64Json: hasKnownDirectImageField(Array.isArray(responseOutput) ? responseOutput[0] : responseOutput, "b64_json"),
        responseOutputImageUrl: hasKnownDirectImageField(Array.isArray(responseOutput) ? responseOutput[0] : responseOutput, "image_url"),
      },
      normalizedStatus,
      normalizationErrorCode,
    };
  }

  private async requestJson(
    path: string,
    init: RequestInit,
    configuration: ResolvedConfiguration,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${configuration.apiKey}`);

    let response: Response;
    try {
      response = await this.fetchImpl(`${configuration.apiBaseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      throw new ImageProviderError(
        normalizeProviderError(error, {
          apiKey: configuration.apiKey,
          fallbackCode: "PROVIDER_NETWORK_ERROR",
          fallbackMessage: "无法连接到 VibeLearning 图片服务。",
          retryable: true,
        }),
        { cause: error },
      );
    }

    if (!response.ok) {
      let errorPayload: unknown;
      try {
        errorPayload = await response.json();
      } catch {
        errorPayload = undefined;
      }
      const extractedError = extractProviderError(errorPayload);
      const message = extractedError.message
        ? new Error(extractedError.message)
        : new Error(`VibeLearning 图片服务返回 HTTP ${response.status}。`);
      throw new ImageProviderError(
        normalizeProviderError(message, {
          apiKey: configuration.apiKey,
          fallbackCode: "PROVIDER_HTTP_ERROR",
          retryable: response.status === 429 || response.status >= 500,
          httpStatus: response.status,
          providerCode: extractedError.code,
        }),
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ImageProviderError(
        {
          code: "INVALID_PROVIDER_RESPONSE",
          message: "供应商返回了无法解析的 JSON 响应。",
          retryable: false,
        },
        { cause: error },
      );
    }
  }
}

export function createVibeLearningImageProvider(
  options: VibeLearningProviderOptions = {},
): ImageProvider {
  return new VibeLearningImageProvider(options);
}
