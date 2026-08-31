export async function retryOnce<T>(operation: () => Promise<T>, delayMs = 750): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return operation().catch(() => {
      throw error;
    });
  }
}

export async function fetchWithNetworkRetry(input: RequestInfo | URL, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  return retryOnce(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  });
}
