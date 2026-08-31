import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ControlPanel, type GenProgress } from "./ControlPanel";
import { Canvas } from "./Canvas";
import { HistoryPanel } from "./HistoryPanel";
import { useHistory, type HistoryItem } from "./history-cache";
import { TopBar } from "./TopBar";
import { TaskFloatingPanel, type FloatingTask } from "./TaskFloatingPanel";
import {
  createGenerationSubmissionFingerprint,
  GenerationSubmitGuard,
  submitStudioGeneration,
} from "./generation-submit-guard";
import {
  getReferenceImageIds,
  getModelOption,
  restoreGenerationInputParameters,
  restoreGenerationParameters,
  type GenerationInputParameters,
  type GenerationPrefill,
  type GenerationSubmission,
} from "./generation-options";
import { useAuth } from "@/hooks/use-auth";
import {
  cancelGenerationTask,
  cancelMyQueuedGenerationTasks,
  createGenerationTask,
  getMyGenerationTasks,
  pollGenerationTask,
  startGenerationTask,
} from "@/lib/admin.functions";
import { isGptImage2BackupModel } from "@/lib/gpt-image-2-backup-models";
import { generatedImageUrl } from "@/lib/image-url";
import { toast } from "sonner";
import { createClientId } from "@/lib/client-id";

const AuthModal = lazy(() =>
  import("@/components/auth/AuthModal").then((m) => ({ default: m.AuthModal })),
);
const latestResultStorageKey = (userId: string) => `mumo:studio:last-result:${userId}`;

type StoredLatestResult = {
  url: string;
  prompt: string;
  modelName: string;
};

type ReuseSource = {
  prompt: string;
  modelKey?: string;
  inputParams?: unknown;
};

function createGenerationPrefill(
  prompt: string,
  modelKey?: string,
  inputParams?: unknown,
): GenerationPrefill {
  return {
    nonce: Date.now(),
    prompt,
    referenceImageIds: getReferenceImageIds(inputParams),
    parameters: restoreGenerationParameters(modelKey, inputParams),
  };
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session storage is best-effort UI state only.
  }
}

function saveSessionLatestResult(userId: string, result: StoredLatestResult) {
  if (!result.url) return;
  writeSessionJson(latestResultStorageKey(userId), result);
}

function getActiveQueueTask(tasks: FloatingTask[]) {
  return (
    tasks.find((task) => task.status === "generating") ??
    tasks.find((task) => task.status === "submitting") ??
    tasks.find((task) => task.status === "waiting") ??
    null
  );
}

function getQueueProgress(task: FloatingTask): GenProgress {
  const displayAsGenerating =
    task.status === "generating" ||
    (task.status === "submitting" && isGptImage2BackupModel(task.modelKey));

  if (displayAsGenerating) {
    return {
      stage: "rendering",
      attempt: 0,
      elapsedSec: 0,
      taskId: task.id,
      message: "AI 正在生成图片，请稍候...",
      initialPos: 18,
      renderBudget: 12,
    };
  }

  if (task.status === "submitting") {
    return {
      stage: "submitting",
      attempt: 0,
      elapsedSec: 0,
      taskId: task.id,
      message: "正在提交任务到生成队列...",
      initialPos: 18,
      renderBudget: 12,
    };
  }

  return {
    stage: "queued",
    attempt: 0,
    elapsedSec: 0,
    taskId: task.id,
    message: "任务已加入队列，等待开始生成...",
    initialPos: 18,
    renderBudget: 12,
  };
}

