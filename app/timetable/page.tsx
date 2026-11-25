"use client";

import { Download, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { Sheet } from "@/components/Sheet";
import { Button, Card, Chip, Field, IconButton, Input, inputClass, SectionLabel } from "@/components/ui";
import { addDays, DAY_NAMES, fmtDate, fmtHm, today } from "@/lib/dates";
import { activeTerm } from "@/lib/sessions";
import { useData } from "@/lib/store";
import { parseTimetable, TEMPLATE, toTimetableCsv } from "@/lib/timetable-import";
import type { Holiday, Slot, SlotKind, Subject, Term } from "@/lib/types";

/** Downloads the current timetable in the import layout, so a classmate can import it. */
function shareCsv(slots: Slot[], subject: Map<string, Subject>) {
  const rows = slots.map((s) => ({ day: s.day, start: s.start_time, end: s.end_time, subject: subject.get(s.subject_id)?.name ?? "", code: subject.get(s.subject_id)?.code ?? "", room: s.room, kind: s.kind }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toTimetableCsv(rows)], { type: "text/csv" }));
  a.download = "timetable.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

const COLORS = ["#1c7ed6", "#e8590c", "#2b8a3e", "#7048e8", "#c2255c", "#0c8599", "#e67700", "#5c940d", "#495057"];

export default function TimetablePage() {
  const { data } = useData();
  const term = activeTerm(data.terms);
  const [slotEdit, setSlotEdit] = useState<{ slot?: Slot; day: number } | null>(null);
  const [subjectEdit, setSubjectEdit] = useState<{ subject?: Subject } | null>(null);
  const [importing, setImporting] = useState(false);
  const subjects = data.subjects.filter((s) => s.term_id === term?.id);
  const subject = new Map(subjects.map((s) => [s.id, s]));
  const t0 = today();
  const slots = data.slots.filter((s) => subject.has(s.subject_id) && (!s.effective_to || s.effective_to >= t0));
  const days = slots.some((s) => s.day === 7) ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];

  return (
    <>
      <PageHeader title="Timetable" sub={term?.name} />
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-4 md:px-8">
        <TermCard key={term?.id ?? "new"} term={term} />

        {term && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel className="mb-0">Subjects</SectionLabel>
              <div className="flex gap-2">
                <Button variant="secondary" className="py-1.5" onClick={() => setImporting(true)}>
                  <Upload size={16} /> Import timetable
                </Button>
                <Button variant="secondary" className="py-1.5" onClick={() => setSubjectEdit({})}>
                  <Plus size={16} /> Subject
                </Button>
              </div>
            </div>
            <Card className="divide-y divide-line">
              {subjects.map((s) => (
                <button key={s.id} type="button" onClick={() => setSubjectEdit({ subject: s })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper/60">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {s.name} {s.code && <span className="text-muted">· {s.code}</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      Opening balance {s.opening_attended} of {s.opening_held}
                      {s.target_pct !== null && ` · target ${s.target_pct}%`}
                    </span>
                  </span>
                  <Pencil size={16} className="text-muted" />
                </button>
              ))}
              {subjects.length === 0 && <p className="px-4 py-3 text-sm text-muted">Add each course you take this term.</p>}
            </Card>
          </section>
        )}

        {term && subjects.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel className="mb-0">Weekly classes</SectionLabel>
              <Button variant="ghost" className="py-1.5" onClick={() => shareCsv(slots, subject)}>
                <Download size={16} /> Share as CSV
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {days.map((d) => (
                <div key={d}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-bold">{DAY_NAMES[d - 1]}</span>
                    <IconButton label={`Add class on ${DAY_NAMES[d - 1]}`} className="h-7 w-7" onClick={() => setSlotEdit({ day: d })}>
                      <Plus size={16} />
                    </IconButton>
                  </div>
                  <div className="space-y-1.5">
                    {slots
                      .filter((s) => s.day === d)
                      .sort((a, b) => a.start_time.localeCompare(b.start_time))
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSlotEdit({ slot: s, day: d })}
                          className="block w-full rounded-xl border-l-4 bg-card px-3 py-2 text-left shadow-sm"
                          style={{ borderColor: subject.get(s.subject_id)?.color }}
                        >
                          <div className="truncate text-sm font-bold">{subject.get(s.subject_id)?.code || subject.get(s.subject_id)?.name}</div>
                          <div className="text-xs text-muted">
                            {fmtHm(s.start_time)}–{fmtHm(s.end_time)}
                            {s.room && ` · ${s.room}`}
                          </div>
                          {s.kind !== "LECTURE" && <div className="text-xs font-semibold text-muted">{s.kind === "LAB" ? `Lab · counts ${s.weight}×` : "Tutorial"}</div>}
                          {s.effective_from > t0 && <div className="text-xs font-semibold text-accent">From {fmtDate(s.effective_from)}</div>}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {importing && term && <ImportSheet term={term} onClose={() => setImporting(false)} />}
      {slotEdit && term && <SlotSheet {...slotEdit} term={term} subjects={subjects} onClose={() => setSlotEdit(null)} />}
      {subjectEdit && term && <SubjectSheet subject={subjectEdit.subject} term={term} onClose={() => setSubjectEdit(null)} />}
    </>
  );
}

function TermCard({ term }: { term: Term | null }) {
  const { run } = useData();
  const t0 = today();
  const [name, setName] = useState(term?.name ?? "Term 1");
  const [start, setStart] = useState(term?.start_date ?? t0);
  const [end, setEnd] = useState(term?.end_date ?? addDays(t0, 90));
  const [track, setTrack] = useState(term?.track_from ?? t0);
  const [holidays, setHolidays] = useState<Holiday[]>(term?.holidays ?? []);
  const [hDate, setHDate] = useState("");
  const [hLabel, setHLabel] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    if (end < start) return setError("The term must end after it starts.");
    if (track < start || track > end) return setError("Tracking must start inside the term.");
    setError("");
    const fields = { name: name.trim(), start_date: start, end_date: end, track_from: track, holidays: [...holidays].sort((a, b) => a.date.localeCompare(b.date)) };
    await run((r) => (term ? r.update("terms", term, fields) : r.insert("terms", { id: crypto.randomUUID(), ...fields })), term ? "Term saved" : "Term created");
  };

  return (
    <Card className="p-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="font-bold">{term ? "Term" : "Set up your term"}</div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Starts">
            <Input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Tracking from">
            <Input type="date" required value={track} min={start} max={end} onChange={(e) => setTrack(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Starting mid-term? Set <b>Tracking from</b> to today and give each subject an opening balance of classes held and attended so far. Classes before that date are never listed or counted twice.
        </p>
        <div>
          <span className="mb-1.5 block text-sm font-bold">Holidays</span>
          <div className="flex flex-wrap gap-1.5">
            {holidays.map((h) => (
              <span key={h.date} className="inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1.5 text-sm font-semibold">
                {fmtDate(h.date)} {h.label && `· ${h.label}`}
                <button type="button" aria-label={`Remove ${h.label || h.date}`} onClick={() => setHolidays(holidays.filter((x) => x.date !== h.date))}>
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input type="date" value={hDate} min={start} max={end} onChange={(e) => setHDate(e.target.value)} className="w-auto" aria-label="Holiday date" />
            <Input value={hLabel} onChange={(e) => setHLabel(e.target.value)} placeholder="Label (optional)" aria-label="Holiday label" />
            <Button
              variant="secondary"
              disabled={!hDate}
              onClick={() => {
                if (!holidays.some((h) => h.date === hDate)) setHolidays([...holidays, { date: hDate, label: hLabel.trim() }]);
                setHDate("");
                setHLabel("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit">{term ? "Save term" : "Create term"}</Button>
      </form>
    </Card>
  );
}

function SubjectSheet({ subject, term, onClose }: { subject?: Subject; term: Term; onClose: () => void }) {
  const { data, run } = useData();
  const [name, setName] = useState(subject?.name ?? "");
  const [code, setCode] = useState(subject?.code ?? "");
  const [color, setColor] = useState(subject?.color ?? COLORS[data.subjects.length % COLORS.length]);
  const [target, setTarget] = useState(subject?.target_pct?.toString() ?? "");
  const [held, setHeld] = useState(subject?.opening_held ?? 0);
  const [attended, setAttended] = useState(subject?.opening_attended ?? 0);
  const invalid = attended > held;

  const save = async () => {
    const t = target.trim() === "" ? null : Math.min(95, Math.max(50, Math.round(+target)));
    const fields = { name: name.trim(), code: code.trim(), color, target_pct: t, opening_held: held, opening_attended: attended };
    const ok = await run(
      (r) => (subject ? r.update("subjects", subject, fields) : r.insert("subjects", { id: crypto.randomUUID(), term_id: term.id, ...fields })),
      subject ? "Subject saved" : "Subject added",
    );
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={subject ? "Edit subject" : "New subject"}
      footer={
        <div className="flex gap-2">
          {subject && (
            <Button
              variant="danger"
              aria-label="Delete subject"
              onClick={async () => {
                if (confirm(`Delete ${subject.name} with its classes and attendance marks?`) && (await run((r) => r.remove("subjects", subject.id), "Subject deleted"))) onClose();
              }}
            >
              <Trash2 size={16} />
            </Button>
          )}
          <Button type="submit" form="subject" className="flex-1" disabled={invalid}>
            Save
          </Button>
        </div>
      }
    >
      <form
        id="subject"
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Name">
              <Input required value={name} onChange={(e) => setName(e.target.value)} autoFocus={!subject} />
            </Field>
          </div>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-bold">Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className="h-8 w-8 rounded-full ring-offset-2" style={{ background: c, boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : undefined }} />
            ))}
          </div>
        </div>
        <Field label="Target %" hint={`Empty = your default (${data.settings.target}%).`}>
          <Input type="number" min={50} max={95} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={String(data.settings.target)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Held before tracking">
            <Input type="number" min={0} value={held} onChange={(e) => setHeld(Math.max(0, Math.round(+e.target.value)))} />
          </Field>
          <Field label="Attended before tracking">
            <Input type="number" min={0} value={attended} onChange={(e) => setAttended(Math.max(0, Math.round(+e.target.value)))} />
          </Field>
        </div>
        {invalid && <p className="text-sm text-danger">Attended cannot be more than held.</p>}
        <p className="text-xs text-muted">Count classes before {fmtDate(term.track_from)} (your tracking start). A lab counts as 2.</p>
      </form>
    </Sheet>
  );
}

function SlotSheet({ slot, day, term, subjects, onClose }: { slot?: Slot; day: number; term: Term; subjects: Subject[]; onClose: () => void }) {
  const { data, run } = useData();
  const t0 = today();
  const hasHistory = !!slot && slot.effective_from < t0;
  const firstSetup = !data.slots.some((s) => subjects.some((x) => x.id === s.subject_id));
  const [subjectId, setSubjectId] = useState(slot?.subject_id ?? subjects[0].id);
  const [d, setD] = useState(slot?.day ?? day);
  const [start, setStart] = useState(slot?.start_time ?? "09:30");
  const [end, setEnd] = useState(slot?.end_time ?? "10:45");
  const [room, setRoom] = useState(slot?.room ?? "");
  const [kind, setKind] = useState<SlotKind>(slot?.kind ?? "LECTURE");
  const [weight, setWeight] = useState(slot?.weight ?? 1);
  // New slots start at tracking start during first setup, otherwise today. Edits to a slot with history start today.
  const [from, setFrom] = useState(slot ? (hasHistory ? t0 : slot.effective_from) : firstSetup ? term.track_from : t0 > term.start_date ? t0 : term.start_date);
  const [error, setError] = useState("");
  const marked = !!slot && data.marks.some((m) => m.slot_id === slot.id);

  const save = async () => {
    if (end <= start) return setError("The class must end after it starts.");
    const fields = { subject_id: subjectId, day: d, start_time: start, end_time: end, room: room.trim(), kind, weight };
    const ok = await run(async (r) => {
      if (!slot) return r.insert("slots", { id: crypto.randomUUID(), ...fields, effective_from: from, effective_to: null });
      if (from <= slot.effective_from) return r.update("slots", slot, { ...fields, effective_from: from });
      // A change from a later date ends the old slot, so past marks keep their original class.
      await r.update("slots", slot, { effective_to: addDays(from, -1) });
      await r.insert("slots", { id: crypto.randomUUID(), ...fields, effective_from: from, effective_to: slot.effective_to });
    }, "Timetable saved");
    if (ok) onClose();
  };

  const removeSlot = async () => {
    if (!slot) return;
    // A slot with attendance marks is ended rather than deleted, so its marks keep counting.
    const ok = marked
      ? await run((r) => r.update("slots", slot, { effective_to: addDays(from > slot.effective_from ? from : t0, -1) }), "Class removed from the timetable")
      : await run((r) => r.remove("slots", slot.id), "Class deleted");
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={slot ? "Edit class" : "Add class"}
      footer={
        <div className="flex gap-2">
          {slot && (
            <Button variant="danger" onClick={() => void removeSlot()} aria-label="Remove class">
              <Trash2 size={16} />
            </Button>
          )}
          <Button type="submit" form="slot" className="flex-1">
            Save
          </Button>
        </div>
      }
    >
      <form
        id="slot"
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
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
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((n, i) => (
            <Chip key={n} active={d === i + 1} onClick={() => setD(i + 1)} className="px-2.5">
              {n}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Room">
          <Input value={room} onChange={(e) => setRoom(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value as SlotKind;
                setKind(k);
                setWeight(k === "LAB" ? 2 : 1);
              }}
              className={inputClass}
            >
              <option value="LECTURE">Lecture</option>
              <option value="TUTORIAL">Tutorial</option>
              <option value="LAB">Lab</option>
            </select>
          </Field>
          <Field label="Counts as">
            <select value={weight} onChange={(e) => setWeight(+e.target.value)} className={inputClass}>
              <option value={1}>1 session</option>
              <option value={2}>2 sessions</option>
            </select>
          </Field>
        </div>
        <Field label={slot ? "Apply from" : "Starts from"} hint={hasHistory ? "Classes before this date keep their current time and marks." : undefined}>
          <Input type="date" required value={from} min={term.start_date} max={term.end_date} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Sheet>
  );
}

/** Paste cells from Excel / Google Sheets, or pick a CSV: creates missing subjects and adds the weekly classes. */
function ImportSheet({ term, onClose }: { term: Term; onClose: () => void }) {
  const { data, run, toast } = useData();
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseTimetable(text) : null), [text]);
  const t0 = today();
  const subjects = data.subjects.filter((s) => s.term_id === term.id);
  const known = new Set(subjects.map((s) => s.name.toLowerCase()));
  const newSubjects = [...new Set((parsed?.rows ?? []).map((r) => r.subject).filter((n) => !known.has(n.toLowerCase())))];
  // Same rule as adding one class: the first timetable counts from tracking start, later ones from today.
  const firstSetup = !data.slots.some((s) => subjects.some((x) => x.id === s.subject_id));
  const from = firstSetup ? term.track_from : t0 > term.start_date ? t0 : term.start_date;

  const readFile = async (f: File) => {
    if (f.size > 1_000_000) return toast("That file is too big for a timetable (over 1 MB).", "error");
    setText(await f.text());
  };

  const add = async () => {
    if (!parsed?.rows.length) return;
    let added = 0;
    let skipped = 0;
    const ok = await run(async (r) => {
      const ids = new Map(subjects.map((s) => [s.name.toLowerCase(), s.id]));
      const seen = new Set(data.slots.filter((s) => !s.effective_to || s.effective_to >= t0).map((s) => `${s.subject_id}|${s.day}|${s.start_time}|${s.end_time}`));
      let colour = subjects.length;
      for (const row of parsed.rows) {
        const name = row.subject.toLowerCase();
        if (!ids.has(name)) {
          const id = crypto.randomUUID();
          await r.insert("subjects", { id, term_id: term.id, name: row.subject, code: row.code, color: COLORS[colour++ % COLORS.length], target_pct: null, opening_held: 0, opening_attended: 0 });
          ids.set(name, id);
        }
        const subject_id = ids.get(name)!;
        const key = `${subject_id}|${row.day}|${row.start}|${row.end}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        await r.insert("slots", { id: crypto.randomUUID(), subject_id, day: row.day, start_time: row.start, end_time: row.end, room: row.room, kind: row.kind, weight: row.kind === "LAB" ? 2 : 1, effective_from: from, effective_to: null });
        added++;
      }
    });
    if (ok) {
      toast(`Added ${added} ${added === 1 ? "class" : "classes"}${skipped ? `; ${skipped} already in your timetable` : ""}`);
      onClose();
    }
  };

  const count = parsed?.rows.length ?? 0;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Import timetable"
      footer={
        <Button className="w-full" disabled={!count} onClick={() => void add()}>
          {count ? `Add ${count} ${count === 1 ? "class" : "classes"}` : "Nothing to add yet"}
        </Button>
      }
    >
      <div className="space-y-4 px-5 pb-5">
        <p className="text-sm text-muted">
          Copy the cells from Excel or Google Sheets and paste them below, or choose a CSV file. The first row must name the columns: <b className="text-ink">Day, Start, End, Subject</b>, and optionally Code, Room and Type (Lecture, Tutorial or Lab).
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="timetable-template.csv" className="inline-flex items-center rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold">
            Download template
          </a>
          <label className="inline-flex cursor-pointer items-center rounded-xl border border-line bg-card px-3 py-2 text-sm font-semibold">
            Choose CSV file
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
          </label>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"Day\tStart\tEnd\tSubject\nMon\t09:30\t10:45\tMarketing Management"}
          aria-label="Timetable rows"
          className={inputClass + " font-mono text-sm"}
        />
        {parsed && (
          <div className="space-y-2 text-sm">
            {parsed.errors.length > 0 && (
              <ul className="space-y-0.5 rounded-xl bg-danger/10 px-4 py-3 text-danger">
                {parsed.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {parsed.errors.length > 8 && <li>…and {parsed.errors.length - 8} more. Rows with problems are left out.</li>}
              </ul>
            )}
            {count > 0 && (
              <>
                <div className="font-bold">
                  {count} {count === 1 ? "class" : "classes"} ready, counting from {fmtDate(from)}
                </div>
                {newSubjects.length > 0 && <div className="text-muted">New subjects: {newSubjects.join(", ")}. Set their opening balances afterwards if you started mid-term.</div>}
                <div className="max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {parsed.rows.map((r) => (
                    <div key={r.line} className="flex gap-3 px-3 py-1.5">
                      <span className="w-9 shrink-0 font-semibold">{DAY_NAMES[r.day - 1]}</span>
                      <span className="w-28 shrink-0 text-muted">
                        {fmtHm(r.start)}–{fmtHm(r.end)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.subject}</span>
                      {r.kind === "LAB" && <span className="text-xs font-semibold text-muted">Lab ×2</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
