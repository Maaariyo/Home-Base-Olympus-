// Acceptance tests from SPEC.md. Run: npm test (fixed to Asia/Kolkata so times are stable).
import assert from "node:assert/strict";
import { test } from "node:test";
import { advice, adviceText, band, percent, project, tally } from "./attendance.ts";
import { hm, ymd } from "./dates.ts";
import { applyQuiet, fireTimes, occurrences } from "./reminders.ts";
import { remainingWeight, sessionsBetween } from "./sessions.ts";
import { DEFAULT_SETTINGS, type CalEvent, type Mark, type Slot, type Status, type Term } from "./types.ts";

const S = DEFAULT_SETTINGS;
const line = (A: number, H: number, t = 75, remaining?: number, weighted = false) =>
  adviceText(advice({ attended: A, held: H }, t, remaining), t, weighted);
const marks = (spec: [Status, number][]) => spec.flatMap(([status, n]) => Array.from({ length: n }, () => ({ status, weight: 1 })));

test("1: A30 H45 -> 66.7%, red, attend 15", () => {
  const t = { attended: 30, held: 45 };
  assert.equal(percent(t), 66.7);
  assert.equal(band(t, 75, S), "BELOW");
  assert.equal(line(30, 45), "Attend the next 15 sessions to reach 75%");
});

test("2: A40 H48 -> 83.3%, green, skip 5", () => {
  assert.equal(percent({ attended: 40, held: 48 }), 83.3);
  assert.equal(band({ attended: 40, held: 48 }, 75, S), "SAFE");
  assert.equal(line(40, 48), "You can skip 5 sessions and stay at 75%+");
});

test("3: A3 H4 -> exactly 75%", () => {
  assert.equal(percent({ attended: 3, held: 4 }), 75);
  assert.equal(band({ attended: 3, held: 4 }, 75, S), "SAFE");
  assert.equal(line(3, 4), "Exactly at 75%: no skips left");
});

test("fix 10: above target with no skips left is not 'exactly at' the target", () => {
  assert.equal(percent({ attended: 8, held: 10 }), 80);
  assert.equal(line(8, 10), "No skips left: one absence takes you below 75%");
});

test("4: A0 H0 -> grey, no line", () => {
  assert.equal(percent({ attended: 0, held: 0 }), null);
  assert.equal(band({ attended: 0, held: 0 }, 75, S), "NONE");
  assert.equal(line(0, 0), "");
});

test("5: A0 H1 -> 0%, attend 3", () => {
  assert.equal(percent({ attended: 0, held: 1 }), 0);
  assert.equal(line(0, 1), "Attend the next 3 sessions to reach 75%");
});

test("6: cancelled classes are ignored", () => {
  const t = tally(marks([["PRESENT", 10], ["ABSENT", 2], ["CANCELLED", 3]]), { held: 0, attended: 0 }, true);
  assert.deepEqual(t, { held: 12, attended: 10 });
  assert.equal(percent(t), 83.3);
});

test("7: duty leave setting on and off", () => {
  const m = marks([["PRESENT", 8], ["DUTY_LEAVE", 2], ["ABSENT", 2]]);
  assert.equal(percent(tally(m, { held: 0, attended: 0 }, true)), 83.3);
  assert.equal(percent(tally(m, { held: 0, attended: 0 }, false)), 80);
});

test("8: amber band at 65", () => {
  const t = { attended: 28, held: 40 };
  assert.equal(percent(t), 70);
  assert.equal(band(t, 75, { amberOn: true, amberFloor: 65 }), "WATCH");
  assert.equal(line(28, 40), "Attend the next 8 sessions to reach 75%");
});

test("9: weight-2 lab marked absent; wording says a lab counts as 2", () => {
  const t = tally([{ status: "ABSENT", weight: 2 }], { held: 12, attended: 10 }, true);
  assert.deepEqual(t, { held: 14, attended: 10 });
  assert.equal(percent(t), 71.4);
  assert.equal(line(10, 14, 75, undefined, true), "Attend the next 2 sessions (a lab counts as 2) to reach 75%");
});

test("10: not reachable this term", () => {
  assert.equal(line(10, 30, 75, 10), "Not reachable this term; best possible 50.0%");
});

