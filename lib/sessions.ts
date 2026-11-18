// Class sessions are not stored: they are derived from the timetable on demand, and only marks are saved.
// That removes the generation job, duplicate sessions across devices, and orphaned sessions after a
// timetable change (an ended slot simply stops producing dates).
import { addDays, at, dow } from "./dates.ts";
import type { Mark, Slot, Status, Term } from "./types.ts";

export interface Session {
  key: string;
  subject_id: string;
  slot_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  weight: number;
  room: string;
  status: Status;
  mark: Mark | null;
}

/** Every session of the term between `from` and `to` (inclusive), sorted by start. */
export function sessionsBetween(from: string, to: string, term: Term, slots: Slot[], marks: Mark[]): Session[] {
  const start = from > term.track_from ? from : term.track_from;
  const end = to < term.end_date ? to : term.end_date;
  const holidays = new Set(term.holidays.map((h) => h.date));
  const byKey = new Map(marks.filter((m) => m.slot_id).map((m) => [`${m.slot_id}|${m.date}`, m]));
  const out: Session[] = [];

  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (holidays.has(d)) continue;
    const day = dow(d);
    for (const s of slots) {
      if (s.day !== day || d < s.effective_from || (s.effective_to && d > s.effective_to)) continue;
      const key = `${s.id}|${d}`;
      const mark = byKey.get(key) ?? null;
      out.push({
        key,
        subject_id: s.subject_id,
        slot_id: s.id,
        date: d,
        start_time: s.start_time,
        end_time: s.end_time,
        weight: s.weight,
        room: s.room,
        status: mark?.status ?? "UNMARKED",
        mark,
      });
    }
  }
  for (const m of marks) {
    if (m.slot_id || m.date < start || m.date > end) continue;
    out.push({
      key: `x|${m.id}`,
      subject_id: m.subject_id,
      slot_id: null,
      date: m.date,
      start_time: m.start_time,
      end_time: m.end_time,
      weight: m.weight,
      room: "Extra class",
      status: m.status,
      mark: m,
    });
  }
  return out.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
}

/** The active term: the one with the latest start date. */
export function activeTerm(terms: Term[]): Term | null {
  return terms.reduce<Term | null>((best, t) => (!best || t.start_date > best.start_date ? t : best), null);
}

export const ended = (s: Session, now: Date) => at(s.date, s.end_time) <= now;
export const started = (s: Session, now: Date) => at(s.date, s.start_time) <= now;

/** Weighted sessions still to come this term that are not already cancelled. */
export function remainingWeight(sessions: Session[], now: Date): number {
  return sessions.filter((s) => !started(s, now) && s.status !== "CANCELLED").reduce((n, s) => n + s.weight, 0);
}
