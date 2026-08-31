import { describe, expect, test } from "bun:test";

import type { ImageGenerationInput } from "../src/lib/generation.schemas";
import {
  ImageProviderError,
  normalizeImageResults,
} from "../src/lib/providers/image-provider.server";
import {
  resolveProviderSize,
  VibeLearningImageProvider,
} from "../src/lib/providers/vibelearning-image.server";

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

const MOCK_API_KEY = "mock-api-key-for-tests";
const MOCK_ENV = {
  VIBELEARNING_IMAGE_API_BASE_URL: "https://mock.vibelearning.test/v1/",
  VIBELEARNING_IMAGE_API_KEY: MOCK_API_KEY,
};

function input(
  referenceImages: ImageGenerationInput["referenceImages"] = [],
): ImageGenerationInput {
  return {
    model: "gpt-image-2",
    prompt: "a quiet reading room",
    aspectRatio: "1:1",
    quality: "1K",
    referenceImages,
    count: 1,
  };
}

function reference(filename: string, value: number) {
  return {
    bytes: new Uint8Array([value, value + 1, value + 2]),
    filename,
    mimeType: "image/png" as const,
  };
}

function mockFetch(...responses: Response[]) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: requestInput, init });
    const response = responses.shift();
    if (!response) throw new Error("unexpected mock fetch call");
    return response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function pngBase64(): { bytes: Uint8Array; encoded: string } {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { bytes, encoded: btoa(String.fromCharCode(...bytes)) };
}

function encodeBytesAsBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 8190;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    let binary = "";
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    chunks.push(btoa(binary));
  }
  return chunks.join("");
}

async function diagnoseResponseDataItem(value: unknown) {
  const mock = mockFetch(jsonResponse({ status: "completed", response: { data: value } }));
  const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });
  const diagnostic = await provider.diagnoseProviderTask({
    generationTaskId: "diagnostic-generation-task",
    taskId: "diagnostic-provider-task",
    mode: "text-to-image",
  });
  return { diagnostic, serialized: JSON.stringify(diagnostic), calls: mock.calls };
}