test("11: opening balance only", () => {
  const t = tally([], { held: 20, attended: 18 }, true);
  assert.equal(percent(t), 90);
  assert.equal(line(18, 20), "You can skip 4 sessions and stay at 75%+");
});

test("formulas match a brute-force count for every target 50-95", () => {
  for (let t = 50; t <= 95; t++)
    for (let H = 1; H < 60; H++)
      for (let A = 0; A <= H; A++) {
        const a = advice({ attended: A, held: H }, t);
        let n = 0;
        if (a.kind === "attend") {
          while (100 * (A + n) < t * (H + n)) n++;
        } else {
          while (100 * A >= t * (H + n + 1)) n++;
        }
        assert.equal(a.kind === "none" ? -1 : a.n, n, `t=${t} A=${A} H=${H}`);
      }
});

test("what-if: skipped sessions count as absent, the rest as attended", () => {
  const upcoming = [
    { key: "a", weight: 1 },
    { key: "b", weight: 1 },
    { key: "lab", weight: 2 },
    { key: "c", weight: 1 },
  ];
  // 30 of 45, attend a, b and c, skip the lab: 33 of 50.
  const t = project({ attended: 30, held: 45 }, upcoming, new Set(["lab"]));
  assert.deepEqual(t, { attended: 33, held: 50 });
  assert.equal(percent(t), 66);
  assert.deepEqual(project({ attended: 3, held: 4 }, [], new Set()), { attended: 3, held: 4 });
});

// Reminders. "Today" is Wed 18 Nov 2026 in these tests.
const due = new Date(2026, 10, 19, 18, 0).getTime();
const clock = (times: number[]) => times.map((t) => `${ymd(new Date(t))} ${hm(new Date(t))}`);

test("12: 1 day and 1 hour before", () => {
  assert.deepEqual(clock(fireTimes(due, [{ before: 1440 }, { before: 60 }]).sort()), ["2026-11-18 18:00", "2026-11-19 17:00"]);
});

test("13: repeating range stops before the due time", () => {
  assert.deepEqual(clock(fireTimes(due, [{ before: 1440, every: 360 }])), [
    "2026-11-18 18:00",
    "2026-11-19 00:00",
    "2026-11-19 06:00",
    "2026-11-19 12:00",
  ]);
});

test("14: quiet hours SHIFT merges 00:00 and 06:00 into 07:00", () => {
  const s = { ...S, quietOn: true, quietStart: "23:00", quietEnd: "07:00", quietMode: "SHIFT" as const };
  assert.deepEqual(clock(applyQuiet(fireTimes(due, [{ before: 1440, every: 360 }]), due, s)), [
    "2026-11-18 18:00",
    "2026-11-19 07:00",
    "2026-11-19 12:00",
  ]);
});

test("fix 5: a shift that would land after the deadline fires at the original time", () => {
  const early = new Date(2026, 10, 19, 6, 30).getTime();
  const s = { ...S, quietOn: true, quietMode: "SHIFT" as const };
  assert.deepEqual(clock(applyQuiet(fireTimes(early, [{ before: 30 }]), early, s)), ["2026-11-19 06:00"]);
  assert.deepEqual(applyQuiet(fireTimes(early, [{ before: 30 }]), early, { ...s, quietMode: "SKIP" }), []);
});

// Sessions
const row = { created_at: "", updated_at: "" };
const term: Term = { ...row, id: "term", name: "T2", start_date: "2026-11-02", end_date: "2026-11-30", track_from: "2026-11-16", holidays: [{ date: "2026-11-18", label: "Holiday" }] };
const mon: Slot = { ...row, id: "mon", subject_id: "mkt", day: 1, start_time: "10:00", end_time: "11:00", room: "", kind: "LECTURE", weight: 1, effective_from: "2026-11-02", effective_to: null };
const wed: Slot = { ...mon, id: "wed", day: 3 };

test("fix 3: no sessions before the opening-balance date, none on holidays", () => {
  const dates = sessionsBetween("2026-11-01", "2026-11-25", term, [mon, wed], []).map((s) => s.date);
  assert.deepEqual(dates, ["2026-11-16", "2026-11-23", "2026-11-25"]);
});

