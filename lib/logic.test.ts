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
