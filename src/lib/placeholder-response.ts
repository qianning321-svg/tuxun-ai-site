export function jsonResponse(payload: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

export function apiError(code: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, code, message }, status);
}

export function migrationPending(feature: string): Response {
  return jsonResponse(
    {
      ok: false,
      code: "D1_MIGRATION_PENDING",
      message: `${feature} is not implemented: D1 migration pending`,
    },
    501,
  );
}
