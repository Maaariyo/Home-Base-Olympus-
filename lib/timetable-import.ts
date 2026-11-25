// Reads a weekly timetable from CSV, or from cells pasted out of Excel / Google Sheets (tab-separated).
import type { SlotKind } from "./types.ts";

export interface ImportRow {
  line: number;
  day: number;
  start: string;
  end: string;
  subject: string;
  code: string;
  room: string;
  kind: SlotKind;
  /** 1, or 2 for a class that counts twice (default: 2 for labs). */
  weight: number;
}

export const TEMPLATE = "Day,Start,End,Subject,Code,Room,Type\nMon,09:30,10:45,Marketing Management,MKT,LT 2,Lecture\nWed,14:00,16:30,Business Analytics Lab,BA,Lab 4,Lab\n";

const COLUMNS: Record<keyof Omit<ImportRow, "line">, string[]> = {
  day: ["day", "weekday"],
  start: ["start", "start time", "from", "begins"],
  end: ["end", "end time", "to", "ends"],
  subject: ["subject", "course", "subject name", "course name"],
  code: ["code", "course code", "subject code"],
  room: ["room", "venue", "location", "classroom"],
  kind: ["type", "kind", "session type"],
  weight: ["counts", "counts as", "weight"],
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABELS: Record<SlotKind, string> = { LECTURE: "Lecture", TUTORIAL: "Tutorial", LAB: "Lab" };

/**
 * A cell starting with = + - or @ runs as a formula when a spreadsheet opens the file, so the export
 * prefixes it with ' (spreadsheets hide it) and the import removes it again.
 */
const FORMULA = /^[=+\-@]/;
const csvCell = (v: string) => {
  const s = FORMULA.test(v) ? `'${v}` : v;
  // Also quote ; and tabs: spreadsheets in some regions split on those.
  return /[",;\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The timetable in the same layout the importer reads, for sharing with a classmate. */
export function toTimetableCsv(rows: Omit<ImportRow, "line">[]): string {
  const lines = rows
    .slice()
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
    .map((r) => [DAY_LABELS[r.day - 1], r.start, r.end, r.subject, r.code, r.room, KIND_LABELS[r.kind], String(r.weight)].map(csvCell).join(","));
  return ["Day,Start,End,Subject,Code,Room,Type,Counts", ...lines].join("\n") + "\n";
}

/** Splits one line, honouring "quoted, fields" and "" escapes. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) out.push(cur.trim()), (cur = "");
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** "9:30", "09.30", "9:30 am", "2 PM", "14:00", "9:30:00" (Google Sheets) -> "HH:MM", or null. */
export function parseTime(v: string): string | null {
  const t = v.trim().replace(/^(\d{1,2}[:.]\d{2})[:.]\d{2}/, "$1"); // drop seconds
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m?\.?$/i) ?? t.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap && (h < 1 || h > 12)) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "Mon", "monday", "1" (Monday) ... "7" (Sunday) -> 1..7, or null. */
export function parseDay(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (/^[1-7]$/.test(s)) return Number(s);
  const i = DAYS.indexOf(s.slice(0, 3));
  return i >= 0 && s.length >= 3 ? i + 1 : null;
}

export function parseTimetable(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim() !== "");
  if (headerAt < 0) return { rows: [], errors: ["The file is empty."] };
  const head = lines[headerAt];
  const sep = head.includes("\t") ? "\t" : (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ";" : ",";
  const names = splitLine(head, sep).map((h) => h.toLowerCase());
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, aliases]) => [k, names.findIndex((n) => aliases.includes(n))])) as Record<keyof typeof COLUMNS, number>;
  const missing = (["day", "start", "end", "subject"] as const).filter((k) => col[k] < 0);
  if (missing.length) return { rows: [], errors: [`The first row needs column headings including ${missing.map((m) => `“${m[0].toUpperCase()}${m.slice(1)}”`).join(", ")}. Download the template to see the layout.`] };

  const rows: ImportRow[] = [];
  const errors: string[] = [];
  lines.forEach((raw, i) => {
    if (i <= headerAt || raw.trim() === "") return;
    const f = splitLine(raw, sep);
    const get = (k: keyof typeof COLUMNS) => {
      const v = col[k] >= 0 ? (f[col[k]] ?? "") : "";
      return v.startsWith("'") && FORMULA.test(v.slice(1)) ? v.slice(1) : v;
    };
    const line = i + 1;
    const day = parseDay(get("day"));
    const start = parseTime(get("start"));
    const end = parseTime(get("end"));
    const subject = get("subject");
    const kindText = get("kind").toLowerCase();
    const kind: SlotKind = kindText.startsWith("lab") || kindText.startsWith("prac") ? "LAB" : kindText.startsWith("tut") ? "TUTORIAL" : "LECTURE";
    const problem = !subject
      ? "no subject"
      : day === null
        ? `“${get("day")}” is not a day`
        : !start
          ? `“${get("start")}” is not a time`
          : !end
            ? `“${get("end")}” is not a time`
            : end <= start
              ? "ends before it starts"
              : null;
    if (problem) errors.push(`Row ${line}: ${problem}.`);
    else {
      const counts = get("weight").trim();
      const weight = counts === "1" || counts === "2" ? Number(counts) : kind === "LAB" ? 2 : 1;
      rows.push({ line, day: day!, start: start!, end: end!, subject: subject.slice(0, 120), code: get("code").slice(0, 20), room: get("room").slice(0, 120), kind, weight });
    }
  });
  return { rows, errors };
}
