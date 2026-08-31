import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListUsers, adminResetPassword, adminAdjustCredits,
  adminBanUser, adminDeleteUser,
  adminGetUserCreditUsageLogs,
} from "@/lib/admin.functions";
import { toast } from "sonner";
import { Shield, KeyRound, Coins, Copy, RefreshCw, Users, Ticket, LayoutDashboard, Trash2, Sparkles, Megaphone, Crown, Lock, Palette, Ban, CircleCheck, Bell, ShoppingBag, Save, Settings2, Images } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { AdsPanel } from "./AdsPanel";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { AdminsPanel } from "./AdminsPanel";
import { AccessGate } from "./AccessGate";
import { AccessPasswordPanel } from "./AccessPasswordPanel";
import { RechargePackagesPanel } from "./RechargePackagesPanel";
import { RedeemCodesPanel } from "./RedeemCodesPanel";
import { ModelsPanel } from "./ModelsPanel";
import { StyleTemplatesPanel } from "./StyleTemplatesPanel";
import { adminGetGlobalConfig, adminUpdateGlobalConfig } from "@/lib/admin.functions";

type UserRow = { id: string; email: string | null; display_name: string | null; credits: number; created_at: string; total_spent: number; is_banned?: boolean };
type CreditUsageLog = {
  id: string;
  user_id: string;
  amount: number | string;
  source: string;
  model_key: string | null;
  model_name: string | null;
  generation_history_id: string | null;
  generation_task_id: string | null;
  image_url?: string | null;
  idempotency_key: string;
  created_at: string;
  metadata?: unknown;
};

type AdminDashboardProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isFounder?: boolean;
};

