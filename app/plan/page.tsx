"use client";

import { ArrowRight, CalendarOff } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { BandPill } from "@/components/Donut";
import { buttonClass, Card, Chip, cx, EmptyState, SectionLabel } from "@/components/ui";
import { band, BAND_STYLE, percent, project, type Band } from "@/lib/attendance";
import { addDays, fmtDate, fmtHm, startOfWeek, ymd } from "@/lib/dates";
import { started } from "@/lib/sessions";
import { termStats } from "@/lib/stats";
import { useData } from "@/lib/store";

/** Amber "at risk" is still below target; only Safe (or no classes yet) is on target. */
const onTarget = (b: Band) => b === "SAFE" || b === "NONE";

const HORIZONS = [
  { id: "week", label: "This week" },
  { id: "2w", label: "Next 2 weeks" },
  { id: "term", label: "Rest of term" },
] as const;

/** What-if: tick the classes you plan to miss; everything else in the period counts as attended. Nothing is saved. */
export default function PlanPage() {
  const { data, now } = useData();
  const stats = useMemo(() => termStats(data, now), [data, now]);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]["id"]>("2w");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const subject = new Map(data.subjects.map((s) => [s.id, s]));

  const end = !stats.term ? "" : horizon === "week" ? addDays(startOfWeek(ymd(now)), 6) : horizon === "2w" ? addDays(ymd(now), 13) : stats.term.end_date;
  // Only classes still to come and not already marked (e.g. cancelled in advance).
  const upcoming = stats.sessions.filter((s) => !started(s, now) && s.status === "UNMARKED" && s.date <= end);
  const days = [...new Set(upcoming.map((s) => s.date))];

  const rows = stats.subjects
    .map((s) => {
      const own = upcoming.filter((u) => u.subject_id === s.subject.id);
      const after = project(s.tally, own, skip);
      const afterBand = band(after, s.target, data.settings);
      // Below target even with perfect attendance: the skips are not what put it there.
      const belowAnyway = !onTarget(band(project(s.tally, own, new Set()), s.target, data.settings));
      return { ...s, after, afterPct: percent(after), afterBand, belowAnyway };
    })
    .sort((a, b) => (a.afterPct ?? 101) - (b.afterPct ?? 101));
  const pushedBelow = rows.filter((r) => !onTarget(r.afterBand) && !r.belowAnyway);
  const belowAnyway = rows.filter((r) => r.belowAnyway);
  const skipped = upcoming.filter((s) => skip.has(s.key));
  const classes = (n: number) => `${n} ${n === 1 ? "class" : "classes"}`;

  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(skip);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setSkip(next);
  };

  if (!stats.term) {
    return (
      <>
        <PageHeader title="What if I skip?" />
        <EmptyState icon={<CalendarOff />} title="No term yet" body="Set up your timetable first." action={<Link href="/timetable" className={buttonClass()}>Set up timetable</Link>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="What if I skip?" sub="Nothing here is saved" />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 md:px-8">
        <div className="flex flex-wrap gap-1.5">
          {HORIZONS.map((h) => (
            <Chip key={h.id} active={horizon === h.id} onClick={() => setHorizon(h.id)}>
              {h.label}
            </Chip>
          ))}
        </div>

        <section aria-live="polite">
          <div
            className={cx("rounded-2xl px-4 py-3 text-sm font-bold", pushedBelow.length ? "bg-danger/10 text-danger" : "bg-ok-bg text-ok")}
            data-testid="plan-summary"
          >
            {skipped.length === 0
              ? `Attending all ${classes(upcoming.length)} in this period. Tick the ones you plan to miss.`
              : pushedBelow.length
                ? `Skipping ${classes(skipped.length)} puts ${pushedBelow.map((r) => `${r.subject.name} (${r.afterPct?.toFixed(1)}%)`).join(", ")} below target.`
                : `Skipping ${classes(skipped.length)} doesn't push any subject below target.`}
          </div>
          {belowAnyway.length > 0 && (
            <p className="mt-2 rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn" data-testid="plan-below-anyway">
              {belowAnyway.map((r) => r.subject.name).join(", ")} {belowAnyway.length === 1 ? "stays" : "stay"} below target in this period even if you attend every class.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">Assumes you attend every other class until {fmtDate(end)}. A lab counts as 2.</p>
          <Card className="mt-3 divide-y divide-line">
            {rows.map((r) => (
              <div key={r.subject.id} data-subject={r.subject.name} className="flex items-center gap-3 px-4 py-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.subject.color }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{r.subject.name}</span>
                <span className="flex items-center gap-1.5 text-sm tabular-nums">
                  <span className="text-muted">{r.pct === null ? "—" : `${r.pct.toFixed(1)}%`}</span>
                  <ArrowRight size={14} className="text-muted" />
                  <b style={{ color: BAND_STYLE[r.afterBand].text }}>{r.afterPct === null ? "—" : `${r.afterPct.toFixed(1)}%`}</b>
                </span>
                <span className="hidden sm:block">
                  <BandPill band={r.afterBand} />
                </span>
              </div>
            ))}
          </Card>
        </section>

        <section>
          <SectionLabel>Classes in this period · {skipped.length} skipped</SectionLabel>
          {days.length === 0 && <p className="text-sm text-muted">No classes left in this period.</p>}
          <div className="space-y-3">
            {days.map((d) => {
              const today = upcoming.filter((s) => s.date === d);
              const all = today.every((s) => skip.has(s.key));
              return (
                <Card key={d}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                    <span className="text-sm font-bold">{fmtDate(d, { weekday: "long", day: "numeric", month: "short" })}</span>
                    <span className="flex items-center gap-2 text-xs font-semibold text-muted">
                      Skip whole day
                      <input type="checkbox" className="h-4 w-4 accent-ink" checked={all} onChange={(e) => toggle(today.map((s) => s.key), e.target.checked)} />
                    </span>
                  </label>
                  {today.map((s) => (
                    <label key={s.key} className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ink"
                        checked={skip.has(s.key)}
                        onChange={(e) => toggle([s.key], e.target.checked)}
                        aria-label={`Skip ${subject.get(s.subject_id)?.name} on ${fmtDate(d)}`}
                      />
                      <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: subject.get(s.subject_id)?.color }} />
                      <span className={cx("min-w-0 flex-1 truncate text-sm font-semibold", skip.has(s.key) && "text-muted line-through")}>
                        {subject.get(s.subject_id)?.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {fmtHm(s.start_time)}
                        {s.weight > 1 && ` · counts ${s.weight}×`}
                      </span>
                    </label>
                  ))}
                </Card>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
