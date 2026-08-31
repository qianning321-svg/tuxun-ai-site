import { describe, expect, test } from "bun:test";

import type { ImageGenerationInput } from "../src/lib/generation.schemas";
import {
  DEFAULT_WUYINKEJI_API_BASE_URL,
  WuyinkejiImageProvider,
} from "../src/lib/providers/wuyinkeji-image.server";

const prompt = "a simple red apple on a white background";
const smokeModels = [
  ["gpt-image-2-vip", "image_gpt"],
  ["nano-banana", "image_nanoBanana"],
  ["nano-banana-pro", "image_nanoBanana_pro"],
  ["nano-banana-2", "image_nanoBanana2"],
  ["nano-banana-2-lite", "image_nanoBanana2Lite"],
] as const;
const requestedModel = process.env.WUYINKEJI_REAL_SMOKE_MODEL?.trim() ?? "";
const selectedSmokeModel = smokeModels.find(([modelKey]) => modelKey === requestedModel);
const shouldRun =
  process.env.MUMO_REAL_PROVIDER_SMOKE_TEST === "true" &&
  typeof process.env.WUYINKEJI_API_KEY === "string" &&
  process.env.WUYINKEJI_API_KEY.trim().length > 0 &&
  !!selectedSmokeModel;

type SafeResponseSummary = {
  phase: "create-response" | "poll-response";
  httpStatus: number;
  contentType: string | null;
  bodyKind: "json-object" | "json-array" | "string" | "empty" | "non-json";
  bodyLength: number;
  jsonParsed: boolean;
  topLevelKeys: string[];
  codeType: string;
  codeValue: string | number | null;
  code: string | number | null;
  msgType: string;
  msgSafe: string | null;
  msgPresent: boolean;
  dataType: string;
  dataKeys: string[];
  dataLength: number | null;
  idPresent: boolean;
  idType: string;
  status: number | string | null;
  statusPresent: boolean;
  statusType: string;
  statusValue: number | string | null;
  resultElementTypes: string[];
  resultFirstElement: Record<string, unknown> | null;
  imageFields: Array<{
    path: string;
    type: string;
    arrayLength: number | null;
    https: boolean | null;
    base64: boolean | null;
    dataUrl: boolean | null;
    mime: string | null;
    decodedBytes: number | null;
  }>;
};

function summarizeResultElement(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const compact = value.replace(/\s/g, "");
    return {
      type: "string",
      length: value.length,
      https: /^https:\/\//i.test(value),
      dataUrl: /^data:image\/(png|jpe?g|webp);base64,/i.test(value),
      base64Like: /^(?:[A-Za-z0-9+/]{4})+(?:={0,2})?$/.test(compact),
    };
  }
  if (isRecord(value)) {
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      if (/(authorization|api[_-]?key|user_ip|debug|request|prompt|ip|account)/i.test(key)) continue;
      if (typeof field === "string") {
        fields[key] = {
          type: "string",
          length: field.length,
          https: /^https:\/\//i.test(field),
          dataUrl: /^data:image\/(png|jpe?g|webp);base64,/i.test(field),
        };
      } else {
        fields[key] = { type: valueType(field) };
      }
    }
    return { type: "object", fields };
  }
  return { type: valueType(value) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value)
    .filter((key) => !/(authorization|api[_-]?key|user_ip|debug)/i.test(key))
    .sort();
}

function sanitizeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const apiKey = process.env.WUYINKEJI_API_KEY ?? "";
  const sanitized = value
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/(?:authorization|api[_-]?key|user_ip|debug|stack)\s*[:=]\s*[^,\s]+/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]")
    .replace(/(?:[A-Za-z0-9+/]{80,}={0,2})/g, "[BASE64_REDACTED]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized ? sanitized.slice(0, 240) : null;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return typeof value;
}

function decodeLength(value: string): number | null {
  const match = value.match(/^data:image\/[^;]+;base64,(.*)$/is);
  const encoded = (match ? match[1] : value).replace(/\s/g, "");
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    return atob(encoded).length;
  } catch {
    return null;
  }
}

