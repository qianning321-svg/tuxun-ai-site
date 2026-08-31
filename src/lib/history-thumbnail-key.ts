export const HISTORY_THUMBNAIL_VERSION = "v1";

export function generatedThumbnailKey(userId: string, taskId: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `generated-thumbs/${safeUserId}/${safeTaskId}/${HISTORY_THUMBNAIL_VERSION}.webp`;
}
