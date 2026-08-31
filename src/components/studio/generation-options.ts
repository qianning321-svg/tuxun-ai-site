export type GenerationQuality = "1K" | "2K" | "4K";

export type GenerationParameters = {
  model: string;
  aspectRatio: string;
  quality: GenerationQuality;
  costCredits: number;
};

export type ReferenceImageAsset = {
  localPreviewUrl: string;
  uploadRequestId: string;
  assetId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "error";
  uploadPhase?: "processing" | "uploading";
  persisted?: boolean;
  errorMessage?: string;
};

export type ReferenceImageUploadResult = {
  assetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type ReferenceImageSlot = ReferenceImageAsset | null;

export function getReadyReferenceImageIds(images: readonly ReferenceImageSlot[]): string[] {
  return images
    .flatMap((asset) => (asset?.status === "ready" && asset.assetId ? [asset.assetId] : []))
    .slice(0, 5);
}

export function createPersistedReferenceImageSlots(
  referenceImageIds: readonly string[],
  slotCount = 5,
): ReferenceImageSlot[] {
  const ids = referenceImageIds
    .filter((assetId): assetId is string => typeof assetId === "string" && !!assetId.trim())
    .map((assetId) => assetId.trim())
    .slice(0, slotCount);
  return Array.from({ length: slotCount }, (_, index) => {
    const assetId = ids[index];
    if (!assetId) return null;
    return {
      localPreviewUrl: `/api/uploads/input-image?assetId=${encodeURIComponent(assetId)}`,
      uploadRequestId: `persisted:${assetId}`,
      assetId,
      filename: `reference-${index + 1}`,
      mimeType: "image/*",
      sizeBytes: 0,
      status: "ready",
      persisted: true,
    };
  });
}

export function applyReferenceImageUploadSuccess(
  images: readonly ReferenceImageSlot[],
  index: number,
  uploadRequestId: string,
  result: ReferenceImageUploadResult,
): ReferenceImageSlot[] {
  return images.map((asset, slot) =>
    slot === index && asset?.status === "uploading" && asset.uploadRequestId === uploadRequestId
      ? {
          ...asset,
          ...result,
          status: "ready",
          uploadPhase: undefined,
          errorMessage: undefined,
        }
      : asset,
  );
}

export function removeReferenceImageAt(
  images: readonly ReferenceImageSlot[],
  index: number,
): ReferenceImageSlot[] {
  return images.map((asset, slot) => (slot === index ? null : asset));
}

export type GenerationSubmission = {
  prompt: string;
  referenceImageIds: string[];
  parameters: GenerationParameters;
};

export type GenerationPrefill = GenerationSubmission & {
  nonce: number;
};

export type GenerationInputParameters = {
  aspectRatio: string;
  quality: GenerationQuality;
  referenceImageIds: string[];
  costCredits: number;
};

export type ModelOption = {
  value: string;
  name: string;
  tag: string;
  tagClassName: string;
  badgeVariant?: ModelBadgeVariant;
  badgeColor?: string;
  badgeTextColor?: string;
  costCredits: number;
  description: string;
  summary: string;
  recommended?: boolean;
  supportedQualities: readonly GenerationQuality[];
  supportedAspectRatios: readonly string[];
  supportsReferenceImages: boolean;
  enabled?: boolean;
};

export type ModelBadgeVariant = "red" | "green" | "amber" | "blue" | "purple" | "gray";
export type ModelDisplayConfig = {
  model_key: string;
  display_name: string;
  cost_credits: number | string;
  sort_order: number | string;
  description?: string | null;
  badge_label?: string | null;
  badge_variant?: string | null;
  badge_color?: string | null;
  badge_text_color?: string | null;
};

export type ParameterOption<T extends string = string> = {
  value: T;
  label: string;
  description: string;
  previewWidth?: number;
  previewHeight?: number;
};

export const MODEL_OPTIONS: ModelOption[] = [
  {
    value: "gpt-image-2-pro",
    name: "GPT-IMAGE-2.0 Pro",
    tag: "",
    tagClassName: "",
    costCredits: 28,
    description: "OPENAI 最新图像模型 · 2K / 4K 在线",
    summary: "旗舰推荐模型",
    recommended: true,
    supportedQualities: ["1K", "2K", "4K"],
    supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3", "5:4", "4:5"],
    supportsReferenceImages: true,
  },
  {
    value: "nano-banana",
    name: "Nano Banana",
    tag: "",
    tagClassName: "",
    costCredits: 15,
    description: "快速文生图，仅支持 1K",
    summary: "仅支持文生图与 1K",
    supportedQualities: ["1K"],
    supportedAspectRatios: ["1:1", "auto", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
    supportsReferenceImages: true,
  },
  {
    value: "nano-banana-pro",
    name: "Nano Banana Pro",
    tag: "",
    tagClassName: "",
    costCredits: 45,
    description: "高质量文生图，支持 1K / 2K / 4K",
    summary: "仅支持文生图",
    supportedQualities: ["1K", "2K", "4K"],
    supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
    supportsReferenceImages: true,
  },
  {
    value: "nano-banana-2",
    name: "Nano Banana 2",
    tag: "",
    tagClassName: "",
    costCredits: 15,
    description: "新一代文生图，支持 1K / 2K / 4K",
    summary: "仅支持文生图",
    supportedQualities: ["1K", "2K", "4K"],
    supportedAspectRatios: ["1:1", "auto", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1:4", "1:8", "4:1", "8:1"],
    supportsReferenceImages: true,
  },
  {
    value: "gpt-image-2-vip",
    name: "GPT Image 2",
    tag: "",
    tagClassName: "",
    costCredits: 15,
    description: "文生图，仅支持 1K",
    summary: "仅支持文生图与 1K",
    supportedQualities: ["1K"],
    supportedAspectRatios: ["1:1", "auto", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"],
    supportsReferenceImages: true,
  },
  {
    value: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    tag: "",
    tagClassName: "",
    costCredits: 0,
    description: "轻量文生图，仅支持 1K",
    summary: "等待服务端价格配置",
    supportedQualities: ["1K"],
    supportedAspectRatios: ["1:1", "auto", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
    supportsReferenceImages: true,
    enabled: false,
  },
];

const MODEL_BADGE_VARIANTS = new Set<ModelBadgeVariant>(["red", "green", "amber", "blue", "purple", "gray"]);

export function normalizeModelBadgeColor(value: unknown): string | undefined {
  const color = typeof value === "string" ? value.trim() : "";
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return undefined;
  const hex = color.slice(1);
  return `#${(hex.length === 3 ? hex.split("").map((part) => `${part}${part}`).join("") : hex).toUpperCase()}`;
}

export function getModelBadgeColorStyle(backgroundValue: unknown, textValue?: unknown): { backgroundColor?: string; borderColor?: string; color: string } | undefined {
  const backgroundColor = normalizeModelBadgeColor(backgroundValue);
  const configuredTextColor = normalizeModelBadgeColor(textValue);
  if (!backgroundColor) return configuredTextColor ? { color: configuredTextColor } : undefined;
  const weights = [0.2126, 0.7152, 0.0722];
  const luminance = [1, 3, 5].reduce((sum, offset, index) => {
    const channel = Number.parseInt(backgroundColor.slice(offset, offset + 2), 16) / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * weights[index];
  }, 0);
  return { backgroundColor, borderColor: backgroundColor, color: configuredTextColor ?? (luminance > 0.179 ? "#000000" : "#FFFFFF") };
}

export function mergeModelDisplayConfigs(configs: readonly ModelDisplayConfig[]): ModelOption[] {
  const safeOptions = new Map(MODEL_OPTIONS.filter((option) => option.enabled !== false).map((option) => [option.value, option]));
  const merged: ModelOption[] = [];

  for (const config of configs) {
    const base = safeOptions.get(config.model_key);
    if (!base) continue;
    const badgeVariant = typeof config.badge_variant === "string" && MODEL_BADGE_VARIANTS.has(config.badge_variant as ModelBadgeVariant)
      ? config.badge_variant as ModelBadgeVariant
      : undefined;
    const badgeLabel = typeof config.badge_label === "string" ? config.badge_label.trim() : "";
    const badgeColor = normalizeModelBadgeColor(config.badge_color);
    const badgeTextColor = normalizeModelBadgeColor(config.badge_text_color);
    merged.push({
      ...base,
      name: typeof config.display_name === "string" && config.display_name.trim() ? config.display_name.trim() : base.name,
      costCredits: Number.isSafeInteger(Number(config.cost_credits)) && Number(config.cost_credits) >= 0 ? Number(config.cost_credits) : base.costCredits,
      description: typeof config.description === "string" && config.description.trim() ? config.description.trim() : base.description,
      tag: badgeLabel,
      badgeVariant: badgeLabel ? badgeVariant : undefined,
      badgeColor: badgeLabel ? badgeColor : undefined,
      badgeTextColor: badgeLabel ? badgeTextColor : undefined,
      tagClassName: "",
      recommended: false,
    });
  }

  return merged;
}

export const ASPECT_RATIO_OPTIONS: ParameterOption[] = [
  { value: "auto", label: "auto", description: "自动", previewWidth: 22, previewHeight: 22 },
  { value: "1:1", label: "1:1", description: "方形", previewWidth: 22, previewHeight: 22 },
  { value: "16:9", label: "16:9", description: "横版", previewWidth: 34, previewHeight: 19 },
  { value: "9:16", label: "9:16", description: "竖版", previewWidth: 16, previewHeight: 28 },
  { value: "4:3", label: "4:3", description: "横版", previewWidth: 32, previewHeight: 24 },
  { value: "3:4", label: "3:4", description: "竖版", previewWidth: 21, previewHeight: 28 },
  { value: "21:9", label: "21:9", description: "影院", previewWidth: 36, previewHeight: 15 },
  { value: "3:2", label: "3:2", description: "横版", previewWidth: 32, previewHeight: 21 },
  { value: "2:3", label: "2:3", description: "竖版", previewWidth: 19, previewHeight: 28 },
  { value: "5:4", label: "5:4", description: "横版", previewWidth: 31, previewHeight: 25 },
  { value: "4:5", label: "4:5", description: "竖版", previewWidth: 22, previewHeight: 28 },
];

export const ASPECT_RATIO_OPTIONS_EXTENDED: ParameterOption[] = [
  ...ASPECT_RATIO_OPTIONS,
  { value: "1:4", label: "1:4", description: "超窄竖版", previewWidth: 12, previewHeight: 32 },
  { value: "1:8", label: "1:8", description: "超窄竖版", previewWidth: 8, previewHeight: 32 },
  { value: "4:1", label: "4:1", description: "超宽横版", previewWidth: 32, previewHeight: 12 },
  { value: "8:1", label: "8:1", description: "超宽横版", previewWidth: 32, previewHeight: 8 },
];

export const QUALITY_OPTIONS: ParameterOption<GenerationQuality>[] = [
  { value: "1K", label: "1K", description: "标准输出" },
  { value: "2K", label: "2K", description: "高清输出" },
  { value: "4K", label: "4K", description: "超清输出" },
];

export function getDefaultQualityForModel(model: ModelOption): GenerationQuality {
  return model.supportedQualities.includes("1K") ? "1K" : model.supportedQualities[0];
}

export const DEFAULT_GENERATION_PARAMETERS: GenerationParameters = {
  model: MODEL_OPTIONS[0].value,
  aspectRatio: "1:1",
  quality: getDefaultQualityForModel(MODEL_OPTIONS[0]),
  costCredits: MODEL_OPTIONS[0].costCredits,
};

export function getModelOption(model: string | null | undefined, options: readonly ModelOption[] = MODEL_OPTIONS): ModelOption {
  const available = options.length ? options : MODEL_OPTIONS;
  const configured = available.find((option) => option.value === model);
  if (configured || !model) return configured ?? available[0];

  return {
    ...available[0],
    value: model,
    name: model,
    tag: "历史任务",
    tagClassName: "border-slate-400/20 bg-slate-400/10 text-slate-600 dark:text-slate-300",
    description: "从历史任务恢复的模型配置",
    summary: "已恢复任务模型",
    recommended: false,
    supportedQualities: available[0].supportedQualities,
    supportedAspectRatios: available[0].supportedAspectRatios,
    supportsReferenceImages: available[0].supportsReferenceImages,
  };
}

export function normalizeGenerationParametersForModel(parameters: GenerationParameters, options: readonly ModelOption[] = MODEL_OPTIONS): GenerationParameters {
  const model = getModelOption(parameters.model, options);
  const quality = model.supportedQualities.includes(parameters.quality)
    ? parameters.quality
    : getDefaultQualityForModel(model);
  const aspectRatio = model.supportedAspectRatios.includes(parameters.aspectRatio)
    ? parameters.aspectRatio
    : model.supportedAspectRatios[0];
  return { ...parameters, quality, aspectRatio, costCredits: model.costCredits };
}

export function selectGenerationModel(
  parameters: GenerationParameters,
  modelKey: string,
  options: readonly ModelOption[] = MODEL_OPTIONS,
): GenerationParameters {
  const model = getModelOption(modelKey, options);
  if (model.value === parameters.model) {
    return normalizeGenerationParametersForModel(parameters, options);
  }
  return normalizeGenerationParametersForModel({
    ...parameters,
    model: model.value,
    quality: getDefaultQualityForModel(model),
    costCredits: model.costCredits,
  }, options);
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

type GenerationInputParameterCandidate = {
  aspectRatio?: unknown;
  quality?: unknown;
  referenceImageIds?: unknown;
  costCredits?: unknown;
};

function getInputParameterCandidate(inputParams: unknown): GenerationInputParameterCandidate {
  return inputParams && typeof inputParams === "object"
    ? (inputParams as GenerationInputParameterCandidate)
    : {};
}

export function getReferenceImageIds(inputParams: unknown): string[] {
  const candidate = getInputParameterCandidate(inputParams).referenceImageIds;
  if (!Array.isArray(candidate)) return [];
  return candidate
    .filter((assetId): assetId is string => typeof assetId === "string" && !!assetId.trim())
    .map((assetId) => assetId.trim())
    .slice(0, 5);
}

export function restoreGenerationParameters(
  modelKey?: string,
  inputParams?: unknown,
): GenerationParameters {
  const candidate = getInputParameterCandidate(inputParams);
  const model = getModelOption(modelKey);
  const qualityValue = getString(candidate.quality, DEFAULT_GENERATION_PARAMETERS.quality);
  const quality = model.supportedQualities.includes(qualityValue as GenerationQuality)
    ? (qualityValue as GenerationQuality)
    : model.supportedQualities[0];
  const clientCost = candidate.costCredits;

  return {
    model: model.value,
    aspectRatio: model.supportedAspectRatios.includes(getString(candidate.aspectRatio, DEFAULT_GENERATION_PARAMETERS.aspectRatio))
      ? getString(candidate.aspectRatio, DEFAULT_GENERATION_PARAMETERS.aspectRatio)
      : model.supportedAspectRatios[0],
    // Concrete pixels will be derived server-side from aspectRatio + quality.
    quality,
    costCredits:
      typeof clientCost === "number" && Number.isFinite(clientCost)
        ? clientCost
        : model.costCredits,
  };
}

export function restoreGenerationInputParameters(
  modelKey?: string,
  inputParams?: unknown,
): GenerationInputParameters {
  const parameters = restoreGenerationParameters(modelKey, inputParams);
  return {
    aspectRatio: parameters.aspectRatio,
    quality: parameters.quality,
    referenceImageIds: getReferenceImageIds(inputParams),
    costCredits: parameters.costCredits,
  };
}
