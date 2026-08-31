import "@tanstack/react-start/server-only";

import {
  type ImageGenerationInput,
  type ImageQuality,
  type NormalizedProviderError,
  type NormalizedProviderImage,
  type ProviderErrorCode,
  type ProviderGenerationMode,
  type ProviderTaskCreated,
  type ProviderTaskResult,
  type ProviderTaskStatus,
} from "../generation.schemas";

export type ImageProviderCapabilities = {
  modes: readonly ProviderGenerationMode[];
  maxReferenceImages?: number;
  aspectRatios?: readonly string[];
  qualities?: readonly ImageQuality[];
};

export type {
  ImageGenerationInput,
  ImageQuality,
  NormalizedProviderError,
  NormalizedProviderImage,
  ProviderErrorCode,
  ProviderGenerationMode,
  ProviderReferenceImage,
  ProviderTaskCreated,
  ProviderTaskResult,
  ProviderTaskStatus,
} from "../generation.schemas";

export interface ImageProvider {
  readonly key: string;
  readonly capabilities: ImageProviderCapabilities;
  createTextToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated>;
  createImageToImageTask(input: ImageGenerationInput): Promise<ProviderTaskCreated>;
  pollTextToImageTask(taskId: string): Promise<ProviderTaskResult>;
  pollImageToImageTask(taskId: string): Promise<ProviderTaskResult>;
  createTask(input: ImageGenerationInput): Promise<ProviderTaskCreated>;
  pollTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult>;
  getTask(task: Pick<ProviderTaskCreated, "taskId" | "mode">): Promise<ProviderTaskResult>;
}

export class ImageProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly providerCode?: string;

  constructor(error: NormalizedProviderError, options?: ErrorOptions) {
    super(error.message, options);
    this.name = "ImageProviderError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.httpStatus = error.httpStatus;
    this.providerCode = error.providerCode;
  }

  toNormalizedError(): NormalizedProviderError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
      ...(this.providerCode === undefined ? {} : { providerCode: this.providerCode }),
    };
  }
}

type NormalizeProviderErrorOptions = {
  apiKey?: string;
  fallbackCode?: ProviderErrorCode;
  fallbackMessage?: string;
  retryable?: boolean;
  httpStatus?: number;
  providerCode?: string;
};

function sanitizeProviderMessage(message: string, apiKey?: string): string {
  const trimmed = message.trim();
  if (!apiKey) return trimmed;
  return trimmed.split(apiKey).join("[REDACTED]");
}

export function normalizeProviderError(
  error: unknown,
  options: NormalizeProviderErrorOptions = {},
): NormalizedProviderError {
  if (error instanceof ImageProviderError) {
    const normalized = error.toNormalizedError();
    return {
      ...normalized,
      message: sanitizeProviderMessage(normalized.message, options.apiKey),
    };
  }

  const sourceMessage = error instanceof Error ? error.message : "";
  const fallbackMessage = options.fallbackMessage ?? "图片供应商请求失败。";
  const message = sanitizeProviderMessage(sourceMessage || fallbackMessage, options.apiKey);

  return {
    code: options.fallbackCode ?? "PROVIDER_NETWORK_ERROR",
    message: message || fallbackMessage,
    retryable: options.retryable ?? true,
    ...(options.httpStatus === undefined ? {} : { httpStatus: options.httpStatus }),
    ...(options.providerCode ? { providerCode: options.providerCode } : {}),
  };
}

export function normalizeTaskStatus(status: unknown): ProviderTaskStatus {
  if (typeof status !== "string" || !status.trim()) {
    throw new ImageProviderError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "供应商任务响应缺少有效状态。",
      retryable: false,
    });
  }

  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const statusMap: Record<string, ProviderTaskStatus> = {
    queued: "queued",
    pending: "queued",
    submitted: "queued",
    created: "queued",
    waiting: "queued",
    processing: "processing",
    running: "processing",
    in_progress: "processing",
    generating: "processing",
    completed: "completed",
    succeeded: "completed",
    success: "completed",
    finished: "completed",
    failed: "failed",
    error: "failed",
    cancelled: "failed",
    canceled: "failed",
  };

  const result = statusMap[normalized];
  if (!result) {
    throw new ImageProviderError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "无法识别供应商任务状态。",
      retryable: false,
    });
  }
  return result;
}

// Matches the existing provider-download ceiling without retaining a full decoded binary string.
const MAX_PROVIDER_IMAGE_BYTES = 25 * 1024 * 1024;
const BASE64_DECODE_CHUNK_CHARS = 64 * 1024;

function invalidProviderBase64(): ImageProviderError {
  return new ImageProviderError({
    code: "INVALID_PROVIDER_BASE64",
    message: "供应商返回了无效的 Base64 图片数据。",
    retryable: false,
  });
}

