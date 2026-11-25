// Dates are local "YYYY-MM-DD", times are local "HH:MM", instants are ISO strings (UTC).

export interface Row {
  id: string;
  created_at: string;
  updated_at: string;
}

/**
 * `before` minutes ahead of the due/start time. With `every`, it repeats from there
 * every `every` minutes until the due/start time (which itself is excluded).
 */
export interface Reminder {
  before: number;
  every?: number;
}

export interface Task extends Row {
  title: string;
  notes: string;
  due_at: string;
  assignees: string[];
  reminders: Reminder[];
  done_at: string | null;
}

export type Category = "ACADEMIC" | "SOCIAL" | "OTHER";
export type Repeat = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface CalEvent extends Row {
  title: string;
  notes: string;
  category: Category;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string;
  repeat: Repeat;
  repeat_until: string | null;
  /** Dates (YYYY-MM-DD) on which a repeating event does not happen. */
  skip_dates: string[];
  reminders: Reminder[];
}

export interface Holiday {
  date: string;
  label: string;
}

export interface Term extends Row {
  name: string;
  start_date: string;
  end_date: string;
  /** Classes before this date are covered by each subject's opening balance. */
  track_from: string;
  holidays: Holiday[];
}

export interface Subject extends Row {
  term_id: string;
  name: string;
  code: string;
  color: string;
  target_pct: number | null;
  opening_held: number;
  opening_attended: number;
}

/** One assessed component of a subject (quiz, mid-term, project...). */
export interface GradeItem extends Row {
  subject_id: string;
  name: string;
  /** Share of the final mark, in percent. */
  weight: number;
  max_score: number;
  /** Null until marked. */
  score: number | null;
}

export type SlotKind = "LECTURE" | "TUTORIAL" | "LAB";

export interface Slot extends Row {
  subject_id: string;
  /** 1 = Monday ... 7 = Sunday */
  day: number;
  start_time: string;
  end_time: string;
  room: string;
  kind: SlotKind;
  weight: number;
  effective_from: string;
  effective_to: string | null;
}

export type Status = "UNMARKED" | "PRESENT" | "ABSENT" | "CANCELLED" | "DUTY_LEAVE";

/** A marked timetable session (slot_id set) or an extra class (slot_id null). */
export interface Mark extends Row {
  subject_id: string;
  slot_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  weight: number;
  status: Status;
}

export interface Settings {
  target: number;
  amberOn: boolean;
  amberFloor: number;
  dutyLeaveCounts: boolean;
  quietOn: boolean;
  quietStart: string;
  quietEnd: string;
  quietMode: "SHIFT" | "SKIP";
  taskReminders: Reminder[];
  eventReminders: Reminder[];
  classPrompt: boolean;
  /** Sunday 19:00: a summary of the week ahead. */
  weeklyDigest: boolean;
  /** The final mark (%) the grades tracker works towards. */
  gradeTarget: number;
}

export const DEFAULT_SETTINGS: Settings = {
  target: 75,
  amberOn: false,
  amberFloor: 65,
  dutyLeaveCounts: true,
  quietOn: false,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietMode: "SHIFT",
  taskReminders: [{ before: 60 }],
  eventReminders: [{ before: 15 }],
  classPrompt: true,
  weeklyDigest: true,
  gradeTarget: 70,
};

export interface Tables {
  tasks: Task;
  events: CalEvent;
  terms: Term;
  subjects: Subject;
  grade_items: GradeItem;
  slots: Slot;
  marks: Mark;
}
export type TableName = keyof Tables;
/** In foreign-key order: an import inserts them in this sequence. */
export const TABLES: TableName[] = ["terms", "subjects", "grade_items", "slots", "marks", "tasks", "events"];

export type Data = { [K in TableName]: Tables[K][] } & { settings: Settings };