describe("VibeLearningImageProvider", () => {
  test("creates text-to-image tasks with JSON and automatic routing", async () => {
    const mock = mockFetch(jsonResponse({ task_id: "text-task", status: "queued" }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const created = await provider.createTask(input());

    expect(created).toEqual({ taskId: "text-task", mode: "text-to-image", status: "queued" });
    expect(String(mock.calls[0].input)).toBe(
      "https://mock.vibelearning.test/v1/images/generations/tasks",
    );
    const headers = new Headers(mock.calls[0].init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe(`Bearer ${MOCK_API_KEY}`);
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "a quiet reading room",
      size: "1024x1024",
      n: 1,
    });
  });

  test("uses the official default base URL and forwards any configured provider model", async () => {
    const mock = mockFetch(jsonResponse({ id: "default-base-task" }));
    const provider = new VibeLearningImageProvider({
      env: { VIBELEARNING_IMAGE_API_KEY: MOCK_API_KEY },
      fetchImpl: mock.fetchImpl,
    });

    await provider.createTextToImageTask({ ...input(), model: "future-provider-model" });

    expect(String(mock.calls[0].input)).toBe(
      "https://image1.vibelearning.top/v1/images/generations/tasks",
    );
    expect(JSON.parse(String(mock.calls[0].init?.body)).model).toBe("future-provider-model");
  });

  test.each([
    ["1:1", "1K", "1024x1024"],
    ["1:1", "2K", "2048x2048"],
    ["1:1", "4K", "4096x4096"],
    ["4:3", "1K", "1024x768"],
    ["4:3", "2K", "2048x1536"],
    ["4:3", "4K", "4096x3072"],
    ["3:4", "1K", "768x1024"],
    ["3:4", "2K", "1536x2048"],
    ["3:4", "4K", "3072x4096"],
    ["16:9", "1K", "1024x576"],
    ["16:9", "2K", "2048x1152"],
    ["16:9", "4K", "4096x2304"],
    ["9:16", "1K", "576x1024"],
    ["9:16", "2K", "1152x2048"],
    ["9:16", "4K", "2304x4096"],
  ])("maps %s + %s to %s in a text-to-image request", async (aspectRatio, quality, size) => {
    const mock = mockFetch(jsonResponse({ task_id: "mapped-task" }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await provider.createTextToImageTask({ ...input(), aspectRatio, quality });

    expect(JSON.parse(String(mock.calls[0].init?.body)).size).toBe(size);
    expect(resolveProviderSize(aspectRatio, quality)).toBe(size);
  });

  test("uses image for one image-to-image reference and its mapped size", async () => {
    const mock = mockFetch(jsonResponse({ data: { task_id: "single-task" } }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const created = await provider.createTask({
      ...input([reference("one.png", 1)]),
      aspectRatio: "4:3",
      quality: "2K",
    });

    expect(created.mode).toBe("image-to-image");
    expect(String(mock.calls[0].input)).toBe(
      "https://mock.vibelearning.test/v1/images/edits/tasks",
    );
    const body = mock.calls[0].init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll("image")).toHaveLength(1);
    expect(body.getAll("image[]")).toHaveLength(0);
    expect((body.get("image") as File).name).toBe("one.png");
    expect(body.get("model")).toBe("gpt-image-2");
    expect(body.get("prompt")).toBe("a quiet reading room");
    expect(body.get("size")).toBe("2048x1536");
    expect(body.get("n")).toBe("1");
    expect(new Headers(mock.calls[0].init?.headers).has("content-type")).toBe(false);
  });

  test("uses repeated image[] fields for multiple references and its mapped size", async () => {
    const mock = mockFetch(jsonResponse({ task_id: "multi-task" }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await provider.createImageToImageTask(
      {
        ...input([reference("one.png", 1), reference("two.png", 2)]),
        aspectRatio: "9:16",
        quality: "4K",
      },
    );

    const body = mock.calls[0].init?.body as FormData;
    expect(body.getAll("image")).toHaveLength(0);
    expect(body.getAll("image[]")).toHaveLength(2);
    expect(body.getAll("image[]").map((entry) => (entry as File).name)).toEqual([
      "one.png",
      "two.png",
    ]);
    expect(body.get("size")).toBe("2304x4096");
  });

  test("reads completed URL images from response.data", async () => {
    const mock = mockFetch(
      jsonResponse({
        status: "completed",
        response: { data: [{ url: "https://cdn.example/result.webp" }] },
      }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTextToImageTask("task/url");

    expect(String(mock.calls[0].input)).toBe(
      "https://mock.vibelearning.test/v1/images/generations/tasks/task%2Furl",
    );
    expect(result).toEqual({
      taskId: "task/url",
      status: "completed",
      images: [{ kind: "url", url: "https://cdn.example/result.webp" }],
    });
  });

  test("keeps a completed task processing while response.data is temporarily empty", async () => {
    const mock = mockFetch(jsonResponse({ status: "completed", response: { data: [] } }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("delayed-task")).resolves.toEqual({
      taskId: "delayed-task",
      status: "processing",
      images: [],
    });
  });

  test("keeps a succeeded task processing while no result field is present", async () => {
    const mock = mockFetch(jsonResponse({ status: "succeeded" }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("missing-result-task")).resolves.toMatchObject({
      taskId: "missing-result-task",
      status: "processing",
      images: [],
    });
  });

  test("keeps completed response.data null or unknown items processing", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "completed", response: { data: null } }),
      jsonResponse({ status: "completed", response: { data: [{ unknown_result: "ignored" }] } }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("null-result")).resolves.toMatchObject({
      status: "processing",
      images: [],
    });
    await expect(provider.pollTextToImageTask("unknown-result")).resolves.toMatchObject({
      status: "processing",
      images: [],
    });
  });

  test("reads completed base64 images from response.data", async () => {
    const { bytes, encoded: imageBase64 } = pngBase64();
    const mock = mockFetch(jsonResponse({
      status: "completed",
      response: { created: 123, data: [{ b64_json: imageBase64 }], usage: {} },
    }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTextToImageTask("existing-task");

    expect(result).toMatchObject({
      status: "completed",
      images: [{ kind: "base64", bytes, mimeType: "image/webp" }],
    });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].init?.method).toBe("GET");
  });

  test.each([
    ["empty URL", ""],
    ["HTTP URL", "http://example.invalid/image.png"],
    ["relative URL", "/temporary/image.png"],
  ])("prefers valid b64_json over a sibling %s", async (_kind, url) => {
    const { bytes, encoded } = pngBase64();
    const mock = mockFetch(jsonResponse({
      status: "completed",
      response: { data: [{ b64_json: encoded, url }] },
    }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTextToImageTask("existing-task");

    expect(result).toMatchObject({
      status: "completed",
      images: [{ kind: "base64", bytes }],
    });
    expect(result.images).toHaveLength(1);
    expect(mock.calls).toHaveLength(1);
  });

  test.each([
    (encoded: string) => ({ url: "https://example.invalid/image.png", b64_json: encoded }),
    (encoded: string) => ({ b64_json: encoded, url: "https://example.invalid/image.png" }),
  ])("prefers b64_json over HTTPS URL regardless of field order", async (itemBuilder) => {
    const { bytes, encoded } = pngBase64();
    const mock = mockFetch(jsonResponse({ status: "completed", response: { data: [itemBuilder(encoded)] } }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTextToImageTask("existing-task");

    expect(result).toMatchObject({ images: [{ kind: "base64", bytes }] });
    expect(result.images).toHaveLength(1);
    expect(mock.calls).toHaveLength(1);
  });

  test("does not fall back to a sibling HTTPS URL when nonempty b64_json is invalid", async () => {
    const mock = mockFetch(jsonResponse({
      status: "completed",
      response: { data: [{ b64_json: "not-base64!", url: "https://example.invalid/image.png" }] },
    }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("existing-task")).rejects.toMatchObject({
      code: "INVALID_PROVIDER_BASE64",
    });
    expect(mock.calls).toHaveLength(1);
  });

  test.each([
    ["empty", ""],
    ["null", null],
    ["missing", undefined],
  ])("uses HTTPS URL when b64_json is %s", async (_kind, b64_json) => {
    const item = b64_json === undefined
      ? { url: "https://cdn.example/fallback.webp" }
      : { b64_json, url: "https://cdn.example/fallback.webp" };
    const mock = mockFetch(jsonResponse({ status: "completed", response: { data: [item] } }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTextToImageTask("existing-task");

    expect(result).toMatchObject({ status: "completed", images: [{ kind: "url" }] });
    expect(result.images).toHaveLength(1);
  });

  test("rejects a non-HTTPS URL when no usable b64_json exists", async () => {
    const mock = mockFetch(jsonResponse({
      status: "completed",
      response: { data: [{ b64_json: "", url: "http://example.invalid/image.png" }] },
    }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("existing-task")).rejects.toMatchObject({
      code: "INVALID_PROVIDER_IMAGE",
    });
  });

  test("keeps completed result items with no usable candidates processing", async () => {
    const mock = mockFetch(jsonResponse({
      status: "completed",
      response: { data: [{ b64_json: "", url: "" }] },
    }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("existing-task")).resolves.toMatchObject({
      status: "processing",
      images: [],
    });
  });

  test.each([
    ["data", (imageBase64: string) => ({ data: [{ b64_json: imageBase64 }] })],
    ["result.data", (imageBase64: string) => ({ result: { data: [{ b64_json: imageBase64 }] } })],
    ["top-level url", () => ({ url: "https://cdn.example/top-level.webp" })],
    ["top-level b64_json", (imageBase64: string) => ({ b64_json: imageBase64 })],
  ])("keeps the explicit %s result path compatible", async (_path, buildPayload) => {
    const imageBase64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    const mock = mockFetch(jsonResponse({ status: "completed", ...buildPayload(imageBase64) }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTextToImageTask("compatible-result");

    expect(result.status).toBe("completed");
    expect(result.images).toHaveLength(1);
  });

  test("uses the same task ID until a delayed URL result becomes available", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "completed", data: [] }),
      jsonResponse({ status: "done", response: { data: [{ url: "https://cdn.example/delayed.webp" }] } }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    expect((await provider.pollTextToImageTask("delayed-url")).status).toBe("processing");
    expect(await provider.pollTextToImageTask("delayed-url")).toMatchObject({
      status: "completed",
      images: [{ kind: "url", url: "https://cdn.example/delayed.webp" }],
    });
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls.map((call) => String(call.input))).toEqual([
      "https://mock.vibelearning.test/v1/images/generations/tasks/delayed-url",
      "https://mock.vibelearning.test/v1/images/generations/tasks/delayed-url",
    ]);
  });

  test("uses a delayed base64 result once it becomes available", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "success", result: { data: [] } }),
      jsonResponse({ status: "success", response: { data: [{ b64_json: "AQIDBA==" }] } }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    expect((await provider.pollImageToImageTask("delayed-base64")).status).toBe("processing");
    await expect(provider.pollImageToImageTask("delayed-base64")).resolves.toMatchObject({
      status: "completed",
      images: [{ kind: "base64", bytes: new Uint8Array([1, 2, 3, 4]) }],
    });
  });

  test("returns a structural diagnostic from one GET without exposing result values", async () => {
    const imageUrl = "https://cdn.example/diagnostic.webp";
    const imageBase64 = "AQIDBA==";
    const mock = mockFetch(
      jsonResponse({
        status: "completed",
        state: "done",
        code: "OK",
        data: {
          status: "completed",
          state: "ready",
          data: [{ url: imageUrl, b64_json: imageBase64 }],
        },
        result: { status: "completed", data: [{ url: imageUrl }] },
      }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const diagnostic = await provider.diagnoseProviderTask({
      generationTaskId: "5c67c57e-098f-49a0-9a5f-c7f82677ecc5",
      taskId: "task_diagnostic",
      mode: "text-to-image",
    });
    const serialized = JSON.stringify(diagnostic);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].init?.method).toBe("GET");
    expect(String(mock.calls[0].input)).toBe(
      "https://mock.vibelearning.test/v1/images/generations/tasks/task_diagnostic",
    );
    expect(diagnostic).toMatchObject({
      generationTaskId: "5c67c57e-098f-49a0-9a5f-c7f82677ecc5",
      provider: "vibelearning",
      providerTaskIdPresent: true,
      generationMode: "text-to-image",
      httpStatus: 200,
      responseIsJson: true,
      topLevelKeys: ["code", "data", "result", "state", "status"],
      dataType: "object",
      dataKeys: ["data", "state", "status"],
      nestedDataType: "array",
      nestedDataCount: 1,
      resultType: "object",
      resultKeys: ["data", "status"],
      resultDataType: "array",
      resultDataCount: 1,
      knownResultFlags: {
        topUrl: false,
        topB64Json: false,
        dataUrl: false,
        dataB64Json: false,
        dataDataUrl: true,
        dataDataB64Json: true,
        resultUrl: false,
        resultB64Json: false,
        resultDataUrl: true,
        resultDataB64Json: false,
        responseUrl: false,
        responseB64Json: false,
        responseImageUrl: false,
        responseOutputUrl: false,
        responseItemUrl: false,
        responseItemB64Json: false,
        responseItemImageUrl: false,
        responseItemOutputUrl: false,
        responseDataUrl: false,
        responseDataB64Json: false,
        responseDataImageUrl: false,
        responseDataOutputUrl: false,
        responseOutputB64Json: false,
        responseOutputImageUrl: false,
      },
    });
    expect(serialized).not.toContain(imageUrl);
    expect(serialized).not.toContain(imageBase64);
    expect(serialized).not.toContain(MOCK_API_KEY);
    expect(serialized).not.toContain("Authorization");
  });

  test("summarizes an array response without returning its URL or task metadata values", async () => {
    const imageUrl = "https://example.test/image.png";
    const taskId = "task-should-not-leak";
    const queryEndpoint = "/v1/images/generations/tasks/task-should-not-leak";
    const mock = mockFetch(jsonResponse({
      status: "completed",
      task_id: taskId,
      query_endpoint: queryEndpoint,
      response: [{ url: imageUrl }],
    }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const diagnostic = await provider.diagnoseProviderTask({
      generationTaskId: "5c67c57e-098f-49a0-9a5f-c7f82677ecc5",
      taskId: "task_diagnostic",
      mode: "text-to-image",
    });
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      responseType: "array",
      responseCount: 1,
      responseItemType: "object",
      responseItemKeys: ["url"],
      knownResultFlags: { responseItemUrl: true },
    });
    expect(serialized).not.toContain(imageUrl);
    expect(serialized).not.toContain(taskId);
    expect(serialized).not.toContain(queryEndpoint);
  });

  test("summarizes response.data and response.output result shapes without returning encoded values", async () => {
    const base64 = "AQIDBA==";
    const outputUrl = "https://example.test/output.png";
    const mock = mockFetch(
      jsonResponse({
        status: "completed",
        response: {
          data: [{ b64_json: base64 }],
          output: [{ url: outputUrl }],
          constructor: "excluded",
          prototype: "excluded",
        },
      }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const diagnostic = await provider.diagnoseProviderTask({
      generationTaskId: "5c67c57e-098f-49a0-9a5f-c7f82677ecc5",
      taskId: "task_diagnostic",
      mode: "text-to-image",
    });
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      responseType: "object",
      responseKeys: ["data", "output"],
      responseDataType: "array",
      responseDataCount: 1,
      responseOutputType: "array",
      responseOutputCount: 1,
      knownResultFlags: {
        responseDataB64Json: true,
        responseOutputUrl: true,
      },
    });
    expect(serialized).not.toContain(base64);
    expect(serialized).not.toContain(outputUrl);
  });

  test("reports a string response only by type", async () => {
    const rawResponse = "https://example.test/never-return-this";
    const mock = mockFetch(jsonResponse({ status: "completed", response: rawResponse }));
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const diagnostic = await provider.diagnoseProviderTask({
      generationTaskId: "5c67c57e-098f-49a0-9a5f-c7f82677ecc5",
      taskId: "task_diagnostic",
      mode: "text-to-image",
    });

    expect(diagnostic).toMatchObject({ responseType: "string", responseKeys: [], responseCount: null });
    expect(JSON.stringify(diagnostic)).not.toContain(rawResponse);
  });

  test("normalizes b64_json images as bytes", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "success", response: { data: [{ b64_json: "AQIDBA==" }] } }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollTask({
      taskId: "base64-task",
      mode: "image-to-image",
    });

    expect(String(mock.calls[0].input)).toBe(
      "https://mock.vibelearning.test/v1/images/edits/tasks/base64-task",
    );

    expect(result.status).toBe("completed");
    expect(result.images[0]).toEqual({
      kind: "base64",
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: "image/webp",
    });
  });

  test("normalizes failed task status without exposing the API key", async () => {
    const mock = mockFetch(
      jsonResponse({
        status: "failed",
        response: { error: { code: "MODEL_ERROR", message: `upstream rejected ${MOCK_API_KEY}` } },
      }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const result = await provider.pollImageToImageTask("failed-task");

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "PROVIDER_TASK_FAILED",
      providerCode: "MODEL_ERROR",
      retryable: false,
    });
    expect(result.error?.message).toContain("[REDACTED]");
    expect(result.error?.message).not.toContain(MOCK_API_KEY);
  });

  test("keeps explicit rejected statuses terminal and unknown statuses out of the success path", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "rejected", error: { message: "policy rejected" } }),
      jsonResponse({ status: "result_eventually", response: { data: [{ url: "https://cdn.example/ignored.webp" }] } }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("rejected-task")).resolves.toMatchObject({
      status: "failed",
    });
    await expect(provider.pollTextToImageTask("unknown-task")).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });

  test.each([
    ["png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ["webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
  ] as const)("diagnoses valid %s Base64 magic without returning image data", async (imageType, bytes) => {
    const encoded = btoa(String.fromCharCode(...bytes));
    const { diagnostic, serialized } = await diagnoseResponseDataItem([{ b64_json: encoded }]);

    expect(diagnostic).toMatchObject({
      responseDataItemType: "object",
      responseDataItemKeys: ["b64_json"],
      responseDataItemB64Type: "string",
      responseDataItemB64AlphabetValid: true,
      responseDataItemB64PaddingValid: true,
      responseDataItemB64DecodedPrefixValid: true,
      responseDataItemDetectedImageType: imageType,
      responseDataItemMagicValid: true,
    });
    expect(serialized).not.toContain(encoded);
  });

  test("diagnoses data URLs, whitespace, and non-multiple-of-four lengths without returning payload text", async () => {
    const encoded = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    const dataUrl = `data:image/png;base64,${encoded}`;
    const whitespace = `${encoded.slice(0, 2)}\n${encoded.slice(2)}`;
    const { diagnostic: dataUrlDiagnostic, serialized: dataUrlSerialized } = await diagnoseResponseDataItem([{ b64_json: dataUrl }]);
    const { diagnostic: whitespaceDiagnostic, serialized: whitespaceSerialized } = await diagnoseResponseDataItem([{ b64_json: whitespace }]);
    const { diagnostic: shortDiagnostic } = await diagnoseResponseDataItem([{ b64_json: "AQI" }]);

    expect(dataUrlDiagnostic.responseDataItemB64HasDataUrlPrefix).toBe(true);
    expect(whitespaceDiagnostic.responseDataItemB64HasWhitespace).toBe(true);
    expect(shortDiagnostic.responseDataItemB64LengthMod4).toBe(3);
    expect(dataUrlSerialized).not.toContain(dataUrl);
    expect(whitespaceSerialized).not.toContain(whitespace);
  });

  test("diagnoses invalid alphabet, padding, magic, and likely truncation safely", async () => {
    const { diagnostic: invalidAlphabet } = await diagnoseResponseDataItem([{ b64_json: "not-base64!" }]);
    const { diagnostic: invalidPadding } = await diagnoseResponseDataItem([{ b64_json: "AQ=I" }]);
    const unknownMagic = btoa(String.fromCharCode(1, 2, 3, 4));
    const { diagnostic: unknownMagicDiagnostic } = await diagnoseResponseDataItem([{ b64_json: unknownMagic }]);
    const { diagnostic: truncated } = await diagnoseResponseDataItem([{ b64_json: "AQIDB" }]);

    expect(invalidAlphabet.responseDataItemB64AlphabetValid).toBe(false);
    expect(invalidPadding.responseDataItemB64PaddingValid).toBe(false);
    expect(unknownMagicDiagnostic).toMatchObject({
      responseDataItemB64DecodedPrefixValid: true,
      responseDataItemDetectedImageType: "unknown",
      responseDataItemMagicValid: false,
    });
    expect(truncated.responseDataItemLikelyTruncated).toBe(true);
  });

  test("summarizes empty and non-object response.data items without scanning further items", async () => {
    const { diagnostic: empty } = await diagnoseResponseDataItem([]);
    const { diagnostic: nonObject } = await diagnoseResponseDataItem(["not-an-image", { b64_json: "ignored" }]);

    expect(empty).toMatchObject({
      responseDataItemType: "null",
      responseDataItemKeys: [],
      responseDataItemB64Length: null,
      responseDataItemMagicValid: false,
    });
    expect(nonObject).toMatchObject({
      responseDataItemType: "string",
      responseDataItemKeys: [],
      responseDataItemB64Type: "null",
    });
  });

  test("returns the existing normalization error code without error details", async () => {
    const { diagnostic, serialized } = await diagnoseResponseDataItem([{ b64_json: "not-base64!" }]);

    expect(diagnostic.normalizationErrorCode).toBe("INVALID_PROVIDER_BASE64");
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
  });

  test.each(["failed", "error", "cancelled", "canceled", "rejected", "expired"])(
    "keeps explicit %s statuses failed even when response.data contains an image",
    async (status) => {
      const mock = mockFetch(jsonResponse({
        status,
        response: { data: [{ url: "https://cdn.example/ignored.webp" }] },
      }));
      const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

      await expect(provider.pollTextToImageTask("failed-task")).resolves.toMatchObject({
        status: "failed",
        images: [],
      });
    },
  );

  test("normalizes non-2xx provider errors", async () => {
    const mock = mockFetch(
      jsonResponse({ error: { code: "RATE_LIMIT", message: "try later" } }, 429),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    const promise = provider.createTextToImageTask(input());

    await expect(promise).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
      httpStatus: 429,
      providerCode: "RATE_LIMIT",
      retryable: true,
    });
  });

  test("rejects unconfirmed size mappings before fetch", async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return jsonResponse({ task_id: "unexpected" });
    }) as typeof fetch;
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl });

    await expect(
      provider.createTask({ ...input(), aspectRatio: "21:9", quality: "2K" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER_SIZE" });
    expect(fetchCalled).toBe(false);
    expect(() => resolveProviderSize("1:1", "1K")).not.toThrow();
  });

  test("rejects invalid base64 while empty completed results remain retryable", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "completed", data: [{ b64_json: "not-base64!" }] }),
      jsonResponse({ status: "completed", data: [] }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("bad-base64")).rejects.toMatchObject({
      code: "INVALID_PROVIDER_BASE64",
    });
    await expect(provider.pollTextToImageTask("empty-data")).resolves.toMatchObject({
      status: "processing",
      images: [],
    });
  });

  test("keeps strict Base64 compatibility for whitespace, missing padding, and data URLs", () => {
    const encoded = "AQIDBA==";

    expect(normalizeImageResults({ b64_json: "AQID\nBA==" })[0]).toMatchObject({
      kind: "base64",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(normalizeImageResults({ b64_json: "AQI" })[0]).toMatchObject({
      kind: "base64",
      bytes: new Uint8Array([1, 2]),
    });
    expect(normalizeImageResults({ b64_json: "AQ" })[0]).toMatchObject({
      kind: "base64",
      bytes: new Uint8Array([1]),
    });
    expect(normalizeImageResults({ b64_json: `data:image/png;base64,${encoded}` })[0]).toMatchObject({
      kind: "base64",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
  });

  test.each([
    ["png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
    ["webp", new Uint8Array([0x52, 0x49, 0x46, 0x46])],
  ] as const)("decodes a standard %s Base64 result", (_type, bytes) => {
    const result = normalizeImageResults({ b64_json: encodeBytesAsBase64(bytes) })[0];

    expect(result).toMatchObject({ kind: "base64", bytes });
  });

  test.each([
    "A",
    "AQ!D",
    "A=ID",
    "AQI===",
  ])("maps invalid Base64 input to the safe error code", (b64_json) => {
    expect(() => normalizeImageResults({ b64_json })).toThrow(
      expect.objectContaining({ code: "INVALID_PROVIDER_BASE64" }),
    );
  });

  test("decodes large Base64 data in bounded atob chunks", () => {
    const bytes = new Uint8Array(160 * 1024);
    bytes[0] = 0x89;
    bytes[1] = 0x50;
    bytes[bytes.length - 2] = 0x7e;
    bytes[bytes.length - 1] = 0x42;
    const encoded = encodeBytesAsBase64(bytes);
    const originalAtob = globalThis.atob;
    const maxChunkChars = 64 * 1024;
    let calls = 0;

    globalThis.atob = ((chunk: string) => {
      calls += 1;
      if (chunk.length > maxChunkChars) throw new Error("chunk too large");
      return originalAtob(chunk);
    }) as typeof atob;
    try {
      const result = normalizeImageResults({ b64_json: encoded })[0];
      expect(result).toMatchObject({ kind: "base64" });
      if (result.kind !== "base64") throw new Error("unexpected image kind");
      expect(result.bytes.length).toBe(bytes.length);
      expect(result.bytes.slice(0, 2)).toEqual(bytes.slice(0, 2));
      expect(result.bytes.slice(-2)).toEqual(bytes.slice(-2));
      expect(calls).toBeGreaterThan(1);
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  test("converts ordinary decoder runtime failures to INVALID_PROVIDER_BASE64", () => {
    const originalAtob = globalThis.atob;
    globalThis.atob = (() => {
      throw new Error("decoder implementation detail");
    }) as typeof atob;
    try {
      expect(() => normalizeImageResults({ b64_json: "AQIDBA==" })).toThrow(
        expect.objectContaining({ code: "INVALID_PROVIDER_BASE64" }),
      );
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  test("rejects Base64 whose decoded size exceeds the provider image limit", () => {
    const overLimitLength = Math.floor((25 * 1024 * 1024 * 4) / 3) + 4;
    const oversized = "A".repeat(overLimitLength - (overLimitLength % 4));

    expect(() => normalizeImageResults({ b64_json: oversized })).toThrow(
      expect.objectContaining({ code: "INVALID_PROVIDER_BASE64" }),
    );
  });

  test("rejects non-HTTPS provider result URLs", async () => {
    const mock = mockFetch(
      jsonResponse({ status: "completed", response: { data: [{ url: "http://cdn.example/result.webp" }] } }),
    );
    const provider = new VibeLearningImageProvider({ env: MOCK_ENV, fetchImpl: mock.fetchImpl });

    await expect(provider.pollTextToImageTask("http-result")).rejects.toMatchObject({
      code: "INVALID_PROVIDER_IMAGE",
    });
  });

  test("does not fetch when the API key is missing", async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return jsonResponse({ task_id: "unexpected" });
    }) as typeof fetch;
    const provider = new VibeLearningImageProvider({
      env: { VIBELEARNING_IMAGE_API_BASE_URL: "https://mock.vibelearning.test/v1" },
      fetchImpl,
    });

    await expect(provider.createTextToImageTask(input())).rejects.toBeInstanceOf(
      ImageProviderError,
    );
    await expect(provider.createTextToImageTask(input())).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
    expect(fetchCalled).toBe(false);
  });

  test("enforces a configured provider reference-image limit", async () => {
    const mock = mockFetch(jsonResponse({ task_id: "unexpected" }));
    const provider = new VibeLearningImageProvider({
      env: MOCK_ENV,
      fetchImpl: mock.fetchImpl,
      maxReferenceImages: 1,
    });

    await expect(
      provider.createTask(input([reference("one.png", 1), reference("two.png", 2)])),
    ).rejects.toMatchObject({ code: "TOO_MANY_REFERENCE_IMAGES" });
    expect(mock.calls).toHaveLength(0);
  });
});
