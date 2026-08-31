import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminDeleteAnnouncement, adminListAnnouncements, adminUpsertAnnouncement } from "@/lib/admin.functions";

type Announcement = { id?: string; title: string; content: string; cta_label?: string | null; cta_url?: string | null; is_enabled: number; sort_order: number; created_at?: string };

function isSafeCtaUrl(value: string) {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function AnnouncementsPanel() {
  const list = useServerFn(adminListAnnouncements);
  const upsert = useServerFn(adminUpsertAnnouncement);
  const remove = useServerFn(adminDeleteAnnouncement);
  const [items, setItems] = useState<Announcement[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { setItems((await list({})) as Announcement[]); setDeletedIds([]); }
    catch (error: any) { toast.error(error.message || "后台数据服务未配置"); }
  };
  useEffect(() => { void load(); }, []);

  const updateItem = (index: number, patch: Partial<Announcement>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const discard = (index: number) => setItems((current) => {
    const target = current[index];
    if (target?.id) setDeletedIds((ids) => [...ids, target.id!]);
    return current.filter((_, itemIndex) => itemIndex !== index);
  });
  const save = async () => {
    if (items.some((item) => !item.title.trim() || !item.content.trim())) return toast.info("请填写公告标题和正文");
    if (items.some((item) => !isSafeCtaUrl(item.cta_url?.trim() ?? ""))) return toast.error("跳转链接仅支持站内 / 路径或 HTTPS 地址");
    setSaving(true);
    try {
      for (const id of deletedIds) await remove({ data: { id } });
      for (const item of items) await upsert({ data: { ...item, title: item.title.trim(), content: item.content.trim(), cta_label: item.cta_label?.trim() ?? "", cta_url: item.cta_url?.trim() ?? "" } });
      toast.success("公告配置已保存");
      await load();
    } catch (error: any) { toast.error(error.message || "保存失败"); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">公告配置</h2><p className="mt-1 text-xs text-muted-foreground">前台公告内容由后台数据服务统一管理。</p></div><Button size="sm" variant="outline" onClick={() => setItems((current) => [...current, { title: "", content: "", cta_label: "", cta_url: "", is_enabled: 1, sort_order: current.length + 1 }])}><Plus className="mr-1.5 h-3.5 w-3.5" />新增公告</Button></div>
      <div className="max-h-[65vh] space-y-3 overflow-auto pr-1">
        {items.map((item, index) => <div key={item.id ?? `new-${index}`} className="grid gap-3 rounded-xl border border-border/60 bg-white/[0.03] p-4 sm:grid-cols-[minmax(0,1fr)_120px]">
          <div className="space-y-3"><Field label="公告标题"><Input value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} /></Field><Field label="公告正文"><Textarea className="min-h-60 resize-y" value={item.content} onChange={(event) => updateItem(index, { content: event.target.value })} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="跳转按钮文字（可选）"><Input value={item.cta_label ?? ""} placeholder="例如：立即查看" onChange={(event) => updateItem(index, { cta_label: event.target.value })} /></Field><Field label="跳转链接（可选）"><Input value={item.cta_url ?? ""} placeholder="https://... 或 /pricing" onChange={(event) => updateItem(index, { cta_url: event.target.value })} /></Field></div></div>
          <div className="space-y-3"><Field label="排序"><Input type="number" value={item.sort_order} onChange={(event) => updateItem(index, { sort_order: Number(event.target.value) || 0 })} /></Field><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!item.is_enabled} onChange={(event) => updateItem(index, { is_enabled: event.target.checked ? 1 : 0 })} />已发布</label>{item.created_at && <p className="text-[11px] text-muted-foreground">创建于 {new Date(item.created_at).toLocaleString()}</p>}<Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => discard(index)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />移除</Button></div>
        </div>)}
        {!items.length && <p className="py-10 text-center text-sm text-muted-foreground">暂无公告</p>}
      </div>
      <div className="flex justify-end"><Button onClick={save} disabled={saving}><Save className="mr-1.5 h-3.5 w-3.5" />{saving ? "保存中..." : "保存公告配置"}</Button></div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1 text-[11px] text-muted-foreground"><span>{label}</span>{children}</label>; }
