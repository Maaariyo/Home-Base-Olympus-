// Local-time helpers on plain Date. "YYYY-MM-DD" strings sort and compare correctly as text.

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 1 = Monday ... 7 = Sunday */
export function dow(s: string): number {
  return parseYmd(s).getDay() || 7;
}

export function at(date: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = parseYmd(date);
  d.setHours(h, m, 0, 0);
  return d;
}

export function startOfWeek(s: string): string {
  return addDays(s, 1 - dow(s));
}

export function today(): string {
  return ymd(new Date());
}

/** Value for <input type="datetime-local"> from an ISO instant, and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${ymd(d)}T${hm(d)}`;
}
export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return parseYmd(s).toLocaleDateString("en-IN", opts);
}

export function fmtTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function fmtHm(time: string): string {
  return fmtTime(at("2000-01-01", time));
}

/** "in 3 h", "2 days late", "now" */
export function relative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  let text: string;
  if (mins < 1) return "now";
  if (mins < 60) text = `${mins} min`;
  else if (mins < 60 * 24) text = `${Math.round(mins / 60)} h`;
  else {
    const days = Math.round(mins / 1440);
    text = `${days} day${days === 1 ? "" : "s"}`;
  }
  return diff > 0 ? `in ${text}` : `${text} late`;
}
