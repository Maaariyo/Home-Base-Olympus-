"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORY_COLOR } from "@/components/Editors";
import { Fab, PageHeader } from "@/components/AppShell";
import { SessionRow } from "@/components/SessionRow";
import { Sheet } from "@/components/Sheet";
import { Card, Chip, cx, IconButton } from "@/components/ui";
import { addDays, at, DAY_NAMES, fmtDate, fmtTime, parseYmd, startOfWeek, ymd } from "@/lib/dates";
import { occurrences } from "@/lib/reminders";
import { termStats } from "@/lib/stats";
import { useData } from "@/lib/store";

type View = "month" | "week" | "day";
type Layer = "events" | "tasks" | "classes";

interface Item {
  key: string;
  layer: Layer;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  done?: boolean;
  open: () => void;
}

const HOUR = 48; // px per hour in the day view
const FIRST_HOUR = 7;

export default function CalendarPage() {
  const { data, now, setEditor } = useData();
  const [view, setView] = useState<View>("month");
  const [day, setDay] = useState(ymd(now));
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ events: true, tasks: true, classes: true });
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const stats = useMemo(() => termStats(data, now), [data, now]);
  const subject = new Map(data.subjects.map((s) => [s.id, s]));

  // The visible range for the current view.
  const [from, to] = useMemo(() => {
    if (view === "day") return [day, day];
    if (view === "week") return [startOfWeek(day), addDays(startOfWeek(day), 6)];
    const first = startOfWeek(day.slice(0, 8) + "01");
    return [first, addDays(first, 41)];
  }, [view, day]);

  const items = useMemo(() => {
    const a = at(from, "00:00");
    const b = at(to, "23:59");
    const out: Item[] = [];
    if (layers.events)
      for (const e of data.events)
        for (const o of occurrences(e, a, b))
          out.push({ key: `${e.id}${o.start.getTime()}`, layer: "events", title: e.title, start: o.start, end: o.end, allDay: e.all_day, color: CATEGORY_COLOR[e.category], open: () => setEditor({ kind: "event", event: e, date: ymd(o.start) }) });
    if (layers.tasks)
      for (const t of data.tasks) {
        const due = new Date(t.due_at);
        if (t.done_at || due < a || due > b) continue;
        out.push({ key: t.id, layer: "tasks", title: `Due: ${t.title}`, start: due, end: new Date(due.getTime() + 30 * 60_000), allDay: false, color: "#495057", open: () => setEditor({ kind: "task", task: t }) });
      }
    if (layers.classes)
      for (const s of stats.sessions) {
        if (s.date < from || s.date > to) continue;
        out.push({
          key: s.key,
          layer: "classes",
          title: subject.get(s.subject_id)?.name ?? "Class",
          start: at(s.date, s.start_time),
          end: at(s.date, s.end_time),
          allDay: false,
          color: subject.get(s.subject_id)?.color ?? "#adb5bd",
          done: s.status === "CANCELLED",
          open: () => setSessionKey(s.key),
        });
      }
    return out.sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.start.getTime() - y.start.getTime());
  }, [data, stats, from, to, layers]);

  const onDay = (d: string) => items.filter((i) => ymd(i.start) <= d && (i.allDay ? ymd(i.end) >= d : ymd(i.start) === d));
  const step = (n: number) => setDay(view === "month" ? ymd(new Date(parseYmd(day).getFullYear(), parseYmd(day).getMonth() + n, 1)) : addDays(day, n * (view === "week" ? 7 : 1)));
  const session = stats.sessions.find((s) => s.key === sessionKey);
  const title =
    view === "month"
      ? parseYmd(day).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
      : view === "week"
        ? `${fmtDate(from, { day: "numeric", month: "short" })} – ${fmtDate(to, { day: "numeric", month: "short" })}`
        : fmtDate(day, { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader title="Calendar" />
      <div className="mx-auto max-w-4xl px-4 py-4 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-card p-0.5">
            {(["month", "week", "day"] as View[]).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cx("rounded-lg px-3 py-1.5 text-sm font-bold capitalize", view === v ? "bg-ink text-on-ink" : "text-muted")}>
                {v}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center">
            <IconButton label="Previous" onClick={() => step(-1)}>
              <ChevronLeft size={20} />
            </IconButton>
            <button type="button" className="px-2 text-sm font-bold" onClick={() => setDay(ymd(now))}>
              Today
            </button>
            <IconButton label="Next" onClick={() => step(1)}>
              <ChevronRight size={20} />
            </IconButton>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <div className="flex gap-1.5">
            {(["events", "tasks", "classes"] as Layer[]).map((l) => (
              <Chip key={l} active={layers[l]} onClick={() => setLayers({ ...layers, [l]: !layers[l] })} className="px-2.5 py-1 text-xs capitalize">
                {l}
              </Chip>
            ))}
          </div>
        </div>

        {view === "month" && (
          <>
            <div className="mt-3 grid grid-cols-7 overflow-hidden rounded-2xl border border-line bg-line gap-px">
              {DAY_NAMES.map((d) => (
                <div key={d} className="bg-paper py-1.5 text-center text-xs font-bold text-muted">
                  {d}
                </div>
              ))}
              {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((d) => {
                const dots = onDay(d);
                const inMonth = d.slice(0, 7) === day.slice(0, 7);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    onDoubleClick={() => {
                      setDay(d);
                      setView("day");
                    }}
                    className={cx("flex h-14 flex-col items-center gap-1 bg-card pt-1.5 md:h-20", !inMonth && "bg-card/60 text-muted", d === day && "ring-2 ring-ink ring-inset")}
                  >
                    <span className={cx("grid h-6 w-6 place-items-center rounded-full text-sm font-bold", d === ymd(now) && "bg-ink text-on-ink")}>{parseYmd(d).getDate()}</span>
                    <span className="flex gap-0.5">
                      {[...new Set(dots.map((x) => x.color))].slice(0, 3).map((c) => (
                        <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <DayList date={day} items={onDay(day)} />
          </>
        )}

        {view === "week" && (
          <div className="mt-3 space-y-3">
            {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => (
              <DayList key={d} date={d} items={onDay(d)} compact />
            ))}
          </div>
        )}

        {view === "day" && <DayTimeline items={onDay(day)} />}
      </div>

      <Sheet open={!!session} onClose={() => setSessionKey(null)} title="Mark attendance">
        {session && (
          <div className="px-5 pb-6">
            <SessionRow session={session} subject={subject.get(session.subject_id)} showDate />
          </div>
        )}
      </Sheet>
      <Fab label="New event" onClick={() => setEditor({ kind: "event", date: day })} />
    </>
  );
}

function ItemRow({ item }: { item: Item }) {
  return (
    <button type="button" onClick={item.open} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-paper/60">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
      <span className={cx("min-w-0 flex-1 truncate text-sm font-semibold", item.done && "text-muted line-through")}>{item.title}</span>
      <span className="shrink-0 text-xs text-muted">{item.allDay ? "All day" : fmtTime(item.start)}</span>
    </button>
  );
}

function DayList({ date, items, compact }: { date: string; items: Item[]; compact?: boolean }) {
  return (
    <section className={compact ? "" : "mt-4"}>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{fmtDate(date, { weekday: "long", day: "numeric", month: "short" })}</div>
      <Card className="divide-y divide-line">
        {items.length ? items.map((i) => <ItemRow key={i.key} item={i} />) : <p className="px-4 py-2.5 text-sm text-muted">Nothing scheduled</p>}
      </Card>
    </section>
  );
}

/** Hour timeline. Overlapping items step to the right. */
function DayTimeline({ items }: { items: Item[] }) {
  const allDay = items.filter((i) => i.allDay);
  const timed = items.filter((i) => !i.allDay);
  const hours = Array.from({ length: 24 - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const top = (d: Date) => (d.getHours() + d.getMinutes() / 60 - FIRST_HOUR) * HOUR;
  return (
    <div className="mt-3">
      {allDay.length > 0 && (
        <Card className="mb-2 divide-y divide-line">
          {allDay.map((i) => (
            <ItemRow key={i.key} item={i} />
          ))}
        </Card>
      )}
      <div className="relative rounded-2xl border border-line bg-card" style={{ height: hours.length * HOUR }}>
        {hours.map((h) => (
          <div key={h} className="absolute inset-x-0 border-t border-line/70 pl-2 text-[11px] text-muted" style={{ top: (h - FIRST_HOUR) * HOUR }}>
            {fmtTime(at("2000-01-01", `${String(h).padStart(2, "0")}:00`))}
          </div>
        ))}
        {timed.map((i, n) => {
          const overlap = timed.slice(0, n).filter((j) => j.start < i.end && i.start < j.end).length;
          return (
            <button
              key={i.key}
              type="button"
              onClick={i.open}
              className={cx("absolute right-2 overflow-hidden rounded-lg px-2 py-1 text-left text-xs font-bold text-white shadow-sm", i.done && "opacity-50 line-through")}
              style={{ top: Math.max(0, top(i.start)), height: Math.max(22, top(i.end) - top(i.start)), left: 64 + overlap * 24, background: i.color }}
            >
              {i.title}
              <span className="block font-medium opacity-85">
                {fmtTime(i.start)}–{fmtTime(i.end)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