export function AdminDashboard({ open, onOpenChange, isFounder = false }: AdminDashboardProps) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => { if (!open) setUnlocked(false); }, [open]);

  if (open && !unlocked) {
    return (
      <AccessGate
        open={open}
        onCancel={() => onOpenChange(false)}
        onPass={() => setUnlocked(true)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-32px)] w-[calc(100vw-24px)] max-w-6xl flex-col overflow-hidden border-border/70 bg-card/80 p-0 backdrop-blur-2xl sm:h-[min(860px,calc(100vh-48px))] sm:w-[calc(100vw-48px)]">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            {isFounder ? <Crown className="h-4 w-4 text-primary" /> : <Shield className="h-4 w-4 text-primary" />}
            {isFounder ? "\u521b\u59cb\u4eba\u540e\u53f0" : "\u7cfb\u7edf\u7ba1\u7406\u540e\u53f0"}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="analytics" className="flex min-h-0 min-w-0 flex-1 flex-col px-6 pb-6 pt-4">
          <div className="w-full max-w-full overflow-x-auto overflow-y-hidden pb-1">
          <TabsList className="inline-flex w-max min-w-max flex-nowrap bg-white/[0.04]">
            <TabsTrigger value="analytics" className="shrink-0 whitespace-nowrap gap-1.5"><LayoutDashboard className="h-3.5 w-3.5" />数据仪表盘</TabsTrigger>
            <TabsTrigger value="site" className="shrink-0 whitespace-nowrap gap-1.5"><Settings2 className="h-3.5 w-3.5" />站点与客服</TabsTrigger>
            <TabsTrigger value="users" className="shrink-0 whitespace-nowrap gap-1.5"><Users className="h-3.5 w-3.5" />用户管理</TabsTrigger>
            <TabsTrigger value="coupons" className="shrink-0 whitespace-nowrap gap-1.5"><Ticket className="h-3.5 w-3.5" />兑换码管理</TabsTrigger>
            <TabsTrigger value="recharge" className="shrink-0 whitespace-nowrap gap-1.5"><ShoppingBag className="h-3.5 w-3.5" />充值套餐</TabsTrigger>
            <TabsTrigger value="models" className="shrink-0 whitespace-nowrap gap-1.5"><Sparkles className="h-3.5 w-3.5" />模型配置</TabsTrigger>
            <TabsTrigger value="ads" className="shrink-0 whitespace-nowrap gap-1.5"><Megaphone className="h-3.5 w-3.5" />广告管理</TabsTrigger>
            <TabsTrigger value="announcements" className="shrink-0 whitespace-nowrap gap-1.5"><Bell className="h-3.5 w-3.5" />通知公告</TabsTrigger>
            <TabsTrigger value="styles" className="shrink-0 whitespace-nowrap gap-1.5"><Palette className="h-3.5 w-3.5" />模板配置</TabsTrigger>
            <TabsTrigger value="works" className="shrink-0 whitespace-nowrap gap-1.5"><Images className="h-3.5 w-3.5" />作品管理</TabsTrigger>
            {isFounder && (
              <TabsTrigger value="admins" className="shrink-0 whitespace-nowrap gap-1.5"><Crown className="h-3.5 w-3.5" />管理员管理</TabsTrigger>
            )}
            {isFounder && (
              <TabsTrigger value="access" className="shrink-0 whitespace-nowrap gap-1.5"><Lock className="h-3.5 w-3.5" />访问密码</TabsTrigger>
            )}
          </TabsList>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-2">
            <TabsContent value="analytics" className="mt-4"><AnalyticsPanel /></TabsContent>
            <TabsContent value="site" className="mt-4"><SiteAndContactConfigPanel /></TabsContent>
            <TabsContent value="users" className="mt-4"><UsersPanel /></TabsContent>
            <TabsContent value="coupons" className="mt-4 space-y-4"><RedeemCodesPanel /><RedeemConfigPanel /></TabsContent>
            <TabsContent value="recharge" className="mt-4"><RechargePackagesPanel /></TabsContent>
            <TabsContent value="models" className="mt-4"><ModelsPanel /></TabsContent>
            <TabsContent value="ads" className="mt-4"><AdsPanel /></TabsContent>
            <TabsContent value="announcements" className="mt-4"><AnnouncementsPanel /></TabsContent>
            <TabsContent value="styles" className="mt-4"><StyleTemplatesPanel /></TabsContent>
            <TabsContent value="works" className="mt-4"><WorksConfigPlaceholder /></TabsContent>
            {isFounder && <TabsContent value="admins" className="mt-4"><AdminsPanel /></TabsContent>}
            {isFounder && <TabsContent value="access" className="mt-4"><AccessPasswordPanel /></TabsContent>}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
function SiteAndContactConfigPanel() {
  const getConfig = useServerFn(adminGetGlobalConfig);
  const updateConfig = useServerFn(adminUpdateGlobalConfig);
  const [site, setSite] = useState({ brandName: "TuXun AI", logoPath: "/mumo-logo.png", subtitle: "TUXUN AI VISUAL STUDIO" });
  const [contact, setContact] = useState({ description: "", wechat: "", email: "", serviceHours: "", enabled: false });
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try { const value: any = await getConfig({}); if (value?.site) setSite((current) => ({ ...current, ...value.site })); if (value?.contact) setContact((current) => ({ ...current, ...value.contact })); }
    catch (error: any) { toast.error(error.message || "后台数据服务未配置"); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    try { await updateConfig({ data: { site, contact } }); setSaved(true); toast.success("站点与客服配置已保存"); }
    catch (error: any) { toast.error(error.message || "保存失败"); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ConfigCard title="站点配置" description="控制前台品牌区域的基础展示。">
        <ConfigField label="品牌名"><Input value={site.brandName} onChange={(event) => { setSaved(false); setSite({ ...site, brandName: event.target.value }); }} /></ConfigField>
        <ConfigField label="Logo 路径"><Input value={site.logoPath} onChange={(event) => { setSaved(false); setSite({ ...site, logoPath: event.target.value }); }} /></ConfigField>
        <ConfigField label="副标题"><Input value={site.subtitle} onChange={(event) => { setSaved(false); setSite({ ...site, subtitle: event.target.value }); }} /></ConfigField>
      </ConfigCard>
      <ConfigCard title="客服配置" description="控制前台客服弹窗展示的信息。">
        <ConfigField label="客服说明"><Input value={contact.description} onChange={(event) => { setSaved(false); setContact({ ...contact, description: event.target.value }); }} /></ConfigField>
        <div className="grid gap-3 sm:grid-cols-2">
          <ConfigField label="微信号"><Input value={contact.wechat} onChange={(event) => { setSaved(false); setContact({ ...contact, wechat: event.target.value }); }} /></ConfigField>
          <ConfigField label="邮箱"><Input value={contact.email} onChange={(event) => { setSaved(false); setContact({ ...contact, email: event.target.value }); }} /></ConfigField>
        </div>
        <ConfigField label="服务时间"><Input value={contact.serviceHours} onChange={(event) => { setSaved(false); setContact({ ...contact, serviceHours: event.target.value }); }} /></ConfigField>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={contact.enabled} onChange={(event) => { setSaved(false); setContact({ ...contact, enabled: event.target.checked }); }} />启用客服入口内容</label>
      </ConfigCard>
      <div className="flex items-center justify-end gap-3 lg:col-span-2">
        {saved && <span className="text-xs text-emerald-500">已保存到本地配置</span>}
        <Button onClick={save}><Save className="mr-1.5 h-3.5 w-3.5" />保存站点与客服配置</Button>
      </div>
    </div>
  );
}

function RedeemConfigPanel() {
  const getConfig = useServerFn(adminGetGlobalConfig);
  const updateConfig = useServerFn(adminUpdateGlobalConfig);
  const [redeem, setRedeem] = useState({ formatHint: "请输入 MUMO 兑换码", enabled: true });
  const [saved, setSaved] = useState(false);

  useEffect(() => { getConfig({}).then((value: any) => value?.redeem && setRedeem((current) => ({ ...current, ...value.redeem }))).catch((error: any) => toast.error(error.message || "后台数据服务未配置")); }, [getConfig]);

  const save = async () => {
    try { await updateConfig({ data: { redeem } }); setSaved(true); toast.success("兑换配置已保存"); }
    catch (error: any) { toast.error(error.message || "保存失败"); }
  };

  return (
    <ConfigCard title="兑换码配置" description="仅配置前台规则说明，不生成或校验真实兑换码。">
      <ConfigField label="兑换码格式说明"><Input value={redeem.formatHint} onChange={(event) => { setSaved(false); setRedeem({ ...redeem, formatHint: event.target.value }); }} /></ConfigField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={redeem.enabled} onChange={(event) => { setSaved(false); setRedeem({ ...redeem, enabled: event.target.checked }); }} />启用兑换功能展示</label>
      <div className="flex items-center justify-end gap-3 pt-2">
        {saved && <span className="text-xs text-emerald-500">已保存到本地配置</span>}
        <Button onClick={save}><Save className="mr-1.5 h-3.5 w-3.5" />保存兑换配置</Button>
      </div>
    </ConfigCard>
  );
}

function WorksConfigPlaceholder() {
  return (
    <ConfigCard title="作品管理" description="作品列表将在作品保存能力开放后展示。">
      <div className="rounded-xl border border-dashed border-border/70 py-12 text-center">
        <Images className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">暂无作品</p>
        <p className="mt-1 text-xs text-muted-foreground">当前仅保留管理入口占位</p>
      </div>
    </ConfigCard>
  );
}

function ConfigCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
      {children}
    </section>
  );
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1 text-[11px] text-muted-foreground"><span>{label}</span>{children}</label>;
}