function collectImageFields(value: unknown, path = "data", output: SafeResponseSummary["imageFields"] = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectImageFields(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, candidate] of Object.entries(value)) {
    if (/(authorization|api[_-]?key|user_ip|debug)/i.test(key)) continue;
    const nextPath = `${path}.${key}`;
    if (typeof candidate === "string") {
      const dataUrl = /^data:image\/(png|jpe?g|webp);base64,/i.test(candidate);
      const base64 = dataUrl || /^(?:[A-Za-z0-9+/]{4})+(?:={0,2})?$/.test(candidate.replace(/\s/g, ""));
      const looksLikeUrl = /url|image|output|result/i.test(key);
      if (looksLikeUrl || base64) {
        output.push({
          path: nextPath,
          type: "string",
          arrayLength: null,
          https: /^https:\/\//i.test(candidate) || (looksLikeUrl ? false : null),
          base64: base64 || null,
          dataUrl: dataUrl || null,
          mime: dataUrl ? candidate.match(/^data:(image\/(?:png|jpe?g|webp));/i)?.[1]?.toLowerCase() ?? null : null,
          decodedBytes: base64 ? decodeLength(candidate) : null,
        });
      }
    } else if (Array.isArray(candidate)) {
      output.push({
        path: nextPath,
        type: "array",
        arrayLength: candidate.length,
        https: null,
        base64: null,
        dataUrl: null,
        mime: null,
        decodedBytes: null,
      });
      collectImageFields(candidate, nextPath, output);
    } else if (isRecord(candidate)) {
      collectImageFields(candidate, nextPath, output);
    }
  }
  return output;
}

function summarize(
  phase: SafeResponseSummary["phase"],
  response: Response,
  body: string,
): SafeResponseSummary {
  let payload: unknown;
  try {
    payload = body ? JSON.parse(body) : undefined;
  } catch {
    payload = undefined;
  }
  const top = isRecord(payload) ? payload : {};
  const data = top.data;
  const dataRecord = isRecord(data) ? data : undefined;
  const rawStatus = dataRecord?.status ?? top.status;
  const result = dataRecord?.result;
  const resultArray = Array.isArray(result) ? result : undefined;
  const statusPresent = rawStatus !== undefined;
  return {
    phase,
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    bodyKind: !body
      ? "empty"
      : isRecord(payload)
        ? "json-object"
        : Array.isArray(payload)
          ? "json-array"
          : typeof payload === "string"
            ? "string"
            : "non-json",
    bodyLength: new TextEncoder().encode(body).byteLength,
    jsonParsed: payload !== undefined,
    topLevelKeys: safeKeys(top),
    codeType: top.code === undefined ? "missing" : valueType(top.code),
    codeValue: typeof top.code === "number" ? top.code : typeof top.code === "string" ? sanitizeMessage(top.code) : null,
    code: typeof top.code === "string" || typeof top.code === "number" ? top.code : null,
    msgType: top.msg === undefined && top.message === undefined ? "missing" : valueType(top.msg ?? top.message),
    msgSafe: sanitizeMessage(top.msg ?? top.message),
    msgPresent: typeof top.msg === "string" || typeof top.message === "string",
    dataType: valueType(data),
    dataKeys: isRecord(data) ? safeKeys(data) : [],
    dataLength: Array.isArray(data) ? data.length : null,
    idPresent: isRecord(data) && data.id !== undefined,
    idType: isRecord(data) && data.id !== undefined ? valueType(data.id) : "missing",
    status: typeof rawStatus === "number" || typeof rawStatus === "string" ? rawStatus : null,
    statusPresent,
    statusType: statusPresent ? valueType(rawStatus) : "missing",
    statusValue: typeof rawStatus === "number" || typeof rawStatus === "string" ? rawStatus : null,
    resultElementTypes: resultArray ? resultArray.slice(0, 1).map(valueType) : [],
    resultFirstElement: resultArray && resultArray.length > 0 ? summarizeResultElement(resultArray[0]) : null,
    imageFields: collectImageFields(data),
  };
}

