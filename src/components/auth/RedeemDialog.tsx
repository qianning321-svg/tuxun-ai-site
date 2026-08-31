import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { listVisibleRechargePackages, redeemCoupon } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Gift, Sparkles, Check, Zap, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

type Plan = {
  id: string;
  title: string;
  price: string;
  subtitle: string;
  credits: number;
  features: string[];
  highlighted?: boolean;
  isPopular?: boolean;
  badgeText?: string;
  icon?: React.ReactNode;
};

const PLANS: Plan[] = [
  {
    id: "trial",
    title: "体验权益包",
    price: "内测",
    subtitle: "适合初次体验的内测用户",
    credits: 1000,
    features: ["1,000 权益点", "基础创作能力", "标准任务队列"],
  },
  {
    id: "starter",
    title: "入门权益包",
    price: "内测",
    subtitle: "轻量级创作者的首选",
    credits: 3000,
    features: ["3,000 权益点", "基础创作能力", "标准任务队列"],
  },
  {
    id: "core",
    title: "进阶权益包",
    price: "内测",
    subtitle: "适合持续进行日常创作",
    credits: 7000,
    features: ["7,000 权益点", "进阶创作能力", "优先任务队列"],
    highlighted: true,
    isPopular: true,
    badgeText: "最受欢迎",
    icon: <Zap className="h-4 w-4" />,
  },
  {
    id: "pro",
    title: "专业权益包",
    price: "内测",
    subtitle: "为高频重度使用者打造",
    credits: 13000,
    features: ["13,000 权益点", "专业创作能力", "优先任务队列", "专属服务支持"],
  },
  {
    id: "premium",
    title: "团队权益包",
    price: "内测",
    subtitle: "适合工作室与团队协作",
    credits: 20000,
    features: ["20,000 权益点", "团队创作能力", "优先任务队列", "团队服务支持"],
    icon: <Crown className="h-4 w-4" />,
  },
];

type RechargePackageRow = {
  id: string;
  title: string;
  subtitle?: string;
  price: string;
  credits: number;
  features: string[];
  badgeText?: string;
  isPopular?: boolean;
  highlighted?: boolean;
};

function toPlan(row: RechargePackageRow): Plan {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? "",
    price: row.price,
    credits: Number(row.credits ?? 0),
    features: Array.isArray(row.features) ? row.features : [],
    badgeText: row.badgeText ?? "",
    isPopular: Boolean(row.isPopular),
    highlighted: Boolean(row.highlighted),
  };
}

