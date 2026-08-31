import { expect, test } from "bun:test";
import { visualProgressForStage } from "../src/components/studio/generation-visual-progress";

const canvasSource = await Bun.file("src/components/studio/Canvas.tsx").text();
const rootSource = await Bun.file("src/routes/__root.tsx").text();
const stylesSource = await Bun.file("src/styles.css").text();
const taskPanelSource = await Bun.file("src/components/studio/TaskFloatingPanel.tsx").text();
const controlPanelSource = await Bun.file("src/components/studio/ControlPanel.tsx").text();
const authModalSource = await Bun.file("src/components/auth/AuthModal.tsx").text();
const settingsDialogSource = await Bun.file("src/components/auth/SettingsDialog.tsx").text();

test("result image uses centered max-bound contain geometry inside the full canvas viewport", () => {
  expect(canvasSource).toContain(
    'data-testid="canvas-viewport" className="absolute inset-0 z-10 overflow-hidden"',
  );
  expect(canvasSource).toContain('data-testid="result-viewport"');
  expect(canvasSource).toContain(
    'className="absolute inset-0 flex items-center justify-center overflow-hidden"',
  );
  expect(canvasSource).toContain('data-testid="result-image"');
  expect(canvasSource).toContain(
    'className="block h-auto w-auto max-h-full max-w-full object-contain object-center"',
  );
  const resultBranch = canvasSource.split(") : hasResult ? (")[1]?.split(") : (")[0] ?? "";
  expect(resultBranch).not.toContain("items-center justify-center bg-[#080d2b]");
  expect(resultBranch).not.toContain("object-cover");
  expect(resultBranch).not.toContain("min-h-full");
  expect(resultBranch).not.toContain("min-w-full");
  expect(resultBranch).not.toContain("scale(");
  expect(resultBranch).not.toContain("transform:");
  expect(resultBranch).not.toContain("h-full w-full object-contain object-center");
  expect(rootSource).toContain("img{max-width:100%;height:auto;object-fit:contain}");
});

test("all supported result ratios fit a containing canvas without cropping", () => {
  const canvas = { width: 1200, height: 700 };
  const ratios = [1, 16 / 9, 9 / 16, 4 / 3, 3 / 4];

  for (const ratio of ratios) {
    const width = Math.min(canvas.width, canvas.height * ratio);
    const height = width / ratio;
    expect(width).toBeLessThanOrEqual(canvas.width);
    expect(height).toBeLessThanOrEqual(canvas.height);
    expect(width / height).toBeCloseTo(ratio, 8);
  }

  const squareSize = Math.min(canvas.width, canvas.height);
  expect(squareSize).toBe(canvas.height);
  expect((canvas.width - squareSize) / 2).toBeGreaterThan(0);
});

test("preview and download paths remain independent of the main result layout", () => {
  expect(canvasSource).toContain("const hasResult = Boolean(generatedUrl);");
  expect(canvasSource).toContain("{hasResult && !showGenerationLoader && (");
  expect(canvasSource).toContain('data-testid="result-toolbar"');
  expect(canvasSource).toContain("onClick={() => setHeroLightbox(true)}");
  expect(canvasSource).toContain(
    "downloadImage(generatedTaskId)",
  );
  expect(canvasSource).toContain("onClick={() => copyToClipboard(heroPrompt)}");
  expect(canvasSource).toContain("onClick={onReuseCurrent}");
  expect(canvasSource).toContain("src={src}");
  expect(canvasSource).toContain("alt={prompt}");
  expect(canvasSource).toContain("onError={onError}");
  expect(canvasSource).toContain('className="h-full w-full object-contain"');
});

