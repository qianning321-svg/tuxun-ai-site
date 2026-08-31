import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHistoryThumbnail } from "./thumbnail.js";

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 45_000;
export const POLL_INTERVAL_MS = 30_000;
export const THUMBNAIL_UPLOAD_ATTEMPTS = 3;
const THUMBNAIL_RETRY_DELAYS_MS = [250, 750] as const;

type FetchLike = typeof fetch;
type ThumbnailProcessor = (bytes: Uint8Array) => Promise<Uint8Array>;

function privateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function privateIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

export async function assertPublicHttpsUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("SSRF_URL_REJECTED");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) throw new Error("SSRF_HOST_REJECTED");
  const kind = isIP(hostname);
  if ((kind === 4 && privateIpv4(hostname)) || (kind === 6 && privateIpv6(hostname))) throw new Error("SSRF_IP_REJECTED");
  if (kind === 0) {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) => isIP(record.address) === 4 ? privateIpv4(record.address) : privateIpv6(record.address))) throw new Error("SSRF_DNS_REJECTED");
  }
  return url;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("IMAGE_TOO_LARGE");
  if (!response.body) throw new Error("DOWNLOAD_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) throw new Error("IMAGE_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function hasMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

export async function fetchSupplierImage(url: string, fetchImpl: FetchLike = fetch): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let current = await assertPublicHttpsUrl(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8", "user-agent": "mumo-provider-result-archiver/1" } });
    } catch (error) {
      throw Object.assign(new Error("DOWNLOAD_NETWORK"), { cause: error instanceof Error ? error.name : undefined });
    } finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === MAX_REDIRECTS) throw new Error("DOWNLOAD_REDIRECT_LIMIT");
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("DOWNLOAD_REDIRECT_INVALID");
      current = await assertPublicHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error("DOWNLOAD_HTTP"); }
    const mimeType = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
    if (!(mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp")) { await response.body?.cancel().catch(() => undefined); throw new Error("INVALID_MIME"); }
    const bytes = await readBounded(response);
    if (!hasMagic(bytes, mimeType)) throw new Error("INVALID_MIME");
    return { bytes, mimeType };
  }
  throw new Error("DOWNLOAD_REDIRECT_LIMIT");
}

function serviceUrl(baseUrl: string, path: string): string { return new URL(path, baseUrl).toString(); }

function assertMumoBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("MUMO_BASE_URL_INVALID");
  return url;
}

export type ClaimedJob = { archiveJobId: string; generationTaskId: string; mumoJobUrl: string; archiveToken: string; tokenExpiresAt: string };

export async function claimJob(baseUrl: string, serviceToken: string, fetchImpl: FetchLike = fetch): Promise<ClaimedJob | null> {
  const base = assertMumoBaseUrl(baseUrl);
  const response = await fetchImpl(serviceUrl(baseUrl, "/api/provider-result-archive/claim"), { method: "POST", headers: { authorization: `Bearer ${serviceToken}`, accept: "application/json" } });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error("CLAIM_FAILED");
  const body = await response.json() as { archiveJobId?: string; generationTaskId?: string; mumoJobUrl?: string; archiveToken?: string; tokenExpiresAt?: string };
  if (!body.archiveJobId || !body.generationTaskId || !body.mumoJobUrl || !body.archiveToken || !body.tokenExpiresAt) throw new Error("CLAIM_INVALID_RESPONSE");
  if (new URL(body.mumoJobUrl).origin !== base.origin) throw new Error("CLAIM_INVALID_RESPONSE");
  return body as ClaimedJob;
}

async function reportFailure(job: ClaimedJob, code: string, fetchImpl: FetchLike): Promise<void> {
  await fetchImpl(new URL("./fail", job.mumoJobUrl).toString(), { method: "POST", headers: { authorization: `MumoArchive ${job.archiveToken}`, "content-type": "application/json" }, body: JSON.stringify({ code }) });
}

async function uploadThumbnail(
  job: ClaimedJob,
  bytes: Uint8Array,
  fetchImpl: FetchLike,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const url = `${job.mumoJobUrl}/thumbnail`;
  for (let attempt = 0; attempt < THUMBNAIL_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `MumoArchive ${job.archiveToken}`,
          "content-type": "image/webp",
          "content-length": String(bytes.byteLength),
        },
        body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      });
      if (response.ok) return;
    } catch {}
    const delay = THUMBNAIL_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }
  throw new Error("THUMBNAIL_UPLOAD_FAILED");
}

function logThumbnailFailure(taskId: string, error: unknown, now: () => Date): void {
  console.error({
    event: "mumo_thumbnail_sidecar_failure_v1",
    taskId,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    timestamp: now().toISOString(),
  });
}

export async function processOne(
  baseUrl: string,
  serviceToken: string,
  fetchImpl: FetchLike = fetch,
  dependencies: {
    thumbnailProcessor?: ThumbnailProcessor;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
  } = {},
): Promise<boolean> {
  const job = await claimJob(baseUrl, serviceToken, fetchImpl);
  if (!job) return false;
  try {
    const metadataResponse = await fetchImpl(job.mumoJobUrl, { headers: { authorization: `MumoArchive ${job.archiveToken}`, accept: "application/json" } });
    if (!metadataResponse.ok) throw new Error("DOWNLOAD_HTTP");
    const metadata = await metadataResponse.json() as { sourceUrl?: string };
    if (!metadata.sourceUrl) throw new Error("UNKNOWN");
    const image = await fetchSupplierImage(metadata.sourceUrl, fetchImpl);
    const upload = await fetchImpl(job.mumoJobUrl, { method: "POST", headers: { authorization: `MumoArchive ${job.archiveToken}`, "content-type": image.mimeType, "content-length": String(image.bytes.byteLength) }, body: image.bytes.buffer as ArrayBuffer });
    if (!upload.ok) throw new Error("UPLOAD_FAILED");
    try {
      const thumbnail = await (dependencies.thumbnailProcessor ?? createHistoryThumbnail)(image.bytes);
      await uploadThumbnail(
        job,
        thumbnail,
        fetchImpl,
        dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      );
    } catch (error) {
      logThumbnailFailure(job.generationTaskId, error, dependencies.now ?? (() => new Date()));
    }
  } catch (error) {
    const code = error instanceof Error && ["DOWNLOAD_NETWORK", "DOWNLOAD_HTTP", "INVALID_MIME", "IMAGE_TOO_LARGE", "UPLOAD_FAILED"].includes(error.message) ? error.message : "UNKNOWN";
    await reportFailure(job, code, fetchImpl).catch(() => undefined);
  }
  return true;
}

export function startLoop(run: () => Promise<boolean>, intervalMs = POLL_INTERVAL_MS): () => void {
  let stopped = false;
  let running = false;
  const tick = () => {
    if (stopped || running) return;
    running = true;
    void run().catch(() => undefined).finally(() => { running = false; });
  };
  const timer = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
