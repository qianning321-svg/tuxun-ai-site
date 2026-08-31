import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Cpu,
  Eraser,
  ImagePlus,
  Images,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { listModelsConfig } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";
import { createClientId } from "@/lib/client-id";
import { retryOnce } from "@/lib/browser-retry";
import {
  compressReferenceImage,
  createReferenceImageWorkQueue,
} from "@/lib/client-image-compression";
import { ModelPicker } from "./ModelPicker";
import { ParameterPicker } from "./ParameterPicker";
import {
  ASPECT_RATIO_OPTIONS,
  ASPECT_RATIO_OPTIONS_EXTENDED,
  DEFAULT_GENERATION_PARAMETERS,
  QUALITY_OPTIONS,
  applyReferenceImageUploadSuccess,
  createPersistedReferenceImageSlots,
  getReadyReferenceImageIds,
  getModelOption,
  removeReferenceImageAt,
  normalizeGenerationParametersForModel,
  mergeModelDisplayConfigs,
  selectGenerationModel,
  type ModelDisplayConfig,
  type ModelOption,
  type GenerationParameters,
  type GenerationPrefill,
  type GenerationSubmission,
  type ReferenceImageAsset,
  type ReferenceImageSlot,
} from "./generation-options";
import { usePortalTheme } from "./usePortalTheme";

export type GenProgress = {
  stage: "submitting" | "queued" | "rendering" | "polling";
  attempt: number;
  elapsedSec: number;
  taskId?: string;
  message?: string;
  initialPos?: number;
  renderBudget?: number;
};

function isModelDisplayConfig(value: unknown): value is ModelDisplayConfig {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.model_key === "string" &&
    typeof record.display_name === "string" &&
    (typeof record.cost_credits === "number" || typeof record.cost_credits === "string") &&
    (typeof record.sort_order === "number" || typeof record.sort_order === "string")
  );
}

export type ControlPanelProps = {
  credits: number;
  generating: boolean;
  promptClearRequest: { prompt: string; nonce: number } | null;
  retryPrefill: GenerationPrefill | null;
  reusePrefill: GenerationPrefill | null;
  referenceResetToken: number;
  onGenerateStart: (submission: GenerationSubmission) => void;
};

type OpenPicker = "model" | "ratio" | "quality" | null;

const MAX_REFERENCE_IMAGES = 5;
const runReferenceImageWork = createReferenceImageWorkQueue();

type ReferenceImageSlots = ReferenceImageSlot[];

type InputImageUploadSuccess = {
  ok: true;
  assetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "ready";
};

type InputImageUploadFailure = {
  ok?: false;
  message?: string;
};

type ModelLoadState = "idle" | "loading" | "success" | "error";

const promptIdeas = [
  "高级电商产品摄影，纯净背景，柔和轮廓光，突出商品材质与细节",
  "现代家居商品场景，自然窗光，低饱和配色，干净留白，商业摄影",
  "轻奢美妆主图，银灰蓝背景，细腻光影，通透材质，高级陈列",
];

function getReferenceSlots(): ReferenceImageSlots {
  return Array.from({ length: MAX_REFERENCE_IMAGES }, () => null);
}

function isInputImageUploadSuccess(value: unknown): value is InputImageUploadSuccess {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InputImageUploadSuccess>;
  return (
    candidate.ok === true &&
    typeof candidate.assetId === "string" &&
    !!candidate.assetId &&
    typeof candidate.filename === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.sizeBytes === "number" &&
    candidate.status === "ready"
  );
}

function getUploadErrorMessage(value: unknown): string {
  if (value && typeof value === "object") {
    const candidate = value as InputImageUploadFailure;
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message.trim();
    }
  }
  return "参考图上传失败，请重新选择。";
}

