import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export function AccessGate({
  open,
  onCancel,
  onPass,
}: {
  open: boolean;
  onCancel: () => void;
  onPass: () => void;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setPw("");
  }, [open]);

  const submit = async () => {
    if (!pw.trim()) return toast.error("请输入管理员账号密码");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/verify-access-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const result: any = await response.json().catch(() => null);
      if (result?.ok !== true) throw new Error("管理员验证失败");
      onPass();
    } catch {
      toast.error("管理员验证失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="max-w-sm border-border/70 bg-card/85 backdrop-blur-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            后台访问验证
          </DialogTitle>
          <DialogDescription>请输入当前管理员账号的登录密码以继续。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <Input
            autoFocus
            type="password"
            placeholder="管理员账号登录密码"
            value={pw}
            onChange={(event) => setPw(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "验证中..." : "进入后台"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
