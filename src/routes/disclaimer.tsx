import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/disclaimer")({
  component: DisclaimerPage,
  head: () => ({
    meta: [
      { title: "用户声明与免责声明 — 沐莫" },
      { name: "description", content: "沐莫 AI 用户声明与免责声明，使用本平台前请仔细阅读。" },
      { property: "og:title", content: "用户声明与免责声明 — 沐莫" },
      { property: "og:description", content: "沐莫 AI 用户声明与免责声明，使用本平台前请仔细阅读。" },
    ],
  }),
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-display text-lg font-semibold text-foreground sm:text-xl">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{children}</div>
    </section>
  );
}

function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← 返回首页</Link>
        </div>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">用户声明与免责声明</h1>
        <p className="mt-3 text-sm text-muted-foreground">最后更新：2026 年</p>

        <Section title="免责声明">
          <p>欢迎使用沐莫 AI（以下简称"本平台"）。</p>
          <p>
            在使用本平台服务前，请您仔细阅读并理解以下内容。一旦您注册、登录、上传图片、输入提示词、点击生成、下载图片、充值积分、兑换积分或继续使用本平台，即视为您已阅读、理解并同意本声明的全部内容。
          </p>
        </Section>

        <Section title="用户责任">
          <p>本平台为 AI 图像生成工具，仅提供技术服务。用户应对其生成、上传、发布、传播、下载、商用及使用的全部内容承担全部责任。</p>
          <p>用户不得利用本平台生成、上传、下载、发布、传播或使用任何违法违规、侵权或违反公序良俗的内容。</p>
        </Section>

        <Section title="禁止内容与违规使用声明">
          <p>用户不得利用沐莫 AI 上传、输入、生成、下载、发布、传播、商用或以其他方式使用任何违法违规、侵权或违反公序良俗的内容，包括但不限于：</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>色情、低俗、露骨、性暗示、未成年人相关不当内容；</li>
            <li>毒品、吸毒、制毒、贩毒、违禁药品、管制物品相关内容；</li>
            <li>赌博、诈骗、洗钱、非法集资、虚假投资、非法金融活动相关内容；</li>
            <li>暴力、血腥、自残、自杀、恐怖主义、极端主义、仇恨歧视相关内容；</li>
            <li>政治敏感、违法宣传、煽动对立、破坏社会秩序、损害国家安全或公共利益的内容；</li>
            <li>侵犯他人肖像权、名誉权、隐私权、著作权、商标权、专利权、商业秘密或其他合法权益的内容；</li>
            <li>未经授权使用他人照片、明星名人肖像、品牌商标、商品包装、影视角色、艺术作品、设计作品等内容；</li>
            <li>利用 AI 生成换脸、伪造身份、冒充他人、虚假证件、虚假新闻、虚假广告、误导公众或损害他人权益的内容；</li>
            <li>涉及医疗、法律、金融、证券、保险等专业领域的误导性结论、虚假承诺或违规宣传内容；</li>
            <li>任何违反用户所在国家或地区法律法规、平台规则、公序良俗或本平台规则的内容。</li>
          </ul>
          <p>
            用户应确保其上传的参考图、输入的提示词、生成结果及后续使用方式均合法合规。因用户违反上述规定而产生的投诉、侵权纠纷、行政处罚、刑事责任、民事赔偿、平台封禁、商业损失或其他后果，均由用户自行承担。
          </p>
        </Section>

        <Section title="知识产权">
          <p>用户对其依法生成的内容享有相应使用权，但用户应确保其输入内容、上传图片及生成结果不侵犯任何第三方合法权益。</p>
          <p>用户不得上传、使用或生成侵犯他人著作权、商标权、专利权、商业秘密、肖像权、名誉权、隐私权或其他合法权益的内容。</p>
          <p>因用户行为导致的知识产权纠纷、侵权投诉、赔偿请求、平台下架、账号封禁或其他法律后果，由用户自行承担全部责任。</p>
        </Section>

        <Section title="肖像权与身份伪造声明">
          <p>用户不得利用本平台进行换脸、伪造身份、冒充他人、虚构人物身份、制作误导性人像内容，或未经授权使用他人肖像、照片、视频截图、社交媒体图片等素材。</p>
          <p>未经本人或权利人明确授权，用户不得生成、发布、传播或商用涉及他人肖像、姓名、身份特征、声音、形象、品牌身份或其他可识别信息的内容。</p>
          <p>因用户违反肖像权、名誉权、隐私权或身份权相关规定而产生的任何责任，由用户自行承担。</p>
        </Section>

        <Section title="AI 生成内容说明">
          <p>本平台生成内容由人工智能模型自动生成，结果可能存在：</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>偏差</li>
            <li>错误</li>
            <li>不准确</li>
            <li>不符合预期</li>
            <li>画面异常</li>
            <li>文字错误</li>
            <li>细节缺失</li>
            <li>与用户意图不一致</li>
          </ul>
          <p>本平台不对生成内容的准确性、完整性、合法性、可用性、商业适用性、版权归属或平台审核通过率作任何明示或暗示保证。</p>
          <p>
            用户理解并同意，本平台生成的图片属于 AI 生成或 AI 辅助生成内容。用户在下载、发布、传播、商用或再次分发生成内容前，应自行审查内容是否合法合规，并根据适用法律法规、平台规则和实际使用场景进行必要的 AI 生成内容声明或标识。
          </p>
        </Section>

        <Section title="参考图与上传素材声明">
          <p>用户上传参考图、产品图、人物图、品牌图、商标图或其他素材时，应确保自己拥有合法使用权或已取得必要授权。</p>
          <p>用户不得上传未经授权的人像照片、身份证件、营业执照、银行卡、隐私截图、他人作品、商业素材、未授权品牌图片或其他敏感内容。</p>
          <p>用户上传图片后，系统可能会进行压缩、格式转换、缩略图生成、临时存储或用于生成任务处理。</p>
          <p>因用户上传、使用未经授权素材导致的侵权、投诉、索赔或法律责任，由用户自行承担。</p>
        </Section>

        <Section title="生成结果使用声明">
          <p>用户下载、保存、发布、商用或传播生成图片前，应自行审查生成结果是否合法、合规、准确、适合使用。</p>
          <p>本平台不对生成内容的商业适用性、版权归属、商标合规、广告合规、肖像授权、平台审核通过率作出保证。</p>
          <p>用户将生成图片用于电商、广告、社交媒体、印刷、产品包装、商业宣传等场景时，应自行承担审查义务。</p>
          <p>若生成结果与他人作品、品牌、人物、商品、场景存在相似性，用户应自行评估侵权风险并谨慎使用。</p>
        </Section>

        <Section title="平台免责">
          <p>对于因以下原因导致的任何损失，本平台不承担责任：</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>用户违规使用平台；</li>
            <li>用户上传、输入、生成、下载、发布、传播或商用内容导致的纠纷；</li>
            <li>第三方侵权行为；</li>
            <li>AI 生成内容引发的争议；</li>
            <li>网络故障、服务中断或不可抗力；</li>
            <li>第三方模型服务、云服务、数据库服务、支付服务异常；</li>
            <li>用户账号被盗、兑换码泄露、数据丢失等情况；</li>
            <li>用户违反当地法律法规、平台规则或本声明造成的任何损失。</li>
          </ul>
        </Section>

        <Section title="内容审核与处理">
          <p>本平台有权对涉嫌违规的内容、账号、订单、积分、生成记录及相关操作进行审核，并有权在不提前通知的情况下采取包括但不限于以下措施：</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>拒绝生成；</li>
            <li>删除违规内容；</li>
            <li>限制部分功能；</li>
            <li>暂停或封禁账号；</li>
            <li>冻结或扣除违规获得或使用的积分；</li>
            <li>保存必要证据；</li>
            <li>根据法律法规或监管要求配合处理。</li>
          </ul>
        </Section>

        <Section title="积分、充值与兑换声明">
          <p>本平台积分仅用于站内 AI 生成及相关功能消耗，不等同于现金、虚拟货币或金融资产。</p>
          <p>用户应通过官方渠道充值或兑换积分。因用户输入错误、泄露兑换码、非官方渠道购买、违规使用或账号异常导致的损失，由用户自行承担。</p>
          <p>如出现订单异常、兑换失败、积分未到账等问题，用户可联系平台客服，并提供必要订单信息以便核查。</p>
        </Section>

        <Section title="服务变更">
          <p>本平台有权根据业务调整、系统维护、第三方服务变化、法律法规要求或风控需要，随时调整、暂停或终止部分或全部服务，无需另行通知。</p>
          <p>本平台会尽力保障服务稳定，但不保证服务永不中断、不出错或始终满足用户需求。</p>
        </Section>

        <Section title="法律适用">
          <p>用户应遵守所在国家或地区相关法律法规。因使用本平台产生的争议，应依据适用法律解决。</p>
          <p>继续使用本平台，即视为您已同意本《用户声明与免责声明》全部内容。</p>
        </Section>

        <Section title="特别提示">
          <p className="rounded-lg border border-border bg-white/[0.03] p-4 text-foreground">
            禁止利用 AI 生成功能进行色情、毒品、赌博、诈骗、政治敏感、侵犯肖像权、侵犯知识产权、换脸、伪造身份、冒充他人或其他违法违规内容。
          </p>
        </Section>

        <div className="mt-10 border-t border-border pt-6 text-center">
          <Link to="/" className="text-sm text-primary hover:underline">返回首页</Link>
        </div>
      </div>
    </div>
  );
}