async function deleteReferenceImageAsset(assetId: string): Promise<void> {
  try {
    await fetch("/api/uploads/input-image", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
  } catch {
    // Local removal stays immediate; expiry cleanup is the fallback.
  }
}

export function ControlPanel({
  credits,
  generating,
  promptClearRequest,
  retryPrefill,
  reusePrefill,
  referenceResetToken,
  onGenerateStart,
}: ControlPanelProps) {
  const { session, loading: authLoading } = useAuth();
  const fetchModelConfigs = useServerFn(listModelsConfig);
  const [prompt, setPrompt] = useState("");
  const [parameters, setParameters] = useState<GenerationParameters>(DEFAULT_GENERATION_PARAMETERS);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>("idle");
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageSlots>(() =>
    getReferenceSlots(),
  );
  const referenceImagesRef = useRef<ReferenceImageSlots>(referenceImages);
  const appliedPrefillNonceRef = useRef<number | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const { anchorRef: panelRef, darkMode } = usePortalTheme<HTMLElement>();
  const charCount = prompt.length;
  const referenceCount = referenceImages.filter(Boolean).length;
  const visibleModelOptions = modelOptions;
  const selectedModel = visibleModelOptions.length
    ? getModelOption(parameters.model, visibleModelOptions)
    : null;
  const ratioOptions = selectedModel
    ? ASPECT_RATIO_OPTIONS_EXTENDED.filter((option) =>
        selectedModel.supportedAspectRatios.includes(option.value),
      )
    : [];
  const qualityOptions = selectedModel
    ? QUALITY_OPTIONS.filter((option) => selectedModel.supportedQualities.includes(option.value))
    : [];
  const selectedRatio =
    ratioOptions.find((option) => option.value === parameters.aspectRatio) ?? ratioOptions[0];
  const selectedQuality =
    qualityOptions.find((option) => option.value === parameters.quality) ?? qualityOptions[0];
  const activePrefill = useMemo(() => {
    if (!retryPrefill) return reusePrefill;
    if (!reusePrefill) return retryPrefill;
    return retryPrefill.nonce >= reusePrefill.nonce ? retryPrefill : reusePrefill;
  }, [retryPrefill, reusePrefill]);

  const loadModels = useCallback(async () => {
    setModelLoadState("loading");
    try {
      const rows = await retryOnce(() => fetchModelConfigs({}));
      if (!Array.isArray(rows)) throw new Error("Invalid model configuration response");
      setModelOptions(mergeModelDisplayConfigs(rows.filter(isModelDisplayConfig)));
      setModelLoadState("success");
    } catch (error) {
      console.warn("[models] load failed", error);
      setModelOptions([]);
      setModelLoadState("error");
    }
  }, [fetchModelConfigs]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      setModelOptions([]);
      setModelLoadState("idle");
      return;
    }
    void loadModels();
  }, [authLoading, session?.user.id, loadModels]);

  useEffect(() => {
    if (
      visibleModelOptions.length === 0 ||
      visibleModelOptions.some((option) => option.value === parameters.model)
    )
      return;
    setParameters((current) =>
      selectGenerationModel(current, visibleModelOptions[0].value, visibleModelOptions),
    );
  }, [visibleModelOptions, parameters.model]);

  const releaseObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const updateReferenceImages = useCallback(
    (updater: (images: ReferenceImageSlots) => ReferenceImageSlots) => {
      setReferenceImages((images) => {
        const nextImages = updater(images);
        referenceImagesRef.current = nextImages;
        return nextImages;
      });
    },
    [],
  );

  const replaceReferenceImages = useCallback(
    (referenceImageIds: string[] = []) => {
      const currentIds = getReadyReferenceImageIds(referenceImagesRef.current);
      const canPreserveCurrentPreviews =
        referenceImageIds.length > 0 &&
        referenceImageIds.length === currentIds.length &&
        referenceImageIds.every((assetId, index) => assetId === currentIds[index]);
      if (canPreserveCurrentPreviews) return;

      releaseObjectUrls();
      const nextSlots = createPersistedReferenceImageSlots(
        referenceImageIds,
        MAX_REFERENCE_IMAGES,
      );
      referenceImagesRef.current = nextSlots;
      setReferenceImages(nextSlots);
    },
    [releaseObjectUrls],
  );

  useEffect(() => releaseObjectUrls, [releaseObjectUrls]);

  useEffect(() => {
    replaceReferenceImages();
  }, [referenceResetToken, replaceReferenceImages]);

  useEffect(() => {
    if (!activePrefill) return;
    if (!selectedModel) return;
    if (appliedPrefillNonceRef.current === activePrefill.nonce) return;
    appliedPrefillNonceRef.current = activePrefill.nonce;
    setPrompt(activePrefill.prompt.slice(0, 1000));
    const normalized = normalizeGenerationParametersForModel(
      activePrefill.parameters,
      visibleModelOptions,
    );
    setParameters(normalized);
    replaceReferenceImages(
      getModelOption(normalized.model, visibleModelOptions).supportsReferenceImages
        ? activePrefill.referenceImageIds
        : [],
    );
  }, [activePrefill, selectedModel, visibleModelOptions, replaceReferenceImages]);

  useEffect(() => {
    if (!promptClearRequest) return;
    setPrompt((current) => (current === promptClearRequest.prompt ? "" : current));
  }, [promptClearRequest]);

  const useRandomPrompt = () => {
    const currentIndex = promptIdeas.indexOf(prompt);
    setPrompt(promptIdeas[(currentIndex + 1 + promptIdeas.length) % promptIdeas.length]);
  };

  const setReferenceImage = (index: number, file?: File) => {
    if (!file) return;
    const previousAsset = referenceImagesRef.current[index];
    if (previousAsset?.status === "ready" && previousAsset.assetId) {
      void deleteReferenceImageAsset(previousAsset.assetId);
    }
    if (previousAsset && objectUrlsRef.current.has(previousAsset.localPreviewUrl)) {
      URL.revokeObjectURL(previousAsset.localPreviewUrl);
      objectUrlsRef.current.delete(previousAsset.localPreviewUrl);
    }
    const localPreviewUrl = URL.createObjectURL(file);
    const uploadRequestId = createClientId();
    objectUrlsRef.current.add(localPreviewUrl);
    const uploadingAsset: ReferenceImageAsset = {
      localPreviewUrl,
      uploadRequestId,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      status: "uploading",
      uploadPhase: "processing",
    };
    updateReferenceImages((images) =>
      images.map((asset, slot) => (slot === index ? uploadingAsset : asset)),
    );

    void runReferenceImageWork(async () => {
      try {
        const compression = await compressReferenceImage(file);
        if (referenceImagesRef.current[index]?.uploadRequestId !== uploadRequestId) return;

        const uploadFile = compression.file;
        updateReferenceImages((images) =>
          images.map((asset, slot) =>
            slot === index && asset?.uploadRequestId === uploadRequestId
              ? {
                  ...asset,
                  filename: uploadFile.name,
                  mimeType: uploadFile.type,
                  sizeBytes: uploadFile.size,
                  uploadPhase: "uploading",
                }
              : asset,
          ),
        );
        const formData = new FormData();
        formData.append("image", uploadFile, uploadFile.name);
        const response = await fetch("/api/uploads/input-image", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = undefined;
        }
        if (!response.ok || !isInputImageUploadSuccess(payload)) {
          throw new Error(getUploadErrorMessage(payload));
        }

        if (referenceImagesRef.current[index]?.uploadRequestId !== uploadRequestId) {
          void deleteReferenceImageAsset(payload.assetId);
          return;
        }
        updateReferenceImages((images) =>
          applyReferenceImageUploadSuccess(images, index, uploadRequestId, payload),
        );
      } catch (error) {
        if (referenceImagesRef.current[index]?.uploadRequestId !== uploadRequestId) return;
        const message = error instanceof Error ? error.message : "参考图上传失败，请重新选择。";
        updateReferenceImages((images) =>
          images.map((asset, slot) =>
            slot === index && asset?.uploadRequestId === uploadRequestId
              ? { ...asset, status: "error", assetId: undefined, errorMessage: message }
              : asset,
          ),
        );
        toast.error(message);
      }
    });
  };

  const removeReferenceImage = (index: number) => {
    const previousAsset = referenceImagesRef.current[index];
    if (previousAsset?.status === "ready" && previousAsset.assetId) {
      void deleteReferenceImageAsset(previousAsset.assetId);
    }
    if (previousAsset && objectUrlsRef.current.has(previousAsset.localPreviewUrl)) {
      URL.revokeObjectURL(previousAsset.localPreviewUrl);
      objectUrlsRef.current.delete(previousAsset.localPreviewUrl);
    }
    updateReferenceImages((images) => removeReferenceImageAt(images, index));
  };

  const startVisualCreation = () => {
    if (!selectedModel) {
      toast.error(modelLoadState === "error" ? "模型加载失败，请重试。" : "暂无可用模型");
      return;
    }
    if (referenceImages.some((asset) => asset?.status === "uploading")) {
      toast.info("参考图正在处理或上传");
      return;
    }
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      toast.info("请先输入画面描述");
      return;
    }

    const safeParameters = normalizeGenerationParametersForModel(parameters, visibleModelOptions);
    // Client pricing is display metadata only. The future server flow must read models_config.
    onGenerateStart({
      prompt: normalizedPrompt,
      referenceImageIds: selectedModel.supportsReferenceImages
        ? getReadyReferenceImageIds(referenceImages)
        : [],
      parameters: safeParameters,
    });
  };

  return (
    <aside
      ref={panelRef}
      className="relative grid w-full self-start grid-rows-[auto_auto_minmax(304px,1fr)] gap-3 overflow-hidden rounded-2xl border border-white/55 bg-white/20 p-2.5 backdrop-blur-xl transition-colors duration-300 dark:border-white/[0.06] dark:bg-[#101925]/48 lg:h-full lg:min-h-0 lg:self-stretch lg:grid-rows-[184px_138px_minmax(0,1fr)]"
    >
      <PanelSection
        icon={<Images className="h-4 w-4" />}
        title="参考图"
        compact
        className="overflow-hidden"
        trailing={
          selectedModel?.supportsReferenceImages ? (
            <SectionBadge>
              {referenceCount} / {MAX_REFERENCE_IMAGES}
            </SectionBadge>
          ) : undefined
        }
      >
        {selectedModel?.supportsReferenceImages ? (
          <div className="grid grid-cols-5 gap-2">
            {referenceImages.map((asset, index) => (
              <CompactReferenceSlot
                key={index}
                index={index}
                asset={asset}
                onSelect={(file) => setReferenceImage(index, file)}
                onRemove={() => removeReferenceImage(index)}
              />
            ))}
          </div>
        ) : (
          <p className="px-1 py-2 text-xs text-muted-foreground">当前模型暂不支持参考图</p>
        )}
      </PanelSection>

      <PanelSection
        icon={<Cpu className="h-4 w-4" />}
        title="生成参数"
        compact
        className="overflow-visible"
      >
        <div className="grid w-full grid-cols-2 gap-2 [&>button]:w-full [&>div>button]:w-full lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
          <div className="col-span-2 w-full lg:col-span-1">
            <ModelPicker
              open={openPicker === "model"}
              onOpenChange={(open) => setOpenPicker(open ? "model" : null)}
              selected={selectedModel}
              options={visibleModelOptions}
              loadState={modelLoadState}
              onRetry={() => void loadModels()}
              onSelect={(option) => {
                setParameters((current) =>
                  selectGenerationModel(current, option.value, visibleModelOptions),
                );
                if (!option.supportsReferenceImages) {
                  getReadyReferenceImageIds(referenceImagesRef.current).forEach(
                    (assetId) => void deleteReferenceImageAsset(assetId),
                  );
                  replaceReferenceImages();
                }
                setOpenPicker(null);
              }}
              darkMode={darkMode}
            />
          </div>
          {selectedModel && (
            <ParameterPicker
              title="比例"
              panelTitle="画面比例"
              open={openPicker === "ratio"}
              onOpenChange={(open) => setOpenPicker(open ? "ratio" : null)}
              selected={selectedRatio}
              options={ratioOptions}
              onSelect={(value) => {
                setParameters((current) => ({ ...current, aspectRatio: value }));
                setOpenPicker(null);
              }}
              darkMode={darkMode}
              columns={4}
            />
          )}
          {selectedModel && (
            <ParameterPicker
              title="质量"
              panelTitle="输出质量"
              open={openPicker === "quality"}
              onOpenChange={(open) => setOpenPicker(open ? "quality" : null)}
              selected={selectedQuality}
              options={qualityOptions}
              onSelect={(value) => {
                setParameters((current) => ({ ...current, quality: value }));
                setOpenPicker(null);
              }}
              darkMode={darkMode}
              columns={3}
              align="end"
              contentClassName="w-[min(250px,calc(100vw-24px))]"
            />
          )}
        </div>
      </PanelSection>

      <PanelSection
        icon={<WandSparkles className="h-4 w-4" />}
        title="提示词输入"
        className="min-h-0 overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        trailing={
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded-lg border border-slate-400/20 bg-white/45 px-2 py-1 text-xs text-slate-500 disabled:opacity-80 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#9DA8C8]"
          >
            <Bot className="h-3.5 w-3.5" />
            AI 助手
          </button>
        }
      >
        <div className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-white/80 bg-white/50 shadow-inner transition-colors focus-within:border-slate-400/45 dark:border-white/10 dark:bg-[#111c2a]/72 dark:focus-within:border-slate-500/45">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, 1000))}
            placeholder="例如：白色香薰瓶置于浅灰石材台面，柔和侧光，简洁高级的电商主图…"
            className="min-h-[96px] w-full flex-1 resize-none bg-transparent px-3.5 py-3 text-[15px] leading-6 text-slate-700 outline-none placeholder:text-[#7F8DB4] dark:text-[#E9EEFF] dark:placeholder:text-[#7F8DB4]"
          />
          <div className="flex items-center justify-between border-t border-slate-400/10 px-3 py-1.5 dark:border-white/[0.07]">
            <span className="font-mono text-xs text-slate-400 dark:text-[#9DA8C8]">
              {charCount} / 1000
            </span>
            <div className="flex items-center gap-1">
              <PromptAction label="清空" onClick={() => setPrompt("")}>
                <Eraser className="h-3 w-3" />
              </PromptAction>
              <PromptAction label="随机词" onClick={useRandomPrompt}>
                <Sparkles className="h-3 w-3" />
              </PromptAction>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={startVisualCreation}
          disabled={generating || !selectedModel}
          title={`开始视觉创作 · 当前余额 ${credits} 点`}
          className="mumo-neon-button mt-2.5 flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold text-white transition-transform enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <WandSparkles className="h-4 w-4 text-[#ead8ae]" />
          <span>{!selectedModel ? "暂无可用模型" : generating ? "生成中…" : "开始视觉创作"}</span>
          {selectedModel && (
            <span className="ml-1 flex items-center gap-1 rounded-md border border-[#d8c18f]/20 bg-[#d8c18f]/[0.08] px-[7px] py-[3px] font-mono text-[11px] leading-none text-[#ead8ae]">
              <Zap className="h-3 w-3" />
              {parameters.costCredits} 点
            </span>
          )}
        </button>
      </PanelSection>
    </aside>
  );
}

