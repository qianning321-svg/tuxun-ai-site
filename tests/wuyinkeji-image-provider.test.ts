import { describe, expect, test } from "bun:test";

import type { ImageGenerationInput } from "../src/lib/generation.schemas";
import { ImageProviderError } from "../src/lib/providers/image-provider.server";
import { createDefaultProviderRegistry } from "../src/lib/providers/provider-registry.server";
import { DEFAULT_WUYINKEJI_API_BASE_URL, WuyinkejiImageProvider } from "../src/lib/providers/wuyinkeji-image.server";

const API_KEY = "wuyinkeji-test-key";

function input(model: string, quality: ImageGenerationInput["quality"] = "1K", aspectRatio = "1:1"): ImageGenerationInput {
  return { model, prompt: "a simple red apple on a white background", aspectRatio, quality, referenceImages: [], count: 1 };
}

function inputWithReference(model: string, quality: ImageGenerationInput["quality"] = "1K", aspectRatio = "1:1"): ImageGenerationInput {
  return {
    ...input(model, quality, aspectRatio),
    referenceImages: [{
      bytes: new Uint8Array(),
      filename: "reference.png",
      mimeType: "image/png",
      supplierUrl: "https://mumo.test/api/provider-input-image/asset-1?exp=123&sig=signature",
    }],
  };
}

