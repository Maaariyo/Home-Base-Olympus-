"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { gradeSummary, gradeText } from "@/lib/grades";
import { useData } from "@/lib/store";
import type { GradeItem, Subject } from "@/lib/types";
import { Button, IconButton, inputClass, SectionLabel } from "./ui";

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** A subject's assessed components: weights, scores, and what is needed on the rest. */
export function GradesSection({ subject }: { subject: Subject }) {
  const { data } = useData();
  const target = data.settings.gradeTarget;
  const items = data.grade_items.filter((g) => g.subject_id === subject.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const s = gradeSummary(items, target);

  return (
    <section>
      <SectionLabel className="mt-6">Grades</SectionLabel>
      {items.length > 0 && (
        <div className="mb-2 rounded-xl bg-paper px-4 py-3 text-sm">
          <div className="font-bold">{gradeText(s, target)}</div>
          {s.average !== null && (
            <div className="mt-0.5 text-muted">
              So far {s.earned} of {s.gradedWeight} marks ({s.average}% average). Raw marks, not a relative grade.
            </div>
          )}
          {s.totalWeight !== 100 && <div className="mt-0.5 font-semibold text-warn">Weights add up to {s.totalWeight}%, not 100%.</div>}
        </div>
      )}
      <div className="divide-y divide-line">
        {items.map((g) => (
          <GradeRow key={g.id} item={g} />
        ))}
      </div>
      <AddGrade subjectId={subject.id} />
    </section>
  );
}

function GradeRow({ item }: { item: GradeItem }) {
  const { run, repo, toast } = useData();
  const saveScore = (value: string) => {
    const score = num(value);
    if (score === item.score) return;
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > item.max_score)) return toast(`Score must be between 0 and ${item.max_score}.`, "error");
    void run((r) => r.update("grade_items", item, { score }));
  };
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{item.name}</div>
        <div className="text-xs text-muted">{item.weight}% of the final mark</div>
      </div>
      {/* Keyed on updated_at so the box shows the saved value after each save. */}
      <input
        key={item.updated_at}
        type="number"
        inputMode="decimal"
        min={0}
        max={item.max_score}
        step="any"
        defaultValue={item.score ?? ""}
        placeholder="—"
        aria-label={`Score for ${item.name}, out of ${item.max_score}`}
        onBlur={(e) => saveScore(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={inputClass + " w-20 py-1.5 text-right"}
      />
      <span className="w-12 shrink-0 text-sm text-muted">/ {item.max_score}</span>
      <IconButton
        label={`Delete ${item.name}`}
        onClick={() =>
          void run((r) => r.remove("grade_items", item.id)).then((ok) => {
            if (!ok) return;
            const { updated_at: _u, ...rest } = item;
            toast(`Deleted ${item.name}`, "info", { label: "Undo", run: () => void run(() => repo.insert("grade_items", rest)) });
          })
        }
      >
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}

function AddGrade({ subjectId }: { subjectId: string }) {
  const { run } = useData();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    const weight = Number(f.get("weight"));
    const max_score = Number(f.get("max"));
    const score = num(String(f.get("score")));
    if (!(weight > 0 && weight <= 100)) return setError("Weight must be between 0 and 100%.");
    if (!(max_score > 0)) return setError("Out of must be more than 0.");
    if (score !== null && (score < 0 || score > max_score)) return setError(`Score must be between 0 and ${max_score}.`);
    setError("");
    const form = e.currentTarget;
    if (await run((r) => r.insert("grade_items", { id: crypto.randomUUID(), subject_id: subjectId, name, weight, max_score, score }), "Component added")) form.reset();
  };

  if (!open) {
    return (
      <Button variant="secondary" className="mt-2 py-1.5" onClick={() => setOpen(true)}>
        <Plus size={16} /> Add a graded component
      </Button>
    );
  }
  return (
    <form onSubmit={add} className="mt-2 space-y-2 rounded-xl border border-line p-3">
      <input name="name" required maxLength={80} placeholder="Name, e.g. Quiz 2" aria-label="Component name" className={inputClass} />
      <div className="grid grid-cols-3 gap-2">
        <input name="weight" type="number" required min={0} max={100} step="any" placeholder="Weight %" aria-label="Weight, percent of the final mark" className={inputClass} />
        <input name="max" type="number" required min={0} step="any" defaultValue={100} aria-label="Out of" className={inputClass} />
        <input name="score" type="number" min={0} step="any" placeholder="Score" aria-label="Score, if marked" className={inputClass} />
      </div>
      <p className="text-xs text-muted">Weight · out of · score (leave the score empty until it&apos;s marked).</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit">Add</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </form>
  );
}