test("fix 7: a timetable change ends old sessions; past marks keep counting", () => {
  const ended = { ...mon, effective_to: "2026-11-22" };
  const moved: Slot = { ...mon, id: "mon2", day: 2, effective_from: "2026-11-23" };
  const mark: Mark = { ...row, id: "m1", subject_id: "mkt", slot_id: "mon", date: "2026-11-16", start_time: "10:00", end_time: "11:00", weight: 1, status: "PRESENT" };
  const s = sessionsBetween("2026-11-16", "2026-11-30", term, [ended, moved], [mark]);
  assert.deepEqual(s.map((x) => `${x.slot_id} ${x.date} ${x.status}`), ["mon 2026-11-16 PRESENT", "mon2 2026-11-24 UNMARKED"]);
  assert.equal(remainingWeight(s, new Date(2026, 10, 20)), 1);
});

test("a repeating event can skip one date", () => {
  const e = { ...row, id: "e", title: "", notes: "", category: "SOCIAL", start_at: new Date(2026, 10, 17, 18, 30).toISOString(), end_at: new Date(2026, 10, 17, 19, 30).toISOString(), all_day: false, location: "", repeat: "WEEKLY", repeat_until: null, skip_dates: ["2026-11-24"], reminders: [] } as CalEvent;
  const got = occurrences(e, new Date(2026, 10, 1), new Date(2026, 11, 9)).map((o) => ymd(o.start));
  assert.deepEqual(got, ["2026-11-17", "2026-12-01", "2026-12-08"]);
});

test("monthly events skip months without that day", () => {
  const e = { ...row, id: "e", title: "", notes: "", category: "OTHER", start_at: new Date(2026, 0, 31, 9).toISOString(), end_at: new Date(2026, 0, 31, 10).toISOString(), all_day: false, location: "", repeat: "MONTHLY", repeat_until: "2026-05-31", skip_dates: [], reminders: [] } as CalEvent;
  const got = occurrences(e, new Date(2026, 0, 1), new Date(2026, 11, 31)).map((o) => ymd(o.start));
  assert.deepEqual(got, ["2026-01-31", "2026-03-31", "2026-05-31"]);
});

test("weekly digest: next Sunday 19:00, counts the following Monday-Sunday", async () => {
  const { weeklyDigest } = await import("./reminders.ts");
  const empty = { terms: [], subjects: [], grade_items: [], slots: [], marks: [], tasks: [], events: [], settings: S };
  const task = (id: string, due: Date, done = false) => ({ ...row, id, title: id, notes: "", due_at: due.toISOString(), assignees: [], reminders: [], done_at: done ? due.toISOString() : null });
  const data = {
    ...empty,
    tasks: [task("in-week", new Date(2026, 10, 25, 9)), task("done", new Date(2026, 10, 26, 9), true), task("next-week", new Date(2026, 11, 1, 9)), task("this-week", new Date(2026, 10, 20, 9))],
  };
  const d = weeklyDigest(data, new Date(2026, 10, 18, 10))!; // Wed 18 Nov
  assert.equal(`${ymd(new Date(d.at))} ${hm(new Date(d.at))}`, "2026-11-22 19:00");
  assert.equal(d.body, "1 deadline, 0 events, 0 classes.");
  // Sunday after 19:00 moves to the next Sunday; an empty week says so; the setting turns it off.
  assert.equal(ymd(new Date(weeklyDigest(empty, new Date(2026, 10, 22, 20))!.at)), "2026-11-29");
  assert.equal(weeklyDigest(empty, new Date(2026, 10, 18))!.body, "A clear week: no deadlines, events or classes.");
  assert.equal(weeklyDigest({ ...empty, settings: { ...S, weeklyDigest: false } }, new Date(2026, 10, 18)), null);
});