function mockFetch(...responses: Response[]) {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const fetchImpl = (async (request: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: request, init });
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function json(payload: unknown, status = 200) { return Response.json(payload, { status }); }

function provider(fetchImpl: typeof fetch, extra: Record<string, string> = {}) {
  return new WuyinkejiImageProvider({ env: { WUYINKEJI_API_KEY: API_KEY, ...extra }, fetchImpl });
}

describe("WuyinkejiImageProvider", () => {
  test("uses the documented default base URL and raw Authorization header", async () => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-1" } }));
    await provider(mock.fetchImpl).createTask(input("image_gpt"));
    expect(String(mock.calls[0].input)).toBe(`${DEFAULT_WUYINKEJI_API_BASE_URL}/api/async/image_gpt`);
    const headers = new Headers(mock.calls[0].init?.headers);
    expect(headers.get("authorization")).toBe(API_KEY);
    expect(headers.get("authorization")).not.toContain("Bearer");
    expect(String(mock.calls[0].input)).not.toContain(API_KEY);
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("classifies an HTTP 200 provider business rejection separately from an invalid response", async () => {
    const mock = mockFetch(json({
      code: 400,
      msg: `请求失败，账户余额不足或没有权限 ip=10.0.0.1 debug=private ${API_KEY}`,
      data: null,
    }));
    const error = await provider(mock.fetchImpl).createTask(input("image_gpt")).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "PROVIDER_REQUEST_REJECTED", providerCode: "400" });
    expect(error).not.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain("10.0.0.1");
    expect(error.message).not.toContain("private");
    expect(mock.calls).toHaveLength(1);
  });

  test("uses a custom base URL and GPT aspect ratio as size", async () => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-2" } }));
    await provider(mock.fetchImpl, { WUYINKEJI_API_BASE_URL: "https://vendor.test/" }).createTask(input("image_gpt", "1K", "16:9"));
    expect(String(mock.calls[0].input)).toBe("https://vendor.test/api/async/image_gpt");
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual({ prompt: "a simple red apple on a white background", size: "16:9", urls: [] });
  });

  test("rejects GPT Image 2 quality above 1K before fetch", async () => {
    const mock = mockFetch();
    await expect(provider(mock.fetchImpl).createTask(input("image_gpt", "2K"))).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER_SIZE" });
    expect(mock.calls).toHaveLength(0);
  });

  test("uses NanoBanana imageSize rather than size", async () => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-3" } }));
    await provider(mock.fetchImpl).createTask(input("image_nanoBanana"));
    expect(String(mock.calls[0].input)).toBe(`${DEFAULT_WUYINKEJI_API_BASE_URL}/api/async/image_nanoBanana`);
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual({ prompt: "a simple red apple on a white background", imageSize: "1K", aspectRatio: "1:1", urls: [] });
  });

  test.each([
    ["image_nanoBanana", "1K", "auto", { prompt: "a simple red apple on a white background", imageSize: "1K", aspectRatio: "auto", urls: [] }],
    ["image_nanoBanana2", "4K", "1:8", { prompt: "a simple red apple on a white background", size: "4K", aspectRatio: "1:8", urls: [] }],
    ["image_nanoBanana2", "2K", "8:1", { prompt: "a simple red apple on a white background", size: "2K", aspectRatio: "8:1", urls: [] }],
    ["image_gpt", "1K", "auto", { prompt: "a simple red apple on a white background", size: "auto", urls: [] }],
    ["image_nanoBanana2Lite", "1K", "auto", { prompt: "a simple red apple on a white background", size: "1K", aspectRatio: "auto", urls: [] }],
  ])("uses the documented payload for %s ratio %s", async (model, quality, aspectRatio, expected) => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-auto" } }));
    await provider(mock.fetchImpl).createTask(input(model, quality as ImageGenerationInput["quality"], aspectRatio));
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual(expected);
  });

  test.each([
    ["image_nanoBanana", "1K", "3:2", { imageSize: "1K", aspectRatio: "3:2" }],
    ["image_nanoBanana_pro", "2K", "3:2", { size: "2K", aspectRatio: "3:2" }],
    ["image_nanoBanana2", "2K", "3:2", { size: "2K", aspectRatio: "3:2" }],
    ["image_gpt", "1K", "16:9", { size: "16:9" }],
    ["image_nanoBanana2Lite", "1K", "3:2", { size: "1K", aspectRatio: "3:2" }],
  ])("sends signed reference URLs for %s without changing its payload mapping", async (model, quality, aspectRatio, expected) => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-reference" } }));
    await provider(mock.fetchImpl).createTask(inputWithReference(model, quality as ImageGenerationInput["quality"], aspectRatio));
    const body = JSON.parse(String(mock.calls[0].init?.body));
    expect(body).toMatchObject({ prompt: "a simple red apple on a white background", ...expected, urls: ["https://mumo.test/api/provider-input-image/asset-1?exp=123&sig=signature"] });
    expect(body).not.toHaveProperty("referenceImages");
    if (model === "image_gpt") expect(body).not.toHaveProperty("aspectRatio");
  });

  test.each([
    [{ data: { id: "data-id" } }, "data-id"],
    [{ data: { task_id: "data-task-id" } }, "data-task-id"],
    [{ id: "top-id", data: null }, "top-id"],
    [{ task_id: "top-task-id" }, "top-task-id"],
  ])("normalizes supported task id shape", async (body, expected) => {
    const mock = mockFetch(json({ code: 200, ...body }));
    const result = await provider(mock.fetchImpl).createTask(input("image_gpt"));
    expect(result.taskId).toBe(expected);
  });

  test.each([
    ["image_nanoBanana_pro", "/api/async/image_nanoBanana_pro"],
    ["image_nanoBanana2", "/api/async/image_nanoBanana2"],
  ])("uses %s endpoint with size and aspectRatio", async (model, endpoint) => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-4" } }));
    await provider(mock.fetchImpl).createTask(input(model, "2K", "3:2"));
    expect(String(mock.calls[0].input)).toBe(`${DEFAULT_WUYINKEJI_API_BASE_URL}${endpoint}`);
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual({ prompt: "a simple red apple on a white background", size: "2K", aspectRatio: "3:2", urls: [] });
  });

  test("uses Lite endpoint and permits only 1K", async () => {
    const mock = mockFetch(json({ code: 200, data: { id: "task-lite" } }));
    await provider(mock.fetchImpl).createTask(input("image_nanoBanana2Lite"));
    expect(String(mock.calls[0].input)).toBe(`${DEFAULT_WUYINKEJI_API_BASE_URL}/api/async/image_nanoBanana2Lite`);
    await expect(provider(mock.fetchImpl).createTask(input("image_nanoBanana2Lite", "2K"))).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER_SIZE" });
    expect(mock.calls).toHaveLength(1);
  });

  test("rejects unknown provider models, unsupported sizes, ratios, and references before fetch", async () => {
    const mock = mockFetch();
    const instance = provider(mock.fetchImpl);
    await expect(instance.createTask(input("unknown"))).rejects.toBeInstanceOf(ImageProviderError);
    await expect(instance.createTask(input("image_nanoBanana", "2K"))).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER_SIZE" });
    await expect(instance.createTask(input("image_gpt", "1K", "5:4"))).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER_SIZE" });
    await expect(instance.createTask({ ...input("image_gpt"), referenceImages: [{ bytes: new Uint8Array([1]), filename: "a.png", mimeType: "image/png" }] })).rejects.toMatchObject({ code: "INVALID_PROVIDER_INPUT" });
    expect(mock.calls).toHaveLength(0);
  });

  test.each([
    [0, "queued"],
    [1, "processing"],
    ["0", "queued"],
    ["1", "processing"],
  ])("normalizes poll status %i", async (status, expected) => {
    const mock = mockFetch(json({ status, data: { unconfirmed: "result" } }));
    const result = await provider(mock.fetchImpl).pollTextToImageTask("vendor task/1");
    expect(result).toEqual({ taskId: "vendor task/1", status: expected, images: [] });
    const url = new URL(String(mock.calls[0].input));
    expect(`${url.pathname}${url.search}`).toBe("/api/async/detail?id=vendor+task%2F1");
    expect(url.searchParams.get("id")).toBe("vendor task/1");
    expect(url.search).not.toContain(API_KEY);
  });

  test.each(["2", "3"])("accepts string terminal status %s", async (status) => {
    const mock = mockFetch(json({ data: { status } }));
    const result = await provider(mock.fetchImpl).pollTextToImageTask("task-terminal").catch((value: unknown) => value);
    if (status === "2") expect(result).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    else expect(result.status).toBe("failed");
  });

  test("uses a valid data.status string before top-level status", async () => {
    const mock = mockFetch(json({ status: 1, data: { status: "0" } }));
    await expect(provider(mock.fetchImpl).pollTextToImageTask("task-priority")).resolves.toMatchObject({ status: "queued" });
  });

  test.each([
    { data: { status: "02" }, status: 1 },
    { data: { status: "success" }, status: 1 },
    { data: { status: "" }, status: 1 },
  ])("rejects invalid data.status without falling back", async (payload) => {
    const mock = mockFetch(json(payload));
    await expect(provider(mock.fetchImpl).pollTextToImageTask("task-invalid-status")).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  test("prioritizes data.status and treats status 2 without a verified image as terminal invalid response", async () => {
    const mock = mockFetch(json({ status: 1, data: { status: 2, result: "unverified" } }));
    await expect(provider(mock.fetchImpl).pollTextToImageTask("task-complete")).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  test("parses the confirmed data.result string array as completed URL images", async () => {
    const mock = mockFetch(json({ code: 200, data: { status: 2, result: ["  https://example.test/generated/image.png  "] } }));
    await expect(provider(mock.fetchImpl).pollTextToImageTask("task-complete")).resolves.toEqual({
      taskId: "task-complete",
      status: "completed",
      images: [{ kind: "url", url: "https://example.test/generated/image.png" }],
    });
  });

  test("preserves ordered multiple confirmed result URLs", async () => {
    const mock = mockFetch(json({ data: { status: 2, result: ["https://example.test/a.png", "https://example.test/b.webp"] } }));
    const result = await provider(mock.fetchImpl).pollTextToImageTask("task-multiple");
    expect(result.images).toEqual([
      { kind: "url", url: "https://example.test/a.png" },
      { kind: "url", url: "https://example.test/b.webp" },
    ]);
  });

  test.each([
    undefined,
    [],
    "https://example.test/image.png",
    ["https://example.test/image.png", { url: "https://example.test/other.png" }],
    [""],
    ["http://example.test/image.png"],
    ["/relative/image.png"],
    ["https://user:pass@example.test/image.png"],
    ["https://localhost/image.png"],
    ["https://127.0.0.1/image.png"],
    ["data:image/png;base64,AAAA"],
  ])("rejects untrusted completed result shape %j", async (result) => {
    const mock = mockFetch(json({ data: { status: 2, result } }));
    await expect(provider(mock.fetchImpl).pollTextToImageTask("task-invalid-result")).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  test("does not parse unrelated URLs or error fields", async () => {
    const mock = mockFetch(json({
      url: "https://example.test/unrelated.png",
      message: "https://example.test/message.png",
      debug: { url: "https://example.test/debug.png" },
      data: { status: 2, result: undefined, unknown: { url: "https://example.test/unknown.png" } },
    }));
    const error = await provider(mock.fetchImpl).pollTextToImageTask("task-no-result").catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(error.message).not.toContain("example.test");
    expect(error.message).not.toContain("message.png");
  });

  test("rejects unknown poll statuses safely", async () => {
    const mock = mockFetch(json({ data: { status: 99 } }));
    await expect(provider(mock.fetchImpl).pollTextToImageTask("task-unknown")).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  test("normalizes failed task status without leaking its API key", async () => {
    const mock = mockFetch(json({ status: 3, code: "TASK_FAILED", message: `failed ${API_KEY} debug=private` }));
    const result = await provider(mock.fetchImpl).pollTextToImageTask("task-failed");
    expect(result.status).toBe("failed");
    expect(result.error?.message).not.toContain(API_KEY);
    expect(result.error?.message).not.toContain("private");
  });

  test("real providers remain disabled unless the registry switch is explicitly enabled", () => {
    expect(() => createDefaultProviderRegistry().get("wuyinkeji")).toThrow("真实图片供应商尚未启用");
    expect(createDefaultProviderRegistry({ allowRealProviders: true }).get("wuyinkeji").key).toBe("wuyinkeji");
    expect(createDefaultProviderRegistry().get("mock").key).toBe("mock");
    expect(createDefaultProviderRegistry({ allowRealProviders: true }).get("vibelearning").key).toBe("vibelearning");
  });
});
