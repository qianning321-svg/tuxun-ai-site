import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getModelBadgeColorStyle, normalizeModelBadgeColor } from "@/components/studio/generation-options";
import { adminListModelsConfig, adminUpdateModel } from "@/lib/admin.functions";

type BadgeVariant = "red" | "green" | "amber" | "blue" | "purple" | "gray";
type ModelRow = {
  id: string; model_key: string; display_name: string; provider: string; provider_model: string;
  cost_credits: number; is_enabled: number; sort_order: number; description: string | null;
  badge_label?: string | null; badge_variant?: BadgeVariant | null; badge_color?: string | null; badge_text_color?: string | null;
  supported_modes?: string; max_reference_images?: number;
};

const badgePreview: Record<BadgeVariant, string> = {
  red: "border-rose-400/25 bg-rose-400/15 text-rose-600 dark:text-rose-300", green: "border-emerald-400/25 bg-emerald-400/15 text-emerald-700 dark:text-emerald-300", amber: "border-amber-400/25 bg-amber-400/15 text-amber-700 dark:text-amber-300", blue: "border-sky-400/25 bg-sky-400/15 text-sky-700 dark:text-sky-300", purple: "border-violet-400/25 bg-violet-400/15 text-violet-700 dark:text-violet-300", gray: "border-slate-400/25 bg-slate-400/15 text-slate-600 dark:text-slate-300",
};
const variants: BadgeVariant[] = ["red", "green", "amber", "blue", "purple", "gray"];

function parseModes(value?: string): string[] { try { const modes = JSON.parse(value ?? "[]") as unknown; return Array.isArray(modes) ? modes.filter((mode): mode is string => typeof mode === "string") : []; } catch { return []; } }

