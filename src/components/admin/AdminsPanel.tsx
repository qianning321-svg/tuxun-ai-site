import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  addAdminUserByEmail,
  listAdminUsers,
  removeAdminUser,
  resetAdminUserPassword,
  updateAdminUserRole,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Crown, KeyRound, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

type AdminRole = "owner" | "admin";

type Row = {
  user_id: string;
  role: AdminRole;
  email: string | null;
  display_name: string | null;
  created_at: string;
  created_by?: string | null;
};

type ResetTarget = {
  userId: string;
  email: string | null;
} | null;

export function AdminsPanel() {
  const list = useServerFn(listAdminUsers);
  const add = useServerFn(addAdminUserByEmail);
  const updateRole = useServerFn(updateAdminUserRole);
  const remove = useServerFn(removeAdminUser);
  const resetPassword = useServerFn(resetAdminUserPassword);

  const [rows, setRows] = useState<Row[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("admin");
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<ResetTarget>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const load = async () => {
    try {
      setRows((await list({ data: {} })) as Row[]);
    } catch (e: any) {
      toast.error(e.message || "加载管理员列表失败");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onAdd = async () => {
    const value = email.trim();
    if (!value) return toast.error("请输入邮箱");
    setBusy(true);
    try {
      await add({ data: { email: value, role } });
      toast.success(role === "owner" ? "已添加 owner" : "已添加管理员");
      setEmail("");
      setRole("admin");
      await load();
    } catch (e: any) {
      toast.error(e.message || "添加管理员失败");
    } finally {
      setBusy(false);
    }
  };

  const onChangeRole = async (row: Row, nextRole: AdminRole) => {
    if (row.role === nextRole) return;
    if (
      row.role === "owner" &&
      nextRole === "admin" &&
      !confirm(`确认将 ${row.email ?? row.user_id} 从 owner 调整为 admin？`)
    ) {
      return;
    }
    try {
      await updateRole({ data: { userId: row.user_id, role: nextRole } });
      toast.success("角色已更新");
      await load();
    } catch (e: any) {
      toast.error(e.message || "更新角色失败");
    }
  };

  const onRemove = async (row: Row) => {
    if (row.role !== "admin") return toast.error("owner 需先改为 admin 后再移除");
    if (!confirm(`确认移除管理员 ${row.email ?? row.user_id}？`)) return;
    try {
      await remove({ data: { userId: row.user_id } });
      toast.success("已移除管理员");
      await load();
    } catch (e: any) {
      toast.error(e.message || "移除管理员失败");
    }
  };

  const onResetPassword = async () => {
    if (!resetTarget) return;
    const password = newPassword.trim();
    if (password.length < 8) return toast.error("密码至少 8 位");
    setResetBusy(true);
    try {
      await resetPassword({ data: { userId: resetTarget.userId, password } });
      toast.success("管理员密码已更新");
      setResetTarget(null);
      setNewPassword("");
    } catch (e: any) {
      toast.error(e.message || "更新密码失败");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-lg border border-border/60 bg-white/[0.03] p-3 md:grid-cols-[1fr_140px_auto_auto] md:items-end">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">通过邮箱添加管理员（用户需先注册账号）</label>
          <Input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="user@example.com"
            onKeyDown={(event) => event.key === "Enter" && onAdd()}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">角色</label>
          <Select value={role} onValueChange={(value) => setRole(value as AdminRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">admin</SelectItem>
              <SelectItem value="owner">owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onAdd} disabled={busy} className="bg-gradient-aurora text-primary-foreground">
          <Plus className="mr-1 h-3.5 w-3.5" />
          添加
        </Button>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
      </div>

      <div className="max-h-[55vh] overflow-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>角色</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>昵称</TableHead>
              <TableHead>授权时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.user_id}>
                <TableCell className="min-w-[160px]">
                  <div className="flex items-center gap-2">
                    {row.role === "owner" ? (
                      <Crown className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <Select value={row.role} onValueChange={(value) => onChangeRole(row, value as AdminRole)}>
                      <SelectTrigger className="h-8 w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="owner">owner</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{row.email ?? "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.display_name ?? "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.created_at ? new Date(row.created_at).toLocaleString() : "-"}
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setResetTarget({ userId: row.user_id, email: row.email });
                      setNewPassword("");
                    }}
                  >
                    <KeyRound className="mr-1 h-3.5 w-3.5" />
                    改密码
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={row.role !== "admin"}
                    onClick={() => onRemove(row)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    移除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                  暂无管理员
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改管理员密码</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">{resetTarget?.email ?? "未命名管理员"}</div>
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="输入至少 8 位新密码"
              onKeyDown={(event) => event.key === "Enter" && onResetPassword()}
            />
            <p className="text-xs text-muted-foreground">更新后该管理员现有登录会话会失效，需要使用新密码重新登录。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button onClick={onResetPassword} disabled={resetBusy || newPassword.trim().length < 8}>
              保存新密码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
