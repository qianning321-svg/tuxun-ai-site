import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Check, CreditCard, Gift, Headphones, History, Sparkles, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { UserMenu } from "@/components/auth/UserMenu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnnouncementCenter } from "./AnnouncementCenter";
import { AdBanner } from "./AdBanner";
import { getGlobalConfig, listAnnouncements, listVisibleRechargePackages, redeemCode as redeemCodeFn } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";
import { canAccessAnnouncements, shouldStartAnnouncementAutoOpen } from "./announcement-access";

const ContactDialog = lazy(() =>
  import("./ContactDialog").then((module) => ({ default: module.ContactDialog })),
);

type Props = {
  credits: number;
  onOpenHistory?: () => void;
  onOpenAnnouncements?: () => void;
  onSwitchAccount: () => void;
};

type SiteConfig = { brandName: string; logoPath: string; subtitle: string };
type RechargePackage = {
  id: string;
  name: string;
  credits: number;
  price_text: string;
  badge: string | null;
  description: string | null;
  button_text: string | null;
  is_popular: number;
  is_highlighted: number;
  benefits_text: string | null;
  buy_url: string | null;
};
const DEFAULT_SITE: SiteConfig = { brandName: "TuXun AI", logoPath: "/mumo-logo.png", subtitle: "TUXUN AI VISUAL STUDIO" };

