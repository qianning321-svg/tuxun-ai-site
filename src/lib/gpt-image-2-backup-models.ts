export const GPT_IMAGE_2_BACKUP_MODEL_KEY = "gpt_image_2_backup";
export const GPT_IMAGE_2_NATIVE_PRO_MODEL_KEY = "gpt_image_2_native_pro";
export const GPT_IMAGE_2_NATIVE_PRO_IMAGE_EDIT_UNSUPPORTED_MESSAGE =
  "GPT-image2-原生PRO 图生图耗时较长，暂未开放，请移除参考图后使用文生图。";

const GPT_IMAGE_2_BACKUP_MODEL_KEYS = new Set<string>([
  GPT_IMAGE_2_BACKUP_MODEL_KEY,
  GPT_IMAGE_2_NATIVE_PRO_MODEL_KEY,
]);

export function isGptImage2BackupModel(modelKey: unknown): boolean {
  return typeof modelKey === "string" && GPT_IMAGE_2_BACKUP_MODEL_KEYS.has(modelKey);
}

export function isGptImage2NativeProModel(modelKey: unknown): boolean {
  return modelKey === GPT_IMAGE_2_NATIVE_PRO_MODEL_KEY;
}
