import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

function sameOriginServerFnFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> {
  if (typeof window === "undefined") return fetch(input, init);

  try {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : null;
    if (!url) return fetch(input, init);

    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/_serverFn/") && parsed.origin !== window.location.origin) {
      return fetch(`${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`, init);
    }
  } catch {
    // Fall through to the original URL if parsing ever fails.
  }

  return fetch(input, init);
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [],
  serverFns: {
    fetch: sameOriginServerFnFetch,
  },
}));
