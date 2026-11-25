// Turns a backup file into rows that are safe to import: every row checked, bad ones dropped, and fresh ids
// (links between rows kept) so a backup from another account never collides with that account's rows.
import { validReminder } from "./reminders.ts";
import { DEFAULT_SETTINGS, TABLES, type Data, type Reminder, type Settings } from "./types.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const str = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const instant = (v: unknown): v is string => str(v, 40) && !Number.isNaN(Date.parse(v));
const reminders = (v: unknown): Reminder[] => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object" && validReminder(r)).map((r) => (r.every ? { before: r.before, every: r.every } : { before: r.before })) : []);
type Obj = Record<string, unknown>;

/** Field checks per table; a row failing them is dropped. */
const VALID: Record<string, (r: Obj) => boolean> = {
  terms: (r) => str(r.name, 120) && DATE.test(String(r.start_date)) && DATE.test(String(r.end_date)) && DATE.test(String(r.track_from)) && String(r.start_date) <= String(r.end_date),
  subjects: (r) => str(r.term_id) && str(r.name, 120) && str(r.code ?? "", 20) && /^#[0-9a-f]{6}$/i.test(String(r.color)) && num(r.opening_held, 0, 10000) && num(r.opening_attended, 0, Number(r.opening_held)) && (r.target_pct === null || num(r.target_pct, 50, 95)),
  grade_items: (r) => str(r.subject_id) && str(r.name, 80) && num(r.weight, 0.01, 100) && num(r.max_score, 0.01, 1e6) && (r.score === null || num(r.score, 0, Number(r.max_score))),
  slots: (r) => str(r.subject_id) && num(r.day, 1, 7) && TIME.test(String(r.start_time)) && TIME.test(String(r.end_time)) && String(r.end_time) > String(r.start_time) && ["LECTURE", "TUTORIAL", "LAB"].includes(String(r.kind)) && [1, 2].includes(Number(r.weight)) && DATE.test(String(r.effective_from)) && (r.effective_to === null || DATE.test(String(r.effective_to))),
  marks: (r) => str(r.subject_id) && (r.slot_id === null || str(r.slot_id)) && DATE.test(String(r.date)) && TIME.test(String(r.start_time)) && TIME.test(String(r.end_time)) && [1, 2].includes(Number(r.weight)) && ["UNMARKED", "PRESENT", "ABSENT", "CANCELLED", "DUTY_LEAVE"].includes(String(r.status)),
  tasks: (r) => str(r.title, 120) && String(r.title).trim() !== "" && instant(r.due_at) && (r.done_at === null || instant(r.done_at)),
  events: (r) => str(r.title, 120) && String(r.title).trim() !== "" && instant(r.start_at) && instant(r.end_at) && Date.parse(String(r.end_at)) > Date.parse(String(r.start_at)) && ["ACADEMIC", "SOCIAL", "OTHER"].includes(String(r.category)) && ["NONE", "DAILY", "WEEKLY", "MONTHLY"].includes(String(r.repeat)) && (r.repeat_until === null || DATE.test(String(r.repeat_until))),
};

export function prepareImport(raw: unknown, newId: () => string = () => crypto.randomUUID()): { data: Data; dropped: number } {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Obj).tasks)) throw new Error("That file is not a Home Base backup.");
  const src = raw as Record<string, unknown>;
  let dropped = 0;
  const ids: Record<string, Map<string, string>> = {};
  const out = {} as Data;

  for (const table of TABLES) {
    const rows = Array.isArray(src[table]) ? (src[table] as unknown[]) : [];
    ids[table] = new Map();
    const kept: Obj[] = [];
    for (const row of rows) {
      const r = row as Obj;
      // Parents come first in TABLES, so a child whose parent was dropped is dropped too.
      const parentOk =
        (table !== "subjects" || ids.terms.has(String(r.term_id))) &&
        (!["grade_items", "slots", "marks"].includes(table) || ids.subjects.has(String(r.subject_id))) &&
        (table !== "marks" || r.slot_id === null || ids.slots.has(String(r.slot_id)));
      if (!r || typeof r !== "object" || !str(r.id, 100) || !VALID[table](r) || !parentOk) {
        dropped++;
        continue;
      }
      const id = newId();
      ids[table].set(r.id, id);
      const { user_id: _u, updated_at: _up, ...rest } = r;
      const clean: Obj = { ...rest, id, created_at: instant(r.created_at) ? r.created_at : new Date().toISOString() };
      if (table === "subjects") clean.term_id = ids.terms.get(String(r.term_id));
      if (table === "grade_items" || table === "slots" || table === "marks") clean.subject_id = ids.subjects.get(String(r.subject_id));
      if (table === "marks" && r.slot_id !== null) clean.slot_id = ids.slots.get(String(r.slot_id));
      if (table === "terms") clean.holidays = Array.isArray(r.holidays) ? r.holidays.filter((h) => h && DATE.test(String(h.date)) && str(h.label ?? "", 120)) : [];
      if (table === "tasks") clean.assignees = Array.isArray(r.assignees) ? r.assignees.filter((a) => str(a, 80)).slice(0, 20) : [];
      if (table === "tasks" || table === "events") clean.reminders = reminders(r.reminders);
      if (table === "events") clean.skip_dates = Array.isArray(r.skip_dates) ? r.skip_dates.filter((d) => DATE.test(String(d))) : [];
      kept.push(clean);
    }
    (out[table] as unknown[]) = kept;
  }
  const s = (src.settings ?? {}) as Partial<Settings>;
  out.settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    taskReminders: reminders(s.taskReminders ?? DEFAULT_SETTINGS.taskReminders),
    eventReminders: reminders(s.eventReminders ?? DEFAULT_SETTINGS.eventReminders),
  };
  return { data: out, dropped };
}
