import type { D1Database } from "./lib/d1";

export interface VibeLearningImageEnv {
  readonly VIBELEARNING_IMAGE_API_BASE_URL?: string;
  readonly VIBELEARNING_IMAGE_API_KEY?: string;
}

export interface WuyinkejiImageEnv {
  readonly WUYINKEJI_API_BASE_URL?: string;
  readonly WUYINKEJI_API_KEY?: string;
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get?(key: string): Promise<{
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
    size?: number;
    httpMetadata?: { contentType?: string };
  } | null>;
  head?(key: string): Promise<{
    size?: number;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete?(key: string): Promise<unknown>;
}

export interface ImagesBindingLike {
  input(source: ReadableStream): {
    transform(options: {
      background?: string;
      width?: number;
      height?: number;
      fit?: "scale-down";
    }): {
      output(options: { format: "image/jpeg" | "image/webp"; quality: number; anim: false }): Promise<{
        response(): Response;
      }>;
    };
  };
}

export interface MumoCloudflareEnv extends VibeLearningImageEnv, WuyinkejiImageEnv {
  readonly MUMO_DB?: D1Database;
  readonly MUMO_GENERATED_IMAGES?: R2BucketLike;
  readonly IMAGES?: ImagesBindingLike;
  readonly MUMO_ENABLE_REAL_IMAGE_PROVIDERS?: "true" | "false";
  readonly MUMO_ENABLE_HISTORY_THUMBNAILS?: "true" | "false";
  readonly MUMO_PROVIDER_CREDENTIALS_MASTER_KEY_V1?: string;
  readonly MUMO_PROVIDER_INPUT_SIGNING_KEY_V1?: string;
  readonly MUMO_PROVIDER_ARCHIVE_SIGNING_KEY_V1?: string;
  readonly MUMO_ARCHIVER_SERVICE_TOKEN_V1?: string;
  readonly MUMO_PUBLIC_ORIGIN?: string;
  readonly R2_PUBLIC_BASE_URL?: string;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly VIBELEARNING_IMAGE_API_BASE_URL?: string;
      readonly VIBELEARNING_IMAGE_API_KEY?: string;
      readonly WUYINKEJI_API_BASE_URL?: string;
      readonly WUYINKEJI_API_KEY?: string;
    }
  }
}
