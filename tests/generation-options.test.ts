import { describe, expect, test } from "bun:test";

import {
  DEFAULT_GENERATION_PARAMETERS,
  getDefaultQualityForModel,
  getModelBadgeColorStyle,
  getModelOption,
  MODEL_OPTIONS,
  mergeModelDisplayConfigs,
  normalizeGenerationParametersForModel,
  normalizeModelBadgeColor,
  selectGenerationModel,
} from "../src/components/studio/generation-options";

describe("Wuyinkeji studio model options", () => {
  test("accepts only canonical HEX badge colors from server display data", () => {
    expect(normalizeModelBadgeColor("#abc")).toBe("#AABBCC");
    expect(normalizeModelBadgeColor("#12aBcF")).toBe("#12ABCF");
    expect(normalizeModelBadgeColor("javascript:alert(1)")).toBeUndefined();
    expect(normalizeModelBadgeColor("var(--brand)")).toBeUndefined();
    expect(getModelBadgeColorStyle("#fff")?.color).toBe("#000000");
    expect(getModelBadgeColorStyle("#000")?.color).toBe("#FFFFFF");
    expect(getModelBadgeColorStyle("#E16F23", "#fff")).toEqual({ backgroundColor: "#E16F23", borderColor: "#E16F23", color: "#FFFFFF" });
    expect(getModelBadgeColorStyle("#FFFFFF", "#000000")).toEqual({ backgroundColor: "#FFFFFF", borderColor: "#FFFFFF", color: "#000000" });
    expect(getModelBadgeColorStyle("#000000", null)?.color).toBe("#FFFFFF");
    expect(getModelBadgeColorStyle(null, "#abc")).toEqual({ color: "#AABBCC" });
  });

  test("keeps server order and excludes unknown or statically hidden models", () => {
    const merged = mergeModelDisplayConfigs([
      { model_key: "nano-banana", display_name: "First", cost_credits: 15, sort_order: 1, badge_label: "Hot", badge_color: "#0af", badge_text_color: "#fff" },
      { model_key: "nano-banana-2-lite", display_name: "Hidden", cost_credits: 0, sort_order: 2 },
      { model_key: "unknown", display_name: "Unknown", cost_credits: 1, sort_order: 3 },
      { model_key: "gpt-image-2-pro", display_name: "Second", cost_credits: 28, sort_order: 4 },
    ]);
    expect(merged.map((model) => model.value)).toEqual(["nano-banana", "gpt-image-2-pro"]);
    expect(merged[0]).toMatchObject({ name: "First", badgeColor: "#00AAFF", badgeTextColor: "#FFFFFF", tag: "Hot" });
  });

  test("keeps the existing GPT Image 2 Pro option unchanged", () => {
    expect(MODEL_OPTIONS[0]).toMatchObject({
      value: "gpt-image-2-pro",
      name: "GPT-IMAGE-2.0 Pro",
      costCredits: 28,
      recommended: true,
      supportsReferenceImages: true,
    });
  });

  test("defines the five ordinary model displays and capabilities", () => {
    expect(MODEL_OPTIONS.map((option) => option.name)).toEqual([
      "GPT-IMAGE-2.0 Pro",
      "Nano Banana",
      "Nano Banana Pro",
      "Nano Banana 2",
      "GPT Image 2",
      "Nano Banana 2 Lite",
    ]);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana")?.supportedQualities).toEqual(["1K"]);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana")?.supportedAspectRatios).toContain("auto");
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana")?.costCredits).toBe(15);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana")?.supportsReferenceImages).toBe(true);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-pro")?.supportedQualities).toEqual(["1K", "2K", "4K"]);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-pro")?.costCredits).toBe(45);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-pro")?.supportsReferenceImages).toBe(true);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2")?.supportedAspectRatios).toContain("8:1");
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2")?.supportedAspectRatios).toContain("auto");
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2")?.costCredits).toBe(15);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2")?.supportsReferenceImages).toBe(true);
    expect(MODEL_OPTIONS.find((option) => option.value === "gpt-image-2-vip")?.supportedQualities).toEqual(["1K"]);
    expect(MODEL_OPTIONS.find((option) => option.value === "gpt-image-2-vip")?.supportedAspectRatios).toContain("auto");
    expect(MODEL_OPTIONS.find((option) => option.value === "gpt-image-2-vip")?.costCredits).toBe(15);
    expect(MODEL_OPTIONS.find((option) => option.value === "gpt-image-2-vip")?.supportsReferenceImages).toBe(true);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2-lite")?.enabled).toBe(false);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2-lite")?.supportsReferenceImages).toBe(true);
    expect(MODEL_OPTIONS.find((option) => option.value === "nano-banana-2-lite")?.supportedAspectRatios).toContain("auto");
  });

  test("falls back unsupported quality and ratio to the model defaults", () => {
    const normalized = normalizeGenerationParametersForModel({
      model: "nano-banana",
      aspectRatio: "8:1",
      quality: "4K",
      costCredits: 999,
    });
    expect(normalized).toMatchObject({ model: "nano-banana", aspectRatio: "1:1", quality: "1K", costCredits: 15 });
  });

  test("defaults every enabled production model to 1K without removing higher qualities", () => {
    expect(DEFAULT_GENERATION_PARAMETERS.quality).toBe("1K");
    const enabledModels = MODEL_OPTIONS.filter((model) => model.enabled !== false);
    expect(enabledModels.map((model) => [model.value, getDefaultQualityForModel(model)])).toEqual([
      ["gpt-image-2-pro", "1K"],
      ["nano-banana", "1K"],
      ["nano-banana-pro", "1K"],
      ["nano-banana-2", "1K"],
      ["gpt-image-2-vip", "1K"],
    ]);
    for (const targetModel of enabledModels) {
      const sourceModel = targetModel.value === "gpt-image-2-pro" ? "nano-banana-pro" : "gpt-image-2-pro";
      expect(selectGenerationModel({ ...DEFAULT_GENERATION_PARAMETERS, model: sourceModel, quality: "2K" }, targetModel.value).quality).toBe("1K");
    }
    expect(MODEL_OPTIONS.find((model) => model.value === "gpt-image-2-pro")?.supportedQualities).toEqual(["1K", "2K", "4K"]);
    expect(MODEL_OPTIONS.find((model) => model.value === "nano-banana-pro")?.supportedQualities).toEqual(["1K", "2K", "4K"]);
    expect(MODEL_OPTIONS.find((model) => model.value === "nano-banana-2")?.supportedQualities).toEqual(["1K", "2K", "4K"]);
  });

  test("resets quality only for an actual model selection", () => {
    const manuallySelected2K = { ...DEFAULT_GENERATION_PARAMETERS, quality: "2K" as const };
    expect(normalizeGenerationParametersForModel(manuallySelected2K).quality).toBe("2K");
    expect(selectGenerationModel(manuallySelected2K, manuallySelected2K.model).quality).toBe("2K");
    expect(selectGenerationModel(manuallySelected2K, "nano-banana-pro").quality).toBe("1K");
    expect(selectGenerationModel(manuallySelected2K, "nano-banana-2").quality).toBe("1K");
  });

  test("switches freely between GPT and enabled Nano models with synchronized parameters", () => {
    const enabledModels = MODEL_OPTIONS.filter((model) => model.enabled !== false);
    const nanoBanana2 = selectGenerationModel(DEFAULT_GENERATION_PARAMETERS, "nano-banana-2", enabledModels);
    expect(nanoBanana2).toMatchObject({ model: "nano-banana-2", quality: "1K", costCredits: 15 });
    expect(getModelOption(nanoBanana2.model, enabledModels).supportedAspectRatios).toContain("8:1");

    const gpt = selectGenerationModel({ ...nanoBanana2, aspectRatio: "8:1", quality: "4K" }, "gpt-image-2-pro", enabledModels);
    expect(gpt).toMatchObject({ model: "gpt-image-2-pro", quality: "1K", costCredits: 28 });
    expect(getModelOption(gpt.model, enabledModels).supportedAspectRatios).not.toContain("8:1");

    for (const option of enabledModels) {
      expect(selectGenerationModel(gpt, option.value, enabledModels).model).toBe(option.value);
    }
  });

  test("ControlPanel applies each retry or reuse prefill only once", async () => {
    const source = await Bun.file("src/components/studio/ControlPanel.tsx").text();
    expect(source).toContain("const appliedPrefillNonceRef = useRef<number | null>(null)");
    expect(source).toContain("if (appliedPrefillNonceRef.current === activePrefill.nonce) return");
    expect(source).toContain("appliedPrefillNonceRef.current = activePrefill.nonce");
  });

  test("uses a supported safe default when submitted quality is missing", () => {
    const invalidParameters = { ...DEFAULT_GENERATION_PARAMETERS, model: "nano-banana-pro", quality: undefined } as unknown as typeof DEFAULT_GENERATION_PARAMETERS;
    expect(normalizeGenerationParametersForModel(invalidParameters).quality).toBe("1K");

    const modelWithout1K = { ...MODEL_OPTIONS[0], value: "future-model", supportedQualities: ["2K", "4K"] as const };
    expect(getDefaultQualityForModel(modelWithout1K)).toBe("2K");
  });
});
