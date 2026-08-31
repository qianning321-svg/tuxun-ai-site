import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";

export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_THUMBNAIL_PRELOAD_CONCURRENCY = 3;

export type HistoryItem = {
  id: string;
  model: string;
  modelKey?: string | null;
  prompt: string | null;
  finalPrompt: string | null;
  styleName: string | null;
  aspectRatio: string | null;
  createdAt: string;
  thumbnailUrl: string | null;
  originalImageUrl: string | null;
  generationTaskId?: string | null;
  inputParams?: Record<string, unknown> | null;
  cost: number;
};

type HistoryPage = {
  items: HistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
};

type HistoryStatus = "idle" | "loading" | "ready" | "error";

type HistoryState = {
  userId: string | null;
  status: HistoryStatus;
  items: HistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  error: string | null;
};

type HistoryContextValue = Omit<HistoryState, "userId"> & {
  thumbnailsEnabled: boolean;
  ensureFirstPage: () => void;
  refreshFirstPage: () => void;
  loadMore: () => void;
};

const EMPTY_STATE: HistoryState = {
  userId: null,
  status: "idle",
  items: [],
  nextCursor: null,
  hasMore: false,
  isLoadingMore: false,
  error: null,
};

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function shouldPreloadHistory(
  userId: string,
  cacheUserId: string | null,
  status: HistoryStatus,
): boolean {
  return userId !== cacheUserId || status === "idle" || status === "error";
}

