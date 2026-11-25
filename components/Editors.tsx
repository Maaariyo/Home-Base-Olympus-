"use client";

import { ExternalLink, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, at, fmtDate, fromLocalInput, today, toLocalInput, ymd } from "@/lib/dates";
import { activeTerm } from "@/lib/sessions";
import { useData } from "@/lib/store";
import type { CalEvent, Category, Repeat, Status, Task } from "@/lib/types";
import { ReminderPicker } from "./ReminderPicker";
import { Sheet } from "./Sheet";
import { Button, Chip, Field, Input, inputClass, Toggle } from "./ui";

export function Editors() {
  const { editor, setEditor } = useData();
  const close = () => setEditor(null);
  if (!editor) return null;
  if (editor.kind === "task") return <TaskSheet key={editor.task?.id ?? "new"} task={editor.task} onClose={close} />;
  if (editor.kind === "event") return <EventSheet key={editor.event?.id ?? "new"} event={editor.event} date={editor.date} onClose={close} />;
  return <ExtraClassSheet date={editor.date} onClose={close} />;
}

function Footer({ onDelete, saving, label = "Save" }: { onDelete?: () => void; saving: boolean; label?: string }) {
  return (
    <div className="flex gap-2">
      {onDelete && (
        <Button variant="danger" onClick={onDelete} aria-label="Delete">
          <Trash2 size={16} />
        </Button>
      )}
      <Button type="submit" form="editor" className="flex-1" disabled={saving}>
        {label}
      </Button>
    </div>
  );
}

