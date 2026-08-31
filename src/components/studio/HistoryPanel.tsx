import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Clock, Copy, Download, ImageIcon, Maximize2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { generatedImageDownloadUrl, generatedImageUrl } from "@/lib/image-url";
import { useHistory, type HistoryItem } from "./history-cache";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReuse: (item: HistoryItem) => void;
};

function Thumbnail({ item, thumbnailsEnabled }: { item: HistoryItem; thumbnailsEnabled: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageUrl = thumbnailsEnabled ? item.thumbnailUrl : item.originalImageUrl;
  const imageSrc = imageUrl
    ? `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}retry=${retryNonce}`
    : "";

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    retryCountRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [imageUrl]);

  const retryThumbnail = () => {
    const attempt = retryCountRef.current;
    const delays = [1000, 2000, 3000, ...Array(17).fill(5000)];
    if (attempt >= delays.length || retryTimerRef.current) {
      setFailed(true);
      return;
    }
    retryCountRef.current = attempt + 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryNonce((nonce) => nonce + 1);
    }, delays[attempt]);
  };

  return (
    <div className="absolute inset-0 bg-[#10182a]">
      {!loaded && !failed && <div className="absolute inset-0 animate-pulse bg-white/[0.06]" />}
      {failed || !imageUrl ? (
        <div className="absolute inset-0 grid place-items-center text-white/25">
          <ImageIcon className="h-7 w-7" />
        </div>
      ) : (
        <img
          src={imageSrc}
          alt=""
          width={512}
          height={512}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={retryThumbnail}
          className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

function HistoryLightbox({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  if (!item.originalImageUrl) return null;

  return (
    <DialogPrimitive.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-history-lightbox-backdrop
          className="fixed inset-0 z-[1000] bg-black/90"
        />
        <DialogPrimitive.Content
          data-history-lightbox-root
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          className="fixed inset-0 z-[1001] grid place-items-center p-4 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">查看大图</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">生成结果大图预览</DialogPrimitive.Description>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="pointer-events-auto absolute right-4 top-4 z-[1002] grid h-10 w-10 place-items-center rounded-md bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={item.generationTaskId ? generatedImageUrl(item.generationTaskId, "large") : item.originalImageUrl}
            alt="生成结果大图"
            decoding="async"
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function HistoryPanel({ open, onOpenChange, onReuse }: Props) {
  const history = useHistory();
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [lightboxItem, setLightboxItem] = useState<HistoryItem | null>(null);

  useEffect(() => {
    if (open) history.ensureFirstPage();
  }, [history.ensureFirstPage, open]);

  useEffect(() => {
    const root = scrollRootRef.current;
    const sentinel = sentinelRef.current;
    if (!open || !root || !sentinel || !history.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) history.loadMore();
      },
      { root, rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [history.hasMore, history.loadMore, open]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[420px] border-l border-border bg-card/95 p-0 backdrop-blur-2xl sm:max-w-none">
          <div className="border-b border-border/60 px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">历史记录</h2>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">最近 30 天，最多保留 100 张</p>
          </div>
          <div ref={scrollRootRef} className="scrollbar-thin h-[calc(100vh-72px)] overflow-y-auto p-4">
            {history.items.length === 0 && history.status === "loading" ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="aspect-square animate-pulse rounded-md bg-white/[0.06]" />
                ))}
              </div>
            ) : history.items.length === 0 && history.status === "error" ? (
              <div className="py-20 text-center text-xs text-muted-foreground">
                <p>{history.error}</p>
                <button type="button" onClick={history.ensureFirstPage} className="mt-3 rounded-md border border-border px-3 py-1.5 hover:text-primary">重试</button>
              </div>
            ) : history.items.length === 0 ? (
              <div className="py-20 text-center text-xs text-muted-foreground">还没有历史作品</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {history.items.map((item) => (
                  <div key={item.generationTaskId ?? item.id} className="group relative aspect-square overflow-hidden rounded-md border border-border bg-[#10182a]">
                    <Thumbnail item={item} thumbnailsEnabled={history.thumbnailsEnabled} />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <div className="absolute inset-x-2 bottom-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button type="button" onClick={() => onReuse(item)} title="一键复用" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white hover:text-primary">
                        <RotateCcw className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(item.prompt ?? ""); toast.success("提示词已复制"); }} title="复制提示词" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white hover:text-primary">
                        <Copy className="h-3 w-3" />
                      </button>
                      {item.originalImageUrl && item.generationTaskId && (
                        <a href={generatedImageDownloadUrl(item.generationTaskId)} download title="下载原图" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white hover:text-primary">
                          <Download className="h-3 w-3" />
                        </a>
                      )}
                      {item.originalImageUrl && (
                        <button type="button" onClick={() => setLightboxItem(item)} title="查看大图" className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white hover:text-primary">
                          <Maximize2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div ref={sentinelRef} className="h-px" aria-hidden="true" />
            {history.isLoadingMore && <div className="py-4 text-center text-[11px] text-muted-foreground">正在加载更多...</div>}
            {history.items.length > 0 && history.error && !history.isLoadingMore && (
              <div className="py-3 text-center text-[11px] text-muted-foreground">
                <button
                  type="button"
                  onClick={history.status === "error" ? history.ensureFirstPage : history.loadMore}
                  className="rounded-md border border-border px-3 py-1.5 hover:text-primary"
                >
                  加载失败，重试
                </button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {lightboxItem && <HistoryLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />}
    </>
  );
}
