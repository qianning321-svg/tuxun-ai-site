import { Check, ChevronDown, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ParameterOption } from "./generation-options";

type Accent = "emerald" | "amber";

type Props<T extends string> = {
  title: string;
  panelTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: ParameterOption<T>;
  options: ParameterOption<T>[];
  onSelect: (value: T) => void;
  darkMode: boolean;
  columns: 2 | 3 | 4;
  accent?: Accent;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  compactValue?: boolean;
};

const gridClassNames = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
} as const;

const activeClassNames: Record<Accent, string> = {
  emerald:
    "border-violet-400/55 bg-indigo-400/[0.16] text-violet-200 shadow-[0_0_20px_rgba(91,76,255,.12)]",
  amber:
    "border-amber-500/30 bg-amber-500/[0.10] text-amber-700 dark:border-amber-300/30 dark:text-amber-200",
};

export function ParameterPicker<T extends string>({
  title,
  panelTitle,
  open,
  onOpenChange,
  selected,
  options,
  onSelect,
  darkMode,
  columns,
  accent = "emerald",
  align = "start",
  contentClassName = "w-[min(350px,calc(100vw-24px))]",
  compactValue = false,
}: Props<T>) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[66px] min-w-0 items-center gap-2 rounded-xl border border-white/80 bg-white/48 px-3 text-left text-slate-600 shadow-sm transition-colors hover:bg-white/75 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-200 dark:hover:bg-white/[0.075]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-500 dark:text-[#9DA9CC]">
              {title}
            </span>
            <span className="mt-1 block truncate font-mono text-[15px] font-semibold leading-[1.3] text-slate-800 dark:text-[#F3F6FF]">
              {compactValue ? selected.label.replaceAll(" ", "") : selected.label}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className={`${darkMode ? "dark" : ""} ${contentClassName} max-h-[min(70vh,360px)] overflow-y-auto rounded-xl border border-border bg-popover/95 p-2.5 text-popover-foreground shadow-elevated backdrop-blur-2xl`}
      >
        <p className="px-1 pb-2 text-[10px] font-medium text-muted-foreground">{panelTitle}</p>
        <div
          role="radiogroup"
          aria-label={panelTitle}
          className={`grid ${gridClassNames[columns]} gap-1.5`}
        >
          {options.map((option) => {
            const active = option.value === selected.value;
            const hasPreview =
              option.previewWidth !== undefined && option.previewHeight !== undefined;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(option.value)}
                className={`flex min-h-[60px] flex-col items-center justify-center rounded-lg border px-2 py-2 transition-colors ${
                  active
                    ? activeClassNames[accent]
                    : "border-border bg-white/45 text-slate-700 hover:bg-white/75 dark:bg-white/[0.025] dark:text-slate-300 dark:hover:bg-white/[0.05]"
                }`}
              >
                {hasPreview &&
                  (option.value === "auto" ? (
                    <Sparkles className="h-4 w-4" />
                  ) : (
                    <span className="flex h-7 w-10 items-center justify-center">
                      <span
                        className={`block rounded-[3px] border ${active ? "border-emerald-500/80 bg-emerald-500/[0.12] dark:border-emerald-300/80 dark:bg-emerald-300/[0.12]" : "border-slate-400 bg-slate-400/[0.05] dark:border-slate-500"}`}
                        style={{ width: option.previewWidth, height: option.previewHeight }}
                      />
                    </span>
                  ))}
                <span className="font-mono text-[10px] font-semibold">{option.label}</span>
                <span className="mt-1 text-[8px] text-slate-500 dark:text-slate-400">
                  {option.description}
                </span>
                {!hasPreview && (
                  <Check
                    className={`mt-1 h-3 w-3 ${active ? "text-current" : "text-transparent"}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
