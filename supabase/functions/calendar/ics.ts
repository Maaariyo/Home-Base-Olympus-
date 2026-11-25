// Builds an iCalendar (RFC 5545) feed: weekly classes, open task deadlines and events.
// No imports, so it runs unchanged in the Edge Function (Deno) and in the tests (Node).

type Row = { id: string };
type Reminder = { before: number; every?: number };
export interface FeedInput {
  timeZone: string;
  terms: (Row & { start_date: string; end_date: string; holidays: { date: string; label: string }[] })[];
  subjects: (Row & { term_id: string; name: string })[];
  slots: (Row & { subject_id: string; day: number; start_time: string; end_time: string; room: string; kind: string; effective_from: string; effective_to: string | null })[];
  marks: (Row & { subject_id: string; slot_id: string | null; date: string; start_time: string; end_time: string; status: string })[];
  tasks: (Row & { title: string; notes: string; due_at: string; done_at: string | null; reminders: Reminder[] })[];
  events: (Row & { title: string; notes: string; start_at: string; end_at: string; all_day: boolean; location: string; repeat: string; repeat_until: string | null; skip_dates?: string[]; reminders: Reminder[] })[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateOnly = (ymd: string) => ymd.replaceAll("-", "");
const local = (ymd: string, hm: string) => `${dateOnly(ymd)}T${hm.replace(":", "")}00`;
const utc = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7;

/** Wall-clock parts of an instant in a time zone. */
function partsIn(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, ms: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) };
}

/** The UTC instant of a wall-clock time in a time zone (exact outside the hour a clock change skips). */
export function zonedToUtc(ymd: string, hm: string, tz: string): Date {
  const wall = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5));
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - (partsIn(new Date(t), tz).ms - t);
  return new Date(t);
}

/** RFC 5545 text: escape \ ; , and newlines. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** A time zone the runtime knows, else UTC (the zone comes from the browser that created the link). */
function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return /^[A-Za-z0-9_+\-/]+$/.test(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

/** Folds lines longer than 75 bytes, as the format requires. */
function fold(line: string): string {
  const enc = new TextEncoder();
  let out = "";
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > 75) {
      out += "\r\n ";
      len = 1;
    }
    out += ch;
    len += n;
  }
  return out;
}

