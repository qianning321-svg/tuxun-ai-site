import { useState } from "react";
import { CheckCircle2, CircleDashed, Clock3, ListChecks, Loader2, XCircle } from "lucide-react";
import { isGptImage2BackupModel } from "@/lib/gpt-image-2-backup-models";
import type { GenerationInputParameters } from "./generation-options";

export type TaskStatus = "waiting" | "submitting" | "generating" | "done" | "failed";

export type FloatingTask = {
  id: string;
  title: string;
  status: TaskStatus;
  prompt?: string;
  modelKey?: string;
  modelName?: string;
  inputParams?: GenerationInputParameters;
  errorMessage?: string | null;
  resultImageUrl?: string | null;
  displayReady?: boolean;
};

const STATUS_META: Record<TaskStatus, { label: string; icon: typeof Clock3; className: string }> = {
  waiting: { label: "等待中", icon: Clock3, className: "text-muted-foreground" },
  submitting: { label: "提交中", icon: CircleDashed, className: "text-sky-300" },
  generating: { label: "生成中", icon: Loader2, className: "text-primary" },
  done: { label: "完成", icon: CheckCircle2, className: "text-emerald-300" },
  failed: { label: "失败", icon: XCircle, className: "text-destructive" },
};

function formatTaskErrorMessage(message?: string | null): string {
  const raw = (message ?? "").trim();
  if (!raw) return "生成失败，上游服务异常，请稍后重试";

  const lower = raw.toLowerCase();

  if (lower.includes("generate image failed")) {
    return "生成失败，上游服务异常，请稍后重试";
  }

  if (
    lower.includes("upstream request failed") ||
    lower.includes("fetch failed") ||
    lower.includes("networkerror")
  ) {
    return "生成失败，服务请求异常，请稍后重试";
  }

  if (lower.includes("content policy") || lower.includes("policy") || lower.includes("rejected")) {
    return "此内容可能违反内容政策，请修改提示词后重试";
  }

  if (
    lower.includes("ref_url") ||
    lower.includes("reference image") ||
    lower.includes("reference")
  ) {
    return "参考图读取失败，请检查图片链接或重新上传参考图";
  }

  if (lower.includes("without charged deduction") || lower.includes("finalize task failed")) {
    return "生成结果结算异常，已保护余额，请联系客服处理";
  }

  return raw;
}

export function TaskFloatingPanel({
  tasks,
  maxTasks = 3,
  onClearTestTasks,
  startingTaskIds = [],
  onCancelTask,
  cancelingTaskIds = [],
  onRetryTask,
  retryingTaskIds = [],
  onEditTask,
  currentTaskCount,
}: {
  tasks: FloatingTask[];
  maxTasks?: number;
  onClearTestTasks?: () => void | Promise<void>;
  startingTaskIds?: string[];
  onCancelTask?: (taskId: string) => void | Promise<void>;
  cancelingTaskIds?: string[];
  onRetryTask?: (taskId: string) => void | Promise<void>;
  retryingTaskIds?: string[];
  onEditTask?: (taskId: string) => void;
  currentTaskCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = tasks.filter(
    (task) =>
      task.status === "waiting" || task.status === "submitting" || task.status === "generating",
  ).length;
  const displayCount = currentTaskCount ?? activeCount;

  return (
    <div data-testid="task-floating-panel" className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="glass-elevated flex items-center gap-2 rounded-full border border-primary/30 bg-card/90 px-3 py-2 text-xs font-semibold text-foreground shadow-glow backdrop-blur-xl transition-colors hover:border-primary/60"
      >
        <ListChecks className="h-3.5 w-3.5 text-primary" />
        任务 {displayCount}/{maxTasks}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border/70 bg-card/95 p-3 shadow-2xl backdrop-blur-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">任务队列</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                显示当前队列和最近完成，最多 3 个任务
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onClearTestTasks && (
                <button
                  type="button"
                  onClick={onClearTestTasks}
                  className="rounded-full border border-border/70 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                >
                  清除未完成任务
                </button>
              )}
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {displayCount}/{maxTasks}
              </span>
            </div>
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-white/[0.02] px-3 py-4 text-center text-xs text-muted-foreground">
              暂无任务队列
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => {
                const displayStatus =
                  task.status === "submitting" && isGptImage2BackupModel(task.modelKey)
                    ? "generating"
                    : task.status;
                const meta = STATUS_META[displayStatus];
                const Icon = meta.icon;
                const starting = startingTaskIds.includes(task.id);
                const canceling = cancelingTaskIds.includes(task.id);
                const retrying = retryingTaskIds.includes(task.id);
                return (
                  <div
                    key={task.id}
                    className="rounded-lg border border-border/60 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`h-3.5 w-3.5 ${meta.className} ${displayStatus === "generating" ? "animate-spin" : ""}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground">
                          {task.title}
                        </div>
                        <div className={`text-[10px] ${meta.className}`}>{meta.label}</div>
                      </div>
                      {task.status === "waiting" && onCancelTask && (
                        <button
                          type="button"
                          disabled={starting || canceling}
                          onClick={() => onCancelTask(task.id)}
                          className="shrink-0 rounded-md border border-border/70 bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {canceling ? "取消中..." : "取消"}
                        </button>
                      )}
                    </div>

                    {task.status === "failed" && (
                      <div className="mt-2 space-y-2">
                        {task.errorMessage && (
                          <div className="line-clamp-2 rounded-md bg-destructive/10 px-2 py-1 text-[10px] leading-relaxed text-destructive">
                            {formatTaskErrorMessage(task.errorMessage)}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {onRetryTask && (
                            <button
                              type="button"
                              disabled={retrying}
                              onClick={() => onRetryTask(task.id)}
                              className="rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {retrying ? "提交中..." : "重新生成"}
                            </button>
                          )}
                          {onEditTask && (
                            <button
                              type="button"
                              onClick={() => onEditTask(task.id)}
                              className="rounded-md border border-border/70 bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                            >
                              编辑后重试
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">状态说明</div>
            <div className="grid grid-cols-5 gap-1">
              {(Object.keys(STATUS_META) as TaskStatus[]).map((status) => {
                const meta = STATUS_META[status];
                const Icon = meta.icon;
                return (
                  <div
                    key={status}
                    className="flex flex-col items-center gap-1 rounded-md bg-white/[0.03] px-1 py-2"
                  >
                    <Icon className={`h-3 w-3 ${meta.className}`} />
                    <span className="text-[9px] text-muted-foreground">{meta.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
