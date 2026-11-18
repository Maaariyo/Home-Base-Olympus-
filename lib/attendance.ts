// Attendance maths. Integer arithmetic only: floating point gives off-by-one errors at the boundary.
import type { Settings, Status } from "./types.ts";

export interface Tally {
  held: number;
  attended: number;
}

export function tally(
  sessions: { status: Status; weight: number }[],
  opening: Tally,
  dutyLeaveCounts: boolean,
): Tally {
  let { held, attended } = opening;
  for (const s of sessions) {
    const present = s.status === "PRESENT" || (s.status === "DUTY_LEAVE" && dutyLeaveCounts);
    if (present) attended += s.weight;
    if (present || s.status === "ABSENT") held += s.weight;
  }
  return { held, attended };
}

/** Percentage to one decimal, or null when nothing has been held. */
export function percent({ held, attended }: Tally): number | null {
  return held === 0 ? null : Math.round((1000 * attended) / held) / 10;
}

export type Band = "SAFE" | "WATCH" | "BELOW" | "NONE";

export function band({ held, attended }: Tally, target: number, s: Pick<Settings, "amberOn" | "amberFloor">): Band {
  if (held === 0) return "NONE";
  if (100 * attended >= target * held) return "SAFE";
  if (s.amberOn && 100 * attended >= s.amberFloor * held) return "WATCH";
  return "BELOW";
}

export type Advice =
  | { kind: "none" }
  | { kind: "attend"; n: number; reachable: boolean; best: number | null }
  | { kind: "skip"; n: number; exact: boolean };

/**
 * Below target: N sessions to attend in a row. At or above: S sessions you can skip.
 * Units are weighted sessions (a weight-2 lab counts as 2). `remaining` = weighted sessions left this term.
 */
export function advice({ held: H, attended: A }: Tally, t: number, remaining?: number): Advice {
  if (H === 0) return { kind: "none" };
  if (100 * A < t * H) {
    const a = t * H - 100 * A;
    const b = 100 - t;
    const n = Math.floor((a + b - 1) / b);
    const reachable = remaining === undefined || n <= remaining;
    const best = reachable ? null : Math.round((1000 * (A + remaining!)) / (H + remaining!)) / 10;
    return { kind: "attend", n, reachable, best };
  }
  return { kind: "skip", n: Math.floor((100 * A - t * H) / t), exact: 100 * A === t * H };
}

export function adviceText(a: Advice, t: number, weighted: boolean): string {
  const unit = (n: number) => `${n} session${n === 1 ? "" : "s"}${weighted ? " (a lab counts as 2)" : ""}`;
  if (a.kind === "none") return "";
  if (a.kind === "attend") {
    if (!a.reachable) return `Not reachable this term; best possible ${a.best!.toFixed(1)}%`;
    return `Attend the next ${unit(a.n)} to reach ${t}%`;
  }
  if (a.n === 0) return a.exact ? `Exactly at ${t}%: no skips left` : `No skips left: one absence takes you below ${t}%`;
  return `You can skip ${unit(a.n)} and stay at ${t}%+`;
}

export const BAND_STYLE: Record<Band, { color: string; label: string }> = {
  SAFE: { color: "#2f9e44", label: "Safe" },
  WATCH: { color: "#e67700", label: "At risk" },
  BELOW: { color: "#e03131", label: "Below target" },
  NONE: { color: "#adb5bd", label: "No classes yet" },
};
