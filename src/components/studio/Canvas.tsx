import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Copy,
  Maximize2,
  ArrowUpRight,
  X,
  Clock,
  ImageIcon,
  RotateCcw,
  Sparkles,
  ListOrdered,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getMyGenerationHistory } from "@/lib/admin.functions";
import { generatedImageDownloadUrl, generatedImageUrl } from "@/lib/image-url";
import type { GenProgress } from "./ControlPanel";
import { historyItemKey, mergeHistoryItems } from "./history-items";
import { visualProgressForStage } from "./generation-visual-progress";

const FALLBACK_THUMB = "/style-previews/default.webp";
const PAGE_SIZE = 20;

type HistoryItem = {
  id: string;
  userId?: string | null;
  model: string;
  prompt: string | null;
  finalPrompt: string | null;
  styleName: string | null;
  aspectRatio: string | null;
  createdAt: string;
  thumbnailUrl: string | null;
  originalImageUrl: string;
  modelKey?: string | null;
  generationTaskId?: string | null;
  inputParams?: Record<string, any> | null;
  cost: number;
  authorName?: string | null;
  authorEmail?: string | null;
  // legacy
  image_url: string;
  created_at: string;
};

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

type Props = {
  userId?: string | null;
  generating: boolean;
  heroIndex?: number;
  generatedUrl?: string | null;
  generatedTaskId?: string | null;
  currentPrompt?: string;
  currentModel?: string;
  progress?: GenProgress | null;
  historyOpen: boolean;
  onHistoryOpenChange: (v: boolean) => void;
  onReuseCurrent: () => void;
  onSelectHistory: (
    url: string,
    prompt: string,
    model: string,
    reuseSource?: { modelKey?: string | null; inputParams?: Record<string, any> | null },
    taskId?: string | null,
  ) => void;
  taskOverlay?: React.ReactNode;
};

function downloadImage(taskId?: string | null) {
  if (!taskId) {
    toast.error("Download unavailable");
    return;
  }
  const a = document.createElement("a");
  a.href = generatedImageDownloadUrl(taskId);
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast.success("已开始下载");
}

