import { expect, test } from "bun:test";
import { historyItemKey, mergeHistoryItems } from "../src/components/studio/history-items";

const canvasSource = await Bun.file("src/components/studio/Canvas.tsx").text();

test("history keeps separate generation tasks even when their image URL is identical", () => {
  const records = [
    { id: "history-a", generationTaskId: "task-a", imageUrl: "/api/download-image?taskId=task-a" },
    { id: "history-b", generationTaskId: "task-b", imageUrl: "/api/download-image?taskId=task-b" },
  ];

  expect(mergeHistoryItems([], records, false)).toHaveLength(2);
  expect(records.map(historyItemKey)).toEqual(["task-a", "task-b"]);
});

test("history append retains every task record", () => {
  const firstPage = Array.from({ length: 28 }, (_, index) => ({
    id: `history-${index}`,
    generationTaskId: `task-${index}`,
  }));
  const secondPage = Array.from({ length: 9 }, (_, index) => ({
    id: `history-next-${index}`,
    generationTaskId: `task-next-${index}`,
  }));

  expect(mergeHistoryItems(firstPage, secondPage, true)).toHaveLength(37);
});

test("history thumbnails are static while explicit history actions remain available", () => {
  expect(canvasSource).toContain('className="absolute inset-0 cursor-default"');
  expect(canvasSource).toContain('className="h-full w-full cursor-default object-cover"');
  expect(canvasSource).toContain('title="一键复用"');
  expect(canvasSource).toContain('title="下载原图"');
  expect(canvasSource).toContain('title="复制提示词"');
  expect(canvasSource).toContain('title="查看大图"');
  expect(canvasSource).toContain('onClick={() => setHeroLightbox(true)}');
});
