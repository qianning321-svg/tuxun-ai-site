import { ShieldCheck } from "lucide-react";

export function AccessPasswordPanel() {
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-border/60 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          管理员二次验证
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          后台入口已改为校验当前管理员账号的登录密码，不再使用共享访问密码。请在“管理员管理”中为指定管理员修改登录密码。
        </p>
        <p className="text-xs leading-6 text-muted-foreground">
          密码不会在后台展示；提交后只会写入新的 password_hash，并撤销该管理员现有登录会话。
        </p>
      </div>
    </div>
  );
}
