import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGetAnalytics } from "@/lib/admin.functions";
import { TrendingUp, Users, Zap, Ticket, Sparkles, ArrowUpRight, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Metrics = { todayUsers: number; todayCost: number; totalUsers: number; unusedCoupons: number };
type ModelStat = { model: string; todayCount: number; totalCount: number; totalCost: number };
type Reg = { id: string; email: string | null; credits: number; created_at: string };
type Data = {
  metrics: Metrics;
  models: ModelStat[];
  todayRegistrations: Reg[];
  dayRange?: { timezone: string; startUtc: string; endUtc: string };
};

export function AnalyticsPanel() {
  const fn = useServerFn(adminGetAnalytics);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await fn({}) as Data); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const m = data?.metrics;
  const totalModelCount = (data?.models ?? []).reduce((s, r) => s + r.totalCount, 0) || 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">运营总览</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">今日统计按北京时间 00:00 刷新</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />刷新
        </Button>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={<Users className="h-4 w-4" />} label="今日注册用户" value={m?.todayUsers ?? 0} trend />
        <MetricCard icon={<Zap className="h-4 w-4" />} label="今日总消耗算力" value={(m?.todayCost ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} trend />
        <MetricCard icon={<Wallet className="h-4 w-4" />} label="今日上游成本" value="未记录" />
        <MetricCard icon={<Sparkles className="h-4 w-4" />} label="历史注册总用户" value={m?.totalUsers ?? 0} />
        <MetricCard icon={<Ticket className="h-4 w-4" />} label="剩余有效兑换码" value={m?.unusedCoupons ?? 0} />
      </div>

      {/* Model usage */}
      <div className="rounded-xl border border-border/60 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-medium">模型消耗大盘</h4>
          <span className="text-[10px] text-muted-foreground">按累计调用次数排序</span>
        </div>
        <div className="space-y-3">
          {(data?.models ?? [])
            .slice()
            .sort((a, b) => b.totalCount - a.totalCount)
            .map((r) => {
              const pct = Math.round((r.totalCount / totalModelCount) * 100);
              return (
                <div key={r.model} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{r.model}</span>
                    <span className="text-muted-foreground tabular-nums">
                      累计 <span className="text-foreground font-mono">{r.totalCount.toLocaleString()}</span> · 今日 <span className="text-primary font-mono">{r.todayCount}</span> · 占比 {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-aurora shadow-glow transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          {(data?.models ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">暂无生成历史数据</p>
          )}
        </div>
      </div>

      {/* Today registrations feed */}
      <div className="rounded-xl border border-border/60 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-medium">今日注册流水</h4>
          <span className="text-[10px] text-muted-foreground">{data?.todayRegistrations.length ?? 0} 条</span>
        </div>
        <div className="max-h-[260px] space-y-1.5 overflow-auto pr-1 font-mono text-[11px]">
          {(data?.todayRegistrations ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border border-border/40 bg-white/[0.02] px-2.5 py-1.5">
              <span className="text-muted-foreground">{new Date(r.created_at).toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</span>
              <span className="text-foreground">-</span>
              <span className="text-foreground">{r.email ?? "未知邮箱"}</span>
              <span className="text-muted-foreground">注册成功，自动赠送</span>
              <span className="text-primary">{r.credits} 余额</span>
            </div>
          ))}
          {(data?.todayRegistrations ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">今日暂无新注册用户</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon, label, value, trend,
}: { icon: React.ReactNode; label: string; value: number | string; trend?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-aurora opacity-10 blur-2xl transition-opacity group-hover:opacity-25" />
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px]">{label}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
        {trend && (
          <span className="flex items-center gap-0.5 text-[10px] text-emerald-400">
            <ArrowUpRight className="h-3 w-3" /><TrendingUp className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}
