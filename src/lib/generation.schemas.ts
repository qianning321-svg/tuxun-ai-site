import { z } from "zod";

export const imageQualitySchema = z.enum(["1K", "2K", "4K"]);

export const providerReferenceImageSchema = z
  .object({
    bytes: z.instanceof(Uint8Array),
    filename: z.string().trim().min(1),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    supplierUrl: z.string().url().optional(),
  })
  .strict();

export const imageGenerationInputSchema = z
  .object({
    model: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    aspectRatio: z.string().trim().min(1),
    quality: imageQualitySchema,
    referenceImages: z.array(providerReferenceImageSchema).max(5),
    count: z.literal(1),
  })
  .strict();

export const providerTaskStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);

export const providerGenerationModeSchema = z.enum(["text-to-image", "image-to-image"]);

export const normalizedProviderImageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("url"),
      url: z.string().url(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("base64"),
      bytes: z.instanceof(Uint8Array),
      mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
    })
    .strict(),
]);

export const providerErrorCodeSchema = z.enum([
  "CONFIGURATION_ERROR",
  "INVALID_PROVIDER_INPUT",
  "TOO_MANY_REFERENCE_IMAGES",
  "UNSUPPORTED_PROVIDER_SIZE",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_HTTP_ERROR",
  "PROVIDER_REQUEST_REJECTED",
  "INVALID_PROVIDER_RESPONSE",
  "PROVIDER_TASK_FAILED",
  "EMPTY_PROVIDER_RESULT",
  "INVALID_PROVIDER_IMAGE",
  "INVALID_PROVIDER_BASE64",
]);

export const normalizedProviderErrorSchema = z
  .object({
    code: providerErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    providerCode: z.string().min(1).optional(),
  })
  .strict();

export const providerTaskCreatedSchema = z
  .object({
    taskId: z.string().min(1),
    mode: providerGenerationModeSchema,
    status: providerTaskStatusSchema,
  })
  .strict();

export const providerTaskResultSchema = z
  .object({
    taskId: z.string().min(1),
    status: providerTaskStatusSchema,
    images: z.array(normalizedProviderImageSchema),
    error: normalizedProviderErrorSchema.optional(),
  })
  .strict();

export type ImageQuality = z.infer<typeof imageQualitySchema>;
export type ProviderReferenceImage = z.infer<typeof providerReferenceImageSchema>;
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;
export type ProviderTaskStatus = z.infer<typeof providerTaskStatusSchema>;
export type ProviderGenerationMode = z.infer<typeof providerGenerationModeSchema>;
export type NormalizedProviderImage = z.infer<typeof normalizedProviderImageSchema>;
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;
export type NormalizedProviderError = z.infer<typeof normalizedProviderErrorSchema>;
export type ProviderTaskCreated = z.infer<typeof providerTaskCreatedSchema>;
export type ProviderTaskResult = z.infer<typeof providerTaskResultSchema>;
