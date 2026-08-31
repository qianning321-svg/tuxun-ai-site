import { useState } from "react";
import { Download, Copy, Maximize2, Heart, X, Sparkles, Clock } from "lucide-react";
import img1 from "@/assets/gen-1.jpg";
import img2 from "@/assets/gen-2.jpg";
import img3 from "@/assets/gen-3.jpg";
import img4 from "@/assets/gen-4.jpg";
import img5 from "@/assets/gen-5.jpg";
import img6 from "@/assets/gen-6.jpg";

type Item = {
  id: string;
  src: string;
  ratio: string;
  prompt: string;
  model: string;
  time: string;
};

const ITEMS: Item[] = [
  { id: "1", src: img1, ratio: "1/1", prompt: "Surreal aurora over dark mountains, ethereal mist, cinematic dreamscape", model: "Flux Pro Ultra", time: "2m ago" },
  { id: "2", src: img2, ratio: "3/4", prompt: "Cyberpunk portrait with holographic green visor, moody neon lighting", model: "GPT Image 2", time: "6m ago" },
  { id: "3", src: img3, ratio: "16/9", prompt: "Brutalist concrete architecture under stormy sky, ultra wide cinematic", model: "Nano Banana", time: "14m ago" },
  { id: "4", src: img4, ratio: "1/1", prompt: "Abstract liquid metal sculpture, iridescent green chrome, studio lighting", model: "Flux Pro Ultra", time: "1h ago" },
  { id: "5", src: img5, ratio: "3/4", prompt: "Macro bioluminescent jellyfish in deep dark ocean, emerald light", model: "GPT Image 2", time: "2h ago" },
  { id: "6", src: img6, ratio: "1/1", prompt: "Vintage analog synthesizer close up, knobs and cables, dark photography", model: "SD 3.5 Turbo", time: "3h ago" },
];

const TABS = ["Recent", "Liked", "Upscaled", "Drafts"];

export function Gallery() {
  const [active, setActive] = useState<Item | null>(null);
  const [tab, setTab] = useState("Recent");

  return (
    <main className="scrollbar-thin flex h-[calc(100vh-3.5rem)] flex-1 flex-col overflow-y-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border/60 bg-background/60 px-7 py-4 backdrop-blur-xl">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Your creations</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Clock className="mr-1 inline h-3 w-3" /> 248 images · 12 this session
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-white/[0.02] p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                tab === t
                  ? "bg-white/8 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Generating hero */}
      <div className="px-7 pt-6">
        <div className="glass-elevated relative overflow-hidden rounded-2xl p-5">
          <div className="absolute inset-0 -z-10 opacity-60" style={{ background: "var(--gradient-glow)" }} />
          <div className="flex items-center gap-4">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-aurora shadow-glow">
              <Sparkles className="h-5 w-5 animate-pulse text-primary-foreground" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">Generating 4 variations…</div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
                <div className="h-full w-2/3 rounded-full bg-gradient-aurora shadow-glow transition-all" />
              </div>
            </div>
            <div className="font-mono text-xs text-muted-foreground">~14s</div>
            <button className="rounded-lg border border-border bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Masonry */}
      <div className="grid grid-cols-1 gap-4 px-7 py-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item)}
            className="group relative block overflow-hidden rounded-2xl border border-border bg-surface text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-glow"
            style={{ aspectRatio: item.ratio }}
          >
            <img
              src={item.src}
              alt={item.prompt}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="absolute left-3 right-3 top-3 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
              <span className="glass rounded-full px-2 py-0.5 text-[10px] font-medium text-foreground/90">
                {item.model}
              </span>
              <button className="glass flex h-7 w-7 items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-primary/20 hover:text-primary">
                <Heart className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="absolute inset-x-3 bottom-3 translate-y-1 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
              <p className="line-clamp-2 text-[11px] leading-snug text-foreground/85">
                {item.prompt}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <QuickAction label="Open"><Maximize2 className="h-3 w-3" /></QuickAction>
                <QuickAction label="Copy"><Copy className="h-3 w-3" /></QuickAction>
                <QuickAction label="Save"><Download className="h-3 w-3" /></QuickAction>
                <span className="ml-auto font-mono text-[10px] text-foreground/60">{item.time}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {active && <Lightbox item={active} onClose={() => setActive(null)} />}
    </main>
  );
}

function QuickAction({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="glass flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-foreground/90">
      {children}
      {label}
    </span>
  );
}

function Lightbox({ item, onClose }: { item: Item; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-elevated relative flex max-h-[90vh] w-full max-w-5xl gap-6 overflow-hidden rounded-2xl p-2"
      >
        <div className="flex-1 overflow-hidden rounded-xl bg-black">
          <img src={item.src} alt={item.prompt} className="h-full w-full object-contain" />
        </div>
        <div className="flex w-72 flex-col p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              {item.model}
            </span>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Prompt</div>
          <p className="mt-2 text-sm leading-relaxed">{item.prompt}</p>
          <div className="mt-auto flex flex-col gap-2">
            <button className="flex items-center justify-center gap-2 rounded-lg bg-gradient-aurora px-3 py-2.5 text-xs font-semibold text-primary-foreground shadow-glow">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white/[0.03] px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.06]">
              <Copy className="h-3.5 w-3.5" /> Copy prompt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
