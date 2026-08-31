import type { GenProgress } from "./ControlPanel";

export function visualProgressForStage(
  stage: GenProgress["stage"],
  elapsedSeconds: number,
  completed: boolean,
) {
  if (completed) return 100;

  const elapsed = Math.max(0, elapsedSeconds);
  if (stage === "submitting") return Math.min(20, 3 + elapsed * 3.2);
  if (stage === "queued") return Math.min(35, 20 + elapsed * 0.75);
  if (stage === "polling") return Math.min(75, 52 + elapsed * 0.55);
  return Math.min(98, 52 + 46 * (1 - Math.exp(-elapsed / 20)));
}
