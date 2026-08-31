import { describe, expect, test } from "bun:test";

import {
  createPersistedReferenceImageSlots,
  getReadyReferenceImageIds,
  getReferenceImageIds,
  restoreGenerationParameters,
} from "../src/components/studio/generation-options";

describe("one-click reference image reuse", () => {
  test("a task without references replaces the reference area with empty slots", () => {
    const slots = createPersistedReferenceImageSlots([]);
    expect(slots).toEqual([null, null, null, null, null]);
    expect(getReadyReferenceImageIds(slots)).toEqual([]);
  });

  test("one persisted reference is restored without a blob URL", () => {
    const slots = createPersistedReferenceImageSlots(["asset-one"]);
    expect(getReadyReferenceImageIds(slots)).toEqual(["asset-one"]);
    expect(slots[0]).toMatchObject({
      assetId: "asset-one",
      persisted: true,
      status: "ready",
      localPreviewUrl: "/api/uploads/input-image?assetId=asset-one",
    });
    expect(slots[0]?.localPreviewUrl.startsWith("blob:")).toBe(false);
  });

  test("multiple references preserve their historical order", () => {
    const ids = ["asset-3", "asset-1", "asset-2"];
    const slots = createPersistedReferenceImageSlots(ids);
    expect(getReadyReferenceImageIds(slots)).toEqual(ids);
  });

  test("history input parsing preserves reference order and generation parameters", () => {
    const inputParams = {
      aspectRatio: "16:9",
      quality: "2K",
      referenceImageIds: ["first", "second", "third"],
      costCredits: 28,
    };
    expect(getReferenceImageIds(inputParams)).toEqual(["first", "second", "third"]);
    expect(restoreGenerationParameters("gpt-image-2-pro", inputParams)).toMatchObject({
      aspectRatio: "16:9",
      quality: "2K",
    });
  });

  test("reuse uses persisted history IDs and does not submit, charge, or upload automatically", async () => {
    const [studio, controlPanel, generationServer, historyServer] = await Promise.all([
      Bun.file("src/components/studio/Studio.tsx").text(),
      Bun.file("src/components/studio/ControlPanel.tsx").text(),
      Bun.file("src/lib/generation.server.ts").text(),
      Bun.file("src/lib/admin.server.ts").text(),
    ]);
    const reuseStart = studio.indexOf("const handleReuseCurrentResult");
    const reuseEnd = studio.indexOf("const showAuth", reuseStart);
    const reuseHandler = studio.slice(reuseStart, reuseEnd);
    expect(reuseHandler).toContain("getReferenceImageIds(source.inputParams)");
    expect(reuseHandler).toContain("setReusePrefill(createGenerationPrefill");
    expect(reuseHandler).not.toContain("handleGenerateStart");
    expect(reuseHandler).not.toContain("createGenerationTask");
    expect(reuseHandler).not.toContain("credits");
    expect(controlPanel).toContain("createPersistedReferenceImageSlots(");
    expect(controlPanel).toContain("onError={() => setFailedPreviewUrl(asset.localPreviewUrl)}");
    expect(controlPanel).toContain("预览失败");
    expect(generationServer).toContain("t.request_json");
    expect(generationServer).toContain("inputParams: parseRequestJson(row.request_json)");
    expect(historyServer).toContain("getMyGenerationHistory = serverFn(async (data) => withUser");
    expect(historyServer).toContain("listGenerationHistoryForUser(userId");
  });
});