test("grades: weighted score so far and the average needed on the rest", async () => {
  const { gradeSummary, gradeText } = await import("./grades.ts");
  const item = (weight: number, max_score: number, score: number | null) => ({ ...row, id: String(weight), subject_id: "s", name: "x", weight, max_score, score });
  const items = [item(10, 10, 8), item(15, 20, 12), item(25, 100, null), item(50, 100, null)];
  // 8/10 of 10 + 12/20 of 15 = 8 + 9 = 17 points from 25 graded: 68% average. Needs 53/75 = 70.7% for 70.
  const s = gradeSummary(items, 70);
  assert.deepEqual(s, { totalWeight: 100, gradedWeight: 25, earned: 17, average: 68, needed: 70.7 });
  assert.equal(gradeText(s, 70), "You need 70.7% on average across the remaining 75% to finish at 70%.");
  assert.equal(gradeText(gradeSummary([item(60, 100, 100), item(40, 100, null)], 50), 50), "50% is secured, even with zero on the remaining 40%.");
  assert.equal(gradeText(gradeSummary([item(60, 100, 10), item(40, 100, null)], 70), 70), "70% is out of reach: the most you can finish with is 46%.");
  assert.equal(gradeText(gradeSummary([item(100, 50, 40)], 70), 70), "Final: 80 out of 100.");
  assert.equal(gradeText(gradeSummary([], 70), 70), "");
});

test("timetable import: CSV with quotes, pasted cells, times and days in common formats", async () => {
  const { parseTimetable, parseTime, parseDay, TEMPLATE } = await import("./timetable-import.ts");
  assert.deepEqual(["9:30", "09.30", "9:30 am", "2 PM", "12 pm", "12am", "14:00", "25:00", "13 pm", "9"].map(parseTime), ["09:30", "09:30", "09:30", "14:00", "12:00", "00:00", "14:00", null, null, null]);
  assert.deepEqual(["Mon", "monday", "THU", "7", "Mo", "8", "Holiday"].map(parseDay), [1, 1, 4, 7, null, null, null]);

  const csv = 'Day,Start,End,Subject,Room,Type\nTue,9:30 am,10:45 am,"Strategy, Advanced",LT 1,Lecture\nWed,2 pm,4:30 pm,Analytics,Lab 4,Lab\nThurs,11:00,10:00,Finance,,\nSun,10,11,,,\n';
  const r = parseTimetable(csv);
  assert.deepEqual(r.rows.map((x) => [x.day, x.start, x.end, x.subject, x.room, x.kind]), [
    [2, "09:30", "10:45", "Strategy, Advanced", "LT 1", "LECTURE"],
    [3, "14:00", "16:30", "Analytics", "Lab 4", "LAB"],
  ]);
  assert.deepEqual(r.errors, ["Row 4: ends before it starts.", "Row 5: no subject."]);

  const pasted = parseTimetable("Day\tStart time\tEnd time\tCourse\nFriday\t09:30\t10:45\tOB\n");
  assert.deepEqual(pasted.rows.map((x) => [x.day, x.subject]), [[5, "OB"]]);
  assert.equal(parseTimetable(TEMPLATE).rows.length, 2);
  assert.match(parseTimetable("Subject,Room\nX,Y").errors[0], /column headings including “Day”, “Start”, “End”/);
});

test("skip hint: safe only if one more absence keeps the subject at or above target", async () => {
  const { skipHint } = await import("./attendance.ts");
  assert.deepEqual(skipHint({ attended: 40, held: 48 }, 1, 75), { text: "Safe to skip: you'd be at 81.6%", ok: true });
  assert.deepEqual(skipHint({ attended: 3, held: 4 }, 1, 75), { text: "Skipping takes you to 60.0%, below 75%", ok: false });
  // A lab counts twice: 9/11 is safe for one lecture (75.0%) but not for a lab (69.2%).
  assert.equal(skipHint({ attended: 9, held: 11 }, 1, 75).ok, true);
  assert.equal(skipHint({ attended: 9, held: 11 }, 2, 75).ok, false);
});

test("timetable export: same layout the importer reads, safe to open in a spreadsheet", async () => {
  const { toTimetableCsv, parseTimetable } = await import("./timetable-import.ts");
  const rows = [
    { day: 3, start: "14:00", end: "16:30", subject: "Analytics, Lab", code: "BA", room: 'Lab "4"', kind: "LAB" as const },
    { day: 1, start: "09:30", end: "10:45", subject: "=HYPERLINK(\"x\")", code: "", room: "", kind: "LECTURE" as const },
  ];
  const csv = toTimetableCsv(rows);
  assert.equal(csv.split("\n")[1], "Mon,09:30,10:45,\"'=HYPERLINK(\"\"x\"\")\",,,Lecture");
  const back = parseTimetable(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.rows.map(({ line: _l, ...r }) => r), [rows[1], rows[0]]);
});

