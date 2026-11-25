"use client";

import { BellRing, ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORY_COLOR } from "@/components/Editors";
import { Fab, PageHeader } from "@/components/AppShell";
import { BandPill } from "@/components/Donut";
import { SessionRow } from "@/components/SessionRow";
import { TaskRow } from "@/components/TaskRow";
import { Button, Card, SectionLabel } from "@/components/ui";
import { at, fmtDate, fmtHm, fmtTime, ymd } from "@/lib/dates";
import { enablePush, pushState } from "@/lib/push";
import { occurrences } from "@/lib/reminders";
import { ended, started, type Session } from "@/lib/sessions";
import { skipHint } from "@/lib/attendance";
import { termStats } from "@/lib/stats";
import { useData } from "@/lib/store";

export default function TodayPage() {
  const { data, now, setEditor } = useData();
  const stats = useMemo(() => termStats(data, now), [data, now]);
  const subject = new Map(data.subjects.map((s) => [s.id, s]));
  const day = ymd(now);
  const dayStart = at(day, "00:00");
  const dayEnd = at(day, "23:59");

  const classes = stats.sessions.filter((s) => s.date === day);
  const next = stats.sessions.find((s) => !started(s, now) && s.status !== "CANCELLED");
  const current = classes.find((s) => started(s, now) && !ended(s, now));
  const focus = current ?? next;
  const unmarked = stats.sessions.filter((s) => ended(s, now) && s.status === "UNMARKED");
  const open = data.tasks.filter((t) => !t.done_at).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const tasks = open.filter((t) => new Date(t.due_at) <= dayEnd);
  const events = data.events
    .flatMap((e) => occurrences(e, dayStart, dayEnd).map((o) => ({ e, o })))
    .sort((a, b) => a.o.start.getTime() - b.o.start.getTime());
  const below = stats.subjects.filter((s) => s.band === "BELOW" || s.band === "WATCH");
  // For classes still to come today: would missing this one keep the subject on target?
  const statsBySubject = new Map(stats.subjects.map((x) => [x.subject.id, x]));
  const hintFor = (s: Session) => {
    const st = statsBySubject.get(s.subject_id);
    return st && !started(s, now) && s.status === "UNMARKED" ? skipHint(st.tally, s.weight, st.target) : undefined;
  };

  return (
    <>
      <PageHeader title="Today" sub={now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 md:px-8">
        <PushBanner />
        {!stats.term && (
          <Card className="p-4">
            <div className="font-bold">Set up your timetable</div>
            <p className="mt-1 text-sm text-muted">Add your term, subjects and weekly classes to start tracking attendance.</p>
            <Link href="/timetable" className="mt-3 inline-block text-sm font-bold text-accent underline">
              Open Timetable
            </Link>
          </Card>
        )}

        {focus && (
          <Card className="flex items-center gap-4 p-4">
            <span className="h-12 w-1.5 rounded-full" style={{ background: subject.get(focus.subject_id)?.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-wide text-muted">{current ? "Now" : "Next class"}</div>
              <div className="truncate text-lg font-extrabold">{subject.get(focus.subject_id)?.name}</div>
              <div className="text-sm text-muted">
                {focus.date !== day && `${fmtDate(focus.date)} · `}
                {fmtHm(focus.start_time)}–{fmtHm(focus.end_time)}
                {focus.room && ` · ${focus.room}`}
              </div>
            </div>
            <Clock className="text-muted" />
          </Card>
        )}

        {unmarked.length > 0 && (
          <Link href="/attendance#unmarked" className="flex items-center justify-between rounded-2xl bg-warn-bg px-4 py-3 text-sm font-bold text-warn">
            {unmarked.length} {unmarked.length === 1 ? "class" : "classes"} not marked
            <ChevronRight size={18} />
          </Link>
        )}

        {classes.length > 0 && (
          <section>
            <SectionLabel>Today&apos;s classes</SectionLabel>
            <Card className="divide-y divide-line px-3">
              {classes.map((s) => (
                <SessionRow key={s.key} session={s} subject={subject.get(s.subject_id)} hint={hintFor(s)} />
              ))}
            </Card>
          </section>
        )}

        <section>
          <SectionLabel>Due today and overdue</SectionLabel>
          {tasks.length ? (
            <div className="space-y-2">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing due today.</p>
          )}
        </section>

        {events.length > 0 && (
          <section>
            <SectionLabel>Events</SectionLabel>
            <Card className="divide-y divide-line">
              {events.map(({ e, o }) => (
                <button key={e.id + o.start.getTime()} type="button" onClick={() => setEditor({ kind: "event", event: e, date: day })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[e.category] }} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{e.title}</span>
                  <span className="text-sm text-muted">{e.all_day ? "All day" : fmtTime(o.start)}</span>
                </button>
              ))}
            </Card>
          </section>
        )}

        {below.length > 0 && (
          <section>
            <SectionLabel>Below target</SectionLabel>
            <Card className="divide-y divide-line">
              {below.map((s) => (
                <Link key={s.subject.id} href="/attendance" className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{s.subject.name}</span>
                    <span className="block text-xs text-muted">{s.text}</span>
                  </span>
                  <span className="font-extrabold">{s.pct?.toFixed(1)}%</span>
                  <BandPill band={s.band} />
                </Link>
              ))}
            </Card>
          </section>
        )}
      </div>
      <Fab
        label="Add"
        menu={[
          { label: "New task", run: () => setEditor({ kind: "task" }) },
          { label: "New event", run: () => setEditor({ kind: "event" }) },
          { label: "Extra class", run: () => setEditor({ kind: "extra" }) },
        ]}
      />
    </>
  );
}

/** Asks for notification permission only when the person taps the button. */
function PushBanner() {
  const { repo, toast } = useData();
  const [state, setState] = useState<string>("loading");
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (repo.mode !== "supabase" || state !== "off") return null;
  return (
    <Card className="flex items-center gap-3 p-4">
      <BellRing className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <b>Turn on reminders on this device.</b> They arrive even when this site is closed.
      </div>
      <Button
        onClick={async () => {
          try {
            await enablePush(repo);
            setState("on");
            toast("Reminders are on for this device");
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), "error");
          }
        }}
      >
        Turn on
      </Button>
    </Card>
  );
}
