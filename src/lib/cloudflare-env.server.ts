import "@tanstack/react-start/server-only";

import type { MumoCloudflareEnv } from "../env";

const NON_BLANK_SECRET_KEYS = [
  "WUYINKEJI_API_KEY",
  "VIBELEARNING_IMAGE_API_KEY",
  "MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1",
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function nonBlankValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Merge request/global bindings without allowing absent or blank secrets to erase a valid binding. */
export function mergeCloudflareEnv(...sources: unknown[]): MumoCloudflareEnv {
  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(asRecord(source))) {
      if (value !== undefined) merged[key] = value;
    }
  }

  for (const key of NON_BLANK_SECRET_KEYS) {
    const selected = [...sources].reverse()
      .map((source) => nonBlankValue(asRecord(source)[key]))
      .find((value): value is string => value !== undefined);
    if (selected === undefined) delete merged[key];
    else merged[key] = selected;
  }

  return merged as MumoCloudflareEnv;
}
