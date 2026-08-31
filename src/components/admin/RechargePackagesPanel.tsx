import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteAdminRechargePackage, listAdminRechargePackages, upsertAdminRechargePackage } from "@/lib/admin.functions";

type PackageRow = {
  id?: string; name: string; credits: number; price_text: string; badge: string;
  description: string; button_text: string; benefits_text: string; sort_order: number;
  is_enabled: number; is_popular: number; is_highlighted: number; buy_url: string;
};

const createEmptyPackage = (sortOrder: number): PackageRow => ({
  name: "",
  credits: 0,
  price_text: "",
  badge: "",
  description: "",
  button_text: "前往购买",
  benefits_text: "",
  sort_order: sortOrder,
  is_enabled: 1,
  is_popular: 0,
  is_highlighted: 0,
  buy_url: "",
});

export function RechargePackagesPanel() {
  const list = useServerFn(listAdminRechargePackages);
  const upsert = useServerFn(upsertAdminRechargePackage);
  const remove = useServerFn(deleteAdminRechargePackage);
  const [plans, setPlans] = useState<PackageRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const rows = await list({}) as Array<Record<string, any>>;
      setPlans(rows.map((row) => ({
        id: String(row.id), name: String(row.name ?? ""), credits: Number(row.credits ?? 0),
        price_text: String(row.price_text ?? ""), badge: String(row.badge ?? ""), description: String(row.description ?? ""),
        button_text: String(row.button_text ?? "前往购买"), benefits_text: String(row.benefits_text ?? ""),
        sort_order: Number(row.sort_order ?? 0), is_enabled: Number(row.is_enabled ?? 0),
        is_popular: Number(row.is_popular ?? 0), is_highlighted: Number(row.is_highlighted ?? 0),
        buy_url: String(row.buy_url ?? ""),
      })));
      setDeletedIds([]);
    } catch (error: any) { toast.error(error.message || "后台数据服务未配置"); }
  };
  useEffect(() => { void load(); }, []);

  const update = (index: number, patch: Partial<PackageRow>) => setPlans((current) => current.map((plan, itemIndex) => itemIndex === index ? { ...plan, ...patch } : plan));
  const discard = (index: number) => setPlans((current) => {
    const target = current[index]; if (target?.id) setDeletedIds((ids) => [...ids, target.id!]);
    return current.filter((_, itemIndex) => itemIndex !== index);
  });
  const save = async () => {
    if (plans.some((plan) => !plan.name.trim() || !plan.price_text.trim())) return toast.info("请填写套餐名称和价格文案");
    setSaving(true);
    try {
      for (const id of deletedIds) await remove({ data: { id } });
      for (const plan of plans) await upsert({ data: plan });
      toast.success("购买兑换码套餐已保存"); await load();
    } catch (error: any) { toast.error(error.message || "保存失败"); }
    finally { setSaving(false); }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">购买兑换码套餐</h2><p className="mt-1 text-xs text-muted-foreground">仅配置第三方购买链接，不处理站内支付或订单。</p></div>
        <Button size="sm" variant="outline" onClick={() => setPlans((current) => [...current, createEmptyPackage(current.length + 1)])}><Plus className="mr-1.5 h-3.5 w-3.5" />新增套餐</Button>
      </div>
      <div className="max-h-[52vh] space-y-3 overflow-auto pr-1">
        {plans.map((plan, index) => (
          <div
            key={plan.id ?? `new-${index}`}
            className={`grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4 ${
              plan.is_highlighted ? "border-primary/50 bg-primary/[0.04]" : "border-border/60 bg-white/[0.03]"
            }`}
          >
            <Field label="套餐名称"><Input value={plan.name} onChange={(event) => update(index, { name: event.target.value })} /></Field>
            <Field label="创作点数量"><Input type="number" min={0} value={plan.credits} onChange={(event) => update(index, { credits: Math.max(0, Number(event.target.value) || 0) })} /></Field>
            <Field label="价格文案"><Input value={plan.price_text} onChange={(event) => update(index, { price_text: event.target.value })} /></Field>
            <Field label="标签文案"><Input value={plan.badge} onChange={(event) => update(index, { badge: event.target.value })} placeholder="例如：加赠 10%" /></Field>
            <div className="sm:col-span-2"><Field label="副标题 / 套餐说明"><Textarea rows={2} value={plan.description} onChange={(event) => update(index, { description: event.target.value })} /></Field></div>
            <Field label="按钮文案"><Input value={plan.button_text} onChange={(event) => update(index, { button_text: event.target.value })} placeholder="前往购买" /></Field>
            <Field label="排序"><Input type="number" value={plan.sort_order} onChange={(event) => update(index, { sort_order: Number(event.target.value) || 0 })} /></Field>
            <div className="sm:col-span-2 lg:col-span-4"><Field label="购买链接（第三方发卡平台）"><Input value={plan.buy_url} onChange={(event) => update(index, { buy_url: event.target.value })} placeholder="https://..." /></Field></div>
            <div className="sm:col-span-2 lg:col-span-4"><Field label="权益列表（一行一个）"><Textarea rows={4} value={plan.benefits_text} onChange={(event) => update(index, { benefits_text: event.target.value })} placeholder={"高清图片生成\n优先任务队列\n兑换码长期有效"} /></Field></div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-span-2 lg:col-span-4">
              <Toggle label="显示套餐" checked={!!plan.is_enabled} onChange={(checked) => update(index, { is_enabled: checked ? 1 : 0 })} />
              <Toggle label="最受欢迎" checked={!!plan.is_popular} onChange={(checked) => update(index, { is_popular: checked ? 1 : 0 })} />
              <Toggle label="高亮展示" checked={!!plan.is_highlighted} onChange={(checked) => update(index, { is_highlighted: checked ? 1 : 0 })} />
              <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => discard(index)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />移除</Button>
            </div>
          </div>
        ))}
        {!plans.length && <p className="py-10 text-center text-sm text-muted-foreground">暂无套餐</p>}
      </div>
      <div className="flex justify-end"><Button onClick={save} disabled={saving}><Save className="mr-1.5 h-3.5 w-3.5" />{saving ? "保存中…" : "保存套餐"}</Button></div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1 text-[11px] text-muted-foreground"><span>{label}</span>{children}</label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