function PanelSection({
  icon,
  title,
  trailing,
  compact = false,
  className = "",
  bodyClassName = "",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  trailing?: React.ReactNode;
  compact?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`mumo-panel flex min-h-0 flex-col rounded-2xl ${compact ? "p-2.5" : "p-3"} ${className}`}
    >
      <div className={`flex items-center gap-2.5 ${compact ? "mb-2" : "mb-2.5"}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/80 bg-white/55 text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/[0.055] dark:text-slate-300">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight text-slate-800 dark:text-[#F5F7FF]">
            {title}
          </h2>
        </div>
        {trailing}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function SectionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-[#b89a61]/20 bg-[#eadfc8]/30 px-2 py-1 font-mono text-xs text-[#806a43] dark:border-[#d8c18f]/15 dark:bg-[#d8c18f]/[0.06] dark:text-[#d8c18f]">
      {children}
    </span>
  );
}

function CompactReferenceSlot({
  index,
  asset,
  onSelect,
  onRemove,
}: {
  index: number;
  asset: ReferenceImageAsset | null;
  onSelect: (file?: File) => void;
  onRemove: () => void;
}) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const previewFailed = !!asset && failedPreviewUrl === asset.localPreviewUrl;

  if (!asset) {
    return (
      <label className="group relative flex aspect-square w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-400/28 bg-white/34 text-slate-400 transition-colors hover:border-slate-500/50 hover:bg-white/68 hover:text-slate-600 dark:border-slate-500/30 dark:bg-white/[0.03] dark:text-slate-500 dark:hover:border-slate-400/45 dark:hover:bg-white/[0.06] dark:hover:text-slate-300">
        <ImagePlus className="h-[18px] w-[18px]" />
        <span className="text-xs">参考 {index + 1}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            onSelect(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
    );
  }

  return (
    <div className="group relative aspect-square w-full min-w-0 overflow-hidden rounded-xl border border-white/90 bg-white/70 p-1.5 shadow-sm dark:border-white/10 dark:bg-slate-900/60">
      <img
        src={asset.localPreviewUrl}
        alt={`参考图 ${index + 1}`}
        onError={() => setFailedPreviewUrl(asset.localPreviewUrl)}
        className={`h-full w-full rounded-lg object-contain ${previewFailed ? "invisible" : ""}`}
      />
      {previewFailed && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
          预览失败
        </span>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent" />
      <span className="absolute left-1 top-1 rounded bg-white/78 px-1 py-0.5 text-[7px] font-medium text-slate-600 backdrop-blur">
        {index + 1}
      </span>
      <span
        title={asset.errorMessage}
        aria-live="polite"
        className={`absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded px-1 py-0.5 text-[7px] font-medium backdrop-blur ${
          asset.status === "error"
            ? "bg-red-500/85 text-white"
            : asset.status === "ready"
              ? "bg-emerald-600/80 text-white"
              : "bg-slate-900/72 text-white"
        }`}
      >
        {asset.status === "uploading" ? (
          <LoaderCircle className="h-2 w-2 animate-spin" />
        ) : asset.status === "ready" ? (
          <CircleCheck className="h-2 w-2" />
        ) : (
          <CircleAlert className="h-2 w-2" />
        )}
        {asset.status === "uploading"
          ? asset.uploadPhase === "processing"
            ? "处理中"
            : "上传中"
          : asset.status === "ready"
            ? "已上传"
            : "失败"}
      </span>
      <div className="absolute inset-x-1 bottom-1 z-10 flex items-center justify-center gap-1">
        <label className="flex cursor-pointer items-center gap-0.5 rounded bg-slate-900/72 px-1.5 py-1 text-[7px] text-white/90 backdrop-blur transition-colors hover:bg-slate-900/88">
          <RefreshCw className="h-2 w-2" />
          替换
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              onSelect(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          title={`删除参考图 ${index + 1}`}
          onClick={onRemove}
          className="flex items-center gap-0.5 rounded bg-white/86 px-1.5 py-1 text-[7px] text-slate-600 backdrop-blur transition-colors hover:text-red-500"
        >
          <Trash2 className="h-2 w-2" />
          删除
        </button>
      </div>
    </div>
  );
}

function PromptAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-700 dark:text-[#9DA8C8] dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
    >
      {children}
      {label}
    </button>
  );
}
