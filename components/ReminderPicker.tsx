"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { reminderLabel } from "@/lib/reminders";
import type { Reminder } from "@/lib/types";
import { Button, Chip, inputClass } from "./ui";

const PRESETS: Reminder[] = [{ before: 0 }, { before: 10 }, { before: 60 }, { before: 1440 }];
const UNITS = [
  { label: "minutes", m: 1 },
  { label: "hours", m: 60 },
  { label: "days", m: 1440 },
  { label: "weeks", m: 10080 },
];

/** Any number of reminders: presets, a custom "before", or a repeating range up to the due time. */
export function ReminderPicker({ value, onChange }: { value: Reminder[]; onChange: (r: Reminder[]) => void }) {
  const [custom, setCustom] = useState<null | "before" | "range">(null);
  const [n, setN] = useState(2);
  const [unit, setUnit] = useState(1440);
  const [every, setEvery] = useState(6);
  const [everyUnit, setEveryUnit] = useState(60);
  const same = (a: Reminder, b: Reminder) => a.before === b.before && (a.every ?? 0) === (b.every ?? 0);
  const add = (r: Reminder) => !value.some((v) => same(v, r)) && onChange([...value, r]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((r, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-on-ink">
            {reminderLabel(r)}
            <button type="button" aria-label={`Remove ${reminderLabel(r)}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </span>
        ))}
        {value.length === 0 && <span className="py-1.5 text-sm text-muted">No reminders</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.filter((p) => !value.some((v) => same(v, p))).map((p) => (
          <Chip key={p.before} onClick={() => add(p)}>
            + {reminderLabel(p)}
          </Chip>
        ))}
        <Chip active={custom === "before"} onClick={() => setCustom(custom === "before" ? null : "before")}>
          Custom…
        </Chip>
        <Chip active={custom === "range"} onClick={() => setCustom(custom === "range" ? null : "range")}>
          Repeating…
        </Chip>
      </div>
      {custom && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-paper p-3 text-sm">
          {custom === "range" && <span>From</span>}
          <input type="number" min={0} value={n} onChange={(e) => setN(Math.max(0, +e.target.value))} className={inputClass + " w-20 py-1.5"} aria-label="Amount" />
          <select value={unit} onChange={(e) => setUnit(+e.target.value)} className={inputClass + " w-auto py-1.5"} aria-label="Unit">
            {UNITS.map((u) => (
              <option key={u.m} value={u.m}>
                {u.label}
              </option>
            ))}
          </select>
          <span>before</span>
          {custom === "range" && (
            <>
              <span>, every</span>
              <input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value))} className={inputClass + " w-20 py-1.5"} aria-label="Repeat every" />
              <select value={everyUnit} onChange={(e) => setEveryUnit(+e.target.value)} className={inputClass + " w-auto py-1.5"} aria-label="Repeat unit">
                {UNITS.slice(0, 3).map((u) => (
                  <option key={u.m} value={u.m}>
                    {u.label}
                  </option>
                ))}
              </select>
              <span>until due</span>
            </>
          )}
          <Button
            className="py-1.5"
            onClick={() => {
              add(custom === "range" ? { before: n * unit, every: every * everyUnit } : { before: n * unit });
              setCustom(null);
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
