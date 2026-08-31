import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, requestOpts?: unknown, ctx?: unknown) => Promise<Response> | Response;
};

const CLOUDFLARE_ENV_GLOBAL_KEY = "__MUMO_CLOUDFLARE_ENV__";

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function logWorkerEnvEntryDiagnostic(request: Request, env: unknown): void {
  let pathname = "";

  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return;
  }

  if (request.method !== "POST" || !pathname.startsWith("/_serverFn/")) {
    return;
  }

  const envRecord =
    env && typeof env === "object"
      ? (env as Record<string, unknown>)
      : {};

  const wuyinkejiKey = envRecord.WUYINKEJI_API_KEY;
  const realProvidersFlag = envRecord.MUMO_ENABLE_REAL_IMAGE_PROVIDERS;

  console.error({
    event: "mumo_worker_env_entry_v1",
    diagnosticRevision: "worker-env-entry-v1",
    hasEnvObject: !!env && typeof env === "object",

    wuyinkejiHasKeyProperty: Object.prototype.hasOwnProperty.call(
      envRecord,
      "WUYINKEJI_API_KEY",
    ),
    wuyinkejiValueType: typeof wuyinkejiKey,
    wuyinkejiHasNonBlankKey:
      typeof wuyinkejiKey === "string" &&
      wuyinkejiKey.trim().length > 0,

    realProvidersHasProperty: Object.prototype.hasOwnProperty.call(
      envRecord,
      "MUMO_ENABLE_REAL_IMAGE_PROVIDERS",
    ),
    realProvidersValueType: typeof realProvidersFlag,
    realProvidersEnabledExactTrue: realProvidersFlag === "true",
  });
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      logWorkerEnvEntryDiagnostic(request, env);

      (globalThis as Record<string, unknown>)[CLOUDFLARE_ENV_GLOBAL_KEY] = env;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, {
        context: {
          cloudflare: { env, ctx },
        },
      });
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
