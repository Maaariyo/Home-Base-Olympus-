// When reminders fire. Pure functions; the result is written to the server's notification queue.
import { addDays, at, fmtDate, fmtHm, fmtTime, today as todayStr, ymd } from "./dates.ts";
import { activeTerm, sessionsBetween } from "./sessions.ts";
import { termStats } from "./stats.ts";
import type { CalEvent, Data, Reminder, Settings } from "./types.ts";

const MIN = 60_000;

/** Fire instants (ms) for one item due/starting at `anchor`. A repeating range stops before the anchor. */
export function fireTimes(anchor: number, reminders: Reminder[]): number[] {
  const out: number[] = [];
  for (const r of reminders) {
    // Values come from saved data and imported backups: anything odd is ignored rather than allowed to
    // loop forever (a negative or vanishingly small step never reaches the anchor).
    if (!validReminder(r)) continue;
    const first = anchor - r.before * MIN;
    if (!r.every) {
      out.push(first);
      continue;
    }
    for (let t = first, n = 0; t < anchor && n < 1000; t += r.every * MIN, n++) out.push(t);
  }
  return out;
}

/** Up to a year ahead; a repeat of at least a minute (0 or none means no repeat). */
export const MAX_BEFORE = 366 * 1440;
export function validReminder(r: Reminder): boolean {
  return Number.isFinite(r?.before) && r.before >= 0 && r.before <= MAX_BEFORE && (!r.every || (Number.isFinite(r.every) && r.every >= 1));
}

