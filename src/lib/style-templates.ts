// Local-only style template presets.
// 风格模板是前端固定的本地预设：不依赖任何后端、数据库或外部图片链接。
// 用户点击模板时，把 promptSuffix 追加到原始 prompt 后即可。

export type StyleTemplate = {
  id: string;
  name: string;
  /** 本地预览图（public/style-previews/*.webp） */
  previewImage: string;
  /** 追加到用户提示词后的风格补充词 */
  promptSuffix: string;
};

export const DEFAULT_STYLE_PREVIEW = "/style-previews/default.webp";

export const STYLE_TEMPLATES: StyleTemplate[] = [
  {
    id: "premium_ecom",
    name: "高级电商",
    previewImage: "/style-previews/style-01.webp",
    promptSuffix:
      "告别低效改稿，一键搞定亚马逊详情页AI 赋能，专业级设计，助力跨境爆单,让每一个产品，都拥有大牌质感",
  },
  {
    id: "tech",
    name: "科技质感",
    previewImage: "/style-previews/style-02.webp",
    promptSuffix:
      "未来科技风产品摄影，冷调青蓝配色，深邃渐变暗底，锐利轮廓光，流光点缀，高端科技氛围感",
  },
  {
    id: "jewelry",
    name: "珠宝高级感",
    previewImage: "/style-previews/style-03.webp",
    promptSuffix:
      "奢华珠宝摄影，丝绒深色背景，高光璀璨夺目，光影精准聚焦，镜面质感细腻，尽显华贵高级格调",
  },
  {
    id: "beauty",
    name: "美妆海报",
    previewImage: "/style-previews/style-04.webp",
    promptSuffix:
      "高端美妆海报，柔光温润亲肤，丝滑渐变底色，雅致粉玫瑰色调，水润奢华氛围感",
  },
  {
    id: "food",
    name: "食品广告",
    previewImage: "/style-previews/style-05.webp",
    promptSuffix:
      "诱人美食商业摄影，暖调金光光影，色泽浓郁勾人，质感鲜嫩多汁，氤氲热气，尽显精致餐食格调",
  },
  {
    id: "shoes",
    name: "鞋靴高级感",
    previewImage: "/style-previews/style-06.webp",
    promptSuffix:
      "高端鞋履广告，立体定向光影，层次动感阴影，质感石质基底，潮流球鞋杂志风范",
  },
  {
    id: "outdoor",
    name: "户外露营",
    previewImage: "/style-previews/style-07.webp",
    promptSuffix:
      "户外露营生活场景，黄金时段自然光，山野丛林地貌，质朴自然色调，氛围感满满野趣气息",
  },
  {
    id: "dark_premium",
    name: "暗黑高级感",
    previewImage: "/style-previews/style-08.webp",
    promptSuffix:
      "暗调高级产品摄影，纯黑底色，明暗对比光影，层次深邃，梦幻泡影极具电影奢华质感",
  },
  {
    id: "outdoor_photo",
    name: "户外摄影",
    previewImage: "/style-previews/style-09.webp",
    promptSuffix:
      "山巅水畔，稳如磐石，你的全能摄影伙伴，风雨无阻，稳定画面，定格每帧震撼瞬间，无惧风雨，稳拍每一刻巅峰",
  },
  {
    id: "future_tech",
    name: "未来科技",
    previewImage: "/style-previews/style-10.webp",
    promptSuffix:
      "踏入未来纪元，直面文明的终极答案，蓝光之下，是科技与未来的序章，当城市被霓虹唤醒，你我皆是未来的观测者",
  },
  {
    id: "apocalypse",
    name: "末日废土",
    previewImage: "/style-previews/style-11.webp",
    promptSuffix:
      "红月升起，万物归墟，世界早已沦陷，高楼倾颓，岩浆翻涌。唯有她的背影，与这轮血色月亮，定格了文明最后的轮廓",
  },
  {
    id: "dark_interior",
    name: "暗系室内风格",
    previewImage: "/style-previews/style-12.webp",
    promptSuffix:
      "黑与红的碰撞，是冷峻与热烈的共生。天然大理石的肌理在光影中舒展，暖调火光揉碎了空间的冷硬，螺旋吊灯垂落，为高定私邸注入流动的艺术感。在这里，每一处线条、每一抹色彩，都在诠释低调又张扬的奢居美学。",
  },
];

export function getStyleTemplate(id: string | null | undefined): StyleTemplate | undefined {
  if (!id) return undefined;
  return STYLE_TEMPLATES.find((s) => s.id === id);
}

export function getStylePromptSuffix(id: string | null | undefined): string {
  return getStyleTemplate(id)?.promptSuffix ?? "";
}

/** 在用户原 prompt 后追加风格补充词。绝不替换原始 prompt。 */
export function applyStyleSuffix(prompt: string, styleId: string | null | undefined): string {
  const suffix = getStylePromptSuffix(styleId).trim();
  const base = (prompt ?? "").trim();
  if (!suffix) return base;
  return base ? `${base}\n\n${suffix}` : suffix;
}
