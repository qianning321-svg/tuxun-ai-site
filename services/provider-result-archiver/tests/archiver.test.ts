import { describe, expect, test } from "bun:test";
import { assertPublicHttpsUrl, fetchSupplierImage, MAX_BYTES, MAX_REDIRECTS, processOne, startLoop } from "../src/archiver";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("provider result archiver safety", () => {
  test("rejects private, credentialed, and non-HTTPS URLs", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/a.png")).rejects.toThrow("SSRF_URL_REJECTED");
    await expect(assertPublicHttpsUrl("https://user:pass@example.com/a.png")).rejects.toThrow("SSRF_URL_REJECTED");
    await expect(assertPublicHttpsUrl("https://127.0.0.1/a.png")).rejects.toThrow("SSRF_IP_REJECTED");
    await expect(assertPublicHttpsUrl("https://localhost/a.png")).rejects.toThrow("SSRF_HOST_REJECTED");
  });

  test("revalidates redirects and enforces the redirect limit", async () => {
    let calls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls += 1;
      if (calls <= MAX_REDIRECTS + 1) return new Response(null, { status: 302, headers: { location: "https://8.8.8.8/image" } });
      return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    await expect(fetchSupplierImage("https://8.8.8.8/image", fetchImpl)).rejects.toThrow("DOWNLOAD_REDIRECT_LIMIT");
  });

  test("rejects private redirect targets, oversized responses, and invalid image bytes", async () => {
    const privateRedirect = (async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/image" } })) as typeof fetch;
    await expect(fetchSupplierImage("https://8.8.8.8/image", privateRedirect)).rejects.toThrow("SSRF_IP_REJECTED");
    const tooLarge = (async () => new Response(png, { status: 200, headers: { "content-type": "image/png", "content-length": String(MAX_BYTES + 1) } })) as typeof fetch;
    await expect(fetchSupplierImage("https://8.8.8.8/image", tooLarge)).rejects.toThrow("IMAGE_TOO_LARGE");
    const badMagic = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
    await expect(fetchSupplierImage("https://8.8.8.8/image", badMagic)).rejects.toThrow("INVALID_MIME");
  });

  test("one-shot exits cleanly with no claimed job", async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
    expect(await processOne("https://mumo.test", "service-token", fetchImpl)).toBe(false);
  });

  test("one-shot downloads, ingests, and never receives a supplier URL from claim", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.endsWith("/claim")) return Response.json({ archiveJobId: "job-1", generationTaskId: "task-1", mumoJobUrl: "https://mumo.test/api/provider-result-archive/job-1", archiveToken: "short-token", tokenExpiresAt: "2026-01-01T00:00:00.000Z" });
      if (url === "https://mumo.test/api/provider-result-archive/job-1" && !init?.method) return Response.json({ sourceUrl: "https://8.8.8.8/image.png" });
      if (url === "https://8.8.8.8/image.png") return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      return Response.json({ ok: true });
    }) as typeof fetch;
    expect(await processOne("https://mumo.test", "service-token", fetchImpl, {
      thumbnailProcessor: async () => webp,
      sleep: async () => undefined,
    })).toBe(true);
    expect(calls[0].url).not.toContain("8.8.8.8");
    expect(calls.at(-1)?.init?.method).toBe("POST");
    expect(calls.at(-1)?.url).toEndWith("/job-1/thumbnail");
    expect(new Headers(calls.at(-1)?.init?.headers).get("content-type")).toBe("image/webp");
  });

  test("thumbnail failure is isolated after original archive success", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const events: unknown[] = [];
    const originalConsoleError = console.error;
    console.error = (event: unknown) => { events.push(event); };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/claim")) return Response.json({ archiveJobId: "job-1", generationTaskId: "task-1", mumoJobUrl: "https://mumo.test/api/provider-result-archive/job-1", archiveToken: "short-token", tokenExpiresAt: "2026-01-01T00:00:00.000Z" });
      if (url.endsWith("/job-1") && !init?.method) return Response.json({ sourceUrl: "https://8.8.8.8/image.png" });
      if (url === "https://8.8.8.8/image.png") return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      expect(await processOne("https://mumo.test", "service-token", fetchImpl, {
        thumbnailProcessor: async () => { throw new Error("fixture failure"); },
        now: () => new Date("2026-08-11T00:00:00.000Z"),
      })).toBe(true);
    } finally {
      console.error = originalConsoleError;
    }
    expect(calls.some((call) => call.url.endsWith("/job-1") && call.method === "POST")).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/fail"))).toBe(false);
    expect(events).toEqual([{
      event: "mumo_thumbnail_sidecar_failure_v1",
      taskId: "task-1",
      errorClass: "Error",
      timestamp: "2026-08-11T00:00:00.000Z",
    }]);
  });

  test("thumbnail upload retries three times without failing the archived original", async () => {
    let thumbnailAttempts = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/claim")) return Response.json({ archiveJobId: "job-1", generationTaskId: "task-1", mumoJobUrl: "https://mumo.test/api/provider-result-archive/job-1", archiveToken: "short-token", tokenExpiresAt: "2026-01-01T00:00:00.000Z" });
      if (url.endsWith("/job-1") && !init?.method) return Response.json({ sourceUrl: "https://8.8.8.8/image.png" });
      if (url === "https://8.8.8.8/image.png") return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      if (url.endsWith("/thumbnail")) { thumbnailAttempts += 1; return new Response(null, { status: 502 }); }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      expect(await processOne("https://mumo.test", "service-token", fetchImpl, {
        thumbnailProcessor: async () => webp,
        sleep: async () => undefined,
      })).toBe(true);
    } finally {
      console.error = originalConsoleError;
    }
    expect(thumbnailAttempts).toBe(3);
  });

  test("one-shot reports retryable network failures and loop stops cleanly", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/claim")) return Response.json({ archiveJobId: "job-1", generationTaskId: "task-1", mumoJobUrl: "https://mumo.test/api/provider-result-archive/job-1", archiveToken: "short-token", tokenExpiresAt: "2026-01-01T00:00:00.000Z" });
      if (url.endsWith("job-1")) return Response.json({ sourceUrl: "https://8.8.8.8/image.png" });
      throw new Error("network down");
    }) as typeof fetch;
    await processOne("https://mumo.test", "service-token", fetchImpl);
    expect(calls.at(-1)).toContain("/fail");
    let ticks = 0;
    const stop = startLoop(async () => { ticks += 1; return false; }, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    const stoppedAt = ticks;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(ticks).toBe(stoppedAt);
  });
});
