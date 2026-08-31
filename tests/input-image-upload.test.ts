import { describe, expect, test } from "bun:test";

import type { R2BucketLike } from "../src/env";
import type { AuthSession } from "../src/lib/auth";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/lib/d1";
import {
  deleteInputImageAsset,
  deleteInputImageAssetFromRequest,
  getInputImageAssetForUser,
  getInputImageAssetFromRequest,
  INPUT_IMAGE_EXPIRY_CLEANUP_CONDITION,
  INPUT_IMAGE_EXPIRY_HOURS,
  InputImageUploadError,
  MAX_INPUT_IMAGE_BYTES,
  storeInputImageAsset,
  uploadInputImageFromRequest,
  validateInputImageFile,
  type InputImageUploadDependencies,
} from "../src/lib/input-image.server";
import {
  applyReferenceImageUploadSuccess,
  getReadyReferenceImageIds,
  removeReferenceImageAt,
  type ReferenceImageAsset,
} from "../src/components/studio/generation-options";

const AUTH_SESSION: AuthSession = {
  user: { id: "user-123", email: "user@example.test" },
  profile: {
    id: "user-123",
    email: "user@example.test",
    display_name: "Test User",
    avatar_url: null,
    credits: 0,
  },
};

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00];
const WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

type MockStorage = {
  bucket: R2BucketLike;
  db: D1Database;
  putKeys: string[];
  deletedKeys: string[];
  boundValues: unknown[][];
  events: string[];
  getAssetStatus: () => string | undefined;
};

type MockAssetRecord = {
  id: string;
  userId: string;
  r2Key: string;
  status: "ready" | "consumed" | "expired" | "deleted";
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  expiresAt?: string | null;
};

type MockStorageOptions = {
  failInsert?: boolean;
  failR2Delete?: boolean;
  omitUpdateChanges?: boolean;
  updateChanges?: number;
  statusOnUpdate?: MockAssetRecord["status"];
  asset?: MockAssetRecord;
};

function imageFile(bytes: readonly number[], filename: string, mimeType: string): File {
  const body = Uint8Array.from(bytes).buffer;
  return new File([body], filename, { type: mimeType });
}

function createMockStorage(options: MockStorageOptions = {}): MockStorage {
  const putKeys: string[] = [];
  const deletedKeys: string[] = [];
  const boundValues: unknown[][] = [];
  const events: string[] = [];
  const asset = options.asset ? { ...options.asset } : undefined;

  const db: D1Database = {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...values: unknown[]) {
          bindings = values;
          boundValues.push(values);
          return statement;
        },
        async first<T>() {
          if (
            query.includes("FROM uploaded_images") &&
            asset?.id === bindings[0] &&
            asset.userId === bindings[1]
          ) {
            return {
              id: asset.id,
              r2_key: asset.r2Key,
              status: asset.status,
              mime_type: asset.mimeType ?? "image/png",
              expires_at: asset.expiresAt ?? null,
            } as T;
          }
          return null;
        },
        async all<T>() {
          return { results: [] as T[], success: true };
        },
        async run<T>() {
          if (query.includes("INSERT INTO uploaded_images") && options.failInsert) {
            throw new Error("mock D1 insert failure");
          }
          if (query.includes("UPDATE uploaded_images")) {
            events.push("d1:update");
            if (options.statusOnUpdate && asset) {
              asset.status = options.statusOnUpdate;
            }
            const requestedChanges = options.updateChanges ?? 1;
            const changes =
              asset?.id === bindings[0] &&
              asset.userId === bindings[1] &&
              asset.status === "ready" &&
              requestedChanges > 0
                ? requestedChanges
                : 0;
            if (changes > 0 && asset) {
              asset.status = "deleted";
            }
            return {
              results: [] as T[],
              success: true,
              ...(options.omitUpdateChanges ? {} : { meta: { changes } }),
            };
          }
          return { results: [] as T[], success: true };
        },
        async raw<T>() {
          return [] as T[];
        },
      };
      return statement;
    },
    async batch<T>() {
      return [] as Array<D1Result<T>>;
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };

  const bucket: R2BucketLike = {
    async put(key) {
      putKeys.push(key);
    },
    async delete(key) {
      events.push("r2:delete");
      deletedKeys.push(key);
      if (options.failR2Delete) {
        throw new Error(`mock R2 delete failure for ${key}`);
      }
    },
    async get(key) {
      if (!asset || key !== asset.r2Key) return null;
      const bytes = Uint8Array.from(PNG_BYTES);
      return {
        body: new Blob([bytes]).stream(),
        arrayBuffer: async () => bytes.buffer,
        size: bytes.byteLength,
        httpMetadata: { contentType: asset.mimeType ?? "image/png" },
      };
    },
  };

  return {
    bucket,
    db,
    putKeys,
    deletedKeys,
    boundValues,
    events,
    getAssetStatus: () => asset?.status,
  };
}

