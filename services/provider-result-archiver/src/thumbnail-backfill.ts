import { MAX_BYTES } from "./archiver.js";
import { createHistoryThumbnail } from "./thumbnail.js";

export const THUMBNAIL_BACKFILL_CONCURRENCY = 2;
export const THUMBNAIL_BACKFILL_DEFAULT_LIMIT = 20;
export const THUMBNAIL_BACKFILL_MAX_LIMIT = 50;

type FetchLike = typeof fetch;

type ScanItem = { taskId: string; hasThumbnail: boolean };
type ScanResponse = {
  items: ScanItem[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

export type ThumbnailBackfillSummary = {
  mode: "dry-run" | "apply";
  eligible: number;
  already_has_thumbnail: number;
  missing_original: number;
  would_generate: number;
  generated: number;
  errors: number;
  nextCursor: string | null;
};

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("MUMO_BASE_URL_INVALID");
  }
  return url;
}

async function readOriginal(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("IMAGE_TOO_LARGE");
  return bytes;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      if (item !== undefined) await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function runThumbnailBackfill(
  baseUrl: string,
  serviceToken: string,
  options: { apply?: boolean; limit?: number; cursor?: string | null } = {},
  dependencies: { fetchImpl?: FetchLike; thumbnailProcessor?: (bytes: Uint8Array) => Promise<Uint8Array> } = {},
): Promise<ThumbnailBackfillSummary> {
  const base = normalizedBaseUrl(baseUrl);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const apply = options.apply === true;
  const limit = Math.min(
    THUMBNAIL_BACKFILL_MAX_LIMIT,
    Math.max(1, Math.floor(Number(options.limit ?? THUMBNAIL_BACKFILL_DEFAULT_LIMIT))),
  );
  const authHeaders = { authorization: `Bearer ${serviceToken}` };
  const scanResponse = await fetchImpl(new URL("/api/provider-result-archive/thumbnail-backfill", base), {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ limit, cursor: options.cursor ?? null }),
  });
  if (!scanResponse.ok) throw new Error("BACKFILL_SCAN_FAILED");
  const scan = await scanResponse.json() as ScanResponse;
  const summary: ThumbnailBackfillSummary = {
    mode: apply ? "apply" : "dry-run",
    eligible: scan.items.length,
    already_has_thumbnail: 0,
    missing_original: 0,
    would_generate: 0,
    generated: 0,
    errors: 0,
    nextCursor: scan.nextCursor,
  };

  await runWithConcurrency(scan.items, THUMBNAIL_BACKFILL_CONCURRENCY, async (item) => {
    if (item.hasThumbnail) {
      summary.already_has_thumbnail += 1;
      return;
    }
    const taskUrl = new URL(
      `/api/provider-result-archive/thumbnail-backfill/${encodeURIComponent(item.taskId)}`,
      base,
    );
    try {
      const probe = await fetchImpl(taskUrl, { method: "HEAD", headers: authHeaders });
      if (probe.status === 404) {
        summary.missing_original += 1;
        return;
      }
      if (!probe.ok) throw new Error("ORIGINAL_PROBE_FAILED");
      summary.would_generate += 1;
      if (!apply) return;

      const originalResponse = await fetchImpl(taskUrl, { method: "GET", headers: authHeaders });
      if (originalResponse.status === 404) {
        summary.missing_original += 1;
        return;
      }
      if (!originalResponse.ok) throw new Error("ORIGINAL_DOWNLOAD_FAILED");
      const original = await readOriginal(originalResponse);
      const thumbnail = await (dependencies.thumbnailProcessor ?? createHistoryThumbnail)(original);
      const upload = await fetchImpl(taskUrl, {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "image/webp",
          "content-length": String(thumbnail.byteLength),
        },
        body: thumbnail.buffer.slice(thumbnail.byteOffset, thumbnail.byteOffset + thumbnail.byteLength) as ArrayBuffer,
      });
      if (!upload.ok) throw new Error("THUMBNAIL_UPLOAD_FAILED");
      summary.generated += 1;
    } catch {
      summary.errors += 1;
    }
  });
  return summary;
}

export function parseThumbnailBackfillArgs(args: string[]): { apply: boolean; limit: number; cursor: string | null } {
  let apply = false;
  let limit = THUMBNAIL_BACKFILL_DEFAULT_LIMIT;
  let cursor: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--limit") limit = Number(args[++index]);
    else if (arg?.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    else if (arg === "--cursor") cursor = args[++index] ?? null;
    else if (arg?.startsWith("--cursor=")) cursor = arg.slice("--cursor=".length) || null;
    else throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > THUMBNAIL_BACKFILL_MAX_LIMIT) {
    throw new Error(`LIMIT_MUST_BE_1_TO_${THUMBNAIL_BACKFILL_MAX_LIMIT}`);
  }
  return { apply, limit, cursor };
}
