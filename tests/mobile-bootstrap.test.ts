import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { retryOnce } from "../src/lib/browser-retry";

test("network retry makes exactly one retry", async () => {
  let calls = 0;
  const result = await retryOnce(async () => {
    calls += 1;
    if (calls === 1) throw new Error("network unavailable");
    return "ok";
  }, 0);

  expect(result).toBe("ok");
  expect(calls).toBe(2);
});

test("bootstrap waits for actual stylesheet state and keeps recovery hidden initially", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  expect(root).toContain('id: "mumo-main-stylesheet"');
  expect(root).toContain("cssLink.addEventListener('load',cssLoaded");
  expect(root).toContain("cssLink.addEventListener('error',cssFailed");
  expect(root).toContain('hidden role="alert"');
  expect(root).toContain("页面样式资源加载失败");
  expect(root).toContain("data-mumo-hydrated");
  expect(root).toContain("页面初始化失败，请重新加载");
  expect(root).toContain("12000");
  expect(root).toContain("__mumoBootstrapHydrated");
  expect(root).toContain("继续尝试进入");
});

test("announcement modal keeps mobile close controls and content inside the viewport", () => {
  const source = readFileSync("src/components/studio/AnnouncementCenter.tsx", "utf8");
  expect(source).toContain("h-[calc(100vh-16px)]");
  expect(source).toContain("h-[calc(100dvh-16px)]");
  expect(source).toContain("[&>button]:h-11");
  expect(source).toContain("sticky top-0");
  expect(source).toContain("md:grid-cols-[280px_minmax(0,1fr)]");
});