async function copyToClipboard(text: string) {
  if (!text) return toast.error("没有可复制的提示词");
  try {
    await navigator.clipboard.writeText(text);
    toast.success("提示词已复制");
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}

export function Canvas({
  userId,
  generating,
  generatedUrl,
  generatedTaskId,
  currentPrompt,
  currentModel,
  progress,
  historyOpen,
  onHistoryOpenChange,
  onReuseCurrent,
  onSelectHistory,
  taskOverlay,
}: Props) {
  const [lightbox, setLightbox] = useState<HistoryItem | null>(null);
  const [heroLightbox, setHeroLightbox] = useState(false);
  const [completionVisible, setCompletionVisible] = useState(false);
  const [imageRetryNonce, setImageRetryNonce] = useState(0);
  const imageRetryCountRef = useRef(0);
  const imageRetryTimerRef = useRef<number | null>(null);
  const wasGeneratingRef = useRef(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [maxKeep, setMaxKeep] = useState(100);
  const [maxDays, setMaxDays] = useState(30);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const fetchHistory = useServerFn(getMyGenerationHistory);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const historyRef = useRef<HistoryItem[]>([]);
  const totalRef = useRef(0);
  const rawLoadedCountRef = useRef(0);
  const hasMoreRef = useRef(true);
  const userIdRef = useRef<string | null | undefined>(userId);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    inFlightRef.current = false;
    historyRef.current = [];
    totalRef.current = 0;
    rawLoadedCountRef.current = 0;
    hasMoreRef.current = true;
    setHistory([]);
    setTotal(0);
    setMaxKeep(100);
    setMaxDays(30);
    setIsAdmin(false);
    setHistoryError(null);
    setHasMore(true);
    setLoadingHistory(false);
    setLoadingMore(false);
    setLightbox(null);
    setHeroLightbox(false);
  }, [userId]);

  const loadHistory = useCallback(
    async (mode: "reset" | "append" = "reset") => {
      const requestUserId = userIdRef.current;
      if (!requestUserId) return;
      if (inFlightRef.current) return;
      if (mode === "append") {
        if (!hasMoreRef.current) return;
        if (totalRef.current > 0 && rawLoadedCountRef.current >= totalRef.current) return;
      }
      inFlightRef.current = true;
      if (mode === "reset") {
        setLoadingHistory(true);
        setHistoryError(null);
        setHasMore(true);
        hasMoreRef.current = true;
        rawLoadedCountRef.current = 0;
      } else {
        setLoadingMore(true);
      }
      try {
        const offset = mode === "append" ? rawLoadedCountRef.current : 0;
        const res = (await fetchHistory({ data: { limit: PAGE_SIZE, offset } })) as {
          items: HistoryItem[];
          total?: number;
          limit: number;
          offset: number;
          maxKeep?: number;
          maxDays?: number;
          isAdmin?: boolean;
        };
        if (userIdRef.current !== requestUserId) return;
        const items = res.items ?? [];
        const returnedTotal = Number(res.total ?? 0);
        const nextRawLoadedCount = offset + items.length;
        const nextHasMore =
          returnedTotal > 0 ? nextRawLoadedCount < returnedTotal : items.length >= PAGE_SIZE;
        rawLoadedCountRef.current = nextRawLoadedCount;
        setTotal(returnedTotal);
        setHasMore(nextHasMore);
        hasMoreRef.current = nextHasMore;
        if (res.maxKeep) setMaxKeep(res.maxKeep);
        if (res.maxDays) setMaxDays(res.maxDays);
        if (typeof res.isAdmin === "boolean") setIsAdmin(res.isAdmin);
        setHistory((prev) => {
          return mergeHistoryItems(prev, items, mode === "append");
        });
      } catch (e: any) {
        console.warn("[history] load failed", e);
        if (mode === "reset") setHistoryError(e?.message ?? "加载失败，请稍后再试");
      } finally {
        setLoadingHistory(false);
        setLoadingMore(false);
        inFlightRef.current = false;
      }
    },
    [fetchHistory],
  );

  useEffect(() => {
    if (!historyOpen) return;
    loadHistory("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, userId]);

  // 当主画布出现新图（生成完成）时，自动刷新历史，确保下次打开抽屉是最新的
  useEffect(() => {
    if (generatedUrl) loadHistory("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedUrl]);

  // 无限滚动：接近滚动容器底部时加载下一页
  const handleHistoryScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (loadingHistory || loadingMore || historyError) return;
      if (!hasMore) return;
      if (totalRef.current > 0 && rawLoadedCountRef.current >= totalRef.current) return;
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
        loadHistory("append");
      }
    },
    [loadingHistory, loadingMore, historyError, hasMore, loadHistory],
  );

  const heroPrompt = currentPrompt ?? "";
  const heroModel = currentModel ?? "当前模型";
  const previewImageUrl = (taskId: string, variant: "canvas" | "large") =>
    `${generatedImageUrl(taskId, variant)}${imageRetryNonce ? `&retry=${imageRetryNonce}` : ""}`;
  const resultImageSrc = generatedTaskId
    ? previewImageUrl(generatedTaskId, "canvas")
    : generatedUrl;
  const isLightboxOpen = !!lightbox || heroLightbox;
  // Keep result rendering and every result action on the same source of truth.
  const hasResult = Boolean(generatedUrl);
  const showGenerationLoader = generating || completionVisible;

  useEffect(() => {
    imageRetryCountRef.current = 0;
    setImageRetryNonce(0);
    if (imageRetryTimerRef.current !== null) window.clearTimeout(imageRetryTimerRef.current);
    return () => {
      if (imageRetryTimerRef.current !== null) window.clearTimeout(imageRetryTimerRef.current);
    };
  }, [generatedTaskId]);

  const retryResultImage = useCallback(() => {
    const attempt = imageRetryCountRef.current;
    if (attempt >= 3 || imageRetryTimerRef.current !== null) return;
    imageRetryCountRef.current = attempt + 1;
    imageRetryTimerRef.current = window.setTimeout(() => {
      imageRetryTimerRef.current = null;
      setImageRetryNonce((nonce) => nonce + 1);
    }, [1000, 2000, 4000][attempt]);
  }, []);

  useEffect(() => {
    if (generating) {
      setCompletionVisible(false);
      wasGeneratingRef.current = true;
      return;
    }

    if (hasResult && !generating && wasGeneratingRef.current) {
      wasGeneratingRef.current = false;
      setCompletionVisible(true);
      const timeoutId = window.setTimeout(() => setCompletionVisible(false), 420);
      return () => window.clearTimeout(timeoutId);
    }

    if (!hasResult) setCompletionVisible(false);
    wasGeneratingRef.current = generating;
  }, [generating, hasResult]);

  return (
    <main
      data-testid="canvas-root"
      className="mumo-canvas-root relative min-h-[70dvh] min-w-0 w-full overflow-hidden rounded-2xl border border-white/80 bg-[#080d2b] shadow-[0_28px_70px_-42px_rgba(42,58,78,.45)] transition-colors duration-300 dark:border-white/10 dark:bg-[#172333]/68 dark:shadow-[0_30px_70px_-42px_rgba(0,0,0,.8)] lg:h-full lg:min-h-0"
    >
      <div
        data-testid="canvas-background"
        className="mumo-canvas-backdrop pointer-events-none absolute inset-0 z-0"
      />
      {hasResult && !showGenerationLoader && (
        <div
          data-testid="result-toolbar"
          className="absolute left-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 sm:max-w-[calc(100%-2rem)]"
        >
          <HeroAction label="查看大图" onClick={() => setHeroLightbox(true)}>
            <Maximize2 className="h-3.5 w-3.5" />
          </HeroAction>
          <HeroAction label="复制提示词" onClick={() => copyToClipboard(heroPrompt)}>
            <Copy className="h-3.5 w-3.5" />
          </HeroAction>
          <HeroAction label="一键复用" onClick={onReuseCurrent}>
            <RotateCcw className="h-3.5 w-3.5" />
          </HeroAction>
          <HeroAction
            label="下载"
            onClick={() => downloadImage(generatedTaskId)}
          >
            <Download className="h-3.5 w-3.5" />
          </HeroAction>
        </div>
      )}
      {taskOverlay && (
        <div data-testid="task-overlay" className="absolute right-3 top-3 z-40">
          {taskOverlay}
        </div>
      )}
      <div data-testid="canvas-viewport" className="absolute inset-0 z-10 overflow-hidden">
        {showGenerationLoader ? (
          <div data-testid="generation-stage" className="absolute inset-0 z-0">
            <QueueProgress progress={progress ?? null} completed={completionVisible} />
          </div>
        ) : hasResult ? (
          <>
            <div
              data-testid="result-viewport"
              className="absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <img
                data-testid="result-image"
                src={resultImageSrc!}
                alt="生成结果"
                onError={retryResultImage}
                className="block h-auto w-auto max-h-full max-w-full object-contain object-center"
              />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 opacity-0 transition-opacity group-hover:opacity-100" />
            {heroPrompt && (
              <div className="absolute inset-x-3 bottom-3 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="glass max-w-2xl rounded-xl px-3 py-2">
                  <p className="line-clamp-2 text-[11px] leading-snug text-foreground/90">
                    {heroPrompt}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div data-testid="idle-stage" className="absolute inset-0 z-0">
            <EmptyPlaceholder />
          </div>
        )}
      </div>

      {/* History drawer */}
      <Sheet open={historyOpen} onOpenChange={onHistoryOpenChange}>
        <SheetContent
          side="right"
          onPointerDownOutside={(event) => {
            if (isLightboxOpen) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (isLightboxOpen) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (isLightboxOpen) event.preventDefault();
          }}
          className="w-[420px] border-l border-border bg-card/95 p-0 backdrop-blur-2xl sm:max-w-none"
        >
          <div className="border-b border-border/60 px-5 py-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-semibold tracking-tight">历史记录</h2>
            </div>
            <p className="mt-0.5 text-[11px] font-light text-muted-foreground">
              {isAdmin
                ? `管理员最近生成记录 · 最多显示 ${maxKeep} 张`
                : `最近 ${maxDays} 天生成记录 · 最多显示 ${maxKeep} 张`}
            </p>
          </div>
          <div
            ref={scrollContainerRef}
            onScroll={handleHistoryScroll}
            className="scrollbar-thin h-[calc(100vh-72px)] overflow-y-auto p-4"
          >
            {loadingHistory ? (
              <div className="py-20 text-center text-xs text-muted-foreground">
                正在加载历史记录…
              </div>
            ) : historyError ? (
              <div className="py-20 text-center text-xs text-muted-foreground">
                <div className="mb-3">{historyError}</div>
                <button
                  onClick={() => loadHistory("reset")}
                  className="rounded-md border border-border px-3 py-1.5 text-[11px] hover:border-primary/60 hover:text-primary"
                >
                  重试
                </button>
              </div>
            ) : history.length === 0 ? (
              <div className="py-20 text-center text-xs text-muted-foreground">
                还没有历史作品，去生成第一张吧
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {history.map((item) => {
                    const thumb = item.thumbnailUrl || FALLBACK_THUMB;
                    return (
                      <div
                        key={historyItemKey(item)}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow"
                      >
                        <div className="absolute inset-0 cursor-default">
                          <img
                            src={thumb}
                            alt=""
                            width={480}
                            height={480}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              const img = e.currentTarget as HTMLImageElement;
                              if (!img.src.endsWith(FALLBACK_THUMB)) img.src = FALLBACK_THUMB;
                            }}
                            className="h-full w-full cursor-default object-cover"
                          />
                        </div>
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 opacity-0 transition-opacity group-hover:opacity-100" />
                        {isAdmin && (
                          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-2 py-1">
                            <span
                              className="line-clamp-1 text-[9px] font-medium text-white/90"
                              title={item.authorEmail ?? item.userId ?? ""}
                            >
                              {item.authorEmail || item.userId?.slice(0, 8) || "-"}
                            </span>
                          </div>
                        )}
                        <div className="absolute left-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="glass rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase text-primary">
                            {item.model.split(" ")[0]}
                          </span>
                        </div>
                        <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="font-mono text-[9px] text-foreground/70">
                            {timeAgo(item.createdAt)}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectHistory(
                                  item.originalImageUrl,
                                  item.prompt ?? "",
                                  item.model,
                                  {
                                    modelKey: item.modelKey,
                                    inputParams: item.inputParams,
                                  },
                                  item.generationTaskId,
                                );
                                onHistoryOpenChange(false);
                              }}
                              title="一键复用"
                              className="glass flex h-6 w-6 items-center justify-center rounded-md text-foreground/90 hover:bg-primary/20 hover:text-primary"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(item.prompt ?? "");
                              }}
                              title="复制提示词"
                              className="glass flex h-6 w-6 items-center justify-center rounded-md text-foreground/90 hover:bg-primary/20 hover:text-primary"
                            >
                              <Copy className="h-2.5 w-2.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadImage(item.generationTaskId);
                              }}
                              title="下载原图"
                              className="glass flex h-6 w-6 items-center justify-center rounded-md text-foreground/90 hover:bg-primary/20 hover:text-primary"
                            >
                              <Download className="h-2.5 w-2.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setLightbox(item);
                              }}
                              title="查看大图"
                              className="glass flex h-6 w-6 items-center justify-center rounded-md text-foreground/90 hover:bg-primary/20 hover:text-primary"
                            >
                              <Maximize2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="h-8" />
                {loadingMore && (
                  <div className="py-3 text-center text-[11px] text-muted-foreground">
                    正在加载更多…
                  </div>
                )}
                {!loadingMore && !hasMore && history.length > 0 && (
                  <div className="py-3 text-center text-[10px] text-muted-foreground/70">
                    没有更多历史记录了
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {lightbox && (
        <Lightbox
          src={lightbox.generationTaskId ? previewImageUrl(lightbox.generationTaskId, "large") : lightbox.originalImageUrl}
          prompt={lightbox.prompt ?? ""}
          model={lightbox.model}
          filename={`mumo-${lightbox.model}-${lightbox.id}.png`}
          taskId={lightbox.generationTaskId}
          onClose={() => setLightbox(null)}
        />
      )}
      {heroLightbox && generatedUrl && (
        <Lightbox
          src={generatedTaskId ? previewImageUrl(generatedTaskId, "large") : resultImageSrc!}
          prompt={heroPrompt}
          model={heroModel}
          filename={`mumo-${Date.now()}.png`}
          taskId={generatedTaskId}
          onError={retryResultImage}
          onClose={() => setHeroLightbox(false)}
        />
      )}
    </main>
  );
}

function HeroAction({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center gap-1.5 rounded-lg border border-[#8791dc]/[0.16] bg-[#080d23]/72 px-2.5 py-1.5 text-[11px] font-medium text-[#e8edff] backdrop-blur-[10px] transition-colors hover:bg-[#5848be]/[0.22]"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function EmptyPlaceholder() {
  return (
    <div className="mumo-canvas-stage relative flex h-full w-full flex-col items-center justify-center gap-5 overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/20 blur-[90px]" />
      <div className="pointer-events-none absolute left-[58%] top-[32%] h-44 w-44 rounded-full bg-blue-500/15 blur-[70px]" />
      <div className="mumo-canvas-icon relative flex h-24 w-24 items-center justify-center rounded-[28px] border border-violet-300/30 bg-[linear-gradient(145deg,rgba(67,120,255,.72),rgba(104,62,255,.82))] shadow-[0_0_32px_rgba(104,78,255,.35),0_22px_48px_-30px_rgba(0,0,0,.8)]">
        <div className="absolute inset-2 rounded-[22px] border border-white/15" />
        <ImageIcon className="h-9 w-9 text-white/85" strokeWidth={1.25} />
      </div>
      <div className="relative max-w-sm px-6 text-center">
        <div className="mumo-canvas-title text-base font-semibold tracking-wide text-[#f7f8ff]">
          让商品创意成为专业视觉
        </div>
        <div className="mumo-canvas-subtitle mt-2 text-xs font-light leading-5 text-[#9ca8cc]">
          在左侧选择商品类型并输入画面描述
          <br />
          适用于电商主图、商品场景与品牌内容
        </div>
      </div>
      <span className="mumo-canvas-pill relative rounded-full border border-violet-300/35 bg-violet-500/10 px-3 py-1.5 text-[9px] tracking-[0.18em] text-[#b8a9ff]">
        MUMO COMMERCE CANVAS
      </span>
    </div>
  );
}

const TERMINAL_LINES_POOL = [
  "正在读取本次创作设置…",
  "正在理解画面描述与主体关系…",
  "正在整理构图与视觉层次…",
  "正在匹配色彩与光影氛围…",
  "正在处理参考画面的风格特征…",
  "创作任务已进入准备队列…",
  "正在丰富画面细节…",
  "正在平衡主体与背景关系…",
  "正在优化材质与光影表现…",
  "正在检查画面完整度…",
  "即将完成本次创作…",
];

function LegacyQueueProgress({ progress }: { progress: GenProgress | null }) {
  const stage = progress?.stage ?? "submitting";
  const queuePosition =
    (stage === "queued" || stage === "polling") && typeof progress?.initialPos === "number"
      ? progress.initialPos
      : null;
  const status =
    stage === "rendering"
      ? { title: "AI 正在创作", helper: "请稍候" }
      : stage === "queued"
        ? {
            title: "正在排队",
            helper: queuePosition ? `第 ${queuePosition} 位` : "正在等待生成资源",
          }
        : stage === "polling"
          ? {
              title: "正在等待生成资源",
              helper: queuePosition ? `第 ${queuePosition} 位` : "请稍候",
            }
          : { title: "正在提交", helper: "正在创建任务" };

  return (
    <div
      data-testid="generation-energy-ring"
      className="mumo-generation-state relative flex h-full w-full items-center justify-center overflow-hidden bg-[#080d28]"
    >
      <div className="mumo-generation-state__veil absolute inset-0" />
      <div className="mumo-energy-ring relative z-10" role="status" aria-live="polite">
        <div className="mumo-energy-ring__glow" />
        <svg viewBox="0 0 240 240" className="mumo-energy-ring__svg" aria-hidden="true">
          <defs>
            <linearGradient id="generation-ring-gradient" x1="18%" y1="6%" x2="82%" y2="94%">
              <stop offset="0%" stopColor="#3D7DFF" />
              <stop offset="38%" stopColor="#5757F7" />
              <stop offset="70%" stopColor="#B13EFF" />
              <stop offset="100%" stopColor="#3D7DFF" />
            </linearGradient>
            <filter id="generation-node-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle className="mumo-energy-ring__base" cx="120" cy="120" r="92" />
          <path
            className="mumo-energy-ring__wave mumo-energy-ring__wave--one"
            d="M120 39 C154 34 191 63 199 105 C208 146 179 196 132 202 C88 209 43 181 39 132 C34 83 72 43 120 39Z"
          />
          <path
            className="mumo-energy-ring__wave mumo-energy-ring__wave--two"
            d="M120 47 C164 44 195 78 194 121 C193 164 164 193 119 195 C75 197 46 165 47 120 C48 75 78 49 120 47Z"
          />
          <circle className="mumo-energy-ring__arc" cx="120" cy="120" r="92" />
          <g className="mumo-energy-ring__orbit mumo-energy-ring__orbit--one">
            <circle
              className="mumo-energy-ring__node"
              cx="120"
              cy="26"
              r="3.2"
              filter="url(#generation-node-glow)"
            />
          </g>
          <g className="mumo-energy-ring__orbit mumo-energy-ring__orbit--two">
            <circle
              className="mumo-energy-ring__node"
              cx="194"
              cy="62"
              r="2.7"
              filter="url(#generation-node-glow)"
            />
          </g>
          <g className="mumo-energy-ring__orbit mumo-energy-ring__orbit--three">
            <circle
              className="mumo-energy-ring__node"
              cx="48"
              cy="164"
              r="2.3"
              filter="url(#generation-node-glow)"
            />
          </g>
        </svg>
        <div className="mumo-energy-ring__status text-center">
          <div className="mumo-energy-ring__title">{status.title}</div>
          <div className="mumo-energy-ring__helper">{status.helper}</div>
        </div>
      </div>
    </div>
  );

  if (false) {
    const elapsed = 0;
    // initialPos / renderBudget 优先从 progress 中读取（已在 ControlPanel 持久化），
    // 这样刷新页面恢复任务时，UI 显示的"第 N 位"和渲染百分比保持一致。
    const [fallbackPos] = useState(() => 18 + Math.floor(Math.random() * 25));
    const [fallbackBudget] = useState(() => 12 + Math.floor(Math.random() * 10));
    const initialPos = progress?.initialPos ?? fallbackPos;
    const renderBudget = progress?.renderBudget ?? fallbackBudget;

    const SEC_PER_TICK = 1.6; // 每 1.6 秒前进一位
    const queuePos = useMemo(() => {
      if (stage === "rendering") return 0;
      const advanced = Math.floor(elapsed / SEC_PER_TICK);
      return Math.max(1, initialPos - advanced);
    }, [stage, elapsed, initialPos]);

    // 终端滚动日志：每 ~450ms 追加一行
    const [logs, setLogs] = useState<string[]>(() => [TERMINAL_LINES_POOL[0]]);
    useEffect(() => {
      let i = 1;
      const id = setInterval(() => {
        setLogs((prev) => {
          const line = TERMINAL_LINES_POOL[i % TERMINAL_LINES_POOL.length];
          i++;
          const next = [...prev, line];
          return next.length > 60 ? next.slice(next.length - 60) : next;
        });
      }, 420);
      return () => clearInterval(id);
    }, []);
    const logEndRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [logs]);

    // 记录进入"渲染中"那一刻的已用秒，避免渲染百分比受排队时长影响

    const renderStartRef = useRef<number | null>(null);
    useEffect(() => {
      if (stage === "rendering" && renderStartRef.current === null) {
        renderStartRef.current = elapsed;
      }
      if (stage !== "rendering") renderStartRef.current = null;
    }, [stage, elapsed]);

    // 总进度百分比
    let pct = 8;
    if (stage === "submitting") pct = 8;
    else if (stage === "queued" || stage === "polling") {
      const queueProgress = 1 - queuePos / initialPos; // 0 → 1
      pct = Math.min(60, 15 + queueProgress * 45);
    } else if (stage === "rendering") {
      const rStart = renderStartRef.current ?? elapsed;
      const renderElapsed = Math.max(0, elapsed - rStart);
      // 60% → 99%，使用对数避免到 100% 卡住
      const rp = Math.min(1, renderElapsed / renderBudget);
      pct = 60 + rp * 39;
    }

    // 友好提示文案（轮播，不显示具体耗时）
    const FRIENDLY_TIPS = [
      "AI 正在创作中，请稍候",
      "正在优化画面细节",
      "正在渲染高清图像",
      "正在处理光影与质感",
      "正在润色构图与色彩",
      "即将完成，请保持页面打开",
    ];
    const LONG_WAIT_TIP = "复杂画面生成需要一点时间，请保持页面打开";
    const [tipIdx, setTipIdx] = useState(0);
    useEffect(() => {
      const id = setInterval(
        () => {
          setTipIdx(
            (i) =>
              (i + 1 + Math.floor(Math.random() * (FRIENDLY_TIPS.length - 1))) %
              FRIENDLY_TIPS.length,
          );
        },
        3500 + Math.floor(Math.random() * 1500),
      );
      return () => clearInterval(id);
    }, []);
    const currentTip = elapsed > 45 ? LONG_WAIT_TIP : FRIENDLY_TIPS[tipIdx];

    const stageLabel =
      stage === "rendering"
        ? "生成中"
        : stage === "polling"
          ? "网络重试"
          : stage === "submitting"
            ? "提交中"
            : "排队中";

    const steps: Array<{ key: GenProgress["stage"]; label: string }> = [
      { key: "submitting", label: "提交" },
      { key: "queued", label: "排队" },
      { key: "rendering", label: "渲染" },
    ];
    const stageIndex = stage === "polling" ? 1 : steps.findIndex((s) => s.key === stage);

    return (
      <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-slate-100 via-white to-blue-100/70 dark:from-[#172333] dark:via-[#14202e] dark:to-[#101923]">
        {/* 背景：轻量网格与柔和光晕 */}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(71,85,105,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(71,85,105,0.045) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.82), transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(148,163,184,0.16), transparent 55%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(71,85,105,0.018) 0 1px, transparent 1px 3px)",
          }}
        />
        {/* 创作状态滚动 */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="scrollbar-thin absolute inset-x-0 bottom-0 top-0 overflow-hidden px-6 py-4 font-mono text-[10.5px] leading-relaxed text-slate-400/42">
            <div className="flex flex-col">
              {logs.map((line, idx) => {
                const isLast = idx === logs.length - 1;
                const dim = idx < logs.length - 8;
                return (
                  <div
                    key={idx}
                    className={`whitespace-pre tracking-tight ${dim ? "opacity-25" : "opacity-75"} ${isLast ? "text-slate-600" : ""}`}
                  >
                    <span className="text-[#a4874f]/55">{String(idx).padStart(4, "0")}</span>
                    <span className="mx-2 text-slate-400/35">│</span>
                    <span>{line}</span>
                    {isLast && (
                      <span className="ml-1 inline-block h-3 w-1.5 -mb-[2px] animate-pulse bg-slate-500/60" />
                    )}
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
            {/* 顶部渐隐遮罩 */}
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-slate-100 to-transparent dark:from-[#172333]" />
          </div>
        </div>
        {/* 中心信息卡 */}
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/45 to-transparent" />
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-6">
          <div className="glass-elevated flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-white/85 bg-white/58 px-6 py-6 shadow-elevated backdrop-blur-2xl dark:border-white/10 dark:bg-[#1c2a3a]/72">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-aurora shadow-glow">
              <Sparkles className="h-7 w-7 animate-pulse text-primary-foreground" />
            </div>

            {/* Stage badge */}
            <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1">
              <ListOrdered className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold tracking-wide text-primary">
                {stageLabel}
              </span>
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
            </div>

            {/* 主信息：排队位次 / 生成百分比 */}
            {stage === "rendering" ? (
              <div className="text-center">
                <div className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  {Math.round(pct)}%
                </div>
                <div className="mt-1 text-xs font-light text-muted-foreground transition-opacity duration-500">
                  {currentTip}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  正在排队 · 第 <span className="text-primary">{queuePos}</span> 位
                </div>
                <div className="mt-1 text-xs font-light text-muted-foreground transition-opacity duration-500">
                  {currentTip}
                </div>
              </div>
            )}

            {/* 进度条 */}
            <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-300/30 dark:bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-gradient-aurora shadow-glow transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Steps tracker */}
            <div className="flex w-full max-w-md items-center justify-between gap-2">
              {steps.map((s, i) => {
                const done = i < stageIndex;
                const active = i === stageIndex;
                return (
                  <div key={s.key} className="flex flex-1 items-center gap-2">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary bg-primary/10 text-primary" : "border-border bg-white/45 text-muted-foreground"}`}
                    >
                      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                    </div>
                    <span
                      className={`text-[11px] ${active ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground"}`}
                    >
                      {s.label}
                    </span>
                    {i < steps.length - 1 && (
                      <div className={`mx-1 h-px flex-1 ${done ? "bg-primary" : "bg-border"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Meta line（不显示具体耗时，仅保留任务编号供排查） */}
            <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
              {progress?.taskId ? (
                <span>任务 {progress?.taskId?.slice(0, 8)}…</span>
              ) : (
                <span>正在准备本次视觉创作…</span>
              )}
            </div>
            <div className="text-[10px] font-light text-slate-400">
              您可以继续浏览历史记录，结果会在这里自动显示
            </div>
          </div>
        </div>
      </div>
    );
  }
}

function QueueProgress({
  progress,
  completed,
}: {
  progress: GenProgress | null;
  completed: boolean;
}) {
  const stage = progress?.stage ?? "submitting";
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const highestProgressRef = useRef(0);

  useEffect(() => {
    if (completed) return;
    const startedAt = performance.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((performance.now() - startedAt) / 1000);
    }, 400);
    return () => window.clearInterval(intervalId);
  }, [completed]);

  const rawProgress = visualProgressForStage(stage, elapsedSeconds, completed);
  const visualProgress = completed
    ? 100
    : Math.max(highestProgressRef.current, Math.round(rawProgress));
  highestProgressRef.current = visualProgress;

  const queuePosition =
    (stage === "queued" || stage === "polling") && typeof progress?.initialPos === "number"
      ? progress.initialPos
      : null;
  const status = completed
    ? { title: "创作完成", helper: "正在呈现结果" }
    : stage === "rendering"
      ? { title: "AI 正在创作", helper: "正在细化画面" }
      : stage === "queued"
        ? {
            title: "正在排队",
            helper: queuePosition ? `第 ${queuePosition} 位` : "正在等待生成资源",
          }
        : stage === "polling"
          ? {
              title: "正在等待生成资源",
              helper: queuePosition ? `第 ${queuePosition} 位` : "请稍候",
            }
          : { title: "正在提交", helper: "正在创建任务" };

  return (
    <div
      data-testid="generation-energy-ring"
      className="mumo-generation-state relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div className="mumo-generation-state__veil absolute inset-0" />
      <div
        className={`mumo-energy-ring relative z-10 ${completed ? "mumo-energy-ring--complete" : ""}`}
        role="status"
        aria-live="polite"
        aria-label={`${status.title}，${visualProgress}%`}
      >
        <div className="mumo-energy-ring__glow" />
        <svg viewBox="0 0 240 240" className="mumo-energy-ring__svg" aria-hidden="true">
          <defs>
            <linearGradient id="generation-ring-gradient" x1="16%" y1="8%" x2="86%" y2="92%">
              <stop offset="0%" stopColor="#9CEBFF" />
              <stop offset="34%" stopColor="#28B8FF" />
              <stop offset="68%" stopColor="#4B6CFF" />
              <stop offset="100%" stopColor="#7667E8" />
            </linearGradient>
            <filter id="generation-node-glow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur stdDeviation="2.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle className="mumo-energy-ring__base" cx="120" cy="120" r="91" />
          <path
            className="mumo-energy-ring__wave mumo-energy-ring__wave--one"
            d="M120 31 C158 33 196 60 207 103 C218 148 187 195 143 207 C97 219 52 193 35 151 C18 109 39 63 79 42 C92 35 106 31 120 31Z"
          />
          <path
            className="mumo-energy-ring__wave mumo-energy-ring__wave--two"
            d="M120 42 C163 38 198 73 199 116 C201 159 171 194 128 199 C84 204 46 177 40 134 C34 91 61 51 104 43 C109 42 115 42 120 42Z"
          />
          <circle className="mumo-energy-ring__arc" cx="120" cy="120" r="91" />
          <g className="mumo-energy-ring__particles">
            <circle cx="81" cy="68" r="1.15" />
            <circle cx="159" cy="78" r="0.9" />
            <circle cx="149" cy="158" r="1.25" />
            <circle cx="91" cy="166" r="0.8" />
            <circle cx="121" cy="54" r="0.75" />
            <circle cx="176" cy="126" r="0.7" />
          </g>
          <g className="mumo-energy-ring__orbit mumo-energy-ring__orbit--one">
            <circle className="mumo-energy-ring__node" cx="120" cy="27" r="3.1" />
          </g>
          <g className="mumo-energy-ring__orbit mumo-energy-ring__orbit--two">
            <circle className="mumo-energy-ring__node" cx="193" cy="62" r="2.6" />
          </g>
          <g className="mumo-energy-ring__orbit mumo-energy-ring__orbit--three">
            <circle className="mumo-energy-ring__node" cx="49" cy="169" r="2.15" />
          </g>
        </svg>
        <div className="mumo-energy-ring__status text-center">
          <div className="mumo-energy-ring__title">{status.title}</div>
          <output className="mumo-energy-ring__percentage" aria-label="创作进度">
            {visualProgress}%
          </output>
          <div className="mumo-energy-ring__helper">{status.helper}</div>
        </div>
      </div>
    </div>
  );
}

function Lightbox({
  src,
  prompt,
  model,
  filename,
  taskId,
  onError,
  onClose,
}: {
  src: string;
  prompt: string;
  model: string;
  filename: string;
  taskId?: string | null;
  onError?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-lightbox-root
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl animate-[fade-in_0.2s_ease-out]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-elevated relative flex max-h-[90vh] w-full max-w-5xl gap-4 overflow-hidden rounded-2xl p-2"
      >
        <div className="flex-1 overflow-hidden rounded-xl bg-black">
          <img src={src} alt={prompt} onError={onError} className="h-full w-full object-contain" />
        </div>
        <div className="flex w-72 flex-col p-4">
          <div className="flex items-center justify-between">
            <span className="self-start rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-primary">
              {model}
            </span>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className="pointer-events-auto relative z-[1001] rounded-md p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            提示词
          </div>
          <p className="mt-2 max-h-60 overflow-y-auto text-sm font-light leading-relaxed">
            {prompt || "（无提示词）"}
          </p>
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <button
              onClick={() => downloadImage(taskId)}
              className="flex items-center justify-center gap-2 rounded-lg bg-gradient-aurora px-3 py-2.5 text-xs font-semibold text-primary-foreground shadow-glow"
            >
              <Download className="h-3.5 w-3.5" /> 下载
            </button>
            <button
              onClick={() => copyToClipboard(prompt)}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white/[0.03] px-3 py-2.5 text-xs font-medium hover:bg-white/[0.06]"
            >
              <Copy className="h-3.5 w-3.5" /> 复制提示词
            </button>
            <button
              onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white/[0.03] px-3 py-2.5 text-xs font-medium hover:bg-white/[0.06]"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> 新标签打开
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
