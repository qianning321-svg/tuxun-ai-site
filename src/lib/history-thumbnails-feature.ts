export const HISTORY_THUMBNAILS_FEATURE_FLAG = "MUMO_ENABLE_HISTORY_THUMBNAILS";

export function historyThumbnailsEnabled(
  env: { MUMO_ENABLE_HISTORY_THUMBNAILS?: unknown } | null | undefined,
): boolean {
  return env?.MUMO_ENABLE_HISTORY_THUMBNAILS === "true";
}
