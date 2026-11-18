"use client";

import { CheckSquare, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Fab, PageHeader } from "@/components/AppShell";
import { TaskRow } from "@/components/TaskRow";
import { Chip, EmptyState, inputClass } from "@/components/ui";
import { at, ymd } from "@/lib/dates";
import { useData } from "@/lib/store";

const SEGMENTS = ["Overdue", "Today", "Upcoming", "Done"] as const;
type Segment = (typeof SEGMENTS)[number];

export default function TasksPage() {
  const { data, now, setEditor } = useData();
  const [segment, setSegment] = useState<Segment>("Today");
  const [person, setPerson] = useState("");
  const [q, setQ] = useState("");
  const people = useMemo(() => [...new Set(data.tasks.flatMap((t) => t.assignees))].sort(), [data.tasks]);

  const groups = useMemo(() => {
    const endOfDay = at(ymd(now), "23:59").getTime();
    const query = q.trim().toLowerCase();
    const g: Record<Segment, typeof data.tasks> = { Overdue: [], Today: [], Upcoming: [], Done: [] };
    for (const t of data.tasks) {
      if (person && !t.assignees.includes(person)) continue;
      if (query && !`${t.title} ${t.notes}`.toLowerCase().includes(query)) continue;
      const due = new Date(t.due_at).getTime();
      if (t.done_at) g.Done.push(t);
      else if (due < now.getTime()) g.Overdue.push(t);
      else if (due <= endOfDay) g.Today.push(t);
      else g.Upcoming.push(t);
    }
    const byDue = (a: { due_at: string }, b: { due_at: string }) => a.due_at.localeCompare(b.due_at);
    g.Overdue.sort(byDue);
    g.Today.sort(byDue);
    g.Upcoming.sort(byDue);
    g.Done.sort((a, b) => b.done_at!.localeCompare(a.done_at!));
    return g;
  }, [data.tasks, now, person, q]);

  const list = groups[segment];
  return (
    <>
      <PageHeader title="Tasks" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-8">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {SEGMENTS.map((s) => (
            <Chip key={s} active={segment === s} onClick={() => setSegment(s)} className={s === "Overdue" && groups.Overdue.length ? "text-danger" : undefined}>
              {s} <span className="opacity-70">{groups[s].length}</span>
            </Chip>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <label className="relative flex-1">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className={inputClass + " pl-9"} aria-label="Search tasks" />
          </label>
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={inputClass + " w-auto"} aria-label="Filter by person">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="mt-4 space-y-2">
          {list.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
        {list.length === 0 && <EmptyState icon={<CheckSquare />} title={`No ${segment.toLowerCase()} tasks`} body={q || person ? "Nothing matches the filter." : "Tap + to add one."} />}
      </div>
      <Fab label="New task" onClick={() => setEditor({ kind: "task" })} />
    </>
  );
}
