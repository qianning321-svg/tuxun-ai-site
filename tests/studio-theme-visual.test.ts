import { expect, test } from "bun:test";

const topBarSource = await Bun.file("src/components/studio/TopBar.tsx").text();
const announcementSource = await Bun.file("src/components/studio/AnnouncementCenter.tsx").text();
const canvasSource = await Bun.file("src/components/studio/Canvas.tsx").text();
const contactSource = await Bun.file("src/components/studio/ContactDialog.tsx").text();
const stylesSource = await Bun.file("src/styles.css").text();
const controlPanelSource = await Bun.file("src/components/studio/ControlPanel.tsx").text();
const modelPickerSource = await Bun.file("src/components/studio/ModelPicker.tsx").text();
const parameterPickerSource = await Bun.file("src/components/studio/ParameterPicker.tsx").text();
const generationOptionsSource = await Bun.file(
  "src/components/studio/generation-options.ts",
).text();

test("recharge packages use presentation variants while retaining configured package data", () => {
  expect(topBarSource).toContain("packages.map((plan) =>");
  expect(topBarSource).toContain("mumo-package-card--featured");
  expect(topBarSource).toContain("mumo-package-card--standard");
  expect(topBarSource).toContain("plan.price_text");
  expect(topBarSource).toContain("Number(plan.credits ?? 0).toLocaleString()");
  expect(topBarSource).not.toContain("from-[#f7eedb]");
  expect(stylesSource).toContain(".mumo-package-card__cta--active {");
  expect(stylesSource).toContain("linear-gradient(90deg, #a23cff, #7558ff, #438eff)");
  expect(stylesSource).toContain("linear-gradient(90deg, #8b5cf6, #4f7dff)");
  expect(stylesSource).not.toContain("#19e3a4");
  expect(stylesSource).not.toContain("#15dca9");
});

test("announcement header has a dedicated dark presentation class", () => {
  expect(announcementSource).toContain("mumo-announcement-dialog__header");
  expect(announcementSource).not.toContain("border-slate-200/70 bg-white/95");
});

test("studio preserves its permanent dark visual center and containing result image", () => {
  expect(canvasSource).toContain("mumo-canvas-stage");
  expect(canvasSource).toContain(
    'className="block h-auto w-auto max-h-full max-w-full object-contain object-center"',
  );
  expect(topBarSource).not.toContain("onToggleTheme");
});

test("contact dialog uses high-contrast dark contact cards", () => {
  expect(contactSource).toContain("mumo-contact-row");
  expect(contactSource).toContain("text-[#e9edff]");
  expect(contactSource).toContain("text-[#b9c4e6]");
  expect(contactSource).not.toContain("bg-white/50");
  expect(stylesSource).toContain(".mumo-contact-row {");
});

test("recharge desktop layout has no internal vertical scrolling and keeps all config-driven packages", () => {
  expect(topBarSource).toContain("mumo-recharge-dialog--packages");
  expect(topBarSource).toContain("mumo-recharge-grid");
  expect(stylesSource).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
  expect(stylesSource).toContain("overflow-y: hidden;");
  expect(topBarSource).toContain("packages.map((plan) =>");
});

test("generation parameter helper microcopy is removed while section titles remain", () => {
  expect(controlPanelSource).toContain('title="参考图"');
  expect(controlPanelSource).toContain('title="生成参数"');
  expect(controlPanelSource).toContain('title="提示词输入"');
  expect(controlPanelSource).not.toContain('description="逐张添加商品、场景或风格参考"');
  expect(controlPanelSource).not.toContain('description="模型、画幅与输出质量"');
  expect(controlPanelSource).not.toContain('description="描述商品主体、场景、光影与构图"');
  expect(parameterPickerSource).not.toContain("{selected.description}");
  expect(modelPickerSource).not.toContain("selected?.summary");
});

test("generation parameters retain dynamic model metadata and option behavior", () => {
  expect(modelPickerSource).toContain("getModelBadgeColorStyle");
  expect(modelPickerSource).toContain("selected?.name");
  expect(modelPickerSource).toContain("selected.costCredits");
  expect(generationOptionsSource).toContain("mergeModelDisplayConfigs");
  expect(generationOptionsSource).toContain("badgeColor");
  expect(generationOptionsSource).toContain("badgeTextColor");
  expect(generationOptionsSource).toContain('value: "1K"');
  expect(generationOptionsSource).toContain("getDefaultQualityForModel");
  expect(generationOptionsSource).toContain("ASPECT_RATIO_OPTIONS_EXTENDED");
  expect(generationOptionsSource).toContain('value: "1:1"');
  expect(generationOptionsSource).toContain('value: "16:9"');
  expect(generationOptionsSource).toContain('value: "9:16"');
});

test("generation parameter cards use readable desktop and mobile layouts", () => {
  expect(controlPanelSource).toContain(
    "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]",
  );
  expect(controlPanelSource).toContain("grid-cols-2");
  expect(controlPanelSource).toContain("col-span-2 w-full lg:col-span-1");
  expect(modelPickerSource).toContain("h-[66px]");
  expect(modelPickerSource).toContain("text-[15px]");
  expect(parameterPickerSource).toContain("h-[66px]");
  expect(parameterPickerSource).toContain("text-[15px]");
  expect(controlPanelSource).toContain("text-[15px]");
  expect(canvasSource).toContain("mumo-canvas-stage");
});
