import { Check, ChevronDown, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getModelBadgeColorStyle,
  type ModelBadgeVariant,
  type ModelOption,
} from "./generation-options";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: ModelOption | null;
  options: readonly ModelOption[];
  onSelect: (option: ModelOption) => void;
  darkMode: boolean;
  loadState: "idle" | "loading" | "success" | "error";
  onRetry: () => void;
};

const BADGE_CLASS_NAMES: Record<ModelBadgeVariant, string> = {
  red: "border-rose-400/25 bg-rose-400/15 text-rose-600 dark:text-rose-300",
  green: "border-emerald-400/25 bg-emerald-400/15 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-400/25 bg-amber-400/15 text-amber-700 dark:text-amber-300",
  blue: "border-sky-400/25 bg-sky-400/15 text-sky-700 dark:text-sky-300",
  purple: "border-violet-400/25 bg-violet-400/15 text-violet-700 dark:text-violet-300",
  gray: "border-slate-400/25 bg-slate-400/15 text-slate-600 dark:text-slate-300",
};

type BadgeData = { label: string; className: string; style?: React.CSSProperties };

function getBadge(option: ModelOption): BadgeData | null {
  if (!option.tag) return null;
  const style = getModelBadgeColorStyle(option.badgeColor, option.badgeTextColor);
  return option.badgeVariant || style
    ? {
        label: option.tag,
        className: option.badgeVariant ? BADGE_CLASS_NAMES[option.badgeVariant] : "",
        style,
      }
    : null;
}

function Badge({ badge }: { badge: BadgeData }) {
  return (
    <span
      style={badge.style}
      className={`shrink-0 rounded-md border px-[7px] py-[3px] text-[11px] font-medium leading-none ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function ModelPicker({
  open,
  onOpenChange,
  selected,
  options,
  onSelect,
  darkMode,
  loadState,
  onRetry,
}: Props) {
  if (loadState === "loading" || loadState === "idle") {
    return (
      <button
        type="button"
        disabled
        className="flex h-[66px] w-full items-center rounded-xl border border-violet-400/25 bg-violet-500/[0.08] px-3 text-left text-sm text-slate-400"
      >
        正在加载模型...
      </button>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex h-[66px] items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 text-xs text-amber-700 dark:text-amber-300">
        <span>模型加载失败，请重试</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-amber-500/30 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-amber-500/10"
        >
          重新加载
        </button>
      </div>
    );
  }

  const selectedBadge = selected ? getBadge(selected) : null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!selected}
          title={selected?.name}
          className="flex h-[66px] min-w-0 items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/[0.10] px-3 text-left text-slate-700 transition-colors hover:border-violet-400/55 hover:bg-violet-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-100"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-500 dark:text-[#9DA9CC]">
              模型
            </span>
            <span className="mt-1 block truncate text-[15px] font-semibold leading-[1.3] text-slate-800 dark:text-[#F3F6FF]">
              {selected?.name ?? "暂无可用模型"}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {selectedBadge && <Badge badge={selectedBadge} />}
              {selected && (
                <span className="shrink-0 rounded-md bg-violet-500/[0.14] px-[7px] py-[3px] font-mono text-[11px] font-semibold leading-none text-violet-300">
                  {selected.costCredits} 点
                </span>
              )}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className={`${darkMode ? "dark" : ""} max-h-[min(70vh,430px)] w-[min(410px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-popover/95 p-2 text-popover-foreground shadow-elevated backdrop-blur-2xl`}
      >
        <p className="px-2 pb-2 pt-1 text-[10px] font-medium text-muted-foreground">选择模型</p>
        <div role="radiogroup" aria-label="选择模型" className="space-y-1">
          {options.map((option) => {
            const active = option.value === selected?.value;
            const badge = getBadge(option);
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(option)}
                className={`flex min-h-[62px] w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors ${active ? "border-violet-400/65 bg-indigo-400/[0.16] shadow-[0_0_20px_rgba(91,76,255,.12)]" : "border-transparent hover:border-border hover:bg-white/55 dark:hover:bg-white/[0.045]"}`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${active ? "border-violet-300/35 bg-[linear-gradient(145deg,#7657ff,#368eff)] text-white" : "border-slate-300/60 bg-white/65 text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-500"}`}
                >
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${active ? "text-violet-200" : "text-slate-800 dark:text-slate-200"}`}
                    >
                      {option.name}
                    </span>
                    {badge && <Badge badge={badge} />}
                  </span>
                  <span className="mt-1 block truncate text-[9px] text-slate-500 dark:text-slate-400">
                    {option.description}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md bg-violet-500/[0.14] px-1.5 py-1 font-mono text-[9px] font-semibold text-violet-200">
                    {option.costCredits} 点
                  </span>
                  <Check
                    className={`h-3.5 w-3.5 ${active ? "text-violet-200" : "text-transparent"}`}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