test("result toolbar shares the displayed result condition and stays hidden outside completion", () => {
  expect(canvasSource).toContain(
    'className="absolute left-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5',
  );
  expect(canvasSource).toContain("{showGenerationLoader ? (");
  expect(canvasSource).toContain(
    "<QueueProgress progress={progress ?? null} completed={completionVisible} />",
  );
  expect(canvasSource).toContain(") : hasResult ? (");
  expect(canvasSource).not.toContain("opacity-70 transition-opacity group-hover:opacity-100");
  expect(canvasSource).not.toContain("absolute right-3 top-3 z-30 flex items-center");
  expect(canvasSource).not.toContain("pb-14 pt-12");
  expect(canvasSource).not.toContain("calc(100% -");
  expect(canvasSource).toContain(
    'data-testid="task-overlay" className="absolute right-3 top-3 z-40"',
  );
  expect(taskPanelSource).toContain('data-testid="task-floating-panel" className="relative"');
  expect(taskPanelSource).toContain('className="absolute right-0 top-full mt-2 w-80');
  expect(taskPanelSource).not.toContain("fixed right-4 top-16 z-50");
});

test("canvas stages fill the same viewport without a full-width control row", () => {
  expect(canvasSource).toContain(
    "mumo-canvas-root relative min-h-[70dvh] min-w-0 w-full overflow-hidden",
  );
  expect(canvasSource).not.toContain("mumo-canvas-root mumo-panel");
  expect(canvasSource).toContain(
    'data-testid="canvas-viewport" className="absolute inset-0 z-10 overflow-hidden"',
  );
  expect(canvasSource).toContain('data-testid="result-image"');
  expect(canvasSource).toContain('data-testid="generation-stage" className="absolute inset-0 z-0"');
  expect(canvasSource).toContain('data-testid="idle-stage" className="absolute inset-0 z-0"');
  const toolbar =
    canvasSource.match(/data-testid="result-toolbar"[\s\S]*?<\/div>\r?\n      \)\}/)?.[0] ?? "";
  expect(toolbar).not.toBe("");
  expect(toolbar).not.toContain("inset-x-0");
  expect(toolbar).not.toContain("w-full");
  expect(toolbar).not.toContain("h-12");
  expect(toolbar).not.toContain("bg-");
  expect(toolbar).not.toContain("border-b");
  expect(toolbar).not.toContain("backdrop");
});

test("idle canvas restores the existing commerce hero without the dot-grid regression", () => {
  expect(canvasSource).toContain("function EmptyPlaceholder()");
  expect(canvasSource).toContain("mumo-canvas-stage");
  expect(canvasSource).toContain("mumo-canvas-icon");
  expect(canvasSource).toContain("<ImageIcon");
  expect(canvasSource).toContain("让商品创意成为专业视觉");
  expect(canvasSource).toContain("在左侧选择商品类型并输入画面描述");
  expect(canvasSource).toContain("适用于电商主图、商品场景与品牌内容");
  expect(canvasSource).toContain("MUMO COMMERCE CANVAS");
  expect(canvasSource).not.toContain("mumo-grid-bg");
  expect(stylesSource).not.toContain(".mumo-grid-bg");
  expect(stylesSource).toContain(".mumo-canvas-stage::before");
  expect(stylesSource).toContain(".mumo-canvas-stage::after");
});

test("idle canvas presentation uses the default cursor without changing real text inputs", () => {
  const canvasStageRule = stylesSource.match(/\.mumo-canvas-stage\s*\{[\s\S]*?\}/)?.[0] ?? "";

  expect(canvasStageRule).toContain("cursor: default;");
  expect(canvasStageRule).toContain("caret-color: transparent;");
  expect(canvasStageRule).toContain("user-select: none;");
  expect(canvasStageRule).toContain("-webkit-user-select: none;");
  expect(stylesSource).toContain(
    '.mumo-canvas-stage :where(input, textarea, [contenteditable="true"])',
  );
  expect(stylesSource).toContain("caret-color: auto;");
  expect(stylesSource).toContain("user-select: text;");
  expect(canvasSource).not.toContain("contentEditable");
  expect(canvasSource).not.toContain('role="textbox"');
  expect(controlPanelSource).toContain("<textarea");
  expect(authModalSource).toContain("<input");
  expect(settingsDialogSource).toContain("<input");
});

