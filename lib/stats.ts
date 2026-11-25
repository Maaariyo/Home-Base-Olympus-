import { advice, adviceText, band, percent, tally, type Band, type Tally } from "./attendance.ts";
import { activeTerm, remainingWeight, sessionsBetween, type Session } from "./sessions.ts";
import type { Data, Subject, Term } from "./types.ts";

export interface SubjectStats {
  subject: Subject;
  sessions: Session[];
  tally: Tally;
  pct: number | null;
  band: Band;
  target: number;
  text: string;
}

export interface TermStats {
  term: Term | null;
  sessions: Session[];
  subjects: SubjectStats[];
  overall: Tally;
}

/** Per-subject attendance for the active term, lowest percentage first. */
export function termStats(data: Data, now: Date): TermStats {
  const term = activeTerm(data.terms);
  if (!term) return { term, sessions: [], subjects: [], overall: { held: 0, attended: 0 } };
  const s = data.settings;
  const sessions = sessionsBetween(term.track_from, term.end_date, term, data.slots, data.marks);
  const subjects = data.subjects
    .filter((x) => x.term_id === term.id)
    .map((subject) => {
      const own = sessions.filter((x) => x.subject_id === subject.id);
      const t = tally(own, { held: subject.opening_held, attended: subject.opening_attended }, s.dutyLeaveCounts);
      const target = subject.target_pct ?? s.target;
      const weighted = own.some((x) => x.weight !== 1);
      return {
        subject,
        sessions: own,
        tally: t,
        pct: percent(t),
        band: band(t, target, s),
        target,
        text: adviceText(advice(t, target, remainingWeight(own, now)), target, weighted),
      };
    })
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.subject.name.localeCompare(b.subject.name));
  const overall = subjects.reduce((o, x) => ({ held: o.held + x.tally.held, attended: o.attended + x.tally.attended }), {
    held: 0,
    attended: 0,
  });
  return { term, sessions, subjects, overall };
}
