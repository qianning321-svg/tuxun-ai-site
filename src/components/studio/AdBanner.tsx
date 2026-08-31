import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listActiveAds } from "@/lib/admin.functions";
import { Megaphone } from "lucide-react";

type Ad = { id: string; title: string; link_url: string | null };

export function AdBanner() {
  const fetchAds = useServerFn(listActiveAds);
  const [ads, setAds] = useState<Ad[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    fetchAds({}).then((d: any) => setAds(d ?? [])).catch(() => setAds([]));
  }, [fetchAds]);

  useEffect(() => {
    if (ads.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % ads.length), 4000);
    return () => clearInterval(t);
  }, [ads.length]);

  if (ads.length === 0) return <div className="flex-1" />;

  const current = ads[idx];
  const inner = (
    <div className="flex items-center gap-2 truncate">
      <Megaphone className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate text-xs font-medium">{current.title}</span>
    </div>
  );

  return (
    <div className="mx-4 hidden h-9 max-w-md flex-1 items-center overflow-hidden rounded-full border border-primary/20 bg-primary/5 px-3.5 md:flex">
      {current.link_url ? (
        <a href={current.link_url} target="_blank" rel="noreferrer noopener" className="w-full overflow-hidden hover:text-primary">
          {inner}
        </a>
      ) : (
        <div className="w-full overflow-hidden">{inner}</div>
      )}
    </div>
  );
}
