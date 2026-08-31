import { Sparkles, Plus, Zap, History, Settings, Moon, HelpCircle } from "lucide-react";

type Props = { credits: number; onOpenHistory: () => void };

export function RightRail({ credits, onOpenHistory }: Props) {
  return (
    <aside className="flex h-screen flex-col items-center justify-between border-l border-border/60 bg-card/60 py-4 backdrop-blur-xl">
      {/* Top: brand + avatar */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-aurora shadow-glow">
          <Sparkles className="h-5 w-5 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="my-1 h-px w-7 bg-border" />
        <div className="relative h-9 w-9 overflow-hidden rounded-full ring-1 ring-border">
          <div className="h-full w-full bg-gradient-to-br from-primary/40 via-accent to-secondary" />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">Y</div>
          <span className="absolute -bottom-0 -right-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
        </div>
      </div>

      {/* Middle: credits + history */}
      <div className="flex flex-col items-center gap-2.5">
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-white/[0.03] px-2 py-2.5">
          <Zap className="h-3.5 w-3.5 text-primary" fill="currentColor" />
          <span className="font-mono text-[11px] font-semibold tabular-nums leading-none">{credits}</span>
          <span className="text-[8px] font-light uppercase tracking-wider text-muted-foreground leading-none">pts</span>
        </div>
        <button
          title="Top up"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-aurora text-primary-foreground shadow-glow transition-transform hover:scale-[1.06]"
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>
        <div className="my-1 h-px w-7 bg-border" />
        <RailBtn title="History" onClick={onOpenHistory}>
          <History className="h-4 w-4" />
        </RailBtn>
      </div>

      {/* Bottom: secondary */}
      <div className="flex flex-col items-center gap-1.5">
        <RailBtn title="Theme"><Moon className="h-4 w-4" /></RailBtn>
        <RailBtn title="Help"><HelpCircle className="h-4 w-4" /></RailBtn>
        <RailBtn title="Settings"><Settings className="h-4 w-4" /></RailBtn>
      </div>
    </aside>
  );
}

function RailBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="group relative flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-all hover:border-border hover:bg-white/[0.05] hover:text-foreground"
    >
      {children}
    </button>
  );
}