function authenticatedDependencies(storage: MockStorage): InputImageUploadDependencies {
  return {
    bucket: storage.bucket,
    db: storage.db,
    authenticate: async () => AUTH_SESSION,
    createAssetId: () => "asset-123",
    now: () => new Date("2026-07-14T00:00:00.000Z"),
  };
}

function uploadRequest(file: File): Request {
  const formData = new FormData();
  formData.append("image", file, file.name);
  return new Request("https://mumo.example/api/uploads/input-image", {
    method: "POST",
    body: formData,
  });
}

function deleteRequest(assetId: string): Request {
  return new Request("https://mumo.example/api/uploads/input-image", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId }),
  });
}

describe("input image validation", () => {
  test("accepts a PNG magic signature", async () => {
    const result = await validateInputImageFile(imageFile(PNG_BYTES, "image.png", "image/png"));
    expect(result).toEqual({ mimeType: "image/png", extension: "png" });
  });

  test("accepts a JPEG magic signature", async () => {
    const result = await validateInputImageFile(imageFile(JPEG_BYTES, "image.jpg", "image/jpeg"));
    expect(result).toEqual({ mimeType: "image/jpeg", extension: "jpg" });
  });

  test("accepts a WEBP magic signature", async () => {
    const result = await validateInputImageFile(imageFile(WEBP_BYTES, "image.webp", "image/webp"));
    expect(result).toEqual({ mimeType: "image/webp", extension: "webp" });
  });

  test("rejects SVG files", async () => {
    const file = new File(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], "image.svg", {
      type: "image/svg+xml",
    });
    await expect(validateInputImageFile(file)).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_TYPE",
      status: 400,
    });
  });

  test("rejects MIME and magic-signature mismatches", async () => {
    const file = imageFile(PNG_BYTES, "fake.jpg", "image/jpeg");
    await expect(validateInputImageFile(file)).rejects.toMatchObject({
      code: "IMAGE_SIGNATURE_MISMATCH",
      status: 400,
    });
  });

  test("rejects text disguised as an allowed image MIME", async () => {
    const file = new File(["this is not an image"], "fake.png", { type: "image/png" });
    await expect(validateInputImageFile(file)).rejects.toMatchObject({
      code: "IMAGE_SIGNATURE_MISMATCH",
      status: 400,
    });
  });

  test("rejects files larger than 10 MB", async () => {
    const file = new File([new ArrayBuffer(MAX_INPUT_IMAGE_BYTES + 1)], "large.png", {
      type: "image/png",
    });
    await expect(validateInputImageFile(file)).rejects.toMatchObject({
      code: "IMAGE_TOO_LARGE",
      status: 400,
    });
  });
});