function PreviewAnalytics() {
  const metrics = [
    { label: "用户数量", value: 0 },
    { label: "今日创作", value: 0 },
    { label: "未使用兑换码", value: 0 },
    { label: "作品数量", value: 0 },
  ];
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-medium">后台预览</h3><p className="mt-1 text-xs text-muted-foreground">正式统计将在管理员身份验证后显示。</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-border/60 bg-white/[0.03] p-4">
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p className="mt-2 font-mono text-2xl font-semibold">{metric.value.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">更多运营统计将在服务开放后展示</div>
    </section>
  );
}

function UsersPanel() {
  const list = useServerFn(adminListUsers);
  const usageList = useServerFn(adminGetUserCreditUsageLogs);
  const resetPw = useServerFn(adminResetPassword);
  const adjust = useServerFn(adminAdjustCredits);
  const banFn = useServerFn(adminBanUser);
  const delFn = useServerFn(adminDeleteUser);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pwOpen, setPwOpen] = useState<UserRow | null>(null);
  const [creditOpen, setCreditOpen] = useState<UserRow | null>(null);
  const [usageOpen, setUsageOpen] = useState<UserRow | null>(null);
  const [usageLogs, setUsageLogs] = useState<CreditUsageLog[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usageLoading, setUsageLoading] = useState(false);
  const [search, setSearch] = useState("");
  const usagePageSize = 50;

  const load = async () => {
    setLoading(true);
    try { setUsers((await list({})) as UserRow[]); } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const loadUsageLogs = async (user: UserRow, offset = 0, append = false) => {
    setUsageLoading(true);
    try {
      const res = await usageList({ data: { userId: user.id, limit: usagePageSize, offset } }) as {
        items: CreditUsageLog[];
        total: number;
      };
      setUsageLogs((prev) => append ? [...prev, ...(res.items ?? [])] : (res.items ?? []));
      setUsageTotal(Number(res.total ?? 0));
    } catch (e: any) {
      toast.error(e.message ?? "消费明细加载失败");
    } finally {
      setUsageLoading(false);
    }
  };

  const openUsageLogs = (user: UserRow) => {
    setUsageOpen(user);
    setUsageLogs([]);
    setUsageTotal(0);
    void loadUsageLogs(user);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? users.filter(u => (u.email ?? "").toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
    : users;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索邮箱 / 用户ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64"
          />
          <p className="text-xs text-muted-foreground">共 {filtered.length} / {users.length} 个用户</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />刷新
        </Button>
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>邮箱</TableHead>
              <TableHead>用户ID</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead className="text-right">算力余额</TableHead>
              <TableHead className="text-right">累计消耗</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(u => (
              <TableRow key={u.id} className={u.is_banned ? "opacity-60" : undefined}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <span>{u.email ?? "—"}</span>
                    {u.is_banned && (
                      <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">已封禁</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{u.id.slice(0, 8)}…</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{u.credits.toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-primary">{Number(u.total_spent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setPwOpen(u)}>
                      <KeyRound className="mr-1 h-3.5 w-3.5" />重置密码
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setCreditOpen(u)}>
                      <Coins className="mr-1 h-3.5 w-3.5" />控制余额
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openUsageLogs(u)}>
                      消耗明细
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={u.is_banned ? "text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400" : "text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"}
                        >
                          {u.is_banned ? <CircleCheck className="mr-1 h-3.5 w-3.5" /> : <Ban className="mr-1 h-3.5 w-3.5" />}
                          {u.is_banned ? "解封" : "封禁"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64 border-border/70 bg-card/90 backdrop-blur-xl">
                        <p className="text-xs text-foreground">
                          确定要{u.is_banned ? "解封" : "封禁"}用户 <span className="font-medium">{u.email}</span> 吗？
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {u.is_banned ? "解封后用户可以重新登录使用。" : "封禁后用户将无法登录或使用平台。"}
                        </p>
                        <div className="mt-3 flex justify-end">
                          <Button
                            size="sm"
                            variant={u.is_banned ? "default" : "destructive"}
                            onClick={async () => {
                              const next = !u.is_banned;
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_banned: next } : x));
                              try {
                                await banFn({ data: { userId: u.id, banned: next } });
                                toast.success(next ? "已封禁用户" : "已解封用户");
                              } catch (e: any) { toast.error(e.message); load(); }
                            }}
                          >确认{u.is_banned ? "解封" : "封禁"}</Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="mr-1 h-3.5 w-3.5" />删除
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-72 border-border/70 bg-card/90 backdrop-blur-xl">
                        <p className="text-xs text-foreground">
                          确定要彻底删除用户 <span className="font-medium">{u.email}</span> 吗？
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          将同时删除该用户的资料、生成记录与登录账号，操作不可恢复。
                        </p>
                        <div className="mt-3 flex justify-end">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              setUsers(prev => prev.filter(x => x.id !== u.id));
                              try {
                                await delFn({ data: { userId: u.id } });
                                toast.success("用户已删除");
                              } catch (e: any) { toast.error(e.message); load(); }
                            }}
                          >确认删除</Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">无匹配用户</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Reset password */}
      <Dialog open={!!pwOpen} onOpenChange={(v) => !v && setPwOpen(null)}>
        <DialogContent className="max-w-sm border-border/70 bg-card/80 backdrop-blur-2xl">
          <DialogHeader><DialogTitle>重置密码 · {pwOpen?.email}</DialogTitle></DialogHeader>
          <ResetPwForm
            onSubmit={async (pw) => {
              if (!pwOpen) return;
              try {
                const result: any = await resetPw({ data: { userId: pwOpen.id, newPassword: pw } });
                if (result?.ok === false) toast.info(result.message || "暂不支持在后台重置密码");
                else { toast.success("密码已重置"); setPwOpen(null); }
              }
              catch (e: any) { toast.error(e.message); }
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Adjust credits */}
      <Dialog open={!!creditOpen} onOpenChange={(v) => !v && setCreditOpen(null)}>
        <DialogContent className="max-w-sm border-border/70 bg-card/80 backdrop-blur-2xl">
          <DialogHeader><DialogTitle>控制余额 · {creditOpen?.email}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">当前余额：<span className="font-mono">{creditOpen?.credits.toLocaleString()}</span></p>
          <AdjustForm
            onSubmit={async (delta) => {
              if (!creditOpen) return;
              try {
                const r = await adjust({ data: { userId: creditOpen.id, delta } });
                toast.success(`更新成功，新余额 ${r.credits}`);
                setCreditOpen(null);
                load();
              } catch (e: any) { toast.error(e.message); }
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Credit usage details */}
      <Dialog
        open={!!usageOpen}
        onOpenChange={(v) => {
          if (!v) {
            setUsageOpen(null);
            setUsageLogs([]);
            setUsageTotal(0);
          }
        }}
      >
        <DialogContent className="max-w-6xl border-border/70 bg-card/90 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>消耗明细 - {usageOpen?.email ?? usageOpen?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>共 {usageTotal} 条记录</span>
              {usageLoading && <span>加载中...</span>}
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-border/60">
              <div className="min-w-[1180px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead className="text-right">点数</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>model_key</TableHead>
                      <TableHead>history_id</TableHead>
                      <TableHead>task_id</TableHead>
                      <TableHead>image_url</TableHead>
                      <TableHead>幂等键</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-primary">
                          {Number(log.amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.source}</TableCell>
                        <TableCell className="max-w-[160px] truncate" title={log.model_name ?? ""}>
                          {log.model_name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.model_key ?? "—"}</TableCell>
                        <TableCell className="max-w-[150px] truncate font-mono text-[11px]" title={log.generation_history_id ?? ""}>
                          {log.generation_history_id ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate font-mono text-[11px]" title={log.generation_task_id ?? ""}>
                          {log.generation_task_id ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          {log.image_url ? (
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={log.image_url}>
                                {log.image_url}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 shrink-0 px-2"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(log.image_url ?? "");
                                    toast.success("链接已复制");
                                  } catch {
                                    toast.error("复制失败");
                                  }
                                }}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-[11px]" title={log.idempotency_key}>
                          {log.idempotency_key}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!usageLoading && usageLogs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                          暂无消费记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={!usageOpen || usageLoading || usageLogs.length >= usageTotal}
                onClick={() => usageOpen && loadUsageLogs(usageOpen, usageLogs.length, true)}
              >
                {usageLoading ? "加载中..." : "加载更多"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResetPwForm({ onSubmit }: { onSubmit: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 pt-2">
      <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="新密码（至少 6 位）" />
      <Button
        className="w-full" disabled={busy || pw.length < 6}
        onClick={async () => { setBusy(true); await onSubmit(pw); setBusy(false); }}
      >确认重置</Button>
    </div>
  );
}

function AdjustForm({ onSubmit }: { onSubmit: (delta: number) => Promise<void> }) {
  const [val, setVal] = useState("100");
  const [busy, setBusy] = useState(false);
  const submit = async (sign: 1 | -1) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n <= 0) return toast.error("请输入正整数");
    setBusy(true); await onSubmit(sign * n); setBusy(false);
  };
  return (
    <div className="space-y-3 pt-2">
      <Input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder="点数" />
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={() => submit(1)}>+ 增加</Button>
        <Button className="flex-1" variant="destructive" disabled={busy} onClick={() => submit(-1)}>− 扣除</Button>
      </div>
    </div>
  );
}
