import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListAds, adminUpsertAd, adminDeleteAd } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

type Ad = {
  id: string; title: string; link_url: string | null;
  is_active: boolean; sort_order: number; created_at: string;
};

export function AdsPanel() {
  const list = useServerFn(adminListAds);
  const upsert = useServerFn(adminUpsertAd);
  const del = useServerFn(adminDeleteAd);
  const [ads, setAds] = useState<Ad[]>([]);
  const [editing, setEditing] = useState<Partial<Ad> | null>(null);

  const load = async () => {
    try { setAds((await list({})) as Ad[]); } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, []);

  const save = async (a: Partial<Ad>) => {
    if (!a.title?.trim()) return toast.error("请填写广告标题");
    try {
      await upsert({ data: {
        id: a.id, title: a.title.trim(),
        link_url: a.link_url?.trim() || null,
        is_active: a.is_active ?? true,
        sort_order: Number(a.sort_order ?? 0),
      } });
      toast.success("已保存");
      setEditing(null); load();
    } catch (e: any) { toast.error(e.message); }
  };

  const toggle = async (a: Ad) => {
    try {
      await upsert({ data: {
        id: a.id, title: a.title, link_url: a.link_url,
        is_active: !a.is_active, sort_order: a.sort_order,
      } });
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {ads.length} 条广告 · 启用 {ads.filter(a => a.is_active).length} 条</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />刷新</Button>
          <Button size="sm" className="bg-gradient-aurora text-primary-foreground"
            onClick={() => setEditing({ title: "", link_url: "", is_active: true, sort_order: 0 })}>
            <Plus className="mr-1 h-3.5 w-3.5" />新建广告
          </Button>
        </div>
      </div>

      <div className="max-h-[55vh] overflow-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>排序</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>链接</TableHead>
              <TableHead>启用</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ads.map(a => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-xs">{a.sort_order}</TableCell>
                <TableCell className="font-medium">{a.title}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{a.link_url || "—"}</TableCell>
                <TableCell><Switch checked={a.is_active} onCheckedChange={() => toggle(a)} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={async () => {
                      if (!confirm(`确认删除广告"${a.title}"?`)) return;
                      try { await del({ data: { id: a.id } }); toast.success("已删除"); load(); }
                      catch (e: any) { toast.error(e.message); }
                    }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {ads.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground">暂无广告，点击右上"新建广告"添加</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md border-border/70 bg-card/80 backdrop-blur-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? "编辑广告" : "新建广告"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">广告标题 *</label>
                <Input value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="例如：限时活动 - 注册即送 1000 算力" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">跳转链接（可选）</label>
                <Input value={editing.link_url ?? ""} onChange={(e) => setEditing({ ...editing, link_url: e.target.value })}
                  placeholder="https://..." />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">排序（数字小靠前）</label>
                  <Input type="number" value={editing.sort_order ?? 0}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
                </div>
                <div className="flex flex-col items-start gap-1">
                  <label className="text-[11px] text-muted-foreground">启用</label>
                  <div className="flex h-9 items-center"><Switch checked={editing.is_active ?? true}
                    onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} /></div>
                </div>
              </div>
              <Button className="w-full bg-gradient-aurora text-primary-foreground" onClick={() => save(editing)}>
                保存并发布
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