export function TopBar({ credits, onOpenHistory, onSwitchAccount }: Props) {
  const fetchConfig = useServerFn(getGlobalConfig);
  const fetchAnnouncements = useServerFn(listAnnouncements);
  const fetchPackages = useServerFn(listVisibleRechargePackages);
  const redeem = useServerFn(redeemCodeFn);
  const { loading: authLoading, session, refreshProfile } = useAuth();
  const [site, setSite] = useState<SiteConfig>(DEFAULT_SITE);
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [redeemHint, setRedeemHint] = useState("请输入 MUMO 兑换码");
  const [displayCredits, setDisplayCredits] = useState(credits);
  const [contactOpen, setContactOpen] = useState(false);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemMessage, setRedeemMessage] = useState("");
  const hasAutoOpenedAnnouncements = useRef(false);
  const canUseAnnouncements = canAccessAnnouncements(authLoading, session?.user.id);

  useEffect(() => setDisplayCredits(credits), [credits]);

  useEffect(() => {
    fetchConfig({}).then((value: any) => {
      if (value?.site) setSite({ ...DEFAULT_SITE, ...value.site });
      if (value?.redeem?.formatHint) setRedeemHint(String(value.redeem.formatHint));
    }).catch(() => {});
    fetchPackages({}).then((rows: unknown) => setPackages((rows ?? []) as RechargePackage[])).catch(() => setPackages([]));
  }, [fetchConfig, fetchPackages]);

  useEffect(() => {
    if (!canUseAnnouncements) {
      setAnnouncementsOpen(false);
      return;
    }
    if (!shouldStartAnnouncementAutoOpen(canUseAnnouncements, hasAutoOpenedAnnouncements.current)) return;
    hasAutoOpenedAnnouncements.current = true;
    let active = true;
    fetchAnnouncements({}).then((rows: unknown) => {
      if (active && Array.isArray(rows) && rows.length > 0) setAnnouncementsOpen(true);
    }).catch(() => {});
    return () => { active = false; };
  }, [canUseAnnouncements, session?.user.id, fetchAnnouncements]);

  const validateRedeemCode = async () => {
    const value = redeemCode.trim();
    if (!value) {
      setRedeemMessage("请输入兑换码");
      return;
    }
    try {
      const result: any = await redeem({ data: { code: value } });
      if (!result?.success) { setRedeemMessage(result?.message || "兑换码不存在或已失效"); return; }
      setDisplayCredits(Number(result.balance ?? displayCredits + Number(result.credits ?? 0)));
      setRedeemCode(""); setRedeemMessage(""); setRedeemOpen(false);
      await refreshProfile();
      toast.success(`兑换成功，已获得 ${Number(result.credits ?? 0).toLocaleString()} 创作点`);
    } catch (error: any) {
      setRedeemMessage(error.message || "后台数据服务未配置");
    }
  };

  const openPurchase = (url: string | null) => {
    if (!url || !/^https?:\/\//i.test(url)) { toast.info("购买链接暂未配置，请联系客服"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <header className="relative z-40 flex min-h-16 w-full shrink-0 flex-wrap items-center gap-2 border-b border-slate-500/10 bg-white/55 px-3 py-2 shadow-[0_10px_35px_-28px_rgba(45,62,82,.45)] backdrop-blur-2xl transition-colors duration-300 dark:border-white/[0.07] dark:bg-[#111a27]/78 dark:shadow-[0_12px_35px_-28px_rgba(0,0,0,.8)] md:h-16 md:flex-nowrap md:px-6 md:py-0">
      <Link to="/" className="group flex shrink-0 items-center gap-3 rounded-xl pr-3 focus:outline-none">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/70 bg-white/45 dark:border-white/10 dark:bg-white/[0.04]">
          <img src="/mumo-logo.png" alt={site.brandName} className="h-8 w-9 object-contain" />
        </span>
        <span className="min-w-0">
          <span className="block whitespace-nowrap text-base font-semibold tracking-[0.08em] text-slate-900 dark:text-slate-100 md:text-lg">{site.brandName}</span>
          <span className="hidden whitespace-nowrap text-[9px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 sm:block">{site.subtitle}</span>
        </span>
        <span className="mumo-workspace-badge hidden lg:inline-flex">
          电商视觉工作台
        </span>
      </Link>

      <AdBanner />

      <nav className="hidden items-center gap-1 lg:flex">
        <NavLinkTo to="/">在线创作</NavLinkTo>
        <NavLinkTo to="/inspiration">模板灵感</NavLinkTo>
      </nav>

      <div className="ml-auto flex min-w-0 items-center justify-end gap-1 md:gap-1.5">
        {canUseAnnouncements && <TopAction title="公告栏" label="公告" onClick={() => setAnnouncementsOpen(true)}>
          <Bell className="h-4 w-4" />
        </TopAction>}
        <TopAction title="在线客服" label="客服" onClick={() => setContactOpen(true)}>
          <Headphones className="h-4 w-4" />
        </TopAction>
        <TopAction title="充值" label="充值" onClick={() => setRechargeOpen(true)}>
          <CreditCard className="h-4 w-4" />
        </TopAction>
        <TopAction title="兑换兑换码" label="兑换" onClick={() => setRedeemOpen(true)}>
          <Gift className="h-4 w-4" />
        </TopAction>
        {onOpenHistory && (
          <TopAction title="历史记录" label="历史记录" onClick={onOpenHistory}>
            <History className="h-4 w-4" />
          </TopAction>
        )}
        <div className="hidden h-7 w-px bg-slate-400/20 dark:bg-white/10 sm:block" />
        <div className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/70 bg-white/45 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.05] sm:flex">
          <Zap className="h-3.5 w-3.5 text-[#a4874f]" fill="currentColor" />
          <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{displayCredits.toLocaleString()}</span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500">创作点</span>
        </div>
        <UserMenu onSwitchAccount={onSwitchAccount} />
      </div>

      {contactOpen && (
        <Suspense fallback={null}>
          <ContactDialog open={contactOpen} onOpenChange={setContactOpen} />
        </Suspense>
      )}

      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogContent className="mumo-recharge-dialog mumo-recharge-dialog--packages p-4 md:p-5">
          <DialogHeader className="mumo-recharge-dialog__header">
            <div className="mumo-recharge-dialog__icon mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border">
              <CreditCard className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl text-[#f5f7ff]">购买兑换码</DialogTitle>
            <DialogDescription className="pt-1 text-sm leading-6 text-[#8793b3]">选择适合的创作点套餐，前往管理员配置的第三方发卡平台购买兑换码。</DialogDescription>
          </DialogHeader>
          <div className="mumo-recharge-grid mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((plan) => (
              <div
                key={plan.id}
                className={`mumo-package-card relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl border p-4 ${
                  Number(plan.is_highlighted) === 1
                    ? "mumo-package-card--featured"
                    : "mumo-package-card--standard"
                }`}
              >
                <div className="flex min-h-7 flex-wrap items-start gap-2">
                  {Number(plan.is_popular) === 1 && (
                    <span className="mumo-package-card__popular inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white">
                      <Sparkles className="h-3 w-3" />最受欢迎
                    </span>
                  )}
                  {plan.badge && <span className="mumo-package-card__badge rounded-full border px-2.5 py-1 text-[10px] font-medium">{plan.badge}</span>}
                </div>
                <p className="mt-4 text-lg font-semibold text-[#f5f7ff]">{plan.name}</p>
                {plan.description && <p className="mt-1 min-h-10 text-xs leading-5 text-[#8793b3]">{plan.description}</p>}
                <p className="mt-5 font-mono text-3xl font-semibold tracking-tight text-[#f8faff]">{plan.price_text}</p>
                <div className="mumo-package-card__credits mt-3 rounded-xl border px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[#8793b3]">创作点</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold text-[#e6ebff]">{Number(plan.credits ?? 0).toLocaleString()}</p>
                </div>
                <ul className="mt-4 flex-1 space-y-2.5">
                  {getPackageBenefits(plan).map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2 text-xs leading-5 text-[#aab4cf]">
                      <Check className="mumo-package-card__check mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => openPurchase(plan.buy_url)}
                  aria-disabled={!hasValidBuyLink(plan.buy_url)}
                  className={`mumo-package-card__cta mt-5 h-10 w-full rounded-xl text-xs font-semibold ${
                    hasValidBuyLink(plan.buy_url)
                      ? "mumo-package-card__cta--active"
                      : "mumo-package-card__cta--disabled"
                  }`}
                >
                  {hasValidBuyLink(plan.buy_url) ? (plan.button_text?.trim() || "前往购买") : "暂未配置"}
                </button>
              </div>
            ))}
            {!packages.length && <p className="col-span-full py-8 text-center text-sm text-slate-400">后台数据服务未配置</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={redeemOpen}
        onOpenChange={(open) => {
          setRedeemOpen(open);
          if (!open) {
            setRedeemCode("");
            setRedeemMessage("");
          }
        }}
      >
        <DialogContent className="mumo-recharge-dialog max-w-sm p-6">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#c5a96f]/25 bg-[#e7d9bb]/25 text-[#8d7344] dark:border-[#d2ba86]/20 dark:bg-[#d2ba86]/10 dark:text-[#d8c18f]">
              <Gift className="h-5 w-5" />
            </div>
            <DialogTitle className="text-lg text-slate-900 dark:text-slate-100">兑换码</DialogTitle>
            <DialogDescription className="pt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{redeemHint}</DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <input
              value={redeemCode}
              onChange={(event) => {
                setRedeemCode(event.target.value.toUpperCase());
                setRedeemMessage("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void validateRedeemCode();
              }}
              placeholder="请输入兑换码"
              aria-label="兑换码"
              className="h-11 w-full rounded-xl border border-slate-300/60 bg-white/65 px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-500/60 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {redeemMessage && <p role="status" className="text-xs text-[#8a6d37] dark:text-[#d8c18f]">{redeemMessage}</p>}
            <button
              type="button"
              onClick={validateRedeemCode}
              className="h-11 w-full rounded-xl bg-slate-800 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              确认兑换
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {canUseAnnouncements && <AnnouncementCenter authenticated open={announcementsOpen} onOpenChange={setAnnouncementsOpen} />}

    </header>
  );
}

function TopAction({ children, label, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      {...rest}
      className="group flex h-9 items-center justify-center gap-1.5 rounded-xl border border-transparent px-2 text-slate-500 transition-all hover:border-white/75 hover:bg-white/55 hover:text-slate-900 hover:shadow-sm dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/[0.06] dark:hover:text-slate-100 md:px-2.5"
    >
      <span className="transition-transform group-hover:scale-105">{children}</span>
      <span className="hidden text-[11px] font-medium xl:inline">{label}</span>
    </button>
  );
}

function NavLinkTo({ to, children }: { to: "/" | "/inspiration"; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-lg px-3 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:bg-white/45 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
      activeProps={{ className: "rounded-lg bg-white/60 px-3 py-2 text-[11px] font-medium text-slate-900 shadow-sm dark:bg-white/[0.08] dark:text-slate-100" }}
    >
      {children}
    </Link>
  );
}

function hasValidBuyLink(url: string | null) {
  return Boolean(url && /^https?:\/\//i.test(url));
}

function getPackageBenefits(plan: RechargePackage) {
  const benefits = String(plan.benefits_text ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return benefits.length > 0 ? benefits : [`兑换后获得 ${Number(plan.credits ?? 0).toLocaleString()} 创作点`];
}