function TaskSheet({ task, onClose }: { task?: Task; onClose: () => void }) {
  const { data, run, repo, toast } = useData();
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [due, setDue] = useState(task ? toLocalInput(task.due_at) : `${addDays(today(), 1)}T09:00`);
  const [people, setPeople] = useState<string[]>(task?.assignees ?? []);
  const [person, setPerson] = useState("");
  const [reminders, setReminders] = useState(task?.reminders ?? data.settings.taskReminders);
  const [saving, setSaving] = useState(false);
  const known = useMemo(() => [...new Set(data.tasks.flatMap((t) => t.assignees))].sort(), [data.tasks]);

  const addPerson = () => {
    const name = person.trim();
    const existing = known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
    if (name && !people.some((p) => p.toLowerCase() === name.toLowerCase())) setPeople([...people, existing]);
    setPerson("");
  };

  const save = async () => {
    setSaving(true);
    const fields = { title: title.trim(), notes, due_at: fromLocalInput(due), assignees: people, reminders };
    const ok = await run(
      (r) => (task ? r.update("tasks", task, fields) : r.insert("tasks", { id: crypto.randomUUID(), done_at: null, ...fields })),
      task ? "Task saved" : "Task added",
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={task ? "Edit task" : "New task"}
      footer={<Footer saving={saving} onDelete={task && (() => void deleteWithUndo(task, "tasks", run, repo, toast).then(onClose))} />}
    >
      <form
        id="editor"
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Heading">
          <Input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus={!task} />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} className={inputClass} />
        </Field>
        <NoteLinks notes={notes} />
        <Field label="Due">
          <Input type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-bold">Assigned to</span>
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1.5 text-sm font-semibold">
                {p}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => setPeople(people.filter((x) => x !== p))}>
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
          <input
            list="known-people"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addPerson();
              }
            }}
            onBlur={addPerson}
            placeholder="Type a name, press Enter"
            maxLength={80}
            className={inputClass + " mt-2"}
          />
          <datalist id="known-people">
            {known.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-bold">Reminders</span>
          <ReminderPicker value={reminders} onChange={setReminders} />
        </div>
        {task && (
          <p className="text-xs text-muted">
            Date created: {new Date(task.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/** Deletes at once and offers Undo, which puts the same row back. */
export async function deleteWithUndo<T extends Task | CalEvent>(
  row: T,
  table: "tasks" | "events",
  run: ReturnType<typeof useData>["run"],
  repo: ReturnType<typeof useData>["repo"],
  toast: ReturnType<typeof useData>["toast"],
) {
  const ok = await run((r) => r.remove(table, row.id));
  if (!ok) return;
  const { updated_at: _u, ...rest } = row;
  toast(`Deleted “${row.title}”`, "info", {
    label: "Undo",
    run: () => void run(() => repo.insert(table, rest as never), "Restored"),
  });
}

/** Links in notes open in a new tab (a textarea itself cannot hold clickable links). */
function NoteLinks({ notes }: { notes: string }) {
  const links = [...new Set(notes.match(/https?:\/\/[^\s<>"]+/g) ?? [])];
  if (!links.length) return null;
  return (
    <div className="-mt-2 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full bg-paper px-3 py-1 text-xs font-semibold text-accent">
          <ExternalLink size={12} className="shrink-0" />
          <span className="truncate">{l.replace(/^https?:\/\/(www\.)?/, "")}</span>
        </a>
      ))}
    </div>
  );
}

const CATEGORIES: { id: Category; label: string; color: string }[] = [
  { id: "ACADEMIC", label: "Academic", color: "#1c7ed6" },
  { id: "SOCIAL", label: "Social", color: "#e64980" },
  { id: "OTHER", label: "Other", color: "#868e96" },
];
export const CATEGORY_COLOR = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.color])) as Record<Category, string>;

function EventSheet({ event, date, onClose }: { event?: CalEvent; date?: string; onClose: () => void }) {
  const { data, run, repo, toast } = useData();
  const day = date ?? today();
  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState<Category>(event?.category ?? "ACADEMIC");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(event ? toLocalInput(event.start_at) : `${day}T10:00`);
  const [end, setEnd] = useState(event ? toLocalInput(event.end_at) : `${day}T11:00`);
  const [location, setLocation] = useState(event?.location ?? "");
  const [repeat, setRepeat] = useState<Repeat>(event?.repeat ?? "NONE");
  const [until, setUntil] = useState(event?.repeat_until ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [reminders, setReminders] = useState(event?.reminders ?? data.settings.eventReminders);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    // All-day events run from the start of the first day to the end of the last.
    const s = allDay ? at(start.slice(0, 10), "00:00").toISOString() : fromLocalInput(start);
    const e = allDay ? at(end.slice(0, 10), "23:59").toISOString() : fromLocalInput(end);
    if (e <= s) return setError("End must be after start");
    setSaving(true);
    const fields = { title: title.trim(), category, all_day: allDay, start_at: s, end_at: e, location, repeat, repeat_until: repeat === "NONE" || !until ? null : until, notes, reminders };
    const ok = await run(
      (r) => (event ? r.update("events", event, fields) : r.insert("events", { id: crypto.randomUUID(), skip_dates: [], ...fields })),
      event ? "Event saved" : "Event added",
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      footer={<Footer saving={saving} onDelete={event && (() => void deleteWithUndo(event, "events", run, repo, toast).then(onClose))} />}
    >
      {event && event.repeat !== "NONE" && date && (
        <div className="mx-5 mb-4 flex items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3 text-sm">
          <span>
            Not happening on <b>{fmtDate(date)}</b>?
          </span>
          <Button
            variant="secondary"
            className="py-1.5"
            onClick={async () => {
              if (await run((r) => r.update("events", event, { skip_dates: [...(event.skip_dates ?? []), date] }), `Skipped ${fmtDate(date)}`)) onClose();
            }}
          >
            Skip this date
          </Button>
        </div>
      )}
      <form
        id="editor"
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Title">
          <Input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!event} />
        </Field>
        <div className="flex gap-1.5">
          {CATEGORIES.map((c) => (
            <Chip key={c.id} active={category === c.id} color={c.color} onClick={() => setCategory(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <Toggle label="All day" checked={allDay} onChange={setAllDay} />
        <div className={allDay ? "grid grid-cols-2 gap-3" : "grid gap-3 sm:grid-cols-2"}>
          <Field label="Starts">
            {allDay ? (
              <Input type="date" required value={start.slice(0, 10)} onChange={(e) => setStart(`${e.target.value}T00:00`)} />
            ) : (
              <Input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
            )}
          </Field>
          <Field label="Ends">
            {allDay ? (
              <Input type="date" required value={end.slice(0, 10)} onChange={(e) => setEnd(`${e.target.value}T23:59`)} />
            ) : (
              <Input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
            )}
          </Field>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Field label="Location">
          <Input value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat">
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className={inputClass}>
              <option value="NONE">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </Field>
          {repeat !== "NONE" && (
            <Field label="Until" hint="Empty = no end">
              <Input type="date" value={until} min={start.slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} className={inputClass} />
        </Field>
        <NoteLinks notes={notes} />
        <div>
          <span className="mb-1.5 block text-sm font-bold">Reminders</span>
          <ReminderPicker value={reminders} onChange={setReminders} />
        </div>
      </form>
    </Sheet>
  );
}

function ExtraClassSheet({ date, onClose }: { date?: string; onClose: () => void }) {
  const { data, run } = useData();
  const term = activeTerm(data.terms);
  const subjects = data.subjects.filter((s) => s.term_id === term?.id);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [day, setDay] = useState(date ?? ymd(new Date()));
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("17:00");
  const [weight, setWeight] = useState(1);
  const [status, setStatus] = useState<Status>("UNMARKED");
  const [saving, setSaving] = useState(false);

  if (!term || subjects.length === 0) {
    return (
      <Sheet open onClose={onClose} title="Add extra class">
        <p className="px-5 pb-6 text-sm text-muted">Set up your term and subjects on the Timetable page first.</p>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title="Add extra class" footer={<Footer saving={saving} label="Add class" />}>
      <form
        id="editor"
        className="space-y-4 px-5 pb-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (end <= start) return;
          setSaving(true);
          const ok = await run(
            (r) => r.insert("marks", { id: crypto.randomUUID(), subject_id: subjectId, slot_id: null, date: day, start_time: start, end_time: end, weight, status }),
            "Extra class added",
          );
          setSaving(false);
          if (ok) onClose();
        }}
      >
        <Field label="Subject">
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={inputClass}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" hint={day < term.track_from ? "Before your tracking start date: this class will not count." : undefined}>
          <Input type="date" required value={day} min={term.start_date} max={term.end_date} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="time" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Counts as">
            <select value={weight} onChange={(e) => setWeight(+e.target.value)} className={inputClass}>
              <option value={1}>1 session</option>
              <option value={2}>2 sessions (lab)</option>
            </select>
          </Field>
          <Field label="Mark">
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={inputClass}>
              <option value="UNMARKED">Not yet</option>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="DUTY_LEAVE">Duty leave</option>
            </select>
          </Field>
        </div>
      </form>
    </Sheet>
  );
}
