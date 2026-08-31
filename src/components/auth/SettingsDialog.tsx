import { useEffect, useRef, useState } from "react";
import { Camera, Check, KeyRound, LoaderCircle, Save } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { compressAvatarImage } from "@/lib/client-image-compression";
import { thumbUrl } from "@/lib/image-url";

function avatarSource(avatar: string | null | undefined) {
  return avatar?.startsWith("avatars/") ? "/api/uploads/avatar" : thumbUrl(avatar);
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const { profile, user, refreshProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => { if (open) setNickname(profile?.display_name ?? ""); }, [open, profile?.display_name]);
  const initial = (profile?.display_name || profile?.email || user?.email || "U")[0]?.toUpperCase() || "U";
  const avatar = profile?.avatar_url;
  const disabled = uploading || savingNickname || savingPassword;

  async function saveNickname() {
    const normalized = nickname.trim();
    const length = Array.from(normalized).length;
    if (!normalized || length < 2 || length > 24) return toast.error("昵称需为 2 到 24 个非空白字符。");
    setSavingNickname(true);
    try {
      const response = await fetch("/api/account/profile", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: normalized }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "昵称保存失败，请稍后重试。");
      await refreshProfile();
      toast.success("昵称已保存");
    } catch (error) { toast.error(error instanceof Error ? error.message : "昵称保存失败，请稍后重试。"); }
    finally { setSavingNickname(false); }
  }

  async function uploadAvatar(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("仅支持 PNG、JPEG 或 WebP 图片。");
    if (file.size > 10 * 1024 * 1024) return toast.error("头像文件不能超过 10 MB。");
    setUploading(true);
    try {
      const compressed = await compressAvatarImage(file);
      const formData = new FormData();
      formData.append("avatar", compressed.file, compressed.file.name);
      const response = await fetch("/api/uploads/avatar", { method: "POST", credentials: "include", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "头像上传失败，请稍后重试。");
      await refreshProfile();
      toast.success("头像已更新");
    } catch (error) { toast.error(error instanceof Error ? error.message : "头像上传失败，请稍后重试。"); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function savePassword() {
    if (newPassword.length < 8) return toast.error("新密码至少需要 8 个字符。");
    if (newPassword !== confirmPassword) return toast.error("两次输入的新密码不一致。");
    if (newPassword === currentPassword) return toast.error("新密码不能与当前密码相同。");
    setSavingPassword(true);
    try {
      const response = await fetch("/api/account/change-password", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "密码修改失败，请稍后重试。");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordOpen(false);
      toast.success("密码已修改");
    } catch (error) { toast.error(error instanceof Error ? error.message : "密码修改失败，请稍后重试。"); }
    finally { setSavingPassword(false); }
  }

  const passwordFields: Array<[string, string, string, (value: string) => void]> = [
    ["current-password", "当前密码", currentPassword, setCurrentPassword],
    ["new-password", "新密码", newPassword, setNewPassword],
    ["confirm-password", "确认新密码", confirmPassword, setConfirmPassword],
  ];

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[560px] overflow-y-auto border-indigo-400/25 bg-[#0a112c]/95 p-5 text-slate-100 shadow-[0_20px_80px_rgba(0,0,0,.55)] backdrop-blur-xl sm:rounded-2xl sm:p-6">
      <DialogHeader><DialogTitle className="text-xl font-bold text-[#f5f7ff]">账户设置</DialogTitle></DialogHeader>
      <section className="space-y-4 border-t border-indigo-300/15 pt-5"><div className="flex items-center gap-4">
        {avatarSource(avatar) ? <img key={avatar ?? "avatar"} src={avatarSource(avatar)} alt="当前头像" className="h-20 w-20 aspect-square rounded-full object-cover ring-2 ring-primary/30" /> : <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-primary via-violet-500 to-sky-400 text-xl font-bold text-white ring-2 ring-primary/30">{initial}</div>}
        <div><p className="text-sm font-semibold text-slate-100">当前头像</p><p className="mt-1 text-xs text-slate-400">PNG、JPEG 或 WebP，最大 10 MB</p><input ref={inputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAvatar(file); }} />
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-indigo-300/25 bg-indigo-400/10 px-3 py-2 text-sm font-medium text-indigo-100 transition hover:bg-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-60"><Camera className="h-4 w-4" />{uploading ? <><LoaderCircle className="h-4 w-4 animate-spin" />上传中...</> : "更换头像"}</button>
        </div></div></section>
      <section className="space-y-3 border-t border-indigo-300/15 pt-5"><label className="block text-sm font-semibold text-slate-100" htmlFor="account-nickname">昵称</label><div className="flex gap-2"><input id="account-nickname" value={nickname} disabled={disabled} onChange={(event) => setNickname(event.target.value)} maxLength={24} className="min-w-0 flex-1 rounded-lg border border-indigo-300/20 bg-[#060c24] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-300/60 disabled:opacity-60" /><button type="button" disabled={disabled} onClick={() => void saveNickname()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{savingNickname ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{savingNickname ? "保存中" : "保存"}</button></div></section>
      <section className="space-y-3 border-t border-indigo-300/15 pt-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-100">账号安全</h3><p className="mt-1 text-xs text-slate-400">新密码至少 8 个字符</p></div><button type="button" disabled={disabled} onClick={() => setPasswordOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-indigo-300/25 px-3 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-400/10 disabled:opacity-60"><KeyRound className="h-4 w-4" />修改密码</button></div>
        {passwordOpen && <div className="space-y-3 rounded-xl border border-indigo-300/15 bg-[#060c24]/80 p-3">{passwordFields.map(([id, label, value, setValue]) => <label key={id} className="block text-xs font-medium text-slate-300">{label}<input id={id} type="password" autoComplete={id === "current-password" ? "current-password" : "new-password"} value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} className="mt-1.5 w-full rounded-lg border border-indigo-300/20 bg-[#03081c] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-300/60 disabled:opacity-60" /></label>)}<button type="button" disabled={disabled} onClick={() => void savePassword()} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingPassword ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{savingPassword ? "修改中..." : "确认修改"}</button></div>}</section>
    </DialogContent>
  </Dialog>;
}
