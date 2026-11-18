"use client";

import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { relative } from "@/lib/dates";
import { useData } from "@/lib/store";
import type { Task } from "@/lib/types";
import { deleteWithUndo } from "./Editors";
import { cx } from "./ui";

/** Tap to edit, tick to complete. On touch screens: swipe right to complete, left to delete (with Undo). */
export function TaskRow({ task }: { task: Task }) {
  const { run, repo, toast, setEditor, now } = useData();
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const overdue = !task.done_at && new Date(task.due_at) < now;
  const toggle = () => void run((r) => r.update("tasks", task, { done_at: task.done_at ? null : new Date().toISOString() }), task.done_at ? "Reopened" : "Done");

  return (
    <div className="relative overflow-hidden rounded-xl">
      {dx !== 0 && (
        <div className={cx("absolute inset-0 flex items-center px-4 text-sm font-bold text-white", dx > 0 ? "justify-start bg-green-700" : "justify-end bg-red-700")}>
          {dx > 0 ? (task.done_at ? "Reopen" : "Complete") : "Delete"}
        </div>
      )}
      <div
        className="relative flex touch-pan-y items-center gap-3 bg-card px-3 py-3"
        style={{ transform: `translateX(${dx}px)`, transition: startX.current === null ? "transform .2s" : "none" }}
        onPointerDown={(e) => e.pointerType === "touch" && (startX.current = e.clientX)}
        onPointerMove={(e) => startX.current !== null && setDx(Math.max(-120, Math.min(120, e.clientX - startX.current)))}
        onPointerUp={() => {
          if (dx > 80) toggle();
          if (dx < -80) void deleteWithUndo(task, "tasks", run, repo, toast);
          startX.current = null;
          setDx(0);
        }}
        onPointerCancel={() => {
          startX.current = null;
          setDx(0);
        }}
      >
        <button
          type="button"
          aria-label={task.done_at ? "Mark not done" : "Mark done"}
          onClick={toggle}
          className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-md border-2", task.done_at ? "border-green-700 bg-green-700 text-white" : "border-line")}
        >
          {task.done_at && <Check size={14} strokeWidth={3} />}
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => Math.abs(dx) < 5 && setEditor({ kind: "task", task })}>
          <div className={cx("truncate font-semibold", task.done_at && "text-muted line-through")}>{task.title}</div>
          <div className={cx("text-xs", overdue ? "font-bold text-danger" : "text-muted")}>
            {task.done_at ? `Done ${relative(task.done_at, now.getTime()).replace(" late", " ago")}` : overdue ? relative(task.due_at, now.getTime()) : `Due ${relative(task.due_at, now.getTime())}`}
          </div>
        </button>
        <div className="flex shrink-0 gap-1">
          {task.assignees.slice(0, 2).map((p) => (
            <span key={p} className="max-w-20 truncate rounded-full bg-paper px-2 py-0.5 text-xs font-semibold">
              {p}
            </span>
          ))}
          {task.assignees.length > 2 && <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-semibold">+{task.assignees.length - 2}</span>}
        </div>
      </div>
    </div>
  );
}