export function mergeHistoryPages(previous: HistoryItem[], incoming: HistoryItem[]): HistoryItem[] {
  const seen = new Set<string>();
  return [...previous, ...incoming].filter((item) => {
    const key = item.generationTaskId ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scheduleThumbnailPreload(
  urls: Array<string | null | undefined>,
  signal: AbortSignal,
  concurrency = HISTORY_THUMBNAIL_PRELOAD_CONCURRENCY,
): () => void {
  if (typeof window === "undefined" || typeof Image === "undefined") return () => {};
  const queue = [...new Set(urls.filter((url): url is string => !!url))];
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const active = new Set<HTMLImageElement>();

  const cancel = () => {
    cancelled = true;
    if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    if (timeoutId !== null) clearTimeout(timeoutId);
    for (const image of active) image.src = "";
    active.clear();
  };
  signal.addEventListener("abort", cancel, { once: true });

  const launch = () => {
    if (cancelled || signal.aborted) return;
    while (active.size < Math.max(1, concurrency) && queue.length > 0) {
      const url = queue.shift()!;
      const image = new Image();
      active.add(image);
      const settled = () => {
        active.delete(image);
        image.onload = null;
        image.onerror = null;
        launch();
      };
      image.onload = settled;
      image.onerror = settled;
      image.decoding = "async";
      image.src = url;
    }
  };

  if ("requestIdleCallback" in window) {
    idleId = window.requestIdleCallback(launch, { timeout: 1500 });
  } else {
    timeoutId = setTimeout(launch, 200);
  }
  return cancel;
}

async function fetchHistoryPage(cursor: string | null, signal: AbortSignal): Promise<HistoryPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/history/${query}`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("历史记录加载失败，请稍后重试");
  const page = await response.json() as HistoryPage;
  if (page.pageSize !== HISTORY_PAGE_SIZE) throw new Error("历史记录分页响应无效");
  return page;
}

export function HistoryProvider({ children }: { children: ReactNode }) {
  const { user, authStatus } = useAuth();
  const currentUserId = authStatus === "authenticated" ? user?.id ?? null : null;
  const [thumbnailsEnabled, setThumbnailsEnabled] = useState(false);
  const [state, setState] = useState<HistoryState>(EMPTY_STATE);
  const stateRef = useRef(state);
  const userIdRef = useRef(currentUserId);
  const controllersRef = useRef(new Set<AbortController>());
  const thumbnailControllersRef = useRef(new Set<AbortController>());
  const requestedCursorsRef = useRef(new Set<string>());
  const thumbnailsEnabledRef = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/config/history-thumbnails", {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ enabled?: unknown }> : null)
      .then((result) => {
        if (controller.signal.aborted) return;
        const enabled = result?.enabled === true;
        thumbnailsEnabledRef.current = enabled;
        setThumbnailsEnabled(enabled);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        thumbnailsEnabledRef.current = false;
        setThumbnailsEnabled(false);
      });
    return () => controller.abort();
  }, []);

  const abortPending = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    for (const controller of thumbnailControllersRef.current) controller.abort();
    controllersRef.current.clear();
    thumbnailControllersRef.current.clear();
    requestedCursorsRef.current.clear();
  }, []);

  const preloadPageThumbnails = useCallback((items: HistoryItem[]) => {
    if (!thumbnailsEnabledRef.current) return;
    const controller = new AbortController();
    thumbnailControllersRef.current.add(controller);
    scheduleThumbnailPreload(
      items.slice(0, HISTORY_PAGE_SIZE).map((item) => item.thumbnailUrl),
      controller.signal,
    );
  }, []);

  const loadFirstPage = useCallback(async (userId: string, force: boolean) => {
    const current = stateRef.current;
    if (!force && !shouldPreloadHistory(userId, current.userId, current.status)) return;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const loadingState: HistoryState = {
      ...current,
      userId,
      status: "loading",
      error: null,
      isLoadingMore: false,
    };
    stateRef.current = loadingState;
    setState(loadingState);
    try {
      const page = await fetchHistoryPage(null, controller.signal);
      if (controller.signal.aborted || userIdRef.current !== userId) return;
      setState((previous) => ({
        userId,
        status: "ready",
        items: force ? mergeHistoryPages(page.items, previous.items) : page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        isLoadingMore: false,
        error: null,
      }));
      preloadPageThumbnails(page.items);
    } catch (error) {
      if (controller.signal.aborted || userIdRef.current !== userId) return;
      setState((previous) => ({
        ...previous,
        userId,
        status: "error",
        error: error instanceof Error ? error.message : "历史记录加载失败，请稍后重试",
      }));
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [preloadPageThumbnails]);

  useEffect(() => {
    if (userIdRef.current !== currentUserId) {
      abortPending();
      userIdRef.current = currentUserId;
      stateRef.current = { ...EMPTY_STATE, userId: currentUserId };
      setState(stateRef.current);
    }
    if (thumbnailsEnabled && currentUserId) {
      const current = stateRef.current;
      if (shouldPreloadHistory(currentUserId, current.userId, current.status)) {
        void loadFirstPage(currentUserId, false);
      } else if (current.items.length > 0) {
        preloadPageThumbnails(current.items);
      }
    }
  }, [abortPending, currentUserId, loadFirstPage, preloadPageThumbnails, thumbnailsEnabled]);

  const ensureFirstPage = useCallback(() => {
    const userId = userIdRef.current;
    if (!userId) return;
    const current = stateRef.current;
    if (current.userId !== userId || current.status === "idle" || current.status === "error") {
      void loadFirstPage(userId, true);
    }
  }, [loadFirstPage]);

  const refreshFirstPage = useCallback(() => {
    const userId = userIdRef.current;
    if (userId) void loadFirstPage(userId, true);
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    const userId = userIdRef.current;
    const current = stateRef.current;
    const cursor = current.nextCursor;
    if (!userId || current.userId !== userId || current.isLoadingMore || !current.hasMore || !cursor) return;
    if (requestedCursorsRef.current.has(cursor)) return;
    requestedCursorsRef.current.add(cursor);
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setState((previous) => ({ ...previous, isLoadingMore: true }));
    try {
      const page = await fetchHistoryPage(cursor, controller.signal);
      if (controller.signal.aborted || userIdRef.current !== userId) return;
      setState((previous) => ({
        ...previous,
        status: "ready",
        items: mergeHistoryPages(previous.items, page.items),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        isLoadingMore: false,
        error: null,
      }));
      preloadPageThumbnails(page.items);
    } catch (error) {
      requestedCursorsRef.current.delete(cursor);
      if (controller.signal.aborted || userIdRef.current !== userId) return;
      setState((previous) => ({
        ...previous,
        isLoadingMore: false,
        error: error instanceof Error ? error.message : "历史记录加载失败，请稍后重试",
      }));
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [preloadPageThumbnails]);

  const visibleState = state.userId === currentUserId ? state : { ...EMPTY_STATE, userId: currentUserId };
  const value = useMemo<HistoryContextValue>(() => ({
    thumbnailsEnabled,
    status: visibleState.status,
    items: visibleState.items,
    nextCursor: visibleState.nextCursor,
    hasMore: visibleState.hasMore,
    isLoadingMore: visibleState.isLoadingMore,
    error: visibleState.error,
    ensureFirstPage,
    refreshFirstPage,
    loadMore,
  }), [ensureFirstPage, loadMore, refreshFirstPage, thumbnailsEnabled, visibleState]);

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context) throw new Error("useHistory must be used inside HistoryProvider");
  return context;
}
