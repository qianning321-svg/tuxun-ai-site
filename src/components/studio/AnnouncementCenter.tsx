import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listAnnouncements } from "@/lib/admin.functions";

type Announcement = {
  id: string;
  title: string;
  content: string;
  cta_label?: string | null;
  cta_url?: string | null;
  sort_order: number;
  created_at?: string;
};
type Props = { open: boolean; onOpenChange: (open: boolean) => void; authenticated: boolean };

function isSafeCtaUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function AnnouncementCenter({ open, onOpenChange, authenticated }: Props) {
  const fetchAnnouncements = useServerFn(listAnnouncements);
  const [items, setItems] = useState<Announcement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authenticated || !open) return;
    setMessage("");
    fetchAnnouncements({})
      .then((rows: unknown) => {
        const nextItems = (rows ?? []) as Announcement[];
        setItems(nextItems);
        setSelectedId((current) => nextItems.some((item) => item.id === current) ? current : (nextItems[0]?.id ?? null));
      })
      .catch(() => { setItems([]); setSelectedId(null); setMessage("Unable to load announcements"); });
  }, [authenticated, open, fetchAnnouncements]);

  useEffect(() => {
    if (authenticated) return;
    setItems([]);
    setSelectedId(null);
    setMessage("");
  }, [authenticated]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0], [items, selectedId]);
  const safeCtaUrl = selected?.cta_url?.trim() && isSafeCtaUrl(selected.cta_url.trim()) ? selected.cta_url.trim() : null;
  const isExternalCta = Boolean(safeCtaUrl?.startsWith("https://"));

  return (
    <Dialog open={authenticated && open} onOpenChange={(nextOpen) => onOpenChange(authenticated && nextOpen)}>
      <DialogContent className="mumo-announcement-dialog grid h-[calc(100vh-16px)] h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg p-0 [&>button]:right-[calc(env(safe-area-inset-right)+4px)] [&>button]:top-[calc(env(safe-area-inset-top)+4px)] [&>button]:z-30 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-lg md:h-[min(720px,calc(100vh-80px))] md:w-[min(1080px,calc(100vw-80px))] md:rounded-xl md:[&>button]:right-4 md:[&>button]:top-4">
        <DialogHeader className="mumo-announcement-dialog__header sticky top-0 z-20 border-b px-4 py-3 pr-14 md:px-6 md:py-4">
          <DialogTitle className="flex items-center gap-2 text-lg text-[#f4f6ff]"><Bell className="h-5 w-5 text-[#c7a45e]" />公告中心</DialogTitle>
          <DialogDescription className="sr-only">Mumo announcements</DialogDescription>
        </DialogHeader>
        {!items.length ? (
          <div className="grid place-items-center px-6 text-sm text-[#7f8aad]">{message || "暂无公告"}</div>
        ) : (
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1">
            <aside className="mumo-announcement-dialog__list min-h-0 overflow-x-auto overflow-y-hidden border-b p-2.5 md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
              <p className="sr-only md:not-sr-only md:px-2 md:pb-2 md:text-xs md:font-medium md:text-[#7f8aad]">公告列表</p>
              <div className="flex gap-2 md:block md:space-y-1 md:overflow-visible">
                {items.map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`mumo-announcement-dialog__item min-w-40 shrink-0 rounded-lg px-3 py-2 text-left md:min-w-0 md:w-full md:py-2.5 ${selected?.id === item.id ? "mumo-announcement-dialog__item--active" : ""}`}>
                    <span className="flex items-start gap-2"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#c7a45e]" /><span className="min-w-0"><span className="line-clamp-2 block text-sm font-medium">{item.title}</span><span className="mt-1 flex items-center gap-1 text-xs text-[#7f8aad]">{formatDate(item.created_at)}</span></span></span>
                  </button>
                ))}
              </div>
            </aside>
            {selected && <article className="mumo-announcement-dialog__article min-h-0 overflow-y-auto px-4 py-5 md:px-9 md:py-8">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#7f8aad]"><span className="mumo-announcement-dialog__tag rounded-full px-2.5 py-1 font-medium">公告</span><time>{formatDate(selected.created_at)}</time></div>
              <h2 className="mt-4 text-[23px] font-bold leading-[1.35] text-[#f4f6ff] md:mt-5 md:text-[30px]">{selected.title}</h2>
              <div className="mt-5 space-y-5 text-[15px] leading-7 text-[#b7c0dd] md:mt-7 md:text-[16px] md:leading-8">{selected.content.split(/\n{2,}/).map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}</div>
              {safeCtaUrl && <div className="mt-8"><Button asChild className="rounded-lg bg-[#9a7d49] px-5 text-white hover:bg-[#806637]"><a href={safeCtaUrl} target={isExternalCta ? "_blank" : undefined} rel={isExternalCta ? "noopener noreferrer" : undefined}>{selected.cta_label?.trim() || "查看详情"}<ExternalLink className="ml-2 h-4 w-4" /></a></Button></div>}
            </article>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