describe("input image asset storage", () => {
  test("rejects unauthenticated upload requests before storage", async () => {
    const storage = createMockStorage();
    const request = uploadRequest(imageFile(PNG_BYTES, "image.png", "image/png"));

    await expect(
      uploadInputImageFromRequest(request, { bucket: storage.bucket, db: storage.db }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(storage.putKeys).toHaveLength(0);
  });

  test("rejects a remote URL in place of a multipart File", async () => {
    const storage = createMockStorage();
    const formData = new FormData();
    formData.append("image", "https://remote.example/image.png");
    const request = new Request("https://mumo.example/api/uploads/input-image", {
      method: "POST",
      body: formData,
    });

    await expect(
      uploadInputImageFromRequest(request, authenticatedDependencies(storage)),
    ).rejects.toMatchObject({ code: "IMAGE_FILE_REQUIRED", status: 400 });
    expect(storage.putKeys).toHaveLength(0);
  });

  test("builds a private R2 key without the original filename", async () => {
    const storage = createMockStorage();
    const filename = "customer-original-name.png";

    await storeInputImageAsset(
      imageFile(PNG_BYTES, filename, "image/png"),
      AUTH_SESSION.user.id,
      authenticatedDependencies(storage),
    );

    expect(storage.putKeys).toEqual(["inputs/user-123/2026/07/asset-123.png"]);
    expect(storage.putKeys[0]).not.toContain(filename);
  });

  test("stores an expiry approximately 24 hours after creation", async () => {
    const storage = createMockStorage();
    await storeInputImageAsset(
      imageFile(PNG_BYTES, "temporary.png", "image/png"),
      AUTH_SESSION.user.id,
      authenticatedDependencies(storage),
    );

    const createdAt = new Date(String(storage.boundValues[0][7]));
    const expiresAt = new Date(String(storage.boundValues[0][8]));
    expect(INPUT_IMAGE_EXPIRY_HOURS).toBe(24);
    expect(expiresAt.getTime() - createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(expiresAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(INPUT_IMAGE_EXPIRY_CLEANUP_CONDITION).toBe(
      "status = 'ready' AND expires_at IS NOT NULL AND datetime(expires_at) <= CURRENT_TIMESTAMP",
    );
  });

  test("deletes the uploaded R2 object when the D1 insert fails", async () => {
    const storage = createMockStorage({ failInsert: true });

    const promise = storeInputImageAsset(
      imageFile(JPEG_BYTES, "image.jpg", "image/jpeg"),
      AUTH_SESSION.user.id,
      authenticatedDependencies(storage),
    );

    await expect(promise).rejects.toBeInstanceOf(InputImageUploadError);
    expect(storage.putKeys).toHaveLength(1);
    expect(storage.deletedKeys).toEqual(storage.putKeys);
  });

  test("returns only public asset metadata", async () => {
    const storage = createMockStorage();
    const result = await uploadInputImageFromRequest(
      uploadRequest(imageFile(WEBP_BYTES, "product.webp", "image/webp")),
      authenticatedDependencies(storage),
    );

    expect(result).toEqual({
      assetId: "asset-123",
      filename: "product.webp",
      mimeType: "image/webp",
      sizeBytes: WEBP_BYTES.length,
      status: "ready",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(AUTH_SESSION.user.id);
    expect(serialized).not.toContain("inputs/");
    expect(serialized).not.toContain("R2_PUBLIC_BASE_URL");
    expect(serialized).not.toContain("http");
  });
});

describe("persisted input image reads", () => {
  test("rejects an unauthenticated persisted-reference preview request", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/reference.png",
        status: "consumed",
      },
    });
    await expect(
      getInputImageAssetFromRequest(
        new Request("https://mumo.example/api/uploads/input-image?assetId=asset-123"),
        "asset-123",
        {
          ...authenticatedDependencies(storage),
          authenticate: async () => {
            throw new Response(null, { status: 401 });
          },
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(storage.putKeys).toEqual([]);
  });

  test("an owner can preview a consumed reference without creating a new upload", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/reference.png",
        status: "consumed",
      },
    });

    const image = await getInputImageAssetForUser(
      "asset-123",
      AUTH_SESSION.user.id,
      authenticatedDependencies(storage),
    );
    expect(image.mimeType).toBe("image/png");
    expect(new Uint8Array(image.body)).toEqual(Uint8Array.from(PNG_BYTES));
    expect(storage.putKeys).toEqual([]);
  });

  test("a persisted reference preview remains scoped to its owner", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: "other-user",
        r2Key: "inputs/other/reference.png",
        status: "consumed",
      },
    });

    await expect(
      getInputImageAssetForUser(
        "asset-123",
        AUTH_SESSION.user.id,
        authenticatedDependencies(storage),
      ),
    ).rejects.toMatchObject({ code: "INPUT_IMAGE_NOT_FOUND", status: 404 });
  });

  test("preview responses are private and never accept an arbitrary storage key", async () => {
    const route = await Bun.file("src/routes/api/uploads/input-image.ts").text();
    expect(route).toContain('"Cache-Control": "private, max-age=0, no-store"');
    expect(route).not.toContain("r2Key");
    expect(route).not.toContain("searchParams.get(\"key\")");
  });
});

