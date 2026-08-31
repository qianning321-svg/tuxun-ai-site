import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminCreateStyleTemplate, adminDeleteStyleTemplate, adminListStyleTemplates, adminUpdateStyleTemplate } from "@/lib/admin.functions";

type TemplateRow = { id?: string; name: string; category: string; prompt: string; preview_url: string; sort_order: number; is_enabled: number };
const emptyTemplate = (): TemplateRow => ({ name: "", category: "", prompt: "", preview_url: "", sort_order: 0, is_enabled: 1 });

export function StyleTemplatesPanel() {
  const list = useServerFn(adminListStyleTemplates); const create = useServerFn(adminCreateStyleTemplate); const update = useServerFn(adminUpdateStyleTemplate); const remove = useServerFn(adminDeleteStyleTemplate);
  const [rows, setRows] = useState<TemplateRow[]>([]); const [editing, setEditing] = useState<TemplateRow | null>(null);
  const load = async () => { try { setRows((await list({})) as TemplateRow[]); } catch (error: any) { toast.error(error.message || "后台数据服务未配置"); } };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!editing?.name.trim()) return toast.info("请填写模板名称");
    try { if (editing.id) await update({ data: editing }); else await create({ data: editing }); toast.success("模板配置已保存"); setEditing(null); await load(); }
    catch (error: any) { toast.error(error.message || "保存失败"); }
  };
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">模板配置</h2><p className="mt-1 text-xs text-muted-foreground">配置模板名称、分类、提示词和启用状态。</p></div><Button size="sm" onClick={() => setEditing(emptyTemplate())}><Plus className="mr-1.5 h-3.5 w-3.5" />新增模板</Button></div>
    <div className="space-y-2">{rows.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{row.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{row.category || "未分类"} · {row.prompt || "暂无提示词"}</p></div><span className={`text-xs ${row.is_enabled ? "text-emerald-500" : "text-muted-foreground"}`}>{row.is_enabled ? "启用" : "停用"}</span><Button variant="ghost" size="sm" onClick={() => setEditing(row)}>编辑</Button><Button variant="ghost" size="icon" className="text-destructive" onClick={async () => { if (!confirm(`确认删除模板 ${row.name} 吗？`)) return; try { await remove({ data: { id: row.id } }); await load(); } catch (error: any) { toast.error(error.message || "删除失败"); } }}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div>
    {editing && <div className="grid gap-3 rounded-xl border border-border/60 bg-white/[0.03] p-4 sm:grid-cols-2"><Field label="模板名称"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="模板分类"><Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field><Field label="预览图地址"><Input value={editing.preview_url} onChange={(e) => setEditing({ ...editing, preview_url: e.target.value })} /></Field><Field label="排序"><Input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) || 0 })} /></Field><div className="sm:col-span-2"><Field label="模板提示词"><Textarea rows={4} value={editing.prompt} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} /></Field></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!editing.is_enabled} onChange={(e) => setEditing({ ...editing, is_enabled: e.target.checked ? 1 : 0 })} />启用</label><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>取消</Button><Button onClick={save}><Save className="mr-1.5 h-3.5 w-3.5" />保存</Button></div></div>}
  </section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1 text-[11px] text-muted-foreground"><span>{label}</span>{children}</label>; }
