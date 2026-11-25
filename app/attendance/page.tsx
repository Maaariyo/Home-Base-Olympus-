"use client";

import { ChevronRight, Grid3x3, PieChart } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Fab, PageHeader } from "@/components/AppShell";
import { BandPill, Donut } from "@/components/Donut";
import { GradesSection } from "@/components/GradesSection";
import { SessionRow } from "@/components/SessionRow";
import { Sheet } from "@/components/Sheet";
import { buttonClass, Card, EmptyState, SectionLabel } from "@/components/ui";
import { band } from "@/lib/attendance";
import { ended, started } from "@/lib/sessions";
import { termStats } from "@/lib/stats";
import { useData } from "@/lib/store";

export default function AttendancePage() {
  const { data, now, setEditor } = useData();
  const stats = useMemo(() => termStats(data, now), [data, now]);
  const [openId, setOpenId] = useState<string | null>(null);
  const subject = new Map(data.subjects.map((s) => [s.id, s]));
  const unmarked = stats.sessions.filter((s) => ended(s, now) && s.status === "UNMARKED");
  const selected = stats.subjects.find((s) => s.subject.id === openId);
  const target = data.settings.target;

  return (
    <>
      <PageHeader title="Attendance" sub={stats.term?.name}>
        <Link href="/timetable" className={buttonClass("secondary", "py-2 md:hidden")}>
          <Grid3x3 size={16} /> Timetable
        </Link>
      </PageHeader>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 md:px-8">
        {!stats.term ? (
          <EmptyState
            icon={<PieChart />}
            title="No term yet"
            body="Add your term, subjects and weekly timetable to start tracking."
            action={
              <Link href="/timetable" className={buttonClass()}>
                Set up timetable
              </Link>
            }
          />
        ) : (
          <>
            <Card className="flex items-center gap-5 p-5">
              <Donut tally={stats.overall} band={band(stats.overall, target, data.settings)} target={target} size={112} />
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted">Overall</div>
                <div className="mt-1 text-sm text-muted">All subjects combined. Your institute&apos;s rule is usually per subject: check each card below.</div>
              </div>
            </Card>

            <Link href="/plan" className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 hover:border-ink/30">
              <span className="min-w-0 flex-1">
                <span className="block font-bold">What if I skip?</span>
                <span className="block text-sm text-muted">Pick classes you plan to miss and see each subject&apos;s percentage before you decide.</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </Link>

            {unmarked.length > 0 && (
              <section id="unmarked">
                <SectionLabel>Not marked yet · {unmarked.length}</SectionLabel>
                <Card className="divide-y divide-line px-3">
                  {unmarked.map((s) => (
                    <SessionRow key={s.key} session={s} subject={subject.get(s.subject_id)} showDate />
                  ))}
                </Card>
              </section>
            )}

            <section>
              <SectionLabel>Subjects, lowest first</SectionLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                {stats.subjects.map((s) => (
                  <button key={s.subject.id} type="button" onClick={() => setOpenId(s.subject.id)} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4 text-left hover:border-ink/30">
                    <Donut tally={s.tally} band={s.band} target={s.target} size={84} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.subject.color }} />
                        <span className="truncate font-bold">{s.subject.name}</span>
                      </div>
                      <div className="mt-1.5">
                        <BandPill band={s.band} />
                      </div>
                      {s.text && <div className="mt-1.5 text-xs text-muted">{s.text}</div>}
                    </div>
                  </button>
                ))}
              </div>
              {stats.subjects.length === 0 && <p className="text-sm text-muted">No subjects yet. Add them on the Timetable page.</p>}
            </section>
          </>
        )}
      </div>

      <Sheet open={!!selected} onClose={() => setOpenId(null)} title={selected?.subject.name} variant="panel">
        {selected && (
          <div className="px-5 pb-6">
            <div className="flex items-center gap-5">
              <Donut tally={selected.tally} band={selected.band} target={selected.target} size={130} />
              <div className="space-y-1.5 text-sm">
                <BandPill band={selected.band} />
                <div>
                  Target <b>{selected.target}%</b>
                </div>
                <div className="text-muted">
                  Opening balance: {selected.subject.opening_attended} of {selected.subject.opening_held}
                </div>
                <Link href="/timetable" className="font-semibold text-accent underline">
                  Edit subject
                </Link>
              </div>
            </div>
            {selected.text && <p className="mt-4 rounded-xl bg-paper px-4 py-3 text-sm font-bold">{selected.text}</p>}
            <GradesSection subject={selected.subject} />
            <SectionLabel className="mt-6">Attendance history, newest first</SectionLabel>
            <div className="divide-y divide-line">
              {selected.sessions
                .filter((s) => started(s, now) || s.status !== "UNMARKED")
                .reverse()
                .map((s) => (
                  <SessionRow key={s.key} session={s} subject={selected.subject} byDate />
                ))}
            </div>
          </div>
        )}
      </Sheet>
      <Fab label="Add extra class" onClick={() => setEditor({ kind: "extra" })} />
    </>
  );
}