test("idle, generating, and completed content stay isolated in their lifecycle branches", () => {
  const generatingStart = canvasSource.indexOf("{showGenerationLoader ? (");
  const completedStart = canvasSource.indexOf(") : hasResult ? (", generatingStart);
  const idleStart = canvasSource.indexOf(") : (", completedStart);
  const viewportEnd = canvasSource.indexOf("</div>", idleStart);

  expect(generatingStart).toBeGreaterThan(-1);
  expect(completedStart).toBeGreaterThan(generatingStart);
  expect(idleStart).toBeGreaterThan(completedStart);
  expect(viewportEnd).toBeGreaterThan(idleStart);

  const generatingBranch = canvasSource.slice(generatingStart, completedStart);
  const completedBranch = canvasSource.slice(completedStart, idleStart);
  const idleBranch = canvasSource.slice(idleStart, viewportEnd);

  expect(generatingBranch).toContain(
    "<QueueProgress progress={progress ?? null} completed={completionVisible} />",
  );
  expect(generatingBranch).not.toContain("<EmptyPlaceholder />");
  expect(completedBranch).toContain('data-testid="result-image"');
  expect(completedBranch).not.toContain("<EmptyPlaceholder />");
  expect(idleBranch).toContain("<EmptyPlaceholder />");
  expect(canvasSource).toContain("{hasResult && !showGenerationLoader && (");
});

test("generation state renders a CSS and SVG energy ring without embedding media", () => {
  expect(canvasSource).toContain('data-testid="generation-energy-ring"');
  expect(canvasSource).toContain('viewBox="0 0 240 240"');
  expect(canvasSource).toContain('id="generation-ring-gradient"');
  expect(canvasSource).toContain("mumo-energy-ring__orbit--one");
  expect(canvasSource).not.toContain("<video");
  expect(canvasSource).not.toContain(".mp4");
});

test("generation status uses lifecycle state and only displays a supplied queue position", () => {
  expect(canvasSource).toContain('stage === "rendering"');
  expect(canvasSource).toContain('stage === "queued"');
  expect(canvasSource).toContain('typeof progress?.initialPos === "number"');
  expect(canvasSource).toContain("AI 正在创作");
  expect(canvasSource).toContain("正在排队");
  expect(canvasSource).not.toContain("progress?.percentage");
});

test("energy ring respects reduced motion and remains limited to the generating branch", () => {
  expect(canvasSource).toContain("{showGenerationLoader ? (");
  expect(canvasSource).toContain(
    "<QueueProgress progress={progress ?? null} completed={completionVisible} />",
  );
  expect(canvasSource).toContain("{hasResult && !showGenerationLoader && (");
  expect(stylesSource).toContain("@media (prefers-reduced-motion: reduce)");
  expect(stylesSource).toContain(".mumo-energy-ring__orbit");
  expect(stylesSource).toContain("animation: none;");
  expect(stylesSource).toContain("width: clamp(280px, 25vw, 316px);");
  expect(stylesSource).toContain("width: clamp(210px, 68vw, 250px);");
});

test("visual progress is monotonic by time, capped below completion, and reaches 100 only on success", () => {
  const stages = ["submitting", "queued", "polling", "rendering"] as const;

  for (const stage of stages) {
    const values = [0, 5, 20, 60, 180].map((seconds) =>
      visualProgressForStage(stage, seconds, false),
    );
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.max(...values)).toBeLessThanOrEqual(98);
    expect(values).not.toContain(100);
  }

  expect(visualProgressForStage("rendering", 10_000, false)).toBe(98);
  expect(visualProgressForStage("rendering", 0, true)).toBe(100);
});

test("completed results hold the 100 percent state before the result branch appears", () => {
  expect(canvasSource).toContain("if (hasResult && !generating && wasGeneratingRef.current)");
  expect(canvasSource).toContain("setCompletionVisible(true)");
  expect(canvasSource).toContain("window.setTimeout(() => setCompletionVisible(false), 420)");
  expect(canvasSource).toContain("const showGenerationLoader = generating || completionVisible;");
});
