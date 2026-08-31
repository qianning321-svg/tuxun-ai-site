// 简单的违规提示词检测：前后端共用。
// 仅做基础关键词匹配，去空格 + 小写。
// 不对外暴露命中词，只返回类别（用于日志），用户侧只显示统一文案。

export type SafetyCategory =
  | "porn"
  | "drugs"
  | "gambling_fraud"
  | "violence"
  | "politics"
  | "infringement"
  | "illegal_ads";

const KEYWORDS: Record<SafetyCategory, string[]> = {
  porn: [
    "色情","裸露","裸体","性爱","性暗示","约炮","成人视频","未成年色情","儿童色情",
    "裸照","私密照","淫秽","成人内容","av女优","porn","nude","nsfw","sex","xxx",
    "loli","lolita","萝莉色","幼女","童交",
  ],
  drugs: [
    "吸毒","贩毒","制毒","冰毒","海洛因","可卡因","大麻","摇头丸","违禁药品","管制药品",
    "heroin","cocaine","meth","methamphetamine",
  ],
  gambling_fraud: [
    "赌博","博彩","赌球","彩票套利","诈骗","洗钱","非法集资","资金盘","杀猪盘",
    "钓鱼网站","盗号","casino","gambling",
  ],
  violence: [
    "血腥","虐杀","分尸","恐怖袭击","爆炸","炸弹","枪杀","屠杀","自残","自杀",
    "极端组织","恐怖主义","terrorist","massacre",
  ],
  politics: [
    "政治敏感","煽动","颠覆","分裂国家","违法宣传","极端政治","非法集会","暴乱",
    "六四","法轮功",
  ],
  infringement: [
    "换脸","ai换脸","deepfake","伪造身份","冒充他人","身份证","护照","银行卡",
    "明星裸照","名人换脸","侵犯肖像权","盗用照片","仿冒品牌","假冒商标",
  ],
  illegal_ads: [
    "假证","办证","代开发票","黑产","灰产","外挂","破解软件","木马","病毒",
    "黑客攻击","盗取账号",
  ],
};

export interface SafetyResult {
  allowed: boolean;
  category?: SafetyCategory;
}

export function checkPromptSafety(prompt: string): SafetyResult {
  if (!prompt) return { allowed: true };
  const normalized = prompt.toLowerCase().replace(/\s+/g, "");
  for (const [cat, words] of Object.entries(KEYWORDS) as [SafetyCategory, string[]][]) {
    for (const w of words) {
      if (!w) continue;
      if (normalized.includes(w.toLowerCase().replace(/\s+/g, ""))) {
        return { allowed: false, category: cat };
      }
    }
  }
  return { allowed: true };
}

export const SAFETY_BLOCK_MESSAGE =
  "当前提示词可能包含违规或敏感内容，请修改后再试。";
export const SAFETY_SERVER_BLOCK_MESSAGE =
  "当前内容无法生成，请调整提示词后重试。";