function input(providerModel: string): ImageGenerationInput {
  return {
    model: providerModel,
    prompt,
    aspectRatio: "1:1",
    quality: "1K",
    referenceImages: [],
    count: 1,
  };
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function smokeOne(modelKey: string, providerModel: string) {
  const responseSummaries: SafeResponseSummary[] = [];
  const fetchImpl = (async (request: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(request, init);
    let body = "";
    try {
      body = await response.clone().text();
    } catch {
      body = "";
    }
    const phase = init?.method === "POST" ? "create-response" : "poll-response";
    responseSummaries.push(summarize(phase, response, body));
    return response;
  }) as typeof fetch;
  const provider = new WuyinkejiImageProvider({
    env: {
      WUYINKEJI_API_KEY: process.env.WUYINKEJI_API_KEY,
      WUYINKEJI_API_BASE_URL: process.env.WUYINKEJI_API_BASE_URL || DEFAULT_WUYINKEJI_API_BASE_URL,
    },
    fetchImpl,
  });

  console.log(JSON.stringify({ modelKey, phase: "create", note: "request started" }));
  let created;
  try {
    created = await provider.createTask(input(providerModel));
  } catch (error) {
    const errorCode = isRecord(error) && typeof error.code === "string" ? error.code : "PROVIDER_ERROR";
    console.log(JSON.stringify({
      modelKey,
      phase: "create",
      ok: false,
      errorCode,
      response: responseSummaries.at(-1),
    }));
    throw new Error(`Wuyinkeji ${modelKey} create failed (${errorCode}).`);
  }
  console.log(JSON.stringify({ modelKey, phase: "create", ok: true, response: responseSummaries.at(-1) }));

  const deadline = Date.now() + 15 * 60 * 1000;
  let delay = 2000;
  while (Date.now() < deadline) {
    let result;
    try {
      result = await provider.pollTextToImageTask(created.taskId);
    } catch (error) {
      const errorCode = isRecord(error) && typeof error.code === "string" ? error.code : "PROVIDER_ERROR";
      console.log(JSON.stringify({ modelKey, phase: "poll", ok: false, errorCode, response: responseSummaries.at(-1) }));
      throw new Error(`Wuyinkeji ${modelKey} poll failed (${errorCode}).`);
    }
    const latest = responseSummaries.at(-1);
    console.log(JSON.stringify({ modelKey, phase: "poll", status: latest?.status, normalized: result.status, response: latest }));
    if (result.status === "failed") {
      throw new Error(`Wuyinkeji ${modelKey} task failed.`);
    }
    if (latest?.status === 2 || latest?.status === "2") {
      if (result.status === "completed" && result.images.length > 0) {
        return { modelKey, created: true, finalStatus: "completed", summaries: responseSummaries };
      }
      throw new Error(`Wuyinkeji ${modelKey} completed response has no recognized image result.`);
    }
    await sleep(delay);
    delay = Math.min(delay + 2000, 10000);
  }
  throw new Error(`Wuyinkeji ${modelKey} task timed out.`);
}

describe.skipIf(!shouldRun)("Wuyinkeji real provider smoke", () => {
  test("runs exactly one explicitly selected model without Mumo persistence", async () => {
    expect(selectedSmokeModel).toBeDefined();
    const [modelKey, providerModel] = selectedSmokeModel!;
    const result = await smokeOne(modelKey, providerModel);
    expect(result.finalStatus).toBe("completed");
  }, 16 * 60 * 1000);
});

if (!shouldRun) {
  console.log(JSON.stringify({
    smoke: "skipped",
    reason: "requires WUYINKEJI_API_KEY, MUMO_REAL_PROVIDER_SMOKE_TEST=true, and a valid WUYINKEJI_REAL_SMOKE_MODEL",
  }));
}