/** `offset`: minutes after the item's start that reminders count from (all-day items: 09:00, like the app). */
function alarms(reminders: Reminder[], title: string, offset = 0): string[] {
  // Calendar apps cannot express "every N hours until due"; only the first alert of a range is kept.
  const valid = reminders.filter((r) => Number.isInteger(r?.before) && r.before >= 0 && r.before <= 366 * 1440);
  return [...new Set(valid.map((r) => r.before))].flatMap((m) => {
    const delta = offset - m;
    return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(title)}`, delta >= 0 ? `TRIGGER:PT${delta}M` : `TRIGGER:-PT${-delta}M`, "END:VALARM"];
  });
}

export function buildCalendar(f: FeedInput, now: Date): string {
  const tz = safeZone(f.timeZone);
  const stamp = `DTSTAMP:${utc(now)}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Home Base (Olympus)//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Home Base", `X-WR-TIMEZONE:${tz}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const event = (body: string[]) => lines.push("BEGIN:VEVENT", stamp, ...body, "END:VEVENT");

  // Classes: one weekly series per timetable slot, minus holidays and cancelled sessions.
  const term = f.terms.reduce<FeedInput["terms"][number] | null>((best, t) => (!best || t.start_date > best.start_date ? t : best), null);
  if (term) {
    const names = new Map(f.subjects.filter((s) => s.term_id === term.id).map((s) => [s.id, s.name]));
    const holidays = (term.holidays ?? []).map((h) => h?.date).filter(isDate);
    for (const s of f.slots) {
      const name = names.get(s.subject_id);
      if (!name) continue;
      let first = s.effective_from > term.start_date ? s.effective_from : term.start_date;
      while (dow(first) !== s.day) first = addDays(first, 1);
      const last = s.effective_to && s.effective_to < term.end_date ? s.effective_to : term.end_date;
      if (first > last) continue;
      const cancelled = f.marks.filter((m) => m.slot_id === s.id && m.status === "CANCELLED").map((m) => m.date);
      const skip = [...new Set([...holidays, ...cancelled])].filter((d) => d >= first && d <= last && dow(d) === s.day).sort();
      event([
        `UID:slot-${s.id}@home-base`,
        `SUMMARY:${text(name + (s.kind === "LAB" ? " (lab)" : s.kind === "TUTORIAL" ? " (tutorial)" : ""))}`,
        ...(s.room ? [`LOCATION:${text(s.room)}`] : []),
        `DTSTART;TZID=${tz}:${local(first, s.start_time)}`,
        `DTEND;TZID=${tz}:${local(first, s.end_time)}`,
        `RRULE:FREQ=WEEKLY;UNTIL=${utc(zonedToUtc(last, "23:59", tz))}`,
        ...(skip.length ? [`EXDATE;TZID=${tz}:${skip.map((d) => local(d, s.start_time)).join(",")}`] : []),
      ]);
    }
    // Extra classes are one-offs.
    for (const m of f.marks) {
      if (m.slot_id || m.status === "CANCELLED" || !names.has(m.subject_id)) continue;
      event([`UID:extra-${m.id}@home-base`, `SUMMARY:${text(`${names.get(m.subject_id)} (extra class)`)}`, `DTSTART;TZID=${tz}:${local(m.date, m.start_time)}`, `DTEND;TZID=${tz}:${local(m.date, m.end_time)}`]);
    }
  }

  // Open tasks: a 15-minute marker at the deadline.
  for (const t of f.tasks) {
    if (t.done_at) continue;
    const due = new Date(t.due_at);
    event([
      `UID:task-${t.id}@home-base`,
      `SUMMARY:${text(`Due: ${t.title}`)}`,
      ...(t.notes ? [`DESCRIPTION:${text(t.notes)}`] : []),
      `DTSTART:${utc(due)}`,
      `DTEND:${utc(new Date(due.getTime() + 15 * 60_000))}`,
      ...alarms(t.reminders, `Due: ${t.title}`),
    ]);
  }

  // Events, in the user's time zone so repeats keep their wall-clock time across clock changes.
  for (const e of f.events) {
    const start = partsIn(new Date(e.start_at), tz);
    const end = partsIn(new Date(e.end_at), tz);
    const freq = ["DAILY", "WEEKLY", "MONTHLY"].includes(e.repeat) ? e.repeat : null;
    const skip = (e.skip_dates ?? []).filter(isDate).map((d) => (e.all_day ? dateOnly(d) : local(d, start.hm)));
    event([
      `UID:event-${e.id}@home-base`,
      `SUMMARY:${text(e.title)}`,
      ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
      ...(e.notes ? [`DESCRIPTION:${text(e.notes)}`] : []),
      ...(e.all_day
        ? [`DTSTART;VALUE=DATE:${dateOnly(start.ymd)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(end.ymd, 1))}`]
        : [`DTSTART;TZID=${tz}:${local(start.ymd, start.hm)}`, `DTEND;TZID=${tz}:${local(end.ymd, end.hm)}`]),
      // UNTIL must match DTSTART's type: a date for all-day events, a UTC time otherwise.
      ...(freq ? [`RRULE:FREQ=${freq}${e.repeat_until && isDate(e.repeat_until) ? `;UNTIL=${e.all_day ? dateOnly(e.repeat_until) : utc(zonedToUtc(e.repeat_until, "23:59", tz))}` : ""}`] : []),
      ...(freq && skip.length ? [e.all_day ? `EXDATE;VALUE=DATE:${skip.join(",")}` : `EXDATE;TZID=${tz}:${skip.join(",")}`] : []),
      ...alarms(e.reminders, e.title, e.all_day ? 540 : 0),
    ]);
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
