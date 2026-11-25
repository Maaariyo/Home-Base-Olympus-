// The calendar feed served by supabase/functions/calendar. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendar, zonedToUtc } from "../supabase/functions/calendar/ics.ts";

const base = {
  timeZone: "Asia/Kolkata",
  terms: [{ id: "t", start_date: "2026-11-02", end_date: "2026-11-30", holidays: [{ date: "2026-11-16", label: "Holiday" }] }],
  subjects: [{ id: "mkt", term_id: "t", name: "Marketing, Management" }],
  slots: [{ id: "s1", subject_id: "mkt", day: 1, start_time: "09:30", end_time: "10:45", room: "LT 2", kind: "LECTURE", effective_from: "2026-11-01", effective_to: null }],
  marks: [
    { id: "m1", subject_id: "mkt", slot_id: "s1", date: "2026-11-23", start_time: "09:30", end_time: "10:45", status: "CANCELLED" },
    { id: "x1", subject_id: "mkt", slot_id: null, date: "2026-11-21", start_time: "16:00", end_time: "17:00", status: "UNMARKED" },
  ],
  tasks: [
    { id: "k1", title: "Submit deck", notes: "", due_at: "2026-11-20T12:30:00.000Z", done_at: null, reminders: [{ before: 60 }, { before: 1440, every: 360 }] },
    { id: "k2", title: "Done already", notes: "", due_at: "2026-11-20T12:30:00.000Z", done_at: "2026-11-19T00:00:00.000Z", reminders: [] },
  ],
  events: [
    { id: "e1", title: "Finance club", notes: "Bring laptop", start_at: "2026-11-17T13:00:00.000Z", end_at: "2026-11-17T14:00:00.000Z", all_day: false, location: "Room 12", repeat: "WEEKLY", repeat_until: "2026-12-15", skip_dates: ["2026-11-24"], reminders: [{ before: 30 }] },
    { id: "e2", title: "Founders' Day fair", notes: "", start_at: "2026-11-26T18:30:00.000Z", end_at: "2026-11-27T18:29:00.000Z", all_day: true, location: "", repeat: "NONE", repeat_until: null, reminders: [] },
  ],
};
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

test("time zone conversion", () => {
  assert.equal(zonedToUtc("2026-11-30", "23:59", "Asia/Kolkata").toISOString(), "2026-11-30T18:29:00.000Z");
  // New York switches to standard time on 1 Nov 2026: 09:00 is 14:00 UTC afterwards, 13:00 UTC before.
  assert.equal(zonedToUtc("2026-11-02", "09:00", "America/New_York").toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-30", "09:00", "America/New_York").toISOString(), "2026-10-30T13:00:00.000Z");
});

test("feed: weekly classes with holidays and cancellations removed, extra classes, tasks, events", () => {
  const ics = buildCalendar(base, new Date("2026-11-18T00:00:00Z"));
  const text = unfold(ics);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "lines folded at 75 bytes");
  // Class series starts on the first Monday of the term, ends with the term, skips the holiday and the cancelled date.
  assert.match(text, /SUMMARY:Marketing\\, Management\r\nLOCATION:LT 2\r\nDTSTART;TZID=Asia\/Kolkata:20261102T093000\r\nDTEND;TZID=Asia\/Kolkata:20261102T104500\r\nRRULE:FREQ=WEEKLY;UNTIL=20261130T182900Z\r\nEXDATE;TZID=Asia\/Kolkata:20261116T093000,20261123T093000/);
  assert.match(text, /UID:extra-x1@home-base\r\nSUMMARY:Marketing\\, Management \(extra class\)\r\nDTSTART;TZID=Asia\/Kolkata:20261121T160000/);
  // Open tasks only, with one alert per distinct lead time.
  assert.match(text, /SUMMARY:Due: Submit deck\r\nDTSTART:20261120T123000Z\r\nDTEND:20261120T124500Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Due: Submit deck\r\nTRIGGER:-PT60M/);
  assert.match(text, /TRIGGER:-PT1440M/);
  assert.doesNotMatch(text, /Done already/);
  // Repeating event in local time with its skipped date; all-day event as dates.
  assert.match(text, /DTSTART;TZID=Asia\/Kolkata:20261117T183000\r\nDTEND;TZID=Asia\/Kolkata:20261117T193000\r\nRRULE:FREQ=WEEKLY;UNTIL=20261215T182900Z\r\nEXDATE;TZID=Asia\/Kolkata:20261124T183000/);
  assert.match(text, /SUMMARY:Founders' Day fair\r\nDTSTART;VALUE=DATE:20261127\r\nDTEND;VALUE=DATE:20261128/);
  assert.match(text, /DESCRIPTION:Bring laptop/);
});

test("feed with no term still lists tasks and events", () => {
  const ics = buildCalendar({ ...base, terms: [] }, new Date("2026-11-18T00:00:00Z"));
  assert.doesNotMatch(ics, /slot-s1/);
  assert.match(ics, /task-k1/);
});

test("feed: hostile or broken values cannot break the file", () => {
  const ics = buildCalendar(
    {
      ...base,
      timeZone: "Not/AZone\r\nX-INJECT:1",
      terms: [{ ...base.terms[0], holidays: [{ date: "2026-11-16\r\nX-BAD:1", label: "" }] }],
      tasks: [{ ...base.tasks[0], title: "A\rB\nC", reminders: [{ before: -5 }, { before: 1.5 }, { before: 30 }] }],
      events: [{ ...base.events[0], skip_dates: ["bad\r\nDATE"] }],
    },
    new Date("2026-11-18T00:00:00Z"),
  );
  assert.doesNotMatch(ics, /X-INJECT|X-BAD|bad\r?\nDATE/);
  assert.match(ics, /X-WR-TIMEZONE:UTC/);
  assert.match(unfold(ics), /SUMMARY:Due: A\\nB\\nC/);
  assert.match(ics, /TRIGGER:-PT30M/);
  assert.doesNotMatch(ics, /TRIGGER:-PT-5M|TRIGGER:-PT1\.5M/);
});

test("all-day events: alerts count from 09:00 like the app, and repeats end on a date", () => {
  const fair = { ...base.events[1], repeat: "WEEKLY", repeat_until: "2026-12-31", reminders: [{ before: 15 }, { before: 1440 }] };
  const text = unfold(buildCalendar({ ...base, events: [fair] }, new Date("2026-11-18T00:00:00Z")));
  assert.match(text, /RRULE:FREQ=WEEKLY;UNTIL=20261231\r\n/);
  assert.match(text, /TRIGGER:PT525M/); // 08:45 on the day
  assert.match(text, /TRIGGER:-PT900M/); // 09:00 the day before
});
