import { addDays, at, today } from "../dates";
import { sessionsBetween } from "../sessions";
import { DEFAULT_SETTINGS, type CalEvent, type Data, type GradeItem, type Mark, type Slot, type Subject, type Task, type Term } from "../types";

/** Sample MBA term so every screen has something to show in demo mode. */
export function seedData(): Data {
  const now = new Date().toISOString();
  const row = () => ({ id: crypto.randomUUID(), created_at: now, updated_at: now });
  const t0 = today();

  const term: Term = {
    ...row(),
    name: "Term 3",
    start_date: addDays(t0, -35),
    end_date: addDays(t0, 49),
    track_from: addDays(t0, -14),
    holidays: [{ date: addDays(t0, 9), label: "Founders' Day" }],
  };
  const subj = (name: string, code: string, color: string, held: number, attended: number): Subject => ({
    ...row(),
    term_id: term.id,
    name,
    code,
    color,
    target_pct: null,
    opening_held: held,
    opening_attended: attended,
  });
  const subjects = [
    subj("Marketing Management", "MKT", "#1c7ed6", 8, 7),
    subj("Corporate Finance", "CF", "#e8590c", 8, 5),
    subj("Operations", "OPS", "#2b8a3e", 6, 6),
    subj("Organisational Behaviour", "OB", "#7048e8", 6, 4),
    subj("Business Analytics Lab", "BA", "#c2255c", 4, 4),
  ];
  const [mkt, cf, ops, ob, ba] = subjects;
  const slot = (s: Subject, day: number, start: string, end: string, room: string, lab = false): Slot => ({
    ...row(),
    subject_id: s.id,
    day,
    start_time: start,
    end_time: end,
    room,
    kind: lab ? "LAB" : "LECTURE",
    weight: lab ? 2 : 1,
    effective_from: term.start_date,
    effective_to: null,
  });
  const slots = [
    slot(mkt, 1, "09:30", "10:45", "LT 2"),
    slot(cf, 1, "11:00", "12:15", "LT 1"),
    slot(ops, 2, "09:30", "10:45", "LT 3"),
    slot(ob, 2, "14:00", "15:15", "LT 2"),
    slot(mkt, 3, "09:30", "10:45", "LT 2"),
    slot(ba, 3, "14:00", "16:30", "Lab 4", true),
    slot(cf, 4, "11:00", "12:15", "LT 1"),
    slot(ops, 4, "14:00", "15:15", "LT 3"),
    slot(ob, 5, "09:30", "10:45", "LT 2"),
    slot(cf, 6, "10:00", "11:15", "LT 1"),
  ];

  // Mark past sessions with a fixed pattern, leaving the two most recent unmarked for the banner.
  const nowDate = new Date();
  const past = sessionsBetween(term.track_from, t0, term, slots, []).filter((s) => at(s.date, s.end_time) < nowDate);
  const pattern = ["PRESENT", "PRESENT", "ABSENT", "PRESENT", "PRESENT", "PRESENT", "CANCELLED", "PRESENT", "ABSENT"] as const;
  const marks: Mark[] = past.slice(0, -2).map((s, i) => ({
    ...row(),
    subject_id: s.subject_id,
    slot_id: s.slot_id,
    date: s.date,
    start_time: s.start_time,
    end_time: s.end_time,
    weight: s.weight,
    status: s.subject_id === cf.id && i % 3 === 0 ? "ABSENT" : pattern[i % pattern.length],
  }));

  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const task = (title: string, dueH: number, assignees: string[], notes = "", done = false): Task => ({
    ...row(),
    title,
    notes,
    due_at: hoursFromNow(dueH),
    assignees,
    reminders: [{ before: 60 }],
    done_at: done ? hoursFromNow(-30) : null,
  });
  const tasks = [
    task("Submit CF problem set 4", -20, ["Me"]),
    task("Marketing case: Nykaa slide deck", 5, ["Aditi", "Rahul"], "Group of 4. Draft in the shared drive."),
    task("OB reflection paper", 52, ["Me"]),
    task("Book room for placement prep", 100, ["Kabir"]),
    task("Pay mess fees", -48, ["Me"], "", true),
  ];

  const event = (title: string, category: CalEvent["category"], date: string, start: string, end: string, repeat: CalEvent["repeat"] = "NONE", location = ""): CalEvent => ({
    ...row(),
    title,
    notes: "",
    category,
    start_at: at(date, start).toISOString(),
    end_at: at(date, end).toISOString(),
    all_day: false,
    location,
    repeat,
    repeat_until: repeat === "NONE" ? null : term.end_date,
    skip_dates: [],
    reminders: [{ before: 30 }],
  });
  const events = [
    event("Guest lecture: retail strategy", "ACADEMIC", addDays(t0, 2), "17:00", "18:30", "NONE", "Auditorium"),
    event("Finance club meet", "SOCIAL", addDays(t0, -1), "18:30", "19:30", "WEEKLY", "Room 12"),
    event("Mock interview", "OTHER", addDays(t0, 4), "16:00", "16:45"),
  ];

  const grade = (s: Subject, name: string, weight: number, max_score: number, score: number | null): GradeItem => ({ ...row(), subject_id: s.id, name, weight, max_score, score });
  const grade_items = [
    grade(mkt, "Class participation", 10, 10, 8),
    grade(mkt, "Quiz 1", 15, 20, 12),
    grade(mkt, "Group project", 25, 100, null),
    grade(mkt, "End-term exam", 50, 100, null),
    grade(cf, "Mid-term exam", 30, 50, 21),
    grade(cf, "Case write-ups", 20, 20, null),
    grade(cf, "End-term exam", 50, 100, null),
  ];

  return { terms: [term], subjects, grade_items, slots, marks, tasks, events, settings: { ...DEFAULT_SETTINGS } };
}
