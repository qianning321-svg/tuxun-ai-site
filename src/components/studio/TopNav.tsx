import { Sparkles, Zap, Plus } from "lucide-react";

export function TopNav() {
  return (
    <header className="glass sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/60 px-5">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-aurora shadow-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="font-display text-base font-semibold tracking-tight">
          TuXun AI
        </div>
        <nav className="ml-6 hidden items-center gap-1 text-xs text-muted-foreground md:flex">
          <a className="rounded-md px-2.5 py-1.5 text-foreground/90 transition-colors hover:bg-white/5">Create</a>
          <a className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-white/5 hover:text-foreground">Gallery</a>
          <a className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-white/5 hover:text-foreground">Models</a>
          <a className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-white/5 hover:text-foreground">Docs</a>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="glass-elevated flex items-center gap-2 rounded-full px-3 py-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" fill="currentColor" />
          <span className="font-mono text-xs font-medium tabular-nums">2,847</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">credits</span>
        </div>
        <button className="flex items-center gap-1.5 rounded-full bg-gradient-aurora px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-[1.03]">
          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
          Top up
        </button>
        <div className="relative h-8 w-8 overflow-hidden rounded-full ring-1 ring-border">
          <div className="h-full w-full bg-gradient-to-br from-primary/40 via-accent to-secondary" />
          <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">Y</div>
        </div>
      </div>
    </header>
  );
}
