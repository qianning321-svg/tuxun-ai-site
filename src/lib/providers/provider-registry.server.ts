import "@tanstack/react-start/server-only";

import type { ImageProvider, ImageQuality, ProviderGenerationMode } from "./image-provider.server";
import { MockImageProvider } from "./mock-image.server";
import type { D1Database } from "../d1";
import type { MumoCloudflareEnv } from "../../env";
import { resolveProviderRuntimeCredential } from "../provider-credentials.server";
import { VibeLearningImageProvider } from "./vibelearning-image.server";
import { WuyinkejiImageProvider } from "./wuyinkeji-image.server";

export type ImageProviderKey = "mock" | "vibelearning" | "wuyinkeji";

export class ProviderRegistryError extends Error {
  readonly code: "UNKNOWN_PROVIDER" | "REAL_PROVIDER_DISABLED" | "UNSUPPORTED_PROVIDER_INPUT";

  constructor(code: ProviderRegistryError["code"], message: string) {
    super(message);
    this.name = "ProviderRegistryError";
    this.code = code;
  }
}

type ProviderFactory = () => ImageProvider;
type RuntimeProviderFactory = (context: { db: D1Database; env?: MumoCloudflareEnv; fetchImpl?: typeof fetch }) => Promise<ImageProvider>;

export class ImageProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();
  private readonly runtimeFactories = new Map<string, RuntimeProviderFactory>();

  constructor(private readonly allowRealProviders = false) {}

  register(key: string, factory: ProviderFactory): this {
    this.factories.set(key, factory);
    return this;
  }

  registerRuntime(key: string, factory: RuntimeProviderFactory): this {
    this.runtimeFactories.set(key.trim().toLowerCase(), factory);
    return this;
  }

  get(key: string): ImageProvider {
    const normalizedKey = key.trim().toLowerCase();
    const factory = this.factories.get(normalizedKey);
    if (!factory) {
      throw new ProviderRegistryError("UNKNOWN_PROVIDER", "模型供应商配置无效。");
    }
    if (normalizedKey !== "mock" && !this.allowRealProviders) {
      throw new ProviderRegistryError("REAL_PROVIDER_DISABLED", "真实图片供应商尚未启用。");
    }
    return factory();
  }

  async getRuntime(key: string, context: { db: D1Database; env?: MumoCloudflareEnv; fetchImpl?: typeof fetch }): Promise<ImageProvider> {
    const normalizedKey = key.trim().toLowerCase();
    const provider = this.get(normalizedKey);
    const runtimeFactory = this.runtimeFactories.get(normalizedKey);
    return runtimeFactory ? runtimeFactory(context) : provider;
  }
}

export function validateProviderCapabilities(
  provider: ImageProvider,
  input: {
    mode: ProviderGenerationMode;
    referenceImageCount: number;
    aspectRatio: string;
    quality: ImageQuality;
  },
): void {
  if (!provider.capabilities.modes.includes(input.mode)) {
    throw new ProviderRegistryError("UNSUPPORTED_PROVIDER_INPUT", "供应商不支持当前生成模式。");
  }
  if (
    provider.capabilities.maxReferenceImages !== undefined &&
    input.referenceImageCount > provider.capabilities.maxReferenceImages
  ) {
    throw new ProviderRegistryError("UNSUPPORTED_PROVIDER_INPUT", "参考图数量超过供应商能力。");
  }
  if (
    provider.capabilities.aspectRatios &&
    !provider.capabilities.aspectRatios.includes(input.aspectRatio)
  ) {
    throw new ProviderRegistryError("UNSUPPORTED_PROVIDER_INPUT", "供应商不支持当前画面比例。");
  }
  if (provider.capabilities.qualities && !provider.capabilities.qualities.includes(input.quality)) {
    throw new ProviderRegistryError("UNSUPPORTED_PROVIDER_INPUT", "供应商不支持当前清晰度。");
  }
}

export function createDefaultProviderRegistry(
  options: {
    allowRealProviders?: boolean;
    mockProvider?: ImageProvider;
    vibelearningFactory?: ProviderFactory;
    wuyinkejiFactory?: ProviderFactory;
  } = {},
): ImageProviderRegistry {
  const registry = new ImageProviderRegistry(options.allowRealProviders ?? false);
  registry.register("mock", () => options.mockProvider ?? new MockImageProvider());
  registry.register("vibelearning", () => {
    if (options.vibelearningFactory) return options.vibelearningFactory();
    return new VibeLearningImageProvider();
  });
  if (!options.vibelearningFactory) {
    registry.registerRuntime("vibelearning", async ({ db, env, fetchImpl }) => {
      const credential = await resolveProviderRuntimeCredential(db, "vibelearning", env);
      return new VibeLearningImageProvider({
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
        env,
        fetchImpl,
      });
    });
  }
  registry.register("wuyinkeji", () => {
    if (options.wuyinkejiFactory) return options.wuyinkejiFactory();
    return new WuyinkejiImageProvider();
  });
  if (!options.wuyinkejiFactory) {
    registry.registerRuntime("wuyinkeji", async ({ db, env, fetchImpl }) => {
      const credential = await resolveProviderRuntimeCredential(db, "wuyinkeji", env);
      return new WuyinkejiImageProvider({
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
        env,
        fetchImpl,
      });
    });
  }
  return registry;
}
