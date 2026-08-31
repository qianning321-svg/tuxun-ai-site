import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Ban, CheckCircle2, Copy, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  adminClearDisabledRedeemCodes,
  adminDeleteRedeemCode,
  adminGenerateRedeemCodes,
  adminListRedeemCodes,
  adminUpdateRedeemCodeStatus,
} from "@/lib/admin.functions";

type RedeemCodeRow = {
  id: string;
  code: string;
  credits: number;
  status: "unused" | "used" | "disabled";
  used_by_label: string | null;
  used_at: string | null;
  created_at: string;
};

type GeneratedRedeemCode = {
  code?: unknown;
};

export function RedeemCodesPanel() {
  const list = useServerFn(adminListRedeemCodes);
  const generateCodes = useServerFn(adminGenerateRedeemCodes);
  const updateStatus = useServerFn(adminUpdateRedeemCodeStatus);
  const deleteCode = useServerFn(adminDeleteRedeemCode);
  const clearDisabledCodes = useServerFn(adminClearDisabledRedeemCodes);
  const [records, setRecords] = useState<RedeemCodeRow[]>([]);
  const [lastGeneratedCodes, setLastGeneratedCodes] = useState<string[]>([]);
  const [count, setCount] = useState("10");
  const [credits, setCredits] = useState("200");
  const [loading, setLoading] = useState(false);

  const unusedCodes = useMemo(() => records.filter((record) => record.status === "unused"), [records]);
  const disabledCount = records.filter((record) => record.status === "disabled").length;

  const load = async () => {
    setLoading(true);
    try {
      setRecords((await list({})) as RedeemCodeRow[]);
    } catch (error: any) {
      toast.error(error.message || "后台数据服务未配置");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const generate = async () => {
    const amount = Number(credits);
    const quantity = Number(count);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      return toast.info("生成数量请输入 1-200 的整数");
    }
    if (!Number.isInteger(amount) || amount < 1) return toast.info("面额请输入正整数");

    try {
      const created = await generateCodes({ data: { count: quantity, credits: amount } }) as GeneratedRedeemCode[];
      const codes = Array.isArray(created)
        ? created.map((item) => String(item.code ?? "").trim()).filter(Boolean)
        : [];
      setLastGeneratedCodes(codes);
      toast.success(`已生成 ${codes.length || quantity} 个 MUMO 兑换码`);
      await load();
    } catch (error: any) {
      toast.error(error.message || "生成失败");
    }
  };

  const copyRawText = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Clipboard unavailable");
  };

  const copyCodes = async (codes: string[], success: string) => {
    const cleanCodes = codes.map((code) => code.trim()).filter(Boolean);
    if (!cleanCodes.length) {
      toast.info("暂无可复制兑换码");
      return;
    }
    try {
      await copyRawText(cleanCodes.join("\n"));
      toast.success(success);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const clearDisabled = async () => {
    if (!disabledCount || !window.confirm(`确认清空 ${disabledCount} 个已禁用兑换码吗？`)) return;
    try {
      await clearDisabledCodes({});
      toast.success("已清空禁用兑换码");
      await load();
    } catch (error: any) {
      toast.error(error.message || "清空失败");
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-white/[0.03] p-4">
        <Field label="生成数量">
          <Input type="number" min={1} max={200} value={count} onChange={(event) => setCount(event.target.value)} className="h-9 w-28" />
        </Field>
        <Field label="每张面额（创作点）">
          <Input type="number" min={1} value={credits} onChange={(event) => setCredits(event.target.value)} className="h-9 w-36" />
        </Field>
        <Button onClick={generate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          生成
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={!lastGeneratedCodes.length}
          onClick={() => copyCodes(lastGeneratedCodes, `已复制本次生成的 ${lastGeneratedCodes.length} 个兑换码`)}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          复制本次生成
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!records.length}
          onClick={() => copyCodes(records.map((record) => record.code), `已复制当前列表 ${records.length} 个兑换码`)}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          复制当前列表
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!unusedCodes.length}
          onClick={() => copyCodes(unusedCodes.map((record) => record.code), `已复制 ${unusedCodes.length} 个未使用兑换码`)}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          复制未使用
        </Button>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" disabled={!disabledCount} onClick={clearDisabled}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          清空已禁用
        </Button>
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>兑换码</TableHead>
              <TableHead className="text-right">面额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>使用者</TableHead>
              <TableHead>使用时间</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <CodeRow
                key={record.id}
                record={record}
                reload={load}
                updateStatus={updateStatus}
                deleteCode={deleteCode}
                copyCodes={copyCodes}
              />
            ))}
            {!records.length && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  暂无兑换码
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">共 {records.length} 个，未使用 {unusedCodes.length} 个。</p>
    </section>
  );
}

function CodeRow({
  record,
  reload,
  updateStatus,
  deleteCode,
  copyCodes,
}: {
  record: RedeemCodeRow;
  reload: () => Promise<void>;
  updateStatus: any;
  deleteCode: any;
  copyCodes: (codes: string[], success: string) => Promise<void>;
}) {
  const toggle = async () => {
    try {
      await updateStatus({ data: { id: record.id, status: record.status === "disabled" ? "unused" : "disabled" } });
      await reload();
    } catch (error: any) {
      toast.error(error.message || "更新失败");
    }
  };

  const remove = async () => {
    if (!window.confirm(`确认删除兑换码 ${record.code} 吗？`)) return;
    try {
      await deleteCode({ data: { id: record.id } });
      toast.success("兑换码已删除");
      await reload();
    } catch (error: any) {
      toast.error(error.message || "删除失败");
    }
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-medium">{record.code}</TableCell>
      <TableCell className="text-right font-mono">{Number(record.credits).toLocaleString()} 点</TableCell>
      <TableCell><StatusBadge status={record.status} /></TableCell>
      <TableCell className="text-xs text-muted-foreground">{record.used_by_label ?? "-"}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(record.used_at)}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(record.created_at)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyCodes([record.code], "兑换码已复制")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {record.status !== "used" && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggle}>
              {record.status === "disabled" ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: RedeemCodeRow["status"] }) {
  const styles = status === "unused"
    ? "bg-emerald-500/15 text-emerald-500"
    : status === "used"
      ? "bg-slate-500/15 text-slate-500"
      : "bg-amber-500/15 text-amber-500";
  const label = status === "unused" ? "未使用" : status === "used" ? "已使用" : "已禁用";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${styles}`}>
      {status === "unused" && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-[11px] text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}