test("reminders: impossible values are ignored instead of hanging the page", async () => {
  const { fireTimes } = await import("./reminders.ts");
  const bad = [{ before: -5 }, { before: 1e300, every: 360 }, { before: 60, every: -1 }, { before: 60, every: 0.5 }, { before: Number.NaN }, { before: 600000 }];
  assert.deepEqual(fireTimes(due, bad), []);
  // A huge but valid range is capped rather than producing millions of entries.
  assert.equal(fireTimes(due, [{ before: 366 * 1440, every: 1 }]).length, 1000);
  assert.equal(fireTimes(due, [{ before: 60, every: 0 }]).length, 1); // every 0 means "no repeat"
});

test("backup import: rows checked, bad ones dropped with their children, fresh ids keep the links", async () => {
  const { prepareImport } = await import("./backup.ts");
  let n = 0;
  const id = () => `new-${++n}`;
  const backup = {
    terms: [{ id: "t1", user_id: "someone", name: "T", start_date: "2026-11-01", end_date: "2026-12-31", track_from: "2026-11-01", holidays: [{ date: "2026-11-27", label: "Fair" }, { date: "nope" }], created_at: "2026-11-01T00:00:00Z", updated_at: "x" }],
    subjects: [
      { id: "s1", term_id: "t1", name: "MKT", code: "", color: "#1c7ed6", target_pct: null, opening_held: 4, opening_attended: 3 },
      { id: "s2", term_id: "missing-term", name: "Orphan", code: "", color: "#1c7ed6", target_pct: null, opening_held: 0, opening_attended: 0 },
    ],
    grade_items: [{ id: "g1", subject_id: "s2", name: "Quiz", weight: 10, max_score: 10, score: 5 }],
    slots: [{ id: "l1", subject_id: "s1", day: 1, start_time: "09:30", end_time: "10:45", room: "", kind: "LECTURE", weight: 1, effective_from: "2026-11-01", effective_to: null }],
    marks: [{ id: "m1", subject_id: "s1", slot_id: "l1", date: "2026-11-02", start_time: "09:30", end_time: "10:45", weight: 1, status: "PRESENT" }],
    tasks: [
      { id: "k1", title: "Deck", notes: "", due_at: "2026-11-20T12:00:00Z", assignees: ["Me", 5], reminders: [{ before: 60 }, { before: 1e300, every: 1e-9 }, { before: 30, every: -1 }], done_at: null },
      { id: "k2", title: "", due_at: "2026-11-20T12:00:00Z", done_at: null },
    ],
    events: [{ id: "e1", title: "Club", notes: "", category: "SOCIAL", start_at: "2026-11-17T13:00:00Z", end_at: "2026-11-17T12:00:00Z", all_day: false, location: "", repeat: "NONE", repeat_until: null, reminders: [] }],
    settings: { target: 80, taskReminders: [{ before: -1 }] },
  };
  const { data, dropped } = prepareImport(backup, id);
  assert.equal(dropped, 4); // orphan subject, its grade item, untitled task, event ending before it starts
  assert.equal(data.terms[0].id, "new-1");
  assert.deepEqual(data.terms[0].holidays, [{ date: "2026-11-27", label: "Fair" }]);
  assert.equal((data.terms[0] as unknown as Record<string, unknown>).user_id, undefined);
  assert.equal(data.subjects[0].term_id, "new-1");
  assert.equal(data.slots[0].subject_id, data.subjects[0].id);
  assert.equal(data.marks[0].slot_id, data.slots[0].id);
  assert.deepEqual(data.tasks[0].assignees, ["Me"]);
  assert.deepEqual(data.tasks[0].reminders, [{ before: 60 }]);
  assert.equal(data.settings.target, 80);
  assert.deepEqual(data.settings.taskReminders, []);
  assert.throws(() => prepareImport({ hello: 1 }), /not a Home Base backup/);
});
