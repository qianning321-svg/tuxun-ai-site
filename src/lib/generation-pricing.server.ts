import "@tanstack/react-start/server-only";

import type { D1Database } from "./d1";

export type GenerationMode = "text_to_image" | "image_to_image";

export type PricedModelConfig = {
  id: string;
  modelKey: string;
  displayName: string;
  provider: string;
  providerModel: string;
  costCredits: number;
  supportedModes: GenerationMode[];
  maxReferenceImages: number;
};

type ModelPricingRow = {
  id: string;
  model_key: string;
  display_name: string;
  provider: string;
  provider_model: string;
  cost_credits: number | string;
  is_enabled: number | string;
  supported_modes: string | null;
  max_reference_images: number | string;
};

export class GenerationPricingError extends Error {
  readonly code: "MODEL_UNAVAILABLE" | "MODEL_MODE_UNSUPPORTED" | "TOO_MANY_REFERENCE_IMAGES";

  constructor(code: GenerationPricingError["code"], message: string) {
    super(message);
    this.name = "GenerationPricingError";
    this.code = code;
  }
}

function parseSupportedModes(value: string | null): GenerationMode[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (mode): mode is GenerationMode => mode === "text_to_image" || mode === "image_to_image",
    );
  } catch {
    return [];
  }
}

export async function getGenerationQuote(
  db: D1Database,
  input: { modelKey: string; mode: GenerationMode; referenceImageCount: number },
): Promise<PricedModelConfig> {
  const row = await db
    .prepare(
      `SELECT id, model_key, display_name, provider, provider_model, cost_credits,
              is_enabled, supported_modes, max_reference_images
       FROM models_config WHERE model_key = ? LIMIT 1`,
    )
    .bind(input.modelKey)
    .first<ModelPricingRow>();
  if (!row || Number(row.is_enabled) !== 1) {
    throw new GenerationPricingError("MODEL_UNAVAILABLE", "所选模型当前不可用。");
  }

  const supportedModes = parseSupportedModes(row.supported_modes);
  if (!supportedModes.includes(input.mode)) {
    throw new GenerationPricingError("MODEL_MODE_UNSUPPORTED", "所选模型不支持当前生成模式。");
  }
  const maxReferenceImages = Number(row.max_reference_images);
  if (
    !Number.isInteger(maxReferenceImages) ||
    maxReferenceImages < 0 ||
    input.referenceImageCount > maxReferenceImages
  ) {
    throw new GenerationPricingError("TOO_MANY_REFERENCE_IMAGES", "参考图数量超过模型配置上限。");
  }

  const costCredits = Number(row.cost_credits);
  if (!Number.isSafeInteger(costCredits) || costCredits < 0) {
    throw new GenerationPricingError("MODEL_UNAVAILABLE", "模型价格配置无效。");
  }

  // Fixed model pricing today; quality/resolution/count rules can be added here later.
  return {
    id: row.id,
    modelKey: row.model_key,
    displayName: row.display_name,
    provider: row.provider.trim().toLowerCase(),
    providerModel: row.provider_model,
    costCredits,
    supportedModes,
    maxReferenceImages,
  };
}