export function ModelsPanel() {
  const list = useServerFn(adminListModelsConfig); const update = useServerFn(adminUpdateModel);
  const [rows, setRows] = useState<ModelRow[]>([]); const [editing, setEditing] = useState<ModelRow | null>(null); const [saving, setSaving] = useState(false);
  const load = async () => { try { setRows((await list({})) as ModelRow[]); } catch (error: any) { toast.error(error.message || "加载模型配置失败"); } };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!editing) return;
    const displayName = editing.display_name.trim(); const badgeLabel = (editing.badge_label ?? "").trim();
    if (!displayName || displayName.length > 80) return toast.error("显示名称不能为空且不超过 80 个字符");
    if (badgeLabel.length > 40) return toast.error("标签文字不能超过 40 个字符");
    if (!Number.isSafeInteger(editing.sort_order) || editing.sort_order < 0 || editing.sort_order > 100000) return toast.error("排序必须是 0 到 100000 之间的整数");
    const badgeColor = (editing.badge_color ?? "").trim();
    if (badgeColor && !normalizeModelBadgeColor(badgeColor)) return toast.error("标签颜色仅支持 #RGB 或 #RRGGBB");
    const badgeTextColor = (editing.badge_text_color ?? "").trim();
    if (badgeTextColor && !normalizeModelBadgeColor(badgeTextColor)) return toast.error("标签字体颜色仅支持 #RGB 或 #RRGGBB");
    setSaving(true);
    try {
      await update({ data: { id: editing.id, display_name: displayName, description: editing.description, cost_credits: editing.cost_credits, is_enabled: editing.is_enabled, sort_order: editing.sort_order, badge_label: badgeLabel, badge_variant: editing.badge_variant ?? "gray", badge_color: badgeColor, badge_text_color: badgeTextColor, supported_modes: parseModes(editing.supported_modes), max_reference_images: editing.max_reference_images ?? 0 } });
      toast.success("模型展示配置已保存"); setEditing(null); await load();
    } catch (error: any) { toast.error(error.message || "保存失败"); } finally { setSaving(false); }
  };

  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">模型配置</h2><p className="mt-1 text-xs text-muted-foreground">编辑前端展示信息；内部模型键和 Provider 映射保持只读。</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />刷新</Button></div>
    <div className="space-y-2">{rows.map((row) => <div key={row.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-border/60 p-3 ${row.is_enabled ? "" : "opacity-65"}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{row.display_name}</p>{row.badge_label && <Badge label={row.badge_label} variant={row.badge_variant ?? "gray"} color={row.badge_color} textColor={row.badge_text_color} />}</div><p className="mt-1 truncate text-xs text-muted-foreground">{row.model_key} / {row.provider} / {row.provider_model}</p></div><span className="font-mono text-xs">{row.cost_credits} 点</span><span className={`text-xs ${row.is_enabled ? "text-emerald-500" : "text-muted-foreground"}`}>{row.is_enabled ? "启用" : "已关闭"}</span><Button variant="ghost" size="sm" onClick={() => setEditing({ ...row, badge_label: row.badge_label ?? "", badge_variant: row.badge_variant ?? "gray", badge_color: row.badge_color ?? "", badge_text_color: row.badge_text_color ?? "" })}>编辑</Button></div>)}</div>
    {editing && <div className="space-y-5 rounded-xl border border-border/60 bg-white/[0.03] p-4">
      <FormSection title="基础展示"><Field label="前端显示名称"><Input maxLength={80} value={editing.display_name} onChange={(event) => setEditing({ ...editing, display_name: event.target.value })} /></Field><Field label="前端排序"><Input type="number" min={0} max={100000} value={editing.sort_order} onChange={(event) => setEditing({ ...editing, sort_order: Number(event.target.value) || 0 })} /></Field><Field label="模型说明"><Input value={editing.description ?? ""} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></Field><Field label="创作点"><Input type="number" min={0} value={editing.cost_credits} onChange={(event) => setEditing({ ...editing, cost_credits: Number(event.target.value) || 0 })} /></Field></FormSection>
      <FormSection title="模型标签"><Field label="标签文字（可选）"><Input maxLength={40} value={editing.badge_label ?? ""} placeholder="例如：推荐" onChange={(event) => setEditing({ ...editing, badge_label: event.target.value })} /></Field><Field label="预设样式"><Select value={editing.badge_variant ?? "gray"} onValueChange={(value) => setEditing({ ...editing, badge_variant: value as BadgeVariant })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{variants.map((variant) => <SelectItem key={variant} value={variant}>{variant}</SelectItem>)}</SelectContent></Select></Field><Field label="标签背景颜色"><div className="flex gap-2"><Input className="h-10 w-12 p-1" type="color" value={normalizeModelBadgeColor(editing.badge_color) ?? "#64748B"} onChange={(event) => setEditing({ ...editing, badge_color: event.target.value })} /><Input value={editing.badge_color ?? ""} placeholder="#RRGGBB" onChange={(event) => setEditing({ ...editing, badge_color: event.target.value })} /></div></Field><Field label="标签字体颜色"><div className="flex gap-2"><Input className="h-10 w-12 p-1" type="color" value={normalizeModelBadgeColor(editing.badge_text_color) ?? "#FFFFFF"} onChange={(event) => setEditing({ ...editing, badge_text_color: event.target.value })} /><Input value={editing.badge_text_color ?? ""} placeholder="#RRGGBB" onChange={(event) => setEditing({ ...editing, badge_text_color: event.target.value })} /></div></Field><div className="flex items-end"><Button type="button" variant="outline" size="sm" onClick={() => setEditing({ ...editing, badge_color: "", badge_text_color: "" })}>使用预设颜色</Button></div><div className="flex items-end">{editing.badge_label?.trim() && <Badge label={editing.badge_label.trim()} variant={editing.badge_variant ?? "gray"} color={editing.badge_color} textColor={editing.badge_text_color} />}</div></FormSection>
      <FormSection title="模型能力"><Field label="最大参考图"><Input type="number" min={0} max={5} value={editing.max_reference_images ?? 0} onChange={(event) => setEditing({ ...editing, max_reference_images: Number(event.target.value) || 0 })} /></Field><Field label="支持模式"><div className="flex gap-4 pt-2 text-xs">{["text_to_image", "image_to_image"].map((mode) => { const modes = parseModes(editing.supported_modes); return <label key={mode} className="flex items-center gap-1"><input type="checkbox" checked={modes.includes(mode)} onChange={(event) => setEditing({ ...editing, supported_modes: JSON.stringify(event.target.checked ? [...modes, mode] : modes.filter((item) => item !== mode)) })} />{mode === "text_to_image" ? "文生图" : "图生图"}</label>; })}</div></Field><div className="flex items-center gap-2 pt-5 text-xs"><Switch checked={!!editing.is_enabled} onCheckedChange={(checked) => setEditing({ ...editing, is_enabled: checked ? 1 : 0 })} /><span className={editing.is_enabled ? "text-emerald-600" : "text-muted-foreground"}>{editing.is_enabled ? "启用" : "已关闭"}</span></div></FormSection>
      <FormSection title="系统配置（只读）"><Field label="内部模型键"><Input readOnly value={editing.model_key} /></Field><Field label="Provider"><Input readOnly value={editing.provider} /></Field><Field label="Provider Model ID"><Input readOnly value={editing.provider_model} /></Field></FormSection>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>取消</Button><Button disabled={saving} onClick={() => void save()}><Save className="mr-1.5 h-3.5 w-3.5" />{saving ? "保存中..." : "保存"}</Button></div>
    </div>}
  </section>;
}
function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-3 text-sm font-semibold">{title}</h3><div className="grid gap-3 sm:grid-cols-2">{children}</div></section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1 text-[11px] text-muted-foreground"><span>{label}</span>{children}</label>; }
function Badge({ label, variant, color, textColor }: { label: string; variant: BadgeVariant; color?: string | null; textColor?: string | null }) { const style = getModelBadgeColorStyle(color, textColor); return <span style={style} className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badgePreview[variant]}`}>{label}</span>; }