function minutesOf(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function inQuiet(t: number, start: number, end: number) {
  const d = new Date(t);
  const m = d.getHours() * 60 + d.getMinutes();
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** The first moment at or after `t` when quiet hours end. */
function quietEndAfter(t: number, endTime: string) {
  const d = new Date(t);
  const [h, m] = endTime.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  if (d.getTime() < t) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Quiet hours. SHIFT moves a reminder to the end of quiet hours, unless that would land at or
 * after the due/start time: then it fires at its original time, because a missed deadline costs
 * more than an early buzz. SKIP drops it. Reminders that land on the same minute merge into one.
 */
export function applyQuiet(times: number[], anchor: number, s: Settings): number[] {
  const result = new Set<number>();
  const qs = minutesOf(s.quietStart);
  const qe = minutesOf(s.quietEnd);
  for (const t of times) {
    if (!s.quietOn || qs === qe || !inQuiet(t, qs, qe)) result.add(t);
    else if (s.quietMode === "SHIFT") {
      const moved = quietEndAfter(t, s.quietEnd);
      result.add(moved < anchor ? moved : t);
    }
  }
  return [...result].sort((a, b) => a - b);
}

export interface Occurrence {
  start: Date;
  end: Date;
}

/** Occurrences of an event that start within [from, to]. Monthly repeats skip months without that day. */
export function occurrences(e: CalEvent, from: Date, to: Date): Occurrence[] {
  const start = new Date(e.start_at);
  const length = new Date(e.end_at).getTime() - start.getTime();
  const until = e.repeat_until ? at(e.repeat_until, "23:59").getTime() : Infinity;
  const last = Math.min(to.getTime(), until);
  const skip = new Set(e.skip_dates ?? []);
  const out: Occurrence[] = [];
  const push = (d: Date) => {
    if (d >= from && d.getTime() <= last && !skip.has(ymd(d))) out.push({ start: d, end: new Date(d.getTime() + length) });
  };
  if (e.repeat === "NONE") {
    // Include an event that started before `from` but is still running.
    if (start.getTime() + length >= from.getTime() && start.getTime() <= last) out.push({ start, end: new Date(start.getTime() + length) });
    return out;
  }
  const step = e.repeat === "DAILY" ? 1 : 7;
  for (let i = 0; ; i++) {
    let d: Date;
    if (e.repeat === "MONTHLY") {
      d = new Date(start);
      d.setDate(1);
      d.setMonth(start.getMonth() + i);
      if (new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() < start.getDate()) continue;
      d.setDate(start.getDate());
    } else {
      d = new Date(start);
      d.setDate(start.getDate() + i * step);
    }
    if (d.getTime() > last) break;
    push(d);
  }
  return out;
}

/** All-day items remind relative to 09:00 that day, not midnight. */
export function eventAnchor(e: CalEvent, o: Occurrence): number {
  return e.all_day ? at(ymd(o.start), "09:00").getTime() : o.start.getTime();
}

export interface PlannedNotification {
  key: string;
  fire_at: string;
  kind: "TASK" | "EVENT" | "CLASS" | "DIGEST";
  owner_id: string;
  title: string;
  body: string;
  url: string;
  /** Class prompts carry the session, so a notification button can mark it. */
  payload: Record<string, unknown> | null;
}

/**
 * The next Sunday-19:00 summary of the coming Monday-to-Sunday week. Its text reflects the data at the
 * moment it is planned (every change and every visit), so it can lag if the site is not opened that week.
 */
export function weeklyDigest(data: Data, now: Date): { at: number; body: string } | null {
  if (!data.settings.weeklyDigest) return null;
  const sunday = at(addDays(ymd(now), (7 - (now.getDay() || 7)) % 7), "19:00");
  if (sunday <= now) sunday.setDate(sunday.getDate() + 7);
  const from = at(addDays(ymd(sunday), 1), "00:00");
  const to = at(addDays(ymd(sunday), 7), "23:59");
  const deadlines = data.tasks.filter((t) => !t.done_at && new Date(t.due_at) >= from && new Date(t.due_at) <= to).length;
  const events = data.events.reduce((n, e) => n + occurrences(e, from, to).length, 0);
  const stats = termStats(data, now);
  const classes = stats.sessions.filter((s) => s.date >= ymd(from) && s.date <= ymd(to) && s.status !== "CANCELLED").length;
  const below = stats.subjects.filter((x) => x.band === "BELOW").map((x) => `${x.subject.name} (${x.pct?.toFixed(1)}%)`);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const week = deadlines + events + classes
    ? `${count(deadlines, "deadline", "deadlines")}, ${count(events, "event", "events")}, ${count(classes, "class", "classes")}.`
    : "A clear week: no deadlines, events or classes.";
  return { at: sunday.getTime(), body: below.length ? `${week} Below target: ${below.join(", ")}.` : week };
}

export const NO_OWNER = "00000000-0000-0000-0000-000000000000";

/** Everything that should fire between now and `horizonDays` from now. Recomputed on every change. */
export function planNotifications(data: Data, now: Date, horizonDays = 30): PlannedNotification[] {
  const s = data.settings;
  const nowMs = now.getTime();
  const horizon = nowMs + horizonDays * 1440 * MIN;
  const out: PlannedNotification[] = [];
  const add = ({ times, ...p }: Omit<PlannedNotification, "fire_at"> & { times: number[] }) => {
    for (const t of times) {
      if (t > nowMs && t <= horizon) out.push({ ...p, key: `${p.key}:${t}`, fire_at: new Date(t).toISOString() });
    }
  };

  for (const task of data.tasks) {
    if (task.done_at) continue;
    const due = new Date(task.due_at).getTime();
    add({
      key: `t:${task.id}`,
      kind: "TASK",
      owner_id: task.id,
      title: task.title,
      body: `Due ${fmtDate(ymd(new Date(due)))}, ${fmtTime(new Date(due))}`,
      url: "/tasks",
      payload: null,
      times: applyQuiet(fireTimes(due, task.reminders), due, s),
    });
  }

  const maxLead = Math.max(0, ...data.events.flatMap((e) => e.reminders.map((r) => r.before))) * MIN;
  for (const e of data.events) {
    for (const o of occurrences(e, now, new Date(horizon + maxLead))) {
      const anchor = eventAnchor(e, o);
      add({
        key: `e:${e.id}:${o.start.getTime()}`,
        kind: "EVENT",
        owner_id: e.id,
        title: e.title,
        body: e.all_day ? `${fmtDate(ymd(o.start))}, all day` : `${fmtDate(ymd(o.start))}, ${fmtTime(o.start)}${e.location ? ` · ${e.location}` : ""}`,
        url: "/calendar",
        payload: null,
        times: applyQuiet(fireTimes(anchor, e.reminders), anchor, s),
      });
    }
  }

  const term = activeTerm(data.terms);
  if (s.classPrompt && term) {
    const names = new Map(data.subjects.map((x) => [x.id, x.name]));
    const from = todayStr();
    for (const c of sessionsBetween(from, addDays(from, horizonDays), term, data.slots, data.marks)) {
      if (c.status !== "UNMARKED" || !names.has(c.subject_id)) continue;
      const end = at(c.date, c.end_time).getTime();
      add({
        key: `c:${c.key}`,
        kind: "CLASS",
        owner_id: c.subject_id,
        title: `Did you attend ${names.get(c.subject_id)}?`,
        body: `${fmtHm(c.start_time)}–${fmtHm(c.end_time)}${c.room ? ` · ${c.room}` : ""}`,
        url: "/",
        payload: {
          subject_id: c.subject_id,
          slot_id: c.slot_id,
          mark_id: c.mark?.id ?? null,
          date: c.date,
          start_time: c.start_time,
          end_time: c.end_time,
          weight: c.weight,
        },
        times: applyQuiet([end], Infinity, s), // no deadline: always shift
      });
    }
  }
  const digest = weeklyDigest(data, now);
  if (digest) {
    add({ key: "digest", kind: "DIGEST", owner_id: NO_OWNER, title: "Your week ahead", body: digest.body, url: "/", payload: null, times: applyQuiet([digest.at], Infinity, s) });
  }
  return out.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
}

/** Short label for a reminder, e.g. "1 h before", "every 6 h from 1 day before". */
export function reminderLabel(r: Reminder): string {
  const span = (m: number) =>
    m % 10080 === 0 && m > 0 ? `${m / 10080} wk` : m % 1440 === 0 && m > 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 && m > 0 ? `${m / 60} h` : `${m} min`;
  const base = r.before === 0 ? "At time" : `${span(r.before)} before`;
  return r.every ? `Every ${span(r.every)} from ${r.before === 0 ? "start" : span(r.before) + " before"}` : base;
}