export function Studio() {
  const { session, profile, loading, refreshProfile } = useAuth();
  const { refreshFirstPage: refreshHistoryFirstPage } = useHistory();
  const fetchGenerationTasks = useServerFn(getMyGenerationTasks);
  const createTask = useServerFn(createGenerationTask);
  const cancelTask = useServerFn(cancelGenerationTask);
  const cancelQueuedTasks = useServerFn(cancelMyQueuedGenerationTasks);
  const startTask = useServerFn(startGenerationTask);
  const pollTask = useServerFn(pollGenerationTask);
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generatedTaskId, setGeneratedTaskId] = useState<string | null>(null);
  const [generatedUrlSource, setGeneratedUrlSource] = useState<"result" | "history" | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [forceAuth, setForceAuth] = useState(false);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [adminTasks, setAdminTasks] = useState<FloatingTask[]>([]);
  const [adminPrimaryTaskInBatch, setAdminPrimaryTaskInBatch] = useState(false);
  const [adminPreparingNextTask, setAdminPreparingNextTask] = useState(false);
  const [startingTaskIds, setStartingTaskIds] = useState<string[]>([]);
  const [cancelingTaskIds, setCancelingTaskIds] = useState<string[]>([]);
  const [retryingTaskIds, setRetryingTaskIds] = useState<string[]>([]);
  const [retryPrefill, setRetryPrefill] = useState<GenerationPrefill | null>(null);
  const [reusePrefill, setReusePrefill] = useState<GenerationPrefill | null>(null);
  const [promptClearRequest, setPromptClearRequest] = useState<{
    prompt: string;
    nonce: number;
  } | null>(null);
  const [currentReuseSource, setCurrentReuseSource] = useState<ReuseSource | null>(null);
  const [referenceResetToken, setReferenceResetToken] = useState(0);
  const pollingTaskIdsRef = useRef<Set<string>>(new Set());
  const displayWaitStartedAtRef = useRef(new Map<string, number>());
  const latestSubmittedTaskIdRef = useRef<string | null>(null);
  const promptClearNonceRef = useRef(0);
  const submitGuardRef = useRef(new GenerationSubmitGuard());
  const adminActiveTaskCount = adminTasks.filter(
    (task) =>
      task.status === "waiting" || task.status === "submitting" || task.status === "generating",
  ).length;
  const adminBatchHasContext = generating || adminActiveTaskCount > 0 || adminPreparingNextTask;
  const effectiveCurrentBatchTaskCount = adminBatchHasContext
    ? adminTasks.length + (adminPrimaryTaskInBatch ? 1 : 0)
    : 0;
  const canPrepareNextAdminTask =
    !!session &&
    !adminPreparingNextTask &&
    effectiveCurrentBatchTaskCount < 3 &&
    (generating || adminActiveTaskCount > 0);
  const activeQueueTask = getActiveQueueTask(adminTasks);
  const latestSubmittedTask = latestSubmittedTaskIdRef.current
    ? (adminTasks.find((task) => task.id === latestSubmittedTaskIdRef.current) ?? null)
    : null;
  const foregroundTask =
    latestSubmittedTask &&
    (latestSubmittedTask.status === "waiting" ||
      latestSubmittedTask.status === "submitting" ||
      latestSubmittedTask.status === "generating")
      ? latestSubmittedTask
      : activeQueueTask;
  const shouldShowQueueLoadingOnCanvas = !!foregroundTask;
  const queueProgress = foregroundTask ? getQueueProgress(foregroundTask) : null;

  const trimPanelTasks = (tasks: FloatingTask[]) => {
    const queueTasks = tasks.filter(
      (task) =>
        task.status === "waiting" || task.status === "submitting" || task.status === "generating",
    );
    const recentTasks = tasks.filter(
      (task) =>
        task.status !== "waiting" && task.status !== "submitting" && task.status !== "generating",
    );
    return [...queueTasks, ...recentTasks].slice(0, 3);
  };

  const rememberLatestResult = (url: string, prompt: string, modelName: string) => {
    const userId = session?.user?.id;
    if (!userId) return;
    saveSessionLatestResult(userId, { url, prompt, modelName });
  };

  const prepareCanvasForNewTask = (
    task?: Pick<FloatingTask, "id" | "title" | "status" | "prompt" | "modelName">,
    options: { clearCurrentResult?: boolean } = {},
  ) => {
    const shouldClearDisplay = options.clearCurrentResult ?? generatedUrlSource !== "result";
    if (!shouldClearDisplay) return;

    setGeneratedUrl(null);
    setGeneratedTaskId(null);
    setGeneratedUrlSource(null);
    if (!task) {
      setProgress(null);
      return;
    }
    setCurrentPrompt(task.prompt ?? task.title ?? "");
    setCurrentModel(task.modelName ?? "");
    setProgress(getQueueProgress(task as FloatingTask));
  };

  const mapRecoveredTaskStatus = (
    status: string,
    deductionStatus?: string | null,
    deductionId?: string | null,
    displayReady?: boolean,
  ): FloatingTask["status"] => {
    if (status === "queued") return "waiting";
    if (status === "running") return "generating";
    if (status === "succeeded") return displayReady === false ? "generating" : "done";
    if (status === "failed") return "failed";
    if (status === "canceled") return "failed";
    return "waiting";
  };

  useEffect(() => {
    setGeneratedUrl(null);
    setGeneratedTaskId(null);
    setGeneratedUrlSource(null);
    setCurrentPrompt("");
    setCurrentModel("");
    setProgress(null);
    setAdminTasks([]);
    setAdminPrimaryTaskInBatch(false);
    setAdminPreparingNextTask(false);
    setStartingTaskIds([]);
    setCancelingTaskIds([]);
    setRetryingTaskIds([]);
    setRetryPrefill(null);
    setReusePrefill(null);
    setPromptClearRequest(null);
    setCurrentReuseSource(null);
    setReferenceResetToken((token) => token + 1);
    pollingTaskIdsRef.current.clear();
    displayWaitStartedAtRef.current.clear();
    latestSubmittedTaskIdRef.current = null;
    submitGuardRef.current.reset();
  }, [session?.user?.id]);

  useEffect(() => {
    if (generatedTaskId && generatedUrlSource === "result") refreshHistoryFirstPage();
  }, [generatedTaskId, generatedUrlSource, refreshHistoryFirstPage]);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setAdminTasks([]);
      setAdminPrimaryTaskInBatch(false);
      setAdminPreparingNextTask(false);
      setStartingTaskIds([]);
      setCancelingTaskIds([]);
      setRetryingTaskIds([]);
      setRetryPrefill(null);
      setReusePrefill(null);
      setPromptClearRequest(null);
      setCurrentReuseSource(null);
      setReferenceResetToken((token) => token + 1);
      pollingTaskIdsRef.current.clear();
      displayWaitStartedAtRef.current.clear();
      submitGuardRef.current.reset();
      return;
    }
    fetchGenerationTasks({})
      .then((res) => {
        if (cancelled) return;
        const recovered = (res?.items ?? [])
          .map(
            (task: {
              taskId: string;
              prompt: string | null;
              modelId: string;
              modelName?: string;
              status: string;
              inputParams?: unknown;
              resultImageUrl?: string | null;
              displayReady?: boolean;
              deductionStatus?: string | null;
              deductionId?: string | null;
              errorMessage?: string | null;
            }) => {
              const promptTitle = task.prompt?.trim().slice(0, 20);
              return {
                id: task.taskId,
                title: promptTitle || task.modelId || "生成任务",
                status: mapRecoveredTaskStatus(
                  task.status,
                  task.deductionStatus,
                  task.deductionId,
                  task.displayReady,
                ),
                prompt: task.prompt ?? "",
                modelKey: task.modelId,
                modelName: task.modelName ?? task.modelId,
                inputParams: restoreGenerationInputParameters(task.modelId, task.inputParams),
                resultImageUrl: task.resultImageUrl ?? null,
                displayReady: task.displayReady,
                errorMessage: task.errorMessage ?? null,
              };
            },
          )
          .slice(0, 3);
        const trimmed = trimPanelTasks(recovered);
        setAdminTasks(trimmed);
        const activeTask = getActiveQueueTask(trimmed);
        if (activeTask) {
          setGeneratedUrl(null);
          setGeneratedTaskId(null);
          setGeneratedUrlSource(null);
          setCurrentPrompt(activeTask.prompt ?? activeTask.title ?? "");
          setCurrentModel(activeTask.modelName ?? "");
          setProgress(getQueueProgress(activeTask));
        }
      })
      .catch((error) => {
        console.warn("[generation-tasks] restore failed", error);
        if (!cancelled) {
          setAdminTasks([]);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session) return;
    const runningTaskIds = adminTasks
      .filter((task) => task.status === "generating")
      .map((task) => task.id);
    if (runningTaskIds.length === 0) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      for (const taskId of runningTaskIds) {
        if (pollingTaskIdsRef.current.has(taskId)) continue;
        pollingTaskIdsRef.current.add(taskId);
        pollTask({ data: { taskId } })
          .then((taskResult) => {
            if (cancelled) return;
            const task = taskResult as {
              taskId: string;
              status: string;
              resultImageUrl?: string | null;
              displayReady?: boolean;
              archiveStatus?: string;
              deductionStatus?: string | null;
              historyId?: string | null;
              errorMessage?: string | null;
            };
            const displayReady = task.displayReady !== false;
            const waitingForDisplay = task.status === "succeeded" && !displayReady;
            const displayWaitStartedAt = waitingForDisplay
              ? (displayWaitStartedAtRef.current.get(task.taskId) ?? Date.now())
              : null;
            if (displayWaitStartedAt !== null) {
              displayWaitStartedAtRef.current.set(task.taskId, displayWaitStartedAt);
            }
            const displayWaitExpired = waitingForDisplay && Date.now() - displayWaitStartedAt! >= 90_000;
            const archiveFailed = waitingForDisplay && task.archiveStatus === "failed";
            const isTerminal =
              task.status === "failed" ||
              task.status === "canceled" ||
              (task.status === "succeeded" && (displayReady || displayWaitExpired || archiveFailed));
            if (isTerminal) {
              displayWaitStartedAtRef.current.delete(task.taskId);
              submitGuardRef.current.completeTask(task.taskId);
              pollingTaskIdsRef.current.delete(task.taskId);
              if (latestSubmittedTaskIdRef.current === task.taskId) {
                latestSubmittedTaskIdRef.current = null;
                setGenerating(false);
                setAdminPreparingNextTask(false);
                setProgress(null);
              }
              void refreshProfile();
            }

            if (task.status === "succeeded") {
              const isCurrentTask =
                latestSubmittedTaskIdRef.current === null ||
                latestSubmittedTaskIdRef.current === task.taskId;
              const matchedTask = adminTasks.find((item) => item.id === task.taskId);
              setAdminTasks((tasks) =>
                trimPanelTasks(
                  tasks.map((item) =>
                    item.id === task.taskId
                      ? {
                          ...item,
                          status: displayWaitExpired || archiveFailed
                            ? "failed" as const
                            : waitingForDisplay
                              ? "generating" as const
                              : "done" as const,
                          resultImageUrl: task.resultImageUrl ?? item.resultImageUrl ?? null,
                          displayReady,
                          errorMessage: displayWaitExpired || archiveFailed
                            ? "结果归档未完成，请稍后重试"
                            : item.errorMessage,
                        }
                      : item,
                  ),
                ),
              );
              if (waitingForDisplay && !displayWaitExpired && !archiveFailed && isCurrentTask) {
                setGenerating(true);
                setProgress({
                  stage: "rendering",
                  attempt: 0,
                  elapsedSec: 0,
                  message: displayWaitExpired || archiveFailed
                    ? "结果归档未完成，请稍后重试"
                    : "正在准备结果，请稍候...",
                });
              } else if (task.resultImageUrl && displayReady && isCurrentTask) {
                setGeneratedUrl(generatedImageUrl(task.taskId, "canvas"));
                setGeneratedTaskId(task.taskId);
                setGeneratedUrlSource("result");
                const prompt = matchedTask?.prompt ?? matchedTask?.title ?? "";
                const modelName = matchedTask?.modelName ?? "";
                setCurrentPrompt(prompt);
                setCurrentModel(modelName);
                setCurrentReuseSource({
                  prompt,
                  modelKey: matchedTask?.modelKey,
                  inputParams: matchedTask?.inputParams,
                });
                setProgress(null);
                setPromptClearRequest({
                  prompt,
                  nonce: ++promptClearNonceRef.current,
                });
                rememberLatestResult(generatedImageUrl(task.taskId, "canvas"), prompt, modelName);
              }
              if ((displayWaitExpired || archiveFailed) && isCurrentTask) {
                setGenerating(false);
                setProgress(null);
              }
              return;
            }
            if (task.status === "failed" || task.status === "canceled") {
              setAdminTasks((tasks) =>
                tasks.map((item) =>
                  item.id === task.taskId
                    ? {
                        ...item,
                        status: "failed" as const,
                        errorMessage: task.errorMessage ?? "任务生成失败",
                      }
                    : item,
                ),
              );
              if (
                latestSubmittedTaskIdRef.current === task.taskId ||
                latestSubmittedTaskIdRef.current === null
              ) {
                setProgress(null);
              }
            }
          })
          .catch((error) => {
            console.warn("[generation-tasks] poll failed", error);
          })
          .finally(() => {
            pollingTaskIdsRef.current.delete(taskId);
          });
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, adminTasks]);

  const handleGenerateStart = async ({
    prompt,
    referenceImageIds,
    parameters,
  }: GenerationSubmission) => {
    if (!session) {
      setForceAuth(true);
      return;
    }
    const model = getModelOption(parameters.model);
    const inputParams: GenerationInputParameters = {
      aspectRatio: parameters.aspectRatio,
      quality: parameters.quality,
      referenceImageIds,
      // Concrete pixels will be derived server-side from aspectRatio + quality.
      // UI estimate only. A future server request must ignore this and read models_config.
      costCredits: parameters.costCredits,
    };
    const fingerprint = createGenerationSubmissionFingerprint({
      modelKey: parameters.model,
      prompt,
      aspectRatio: parameters.aspectRatio,
      quality: parameters.quality,
      referenceImageIds,
    });
    try {
      const task = await submitStudioGeneration({
        guard: submitGuardRef.current,
        fingerprint,
        createKey: createClientId,
        onStarted: () => {
          setAdminPreparingNextTask(false);
          setCurrentPrompt(prompt);
          setCurrentModel(model.name);
          setCurrentReuseSource({
            prompt,
            modelKey: parameters.model,
            inputParams,
          });
          setGenerating(true);
          setProgress({
            stage: "submitting",
            attempt: 0,
            elapsedSec: 0,
            message: "正在创建生成任务...",
          });
        },
        createTask: (idempotencyKey) =>
          createTask({
            data: {
              modelKey: parameters.model,
              prompt,
              referenceImageIds,
              parameters: {
                aspectRatio: parameters.aspectRatio,
                quality: parameters.quality,
              },
              idempotencyKey,
            },
          }),
      });
      if (!task) return;
      latestSubmittedTaskIdRef.current = task.taskId;
      void refreshProfile();
      const floatingTask: FloatingTask = {
        id: task.taskId,
        title: prompt.slice(0, 20) || task.modelName,
        status:
          task.status === "succeeded"
            ? task.displayReady === false
              ? "generating"
              : "done"
            : task.status === "failed"
              ? "failed"
              : task.status === "running"
                ? "generating"
                : "waiting",
        prompt,
        modelKey: task.modelId,
        modelName: task.modelName,
        inputParams: task.inputParams,
        resultImageUrl: task.resultImageUrl,
        displayReady: task.displayReady,
        errorMessage: task.errorMessage,
      };
      setAdminTasks((tasks) => trimPanelTasks([floatingTask, ...tasks]));
      if (task.status === "failed") {
        setProgress(null);
        toast.error(task.errorMessage ?? "任务创建失败，请稍后重试。");
      } else {
        setProgress(getQueueProgress(floatingTask));
        toast.success("生成任务已创建");
      }
    } catch (error) {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : "任务创建失败，请稍后重试。");
    } finally {
      setGenerating(false);
    }
  };
  const handleGenerateDone = (url: string | null) => {
    setGenerating(false);
    setAdminPreparingNextTask(false);
    setAdminTasks((tasks) =>
      trimPanelTasks(
        url
          ? tasks.map((task) =>
              task.id.startsWith("admin-preview-") && task.status === "generating"
                ? { ...task, status: "done" as const, resultImageUrl: url }
                : task,
            )
          : tasks.map((task) =>
              task.id.startsWith("admin-preview-") && task.status === "generating"
                ? { ...task, status: "failed" as const }
                : task,
            ),
      ),
    );
    setProgress(null);
    if (url) {
      setGeneratedUrl(url);
      setGeneratedTaskId(null);
      setGeneratedUrlSource("result");
      rememberLatestResult(url, currentPrompt, currentModel);
    }
  };

  const handleAdminPrepareNextTask = () => {
    if (!canPrepareNextAdminTask) return;
    prepareCanvasForNewTask(activeQueueTask ?? undefined, { clearCurrentResult: false });
    setAdminPreparingNextTask(true);
  };

  const handleAdminCreateQueuedTask = async (input: {
    prompt: string;
    modelKey: string;
    modelName: string;
    inputParams: GenerationInputParameters;
  }) => {
    if (!session) return false;
    if (effectiveCurrentBatchTaskCount >= 3) {
      throw new Error("本轮任务已满 3 个，请开始新一轮后再提交。");
    }

    const task = await createTask({
      data: {
        modelKey: input.modelKey,
        prompt: input.prompt,
        referenceImageIds: input.inputParams.referenceImageIds,
        parameters: {
          aspectRatio: input.inputParams.aspectRatio,
          quality: input.inputParams.quality,
        },
        idempotencyKey: createClientId(),
      },
    });

    const title = task.prompt.trim().slice(0, 20) || input.modelName || task.modelId;
    const queuedTask: FloatingTask = {
      id: task.taskId,
      title,
      status: "waiting",
      prompt: input.prompt,
      modelKey: input.modelKey,
      modelName: input.modelName,
      inputParams: input.inputParams,
    };
    setAdminTasks((tasks) => trimPanelTasks([...(!adminBatchHasContext ? [] : tasks), queuedTask]));
    prepareCanvasForNewTask(queuedTask, {
      clearCurrentResult: generatedUrlSource !== "result" || adminActiveTaskCount === 0,
    });
    setAdminPreparingNextTask(false);
    return true;
  };

  const handleAdminClearTestTasks = async () => {
    if (!session) return;
    try {
      await cancelQueuedTasks({});
      setAdminTasks((tasks) =>
        tasks.filter(
          (task) =>
            task.status !== "waiting" &&
            task.status !== "submitting" &&
            task.status !== "generating",
        ),
      );
      setAdminPreparingNextTask(false);
      toast.success("未完成任务已清除");
    } catch (error) {
      const message = error instanceof Error ? error.message : "清除未完成任务失败";
      setProgress(null);
      toast.error(message);
    }
  };

  const handleAdminCancelTask = async (taskId: string) => {
    if (!session) return;
    if (cancelingTaskIds.includes(taskId)) return;
    setCancelingTaskIds((ids) => (ids.includes(taskId) ? ids : [...ids, taskId]));
    try {
      const task = (await cancelTask({ data: { taskId } })) as { taskId: string; status: string };
      if (task.status === "canceled") {
        setAdminTasks((tasks) => tasks.filter((item) => item.id !== task.taskId));
        toast.success("任务已取消");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务取消失败";
      toast.error(message);
    } finally {
      setCancelingTaskIds((ids) => ids.filter((id) => id !== taskId));
    }
  };

  const handleRetryFailedTask = async (taskId: string) => {
    if (!session) return;
    if (retryingTaskIds.includes(taskId)) return;
    if (adminActiveTaskCount >= 3) {
      toast.error("任务已满 3/3");
      return;
    }

    const failedTask = adminTasks.find((task) => task.id === taskId && task.status === "failed");
    if (!failedTask?.prompt || !failedTask.modelKey) {
      toast.error("失败任务参数不完整，请编辑后重试。");
      return;
    }

    setRetryingTaskIds((ids) => (ids.includes(taskId) ? ids : [...ids, taskId]));
    try {
      const retryInputParams =
        failedTask.inputParams ?? restoreGenerationInputParameters(failedTask.modelKey);
      const task = await createTask({
        data: {
          modelKey: failedTask.modelKey,
          prompt: failedTask.prompt,
          referenceImageIds: retryInputParams.referenceImageIds,
          parameters: {
            aspectRatio: retryInputParams.aspectRatio,
            quality: retryInputParams.quality,
          },
          idempotencyKey: createClientId(),
        },
      });
      const title = task.prompt.trim().slice(0, 20) || failedTask.modelName || task.modelId;
      const queuedTask: FloatingTask = {
        id: task.taskId,
        title,
        status: "waiting",
        prompt: task.prompt,
        modelKey: failedTask.modelKey,
        modelName: failedTask.modelName ?? task.modelId,
        inputParams: retryInputParams,
      };
      setAdminTasks((tasks) => trimPanelTasks([...tasks, queuedTask]));
      prepareCanvasForNewTask(queuedTask, {
        clearCurrentResult: generatedUrlSource !== "result" || adminActiveTaskCount === 0,
      });
      toast.success("已重新加入任务队列");
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务创建失败，请稍后重试。";
      toast.error(message);
    } finally {
      setRetryingTaskIds((ids) => ids.filter((id) => id !== taskId));
    }
  };

  const handleEditFailedTask = (taskId: string) => {
    const failedTask = adminTasks.find((task) => task.id === taskId && task.status === "failed");
    if (!failedTask?.prompt) {
      toast.error("失败任务参数不完整，无法回填。");
      return;
    }
    setAdminPreparingNextTask(false);
    setRetryPrefill(
      createGenerationPrefill(failedTask.prompt, failedTask.modelKey, failedTask.inputParams ?? {}),
    );
  };

  const handleAdminStartTask = async (taskId: string) => {
    if (!session) return;
    if (startingTaskIds.includes(taskId)) return;
    const taskForCanvas = adminTasks.find((item) => item.id === taskId);
    setStartingTaskIds((ids) => (ids.includes(taskId) ? ids : [...ids, taskId]));
    setAdminTasks((tasks) =>
      tasks.map((item) =>
        item.id === taskId && item.status === "waiting"
          ? { ...item, status: "submitting" as const }
          : item,
      ),
    );
    if (taskForCanvas) {
      const submittingTask: FloatingTask = { ...taskForCanvas, status: "submitting" };
      prepareCanvasForNewTask(submittingTask, { clearCurrentResult: false });
    }
    try {
      const task = (await startTask({ data: { taskId } })) as {
        taskId: string;
        status: string;
        resultImageUrl?: string | null;
        displayReady?: boolean;
        archiveStatus?: string;
        errorMessage?: string | null;
        deductionStatus?: string | null;
        historyId?: string | null;
      };
      const matchedTask = adminTasks.find((item) => item.id === task.taskId);
      const finalized = task.status === "succeeded" && task.displayReady !== false;
      const waitingForDisplay = task.status === "succeeded" && task.displayReady === false;
      if (task.status === "failed" || finalized) {
        submitGuardRef.current.completeTask(task.taskId);
      }
      const nextStatus = finalized
        ? "done"
        : task.status === "failed"
          ? "failed"
          : "generating";
      if (nextStatus === "generating") latestSubmittedTaskIdRef.current = task.taskId;
      void refreshProfile();
      setAdminTasks((tasks) =>
        trimPanelTasks(
          finalized
            ? tasks.map((item) =>
                item.id === task.taskId
                  ? {
                      ...item,
                      status: "done" as const,
                      resultImageUrl: task.resultImageUrl ?? item.resultImageUrl ?? null,
                      displayReady: true,
                    }
                  : item,
              )
            : tasks.map((item) =>
                item.id === task.taskId
                  ? {
                      ...item,
                      status: nextStatus as FloatingTask["status"],
                      resultImageUrl: task.resultImageUrl ?? item.resultImageUrl ?? null,
                      displayReady: task.displayReady,
                      errorMessage:
                        nextStatus === "failed"
                          ? (task.errorMessage ?? "任务生成失败")
                          : item.errorMessage,
                    }
                  : item,
              ),
        ),
      );
      if (finalized) {
        if (task.resultImageUrl) {
          setGeneratedUrl(generatedImageUrl(task.taskId, "canvas"));
          setGeneratedTaskId(task.taskId);
          setGeneratedUrlSource("result");
          const prompt = matchedTask?.prompt ?? matchedTask?.title ?? "";
          const modelName = matchedTask?.modelName ?? "";
          setCurrentPrompt(prompt);
          setCurrentModel(modelName);
          setCurrentReuseSource({
            prompt,
            modelKey: matchedTask?.modelKey,
            inputParams: matchedTask?.inputParams,
          });
          setProgress(null);
          setPromptClearRequest({
            prompt: matchedTask?.prompt ?? matchedTask?.title ?? "",
            nonce: ++promptClearNonceRef.current,
          });
          rememberLatestResult(generatedImageUrl(task.taskId, "canvas"), prompt, modelName);
        }
        toast.success("任务已完成");
      } else if (task.status === "failed") {
        setProgress(null);
        toast.error(task.errorMessage ?? "任务生成失败");
      } else if (waitingForDisplay) {
        setProgress({
          stage: "rendering",
          attempt: 0,
          elapsedSec: 0,
          message: "正在准备结果，请稍候...",
        });
      } else {
        toast.success("任务已进入生成中");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务启动失败";
      setAdminTasks((tasks) =>
        tasks.map((item) =>
          item.id === taskId ? { ...item, status: "failed" as const, errorMessage: message } : item,
        ),
      );
      setProgress(null);
      void refreshProfile();
      toast.error(message);
    } finally {
      setStartingTaskIds((ids) => ids.filter((id) => id !== taskId));
    }
  };

  useEffect(() => {
    if (!session) return;
    if (generating) return;
    const runningOrStartingIds = new Set(startingTaskIds);
    for (const task of adminTasks) {
      if (task.status === "submitting" || task.status === "generating") {
        runningOrStartingIds.add(task.id);
      }
    }
    if (runningOrStartingIds.size > 0) return;

    const taskToStart = adminTasks.find(
      (task) => task.status === "waiting" && !startingTaskIds.includes(task.id),
    );
    if (!taskToStart) return;

    void handleAdminStartTask(taskToStart.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, adminTasks, startingTaskIds, generating]);

  const handleReuseCurrentResult = () => {
    const source = currentReuseSource ?? (currentPrompt ? { prompt: currentPrompt } : null);
    if (!source?.prompt) {
      toast.error("没有可复用的提示词");
      return;
    }

    const referenceImageIds = getReferenceImageIds(source.inputParams);
    setReusePrefill(createGenerationPrefill(source.prompt, source.modelKey, source.inputParams));
    if (referenceImageIds.length > 0) {
      toast.success("已复用提示词和参考图，可修改后再次生成");
    } else {
      toast.message("已复用提示词，未找到可复用参考图");
    }
  };

  const handleReuseHistory = (item: HistoryItem) => {
    const prompt = item.prompt ?? "";
    if (!prompt) {
      toast.error("没有可复用的提示词");
      return;
    }
    setReusePrefill(createGenerationPrefill(prompt, item.modelKey ?? undefined, item.inputParams));
    setCurrentReuseSource({
      prompt,
      modelKey: item.modelKey ?? undefined,
      inputParams: item.inputParams,
    });
    setReferenceResetToken((token) => token + 1);
    setHistoryOpen(false);
    toast.success("已复用历史参数，可修改后再次生成");
  };

  const showAuth = !loading && (!session || forceAuth);
  const credits = profile?.credits ?? 0;

  return (
    <div className="dark mumo-theme-shell min-h-[100dvh] w-screen overflow-y-auto bg-background text-foreground transition-colors duration-300 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      <div
        className={`${showAuth ? "pointer-events-none select-none blur-sm" : ""} min-h-[100dvh] lg:flex lg:min-h-0 lg:flex-1 lg:flex-col`}
      >
        <TopBar
          credits={credits}
          onOpenHistory={session ? () => setHistoryOpen(true) : undefined}
          onSwitchAccount={() => {
            setForceAuth(true);
          }}
        />
        <div className="relative grid grid-cols-1 pb-[calc(env(safe-area-inset-bottom)+10rem)] lg:min-h-0 lg:flex-1 lg:grid-cols-[540px_minmax(0,1fr)] lg:gap-2 lg:overflow-hidden lg:p-2 lg:pb-2 xl:grid-cols-[600px_minmax(0,1fr)] 2xl:grid-cols-[620px_minmax(0,1fr)]">
          <ControlPanel
            credits={credits}
            onGenerateStart={handleGenerateStart}
            generating={generating}
            promptClearRequest={promptClearRequest}
            retryPrefill={retryPrefill}
            reusePrefill={reusePrefill}
            referenceResetToken={referenceResetToken}
          />
          <Canvas
            userId={null}
            generating={generating || shouldShowQueueLoadingOnCanvas}
            heroIndex={0}
            generatedUrl={generatedUrl}
            generatedTaskId={generatedTaskId}
            currentPrompt={currentPrompt}
            currentModel={currentModel}
            progress={shouldShowQueueLoadingOnCanvas ? queueProgress : progress}
            historyOpen={false}
            onHistoryOpenChange={() => {}}
            onReuseCurrent={handleReuseCurrentResult}
            onSelectHistory={(url, prompt, model, reuseSource, taskId) => {
              setGeneratedUrl(taskId ? generatedImageUrl(taskId, "canvas") : url);
              setGeneratedTaskId(taskId ?? null);
              setGeneratedUrlSource("history");
              setCurrentPrompt(prompt);
              setCurrentModel(model);
              setCurrentReuseSource({
                prompt,
                modelKey: reuseSource?.modelKey ?? undefined,
                inputParams: reuseSource?.inputParams ?? undefined,
              });
              setReferenceResetToken((token) => token + 1);
            }}
            taskOverlay={
              session ? (
                <TaskFloatingPanel
                  tasks={adminTasks}
                  maxTasks={3}
                  onClearTestTasks={handleAdminClearTestTasks}
                  startingTaskIds={startingTaskIds}
                  onCancelTask={handleAdminCancelTask}
                  cancelingTaskIds={cancelingTaskIds}
                  onRetryTask={handleRetryFailedTask}
                  retryingTaskIds={retryingTaskIds}
                  onEditTask={handleEditFailedTask}
                  currentTaskCount={effectiveCurrentBatchTaskCount}
                />
              ) : undefined
            }
          />
          <HistoryPanel
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            onReuse={handleReuseHistory}
          />
        </div>
      </div>
      {showAuth && (
        <Suspense fallback={null}>
          <AuthModal
            onSuccess={() => {
              setForceAuth(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