export function RedeemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [plans, setPlans] = useState<Plan[]>(PLANS);
  const fn = useServerFn(redeemCoupon);
  const listPackages = useServerFn(listVisibleRechargePackages);
  const { refreshProfile } = useAuth();

  useEffect(() => { if (!open) setCode(""); }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listPackages({})
      .then((rows: any) => {
        const next = Array.isArray(rows) ? rows.map(toPlan).filter((plan) => plan.title.trim()) : [];
        if (!cancelled) setPlans(next.length > 0 ? next : PLANS);
      })
      .catch(() => {
        if (!cancelled) {
          setPlans(PLANS);
          toast.info("权益配置读取失败，已使用默认展示");
        }
      });
    return () => { cancelled = true; };
  }, [open, listPackages]);

  // 5s cooldown countdown to throttle repeated clicks
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    if (!code.trim() || loading || cooldown > 0) return;
    setLoading(true);
    setCooldown(5);
    try {
      const r = await fn({ data: { code: code.trim() } });
      if (r.success) {
        toast.success(`积分已成功入账！本次到账 ${r.amount} 点`);
        await refreshProfile();
        onOpenChange(false);
      } else {
        toast.error(r.message || "兑换失败");
      }
    } catch (e: any) {
      toast.error(e.message || "兑换失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-6xl max-h-[calc(100dvh-1rem)] overflow-y-auto border-border/70 bg-card/90 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-2xl md:max-h-[92vh] md:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Gift className="h-5 w-5 text-primary" /> 内测权益中心
          </DialogTitle>
          <p className="text-xs text-muted-foreground">内测权益配置将在后续开放</p>
        </DialogHeader>

        {/* 内测权益展示区 */}
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 md:gap-4 lg:grid-cols-5">
          {plans.map((p) => (
              <PlanCard key={p.id} plan={p} />
          ))}
        </div>

        {/* 兑换码区 */}
        <div className="mt-6 w-full rounded-2xl border border-emerald-500/30 bg-gray-900/50 p-4 shadow-[0_0_15px_rgba(16,185,129,0.15)] backdrop-blur-sm md:mt-8 md:p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-base font-bold text-emerald-400">内测兑换码</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="请输入内测兑换码"
              className="h-11 min-w-0 flex-1 border-emerald-500/20 bg-black/40 font-mono tracking-wider text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-emerald-500/40"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              disabled={loading || cooldown > 0}
            />
            <Button
              onClick={submit}
              disabled={loading || cooldown > 0 || !code.trim()}
              className="h-11 w-full bg-emerald-500 font-semibold text-white shadow-[0_0_18px_rgba(16,185,129,0.45)] hover:bg-emerald-400 sm:w-auto sm:min-w-[110px]"
            >
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  兑换中…
                </span>
              ) : cooldown > 0 ? (
                `请稍候 ${cooldown}s`
              ) : (
                "确认兑换"
              )}
            </Button>
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            兑换功能暂未开放，仅供后续客户配置
          </p>
        </div>

      </DialogContent>
    </Dialog>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const highlight = plan.highlighted || plan.isPopular;
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-2xl p-4 transition-all duration-300 md:p-5",
        "hover:-translate-y-1",
        highlight
          ? "bg-zinc-900 shadow-[0_0_28px_rgba(16,185,129,0.28)] md:scale-[1.03] lg:scale-[1.06]"
          : "border border-zinc-800 bg-zinc-900/50 hover:border-zinc-600 hover:shadow-lg hover:shadow-black/30",
      )}
    >
      {/* 高亮卡片：径向翡翠光晕 + 2px 渐变描边 */}
      {highlight && (
        <>
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background:
                "radial-gradient(120% 80% at 50% 0%, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.06) 35%, rgba(0,0,0,0) 70%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl p-[2px] bg-gradient-to-br from-emerald-400 to-cyan-500"
            style={{
              WebkitMask:
                "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />
        </>
      )}

      {/* 角标：右上角 */}
      {(plan.isPopular || plan.badgeText) && (
        <div className="absolute -top-2.5 right-2 z-10 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_4px_14px_rgba(16,185,129,0.45)] md:-right-2">
          {plan.badgeText || "最受欢迎"}
        </div>
      )}

      <div className="relative flex items-center gap-2">
        {plan.icon && <span className={highlight ? "text-emerald-400" : "text-zinc-400"}>{plan.icon}</span>}
        <h3 className={cn("text-base font-semibold", highlight ? "text-white" : "text-zinc-100")}>{plan.title}</h3>
      </div>
      <p className="relative mt-1 text-xs text-zinc-400">{plan.subtitle}</p>

      <div className="relative mt-4 flex items-baseline gap-1">
        <span className={cn("text-sm", highlight ? "text-zinc-300" : "text-zinc-500")}>阶段</span>
        <span
          className={cn(
            "font-bold tabular-nums leading-none",
            highlight ? "text-4xl text-white drop-shadow-[0_2px_8px_rgba(16,185,129,0.35)] md:text-5xl" : "text-4xl text-zinc-100",
          )}
        >
          {plan.price}
        </span>
      </div>

      <ul className="relative mt-4 flex-1 space-y-2">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-zinc-300">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        disabled
        className="relative mt-5 w-full cursor-not-allowed border border-zinc-700 bg-zinc-800/60 font-semibold text-zinc-400 opacity-70 shadow-none"
      >
        兑换功能暂未开放
      </Button>
    </div>
  );
}
