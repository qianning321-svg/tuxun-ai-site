import { lazy, Suspense, useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Settings, RefreshCw, LogOut, Zap, Shield, Crown } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin.functions";
import { toast } from "sonner";
import { thumbUrl } from "@/lib/image-url";

// Lazy: only loaded when the user opens them — keeps initial bundle small.
const SettingsDialog = lazy(() => import("./SettingsDialog").then((m) => ({ default: m.SettingsDialog })));
const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));

export function UserMenu({ onSwitchAccount }: { onSwitchAccount: () => void }) {
  const { user, profile, signOut, session } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isFounder, setIsFounder] = useState(false);
  const check = useServerFn(checkIsAdmin);

  useEffect(() => {
    if (!session) { setIsAdmin(false); setIsFounder(false); return; }
    check({}).then((r: any) => {
      setIsAdmin(!!r?.isAdmin);
      setIsFounder(!!r?.isFounder);
    }).catch(() => { setIsAdmin(false); setIsFounder(false); });
  }, [session, check]);

  const initial = (profile?.display_name || profile?.email || user?.email || "U")[0].toUpperCase();
  const avatar = profile?.avatar_url;
  const avatarSrc = avatar?.startsWith("avatars/") ? "/api/uploads/avatar" : thumbUrl(avatar, { quality: 75 });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="relative h-8 w-8 overflow-hidden rounded-full ring-1 ring-border transition-all hover:ring-primary/60">
            {avatar ? (
              <img key={avatar} src={avatarSrc} alt="头像" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <>
                <div className="h-full w-full bg-gradient-to-br from-primary/40 via-accent to-secondary" />
                <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">{initial}</div>
              </>
            )}
            <span className="absolute -bottom-0 -right-0 h-2 w-2 rounded-full border-2 border-card bg-primary" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-72 border-border/70 bg-card/70 p-0 backdrop-blur-2xl shadow-elevated"
        >
          <div className="relative overflow-hidden p-4">
            <div className="pointer-events-none absolute -top-12 left-1/2 h-32 w-48 -translate-x-1/2 rounded-full bg-gradient-aurora opacity-15 blur-3xl" />
            <div className="relative flex items-center gap-3">
              <div className="relative h-11 w-11 overflow-hidden rounded-full ring-1 ring-border">
                {avatar ? (
                  <img key={avatar} src={avatarSrc} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <>
                    <div className="h-full w-full bg-gradient-to-br from-primary/40 via-accent to-secondary" />
                    <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{initial}</div>
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{profile?.display_name || "未命名用户"}</div>
                <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
              </div>
            </div>
            <div className="relative mt-3 flex items-center justify-between rounded-lg border border-border bg-white/[0.03] px-3 py-2">
              <span className="text-[11px] text-muted-foreground">当前剩余算力</span>
              <span className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-primary" fill="currentColor" />
                <span className="font-mono text-sm font-semibold tabular-nums">{(profile?.credits ?? 0).toLocaleString()}</span>
                <span className="text-[10px] text-muted-foreground">pts</span>
              </span>
            </div>
          </div>

          <DropdownMenuSeparator className="bg-border/60" />

          <div className="p-1.5">
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)} className="cursor-pointer gap-2.5 rounded-md px-2.5 py-2 text-xs">
              <Settings className="h-3.5 w-3.5" /> 个人设置
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem onSelect={() => setAdminOpen(true)} className="cursor-pointer gap-2.5 rounded-md px-2.5 py-2 text-xs text-primary focus:bg-primary/10">
                {isFounder ? <Crown className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                {isFounder ? "创始人后台" : "管理员后台"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={async () => {
                await signOut();
                onSwitchAccount();
                toast.success("已注销当前账号");
              }}
              className="cursor-pointer gap-2.5 rounded-md px-2.5 py-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 切换账号
            </DropdownMenuItem>
          </div>

          <DropdownMenuSeparator className="bg-border/60" />

          <div className="p-1.5">
            <DropdownMenuItem
              onSelect={async () => { await signOut(); toast.success("已退出登录"); }}
              className="cursor-pointer gap-2.5 rounded-md px-2.5 py-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" /> 退出登录
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
      {adminOpen && (
        <Suspense fallback={null}>
          <AdminDashboard
            open={adminOpen}
            onOpenChange={setAdminOpen}
            isFounder={isFounder}
          />
        </Suspense>
      )}
    </>
  );
}
