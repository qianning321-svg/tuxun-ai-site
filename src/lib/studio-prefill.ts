// Shared key + helpers for handing a "use this case" payload to the studio.
export const PREFILL_KEY = "studio:prefill";

export type StudioPrefill = {
  prompt?: string;
  modelKey?: string;
  aspectRatio?: string;
  size?: "1K" | "2K" | "4K";
  styleId?: string;
  fromInspiration?: boolean;
};

export function setStudioPrefill(p: StudioPrefill) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function consumeStudioPrefill(): StudioPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILL_KEY);
    return JSON.parse(raw) as StudioPrefill;
  } catch {
    return null;
  }
}
