import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/studio/Studio";

export const Route = createFileRoute("/")({
  component: Studio,
  head: () => ({
    meta: [
      { title: "TuXun AI 图片生成丨【GPT Image 2 Pro 与 Nano Banana】" },
      { name: "description", content: "沐莫为电商创作者提供商品主图、场景视觉与批量处理工作台。" },
      { property: "og:title", content: "TuXun AI 图片生成丨【GPT Image 2 Pro 与 Nano Banana】" },
      { property: "og:description", content: "沐莫为电商创作者提供商品主图、场景视觉与批量处理工作台。" },
      { name: "twitter:title", content: "TuXun AI 图片生成丨【GPT Image 2 Pro 与 Nano Banana】" },
      { name: "twitter:description", content: "沐莫为电商创作者提供商品主图、场景视觉与批量处理工作台。" },
    ],
  }),
});
