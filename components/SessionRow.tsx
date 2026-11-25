"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { fmtDate, fmtHm } from "@/lib/dates";
import { started, type Session } from "@/lib/sessions";
import { useData } from "@/lib/store";
import type { Status, Subject } from "@/lib/types";
import { cx } from "./ui";

const OPTIONS: { status: Status; label: string; tone: string }[] = [
  { status: "PRESENT", label: "Present", tone: "bg-green-700 text-white border-green-700" },
  { status: "ABSENT", label: "Absent", tone: "bg-red-700 text-white border-red-700" },
  { status: "CANCELLED", label: "Cancelled", tone: "bg-ink text-on-ink border-ink" },
];

/**
 * One class with its three-way mark control; duty leave sits in the overflow menu.
 * `byDate` leads with the date instead of the subject (for one subject's history).
 */
export function SessionRow({ session, subject, showDate, byDate }: { session: Session; subject?: Subject; showDate?: boolean; byDate?: boolean }) {
  const { mark, now } = useData();
  const [menu, setMenu] = useState(false);
  const future = !started(session, now);
  const set = (s: Status) => {
    setMenu(false);
    void mark(session, session.status === s ? "UNMARKED" : s);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: subject?.color ?? "#adb5bd" }} />
      <div className="min-w-[11rem] flex-1">
        <div className="truncate font-bold">{byDate ? fmtDate(session.date) : (subject?.name ?? "Unknown subject")}</div>
        <div className="text-xs text-muted">
          {showDate && !byDate && `${fmtDate(session.date)} · `}
          {fmtHm(session.start_time)}–{fmtHm(session.end_time)}
          {session.room && ` · ${session.room}`}
          {session.weight > 1 && ` · counts ${session.weight}×`}
        </div>
      </div>
      <div className="relative ml-auto flex items-center gap-1">
        {OPTIONS.map((o) => (
          <button
            key={o.status}
            type="button"
            disabled={future && o.status !== "CANCELLED"}
            aria-pressed={session.status === o.status}
            onClick={() => set(o.status)}
            className={cx(
              "rounded-lg border px-2.5 py-1.5 text-xs font-bold disabled:opacity-35",
              session.status === o.status ? o.tone : "border-line bg-card text-ink hover:border-ink/30",
            )}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="More options"
          onClick={() => setMenu((m) => !m)}
          className={cx("rounded-lg border px-1.5 py-1.5", session.status === "DUTY_LEAVE" ? "border-accent bg-accent text-paper" : "border-line bg-card")}
        >
          <MoreHorizontal size={15} />
        </button>
        {menu && (
          <div className="absolute top-full right-0 z-20 mt-1 w-40 rounded-xl border border-line bg-card p-1 shadow-lg">
            <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-paper" onClick={() => set("DUTY_LEAVE")}>
              {session.status === "DUTY_LEAVE" ? "✓ " : ""}Duty leave
            </button>
            {session.status !== "UNMARKED" && (
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-paper" onClick={() => set("UNMARKED")}>
                Clear mark
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
