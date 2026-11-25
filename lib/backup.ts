// Turns a backup file into rows that are safe to import: every row checked, bad ones dropped, long text
// shortened to the database limits, and fresh ids (links between rows kept) so a backup from another
// account never collides with that account's rows.
import { validReminder } from "./reminders.ts";
import { DEFAULT_SETTINGS, TABLES, type Data, type Reminder, type Settings } from "./types.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const instant = (v: unknown): v is string => str(v) && v.length <= 40 && !Number.isNaN(Date.parse(v));
const reminders = (v: unknown): Reminder[] => (Array.isArray(v) ? v.filter((r) => isObj(r) && validReminder(r as unknown as Reminder)).map((r) => (r.every ? { before: r.before as number, every: r.every as number } : { before: r.before as number })) : []);

/** Settings from a file or the database, field by field; anything missing or odd falls back to the default. */
export function cleanSettings(raw: unknown): Settings {
  const s = isObj(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const int = (v: unknown, lo: number, hi: number, def: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const time = (v: unknown, def: string) => (str(v) && HM.test(v) ? v : def);
  const target = int(s.target, 50, 95, d.target);
  return {
    target,
    amberOn: bool(s.amberOn, d.amberOn),
    amberFloor: int(s.amberFloor, 0, target - 1, Math.min(d.amberFloor, target - 1)),
    dutyLeaveCounts: bool(s.dutyLeaveCounts, d.dutyLeaveCounts),
    quietOn: bool(s.quietOn, d.quietOn),
    quietStart: time(s.quietStart, d.quietStart),
    quietEnd: time(s.quietEnd, d.quietEnd),
    quietMode: s.quietMode === "SKIP" ? "SKIP" : "SHIFT",
    taskReminders: Array.isArray(s.taskReminders) ? reminders(s.taskReminders) : d.taskReminders,
    eventReminders: Array.isArray(s.eventReminders) ? reminders(s.eventReminders) : d.eventReminders,
    classPrompt: bool(s.classPrompt, d.classPrompt),
    weeklyDigest: bool(s.weeklyDigest, d.weeklyDigest),
    gradeTarget: int(s.gradeTarget, 1, 100, d.gradeTarget),
  };
}

/** Field checks per table; a row failing them is dropped. Text length is not checked here: it is shortened. */
const VALID: Record<string, (r: Obj) => boolean> = {
  terms: (r) => str(r.name) && DATE.test(String(r.start_date)) && DATE.test(String(r.end_date)) && DATE.test(String(r.track_from)) && String(r.start_date) <= String(r.end_date),
  subjects: (r) => str(r.term_id) && str(r.name) && /^#[0-9a-f]{6}$/i.test(String(r.color)) && num(r.opening_held, 0, 10000) && num(r.opening_attended, 0, Number(r.opening_held)) && (r.target_pct === null || num(r.target_pct, 50, 95)),
  grade_items: (r) => str(r.subject_id) && str(r.name) && num(r.weight, 0.01, 100) && num(r.max_score, 0.01, 1e6) && (r.score === null || num(r.score, 0, Number(r.max_score))),
  slots: (r) => str(r.subject_id) && num(r.day, 1, 7) && TIME.test(String(r.start_time)) && TIME.test(String(r.end_time)) && String(r.end_time) > String(r.start_time) && ["LECTURE", "TUTORIAL", "LAB"].includes(String(r.kind)) && [1, 2].includes(Number(r.weight)) && DATE.test(String(r.effective_from)) && (r.effective_to === null || DATE.test(String(r.effective_to))),
  marks: (r) => str(r.subject_id) && (r.slot_id === null || str(r.slot_id)) && DATE.test(String(r.date)) && TIME.test(String(r.start_time)) && TIME.test(String(r.end_time)) && [1, 2].includes(Number(r.weight)) && ["UNMARKED", "PRESENT", "ABSENT", "CANCELLED", "DUTY_LEAVE"].includes(String(r.status)),
  tasks: (r) => str(r.title) && r.title.trim() !== "" && instant(r.due_at) && (r.done_at === null || instant(r.done_at)),
  events: (r) => str(r.title) && r.title.trim() !== "" && instant(r.start_at) && instant(r.end_at) && Date.parse(String(r.end_at)) > Date.parse(String(r.start_at)) && ["ACADEMIC", "SOCIAL", "OTHER"].includes(String(r.category)) && ["NONE", "DAILY", "WEEKLY", "MONTHLY"].includes(String(r.repeat)) && (r.repeat_until === null || DATE.test(String(r.repeat_until))),
};

/** The database's text limits (schema.sql); longer text is shortened rather than the row being lost. */
const LIMITS: Record<string, Record<string, number>> = {
  terms: { name: 120 },
  subjects: { name: 120, code: 20 },
  grade_items: { name: 80 },
  slots: { room: 120 },
  tasks: { title: 120, notes: 5000 },
  events: { title: 120, notes: 5000, location: 200 },
};

export function prepareImport(raw: unknown, newId: () => string = () => crypto.randomUUID()): { data: Data; dropped: number } {
  if (!isObj(raw) || !Array.isArray(raw.tasks)) throw new Error("That file is not a Home Base backup.");
  let dropped = 0;
  const ids: Record<string, Map<string, string>> = {};
  const out = {} as Data;

  for (const table of TABLES) {
    const rows = Array.isArray(raw[table]) ? (raw[table] as unknown[]) : [];
    ids[table] = new Map();
    const kept: Obj[] = [];
    for (const row of rows) {
      if (!isObj(row) || !str(row.id) || row.id.length > 100 || !VALID[table](row)) {
        dropped++;
        continue;
      }
      const r = row;
      // Parents come first in TABLES, so a child whose parent was dropped is dropped too.
      const parentOk =
        (table !== "subjects" || ids.terms.has(String(r.term_id))) &&
        (!["grade_items", "slots", "marks"].includes(table) || ids.subjects.has(String(r.subject_id))) &&
        (table !== "marks" || r.slot_id === null || ids.slots.has(String(r.slot_id)));
      if (!parentOk) {
        dropped++;
        continue;
      }
      const id = newId();
      ids[table].set(r.id as string, id);
      const { user_id: _u, updated_at: _up, ...rest } = r;
      const clean: Obj = { ...rest, id, created_at: instant(r.created_at) ? r.created_at : new Date().toISOString() };
      for (const [field, max] of Object.entries(LIMITS[table] ?? {})) clean[field] = str(r[field]) ? r[field].slice(0, max) : "";
      if (table === "subjects") clean.term_id = ids.terms.get(String(r.term_id));
      if (table === "grade_items" || table === "slots" || table === "marks") clean.subject_id = ids.subjects.get(String(r.subject_id));
      if (table === "marks" && r.slot_id !== null) clean.slot_id = ids.slots.get(String(r.slot_id));
      if (table === "terms") clean.holidays = Array.isArray(r.holidays) ? r.holidays.filter((h) => isObj(h) && DATE.test(String(h.date))).slice(0, 200).map((h) => ({ date: h.date, label: str(h.label) ? h.label.slice(0, 120) : "" })) : [];
      if (table === "tasks") clean.assignees = Array.isArray(r.assignees) ? r.assignees.filter(str).map((a) => a.slice(0, 80)).slice(0, 20) : [];
      if (table === "tasks" || table === "events") clean.reminders = reminders(r.reminders).slice(0, 20);
      if (table === "events") clean.skip_dates = Array.isArray(r.skip_dates) ? r.skip_dates.filter((d) => DATE.test(String(d))).slice(0, 500) : [];
      kept.push(clean);
    }
    (out[table] as unknown[]) = kept;
  }
  out.settings = cleanSettings(raw.settings);
  return { data: out, dropped };
}