function isBase64Character(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  );
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    // Avoid copying the common provider result: already-trimmed, whitespace-free Base64.
    let payload = /^\s|\s$/.test(value) ? value.trim() : value;
    const dataUrlMatch = payload.match(/^data:image\/[a-z0-9.+-]+;base64,/i);
    if (dataUrlMatch) payload = payload.slice(dataUrlMatch[0].length);

    const compact = /\s/.test(payload) ? payload.replace(/\s/g, "") : payload;
    if (!compact || compact.length % 4 === 1) throw invalidProviderBase64();

    let paddingStart = compact.length;
    while (paddingStart > 0 && compact.charCodeAt(paddingStart - 1) === 0x3d) {
      paddingStart -= 1;
    }
    const suppliedPadding = compact.length - paddingStart;
    if (suppliedPadding > 2) throw invalidProviderBase64();

    for (let index = 0; index < paddingStart; index += 1) {
      if (!isBase64Character(compact.charCodeAt(index))) throw invalidProviderBase64();
    }
    for (let index = paddingStart; index < compact.length; index += 1) {
      if (compact.charCodeAt(index) !== 0x3d) throw invalidProviderBase64();
    }

    const requiredPadding = (4 - (paddingStart % 4)) % 4;
    if (requiredPadding > 2 || suppliedPadding > requiredPadding) throw invalidProviderBase64();
    const paddedLength = paddingStart + requiredPadding;
    const decodedLength = (paddedLength / 4) * 3 - requiredPadding;
    if (
      !Number.isSafeInteger(decodedLength) ||
      decodedLength <= 0 ||
      decodedLength > MAX_PROVIDER_IMAGE_BYTES
    ) {
      throw invalidProviderBase64();
    }

    const bytes = new Uint8Array(decodedLength);
    let sourceOffset = 0;
    let destinationOffset = 0;
    while (sourceOffset < paddingStart) {
      const remaining = paddingStart - sourceOffset;
      const chunkLength = remaining > BASE64_DECODE_CHUNK_CHARS
        ? BASE64_DECODE_CHUNK_CHARS
        : remaining;
      const isFinalChunk = sourceOffset + chunkLength === paddingStart;
      const chunkPadding = isFinalChunk ? requiredPadding : 0;
      const binary = atob(
        compact.slice(sourceOffset, sourceOffset + chunkLength) + "=".repeat(chunkPadding),
      );
      if (!binary.length || destinationOffset + binary.length > bytes.length) {
        throw invalidProviderBase64();
      }
      for (let index = 0; index < binary.length; index += 1) {
        bytes[destinationOffset + index] = binary.charCodeAt(index);
      }
      destinationOffset += binary.length;
      sourceOffset += chunkLength;
    }
    if (destinationOffset !== bytes.length) throw invalidProviderBase64();
    return bytes;
  } catch (error) {
    if (error instanceof ImageProviderError) throw error;
    throw invalidProviderBase64();
  }
}

function normalizeMimeType(value: unknown, fallback: string): string {
  const candidate =
    typeof value === "string" && value.trim() ? value.trim().toLowerCase() : fallback;
  return /^image\/[a-z0-9.+-]+$/i.test(candidate) ? candidate : fallback;
}

function normalizeImageResult(item: unknown, defaultMimeType: string): NormalizedProviderImage {
  if (!item || Array.isArray(item) || typeof item !== "object") {
    throw new ImageProviderError({
      code: "INVALID_PROVIDER_IMAGE",
      message: "供应商图片结果格式无效。",
      retryable: false,
    });
  }

  const record = item as Record<string, unknown>;
  if (typeof record.url === "string" && record.url.trim()) {
    try {
      const url = new URL(record.url.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("unsupported protocol");
      return { kind: "url", url: url.toString() };
    } catch (error) {
      throw new ImageProviderError(
        {
          code: "INVALID_PROVIDER_IMAGE",
          message: "供应商返回了无效的图片 URL。",
          retryable: false,
        },
        { cause: error },
      );
    }
  }

  if (typeof record.b64_json === "string") {
    let mimeType = normalizeMimeType(record.mime_type, defaultMimeType);
    const dataUrlMatch = record.b64_json.match(/^\s*data:(image\/[a-z0-9.+-]+);base64,/i);
    if (dataUrlMatch) {
      mimeType = normalizeMimeType(dataUrlMatch[1], mimeType);
    }
    return { kind: "base64", bytes: decodeBase64(record.b64_json), mimeType };
  }

  throw new ImageProviderError({
    code: "INVALID_PROVIDER_IMAGE",
    message: "供应商图片结果既不包含 URL，也不包含 Base64 数据。",
    retryable: false,
  });
}

export function normalizeImageResults(
  data: unknown,
  defaultMimeType = "image/webp",
): NormalizedProviderImage[] {
  const isEmptyObject =
    data !== null &&
    !Array.isArray(data) &&
    typeof data === "object" &&
    Object.keys(data).length === 0;
  const items = Array.isArray(data) ? data : data == null || isEmptyObject ? [] : [data];
  if (!items.length) {
    throw new ImageProviderError({
      code: "EMPTY_PROVIDER_RESULT",
      message: "供应商任务已完成，但未返回图片数据。",
      retryable: false,
    });
  }
  return items.map((item) => normalizeImageResult(item, defaultMimeType));
}

export function createProviderTaskFailure(
  taskId: string,
  error: unknown,
  options: NormalizeProviderErrorOptions = {},
): ProviderTaskResult {
  return {
    taskId,
    status: "failed",
    images: [],
    error: normalizeProviderError(error, {
      ...options,
      fallbackCode: options.fallbackCode ?? "PROVIDER_TASK_FAILED",
      fallbackMessage: options.fallbackMessage ?? "供应商图片生成任务失败。",
      retryable: options.retryable ?? false,
    }),
  };
}

export function isImageToImageMode(mode: ProviderGenerationMode): boolean {
  return mode === "image-to-image";
}