describe("input image asset deletion", () => {
  test("lets a user delete their own ready asset and marks it deleted", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/2026/07/asset-123.png",
        status: "ready",
      },
    });

    const result = await deleteInputImageAssetFromRequest(
      deleteRequest("asset-123"),
      authenticatedDependencies(storage),
    );

    expect(result).toEqual({ assetId: "asset-123", status: "deleted" });
    expect(storage.events).toEqual(["d1:update", "r2:delete"]);
    expect(storage.deletedKeys).toEqual(["inputs/user-123/2026/07/asset-123.png"]);
    expect(storage.getAssetStatus()).toBe("deleted");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("r2_key");
    expect(serialized).not.toContain("inputs/");
  });

  test("does not let a user delete another user's asset", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: "other-user",
        r2Key: "inputs/other-user/2026/07/asset-123.png",
        status: "ready",
      },
    });

    await expect(
      deleteInputImageAsset("asset-123", AUTH_SESSION.user.id, authenticatedDependencies(storage)),
    ).rejects.toMatchObject({ code: "INPUT_IMAGE_NOT_FOUND", status: 404 });
    expect(storage.deletedKeys).toHaveLength(0);
  });

  test("does not delete a consumed asset", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/2026/07/asset-123.png",
        status: "consumed",
      },
    });

    await expect(
      deleteInputImageAsset("asset-123", AUTH_SESSION.user.id, authenticatedDependencies(storage)),
    ).rejects.toMatchObject({ code: "INPUT_IMAGE_NOT_DELETABLE", status: 409 });
    expect(storage.deletedKeys).toHaveLength(0);
  });

  test("returns success idempotently for an already deleted asset", async () => {
    const storage = createMockStorage({
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/2026/07/asset-123.png",
        status: "deleted",
      },
    });

    const result = await deleteInputImageAsset("asset-123", AUTH_SESSION.user.id, {
      db: storage.db,
    });
    expect(result).toEqual({ assetId: "asset-123", status: "deleted" });
    expect(storage.deletedKeys).toHaveLength(0);
  });

  test("does not delete R2 when the conditional update affects no rows", async () => {
    const storage = createMockStorage({
      updateChanges: 0,
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/2026/07/asset-123.png",
        status: "ready",
      },
    });

    await expect(
      deleteInputImageAsset("asset-123", AUTH_SESSION.user.id, authenticatedDependencies(storage)),
    ).rejects.toMatchObject({ code: "INPUT_IMAGE_DELETE_FAILED", status: 500 });
    expect(storage.events).toEqual(["d1:update"]);
    expect(storage.deletedKeys).toHaveLength(0);
    expect(storage.getAssetStatus()).toBe("ready");
  });

  test("does not delete R2 when the asset changes concurrently after SELECT", async () => {
    const storage = createMockStorage({
      updateChanges: 0,
      statusOnUpdate: "consumed",
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/2026/07/asset-123.png",
        status: "ready",
      },
    });

    await expect(
      deleteInputImageAsset("asset-123", AUTH_SESSION.user.id, authenticatedDependencies(storage)),
    ).rejects.toMatchObject({ code: "INPUT_IMAGE_NOT_DELETABLE", status: 409 });
    expect(storage.events).toEqual(["d1:update"]);
    expect(storage.deletedKeys).toHaveLength(0);
    expect(storage.getAssetStatus()).toBe("consumed");
  });

  test("re-reads deleted state when D1 does not report affected rows", async () => {
    const storage = createMockStorage({
      omitUpdateChanges: true,
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key: "inputs/user-123/2026/07/asset-123.png",
        status: "ready",
      },
    });

    const result = await deleteInputImageAsset(
      "asset-123",
      AUTH_SESSION.user.id,
      authenticatedDependencies(storage),
    );
    expect(result).toEqual({ assetId: "asset-123", status: "deleted" });
    expect(storage.events).toEqual(["d1:update", "r2:delete"]);
  });

  test("keeps D1 deleted and returns a sanitized success when R2 deletion fails", async () => {
    const r2Key = "inputs/user-123/2026/07/internal-secret.png";
    const storage = createMockStorage({
      failR2Delete: true,
      asset: {
        id: "asset-123",
        userId: AUTH_SESSION.user.id,
        r2Key,
        status: "ready",
      },
    });

    const result = await deleteInputImageAsset(
      "asset-123",
      AUTH_SESSION.user.id,
      authenticatedDependencies(storage),
    );

    expect(result).toEqual({ assetId: "asset-123", status: "deleted" });
    expect(storage.events).toEqual(["d1:update", "r2:delete"]);
    expect(storage.getAssetStatus()).toBe("deleted");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(r2Key);
    expect(serialized).not.toContain("mock R2");
  });
});

describe("reference image client lifecycle", () => {
  const readyAsset: ReferenceImageAsset = {
    localPreviewUrl: "blob:preview-ready",
    uploadRequestId: "request-ready",
    assetId: "asset-ready",
    filename: "ready.png",
    mimeType: "image/png",
    sizeBytes: 9,
    status: "ready",
  };

  test("does not submit an assetId after the reference is removed", () => {
    const removed = removeReferenceImageAt([readyAsset], 0);
    expect(getReadyReferenceImageIds(removed)).toEqual([]);
  });

  test("does not restore a stale assetId when upload completes after removal", () => {
    const uploadingAsset: ReferenceImageAsset = {
      ...readyAsset,
      uploadRequestId: "request-uploading",
      assetId: undefined,
      status: "uploading",
    };
    const removed = removeReferenceImageAt([uploadingAsset], 0);
    const completed = applyReferenceImageUploadSuccess(removed, 0, "request-uploading", {
      assetId: "stale-asset",
      filename: "ready.png",
      mimeType: "image/png",
      sizeBytes: 9,
    });

    expect(completed).toEqual([null]);
    expect(getReadyReferenceImageIds(completed)).toEqual([]);
  });
});
