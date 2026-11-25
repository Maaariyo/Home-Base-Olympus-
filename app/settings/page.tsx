"use client";

import { Download, LogOut, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { ReminderPicker } from "@/components/ReminderPicker";
import { Button, Card, Field, Input, inputClass, SectionLabel, Toggle } from "@/components/ui";
import { enablePush, pushState } from "@/lib/push";
import { resetDemoData } from "@/lib/repo/local";
import { useData } from "@/lib/store";
import { TABLES, type Data, type Settings } from "@/lib/types";

const PUSH_TEXT: Record<string, string> = {
  loading: "Checking…",
  unconfigured: "Push reminders are not set up on this server (see README, step 4).",
  unsupported: "This browser can't receive push reminders. On iPhone, add the site to your Home Screen and open it from there.",
  blocked: "Notifications are blocked for this site. Allow them in your browser's site settings.",
  off: "Off on this device.",
  on: "On for this device.",
};

export default function SettingsPage() {
  const { data, run, repo, auth, toast } = useData();
  const [s, setS] = useState<Settings>(data.settings);
  const [push, setPush] = useState("loading");
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings);
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `home-base-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (f: File) => {
    let parsed: Data;
    try {
      parsed = JSON.parse(await f.text());
      // Backups from before a table existed simply lack it; anything else must be a list.
      if (!Array.isArray(parsed.tasks) || !TABLES.every((t) => parsed[t] === undefined || Array.isArray(parsed[t]))) throw new Error();
    } catch {
      return toast("That file is not a Home Base backup.", "error");
    }
    if (confirm("Replace everything in this account with the backup? This cannot be undone.")) await run((r) => r.replaceAll(parsed), "Backup imported");
  };

  return (
    <>
      <PageHeader title="Settings" sub={repo.mode === "demo" ? "Demo mode" : auth?.kind === "signed-in" ? auth.email : undefined} />
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-4 pb-24 md:px-8">
        <section>
          <SectionLabel>Attendance</SectionLabel>
          <Card className="space-y-3 p-4">
            <Field label="Target %" hint="Applies to every subject without its own target. 50 to 95.">
              <Input type="number" min={50} max={95} value={s.target} onChange={(e) => set({ target: Math.min(95, Math.max(50, Math.round(+e.target.value) || 75)) })} />
            </Field>
            <Toggle label="Amber “at risk” band" hint="Shows subjects between the floor and the target in amber instead of red." checked={s.amberOn} onChange={(v) => set({ amberOn: v })} />
            {s.amberOn && (
              <Field label="Amber floor %">
                <Input type="number" min={0} max={s.target - 1} value={s.amberFloor} onChange={(e) => set({ amberFloor: Math.min(s.target - 1, Math.max(0, Math.round(+e.target.value))) })} />
              </Field>
            )}
            <Toggle label="Duty leave counts as present" hint="Off: duty leave is left out, like a cancelled class." checked={s.dutyLeaveCounts} onChange={(v) => set({ dutyLeaveCounts: v })} />
          </Card>
        </section>

        <section>
          <SectionLabel>Grades</SectionLabel>
          <Card className="p-4">
            <Field label="Aim for a final mark of (%)" hint="The grades tracker shows the average you need on what's left to reach it.">
              <Input type="number" min={1} max={100} value={s.gradeTarget} onChange={(e) => set({ gradeTarget: Math.min(100, Math.max(1, Math.round(+e.target.value) || 70)) })} />
            </Field>
          </Card>
        </section>

        <section>
          <SectionLabel>Reminders</SectionLabel>
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-bold">Notifications</div>
                <div className="text-muted">{repo.mode === "demo" ? "Available once the site is connected to Supabase." : PUSH_TEXT[push]}</div>
              </div>
              {repo.mode === "supabase" && push === "off" && (
                <Button
                  onClick={async () => {
                    try {
                      await enablePush(repo);
                      setPush("on");
                    } catch (e) {
                      toast(e instanceof Error ? e.message : String(e), "error");
                    }
                  }}
                >
                  Turn on
                </Button>
              )}
            </div>
            <Toggle label="Class prompt" hint="At the end of each class: “Did you attend?” with Present and Absent buttons." checked={s.classPrompt} onChange={(v) => set({ classPrompt: v })} />
            <Toggle label="Weekly digest" hint="Sunday at 7 pm: deadlines, events and classes in the week ahead, plus subjects below target." checked={s.weeklyDigest} onChange={(v) => set({ weeklyDigest: v })} />
            <Toggle label="Quiet hours" checked={s.quietOn} onChange={(v) => set({ quietOn: v })} />
            {s.quietOn && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="From">
                  <Input type="time" value={s.quietStart} onChange={(e) => set({ quietStart: e.target.value })} />
                </Field>
                <Field label="To">
                  <Input type="time" value={s.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} />
                </Field>
                <Field label="Reminders inside">
                  <select value={s.quietMode} onChange={(e) => set({ quietMode: e.target.value as Settings["quietMode"] })} className={inputClass}>
                    <option value="SHIFT">Move to the end</option>
                    <option value="SKIP">Drop</option>
                  </select>
                </Field>
              </div>
            )}
            {s.quietOn && s.quietMode === "SHIFT" && <p className="text-xs text-muted">A reminder that would move past its deadline fires at its original time instead.</p>}
            <div>
              <div className="mb-1.5 text-sm font-bold">Default reminders for new tasks</div>
              <ReminderPicker value={s.taskReminders} onChange={(v) => set({ taskReminders: v })} />
            </div>
            <div>
              <div className="mb-1.5 text-sm font-bold">Default reminders for new events</div>
              <ReminderPicker value={s.eventReminders} onChange={(v) => set({ eventReminders: v })} />
            </div>
          </Card>
        </section>

        <CalendarFeed />

        <section>
          <SectionLabel>Backup</SectionLabel>
          <Card className="flex flex-wrap gap-2 p-4">
            <Button variant="secondary" onClick={exportData}>
              <Download size={16} /> Export JSON
            </Button>
            <Button variant="secondary" onClick={() => file.current?.click()}>
              <Upload size={16} /> Import JSON
            </Button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0]).finally(() => (e.target.value = ""))} />
            <p className="w-full text-xs text-muted">Export from demo mode and import after signing in to move your setup into your account.</p>
          </Card>
        </section>

        <section>
          <SectionLabel>Account</SectionLabel>
          <Card className="p-4">
            {repo.mode === "demo" ? (
              <Button
                variant="danger"
                onClick={() => {
                  if (!confirm("Reset the demo to its sample data?")) return;
                  resetDemoData();
                  window.location.reload();
                }}
              >
                Reset demo data
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void repo.signOut()}>
                <LogOut size={16} /> Sign out
              </Button>
            )}
          </Card>
        </section>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-[850] border-t border-line bg-card px-4 py-3 md:bottom-0 md:left-56">
          <div className="mx-auto flex max-w-2xl gap-2">
            <Button variant="secondary" onClick={() => setS(data.settings)}>
              Discard
            </Button>
            <Button className="flex-1" onClick={() => void run((r) => r.saveSettings(s), "Settings saved")}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** The private link calendar apps subscribe to: classes, open deadlines and events. */
function CalendarFeed() {
  const { repo, toast } = useData();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (reset: boolean) => {
    if (reset && !confirm("Reset the link? Calendars using the old link stop updating until you add the new one.")) return;
    setBusy(true);
    try {
      setUrl(await repo.calendarFeed(reset));
      if (reset) toast("New link created. The old one no longer works.");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
    setBusy(false);
  };
  return (
    <section>
      <SectionLabel>Calendar feed</SectionLabel>
      <Card className="space-y-3 p-4 text-sm">
        <p className="text-muted">
          Show your classes, deadlines and events in Google Calendar or Apple Calendar. They refresh on the calendar app&apos;s schedule (Google: every few hours), and cancelled classes and holidays drop out.
        </p>
        {repo.mode === "demo" ? (
          <p className="text-muted">Available once the site is connected to Supabase.</p>
        ) : !url ? (
          <Button variant="secondary" disabled={busy} onClick={() => void load(false)}>
            Get my calendar link
          </Button>
        ) : (
          <>
            <div className="flex gap-2">
              <input readOnly value={url} aria-label="Calendar link" className={inputClass + " font-mono text-xs"} onFocus={(e) => e.target.select()} />
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.clipboard.writeText(url).then(
                    () => toast("Link copied"),
                    () => toast("Couldn't copy: select the link and copy it yourself.", "error"),
                  )
                }
              >
                Copy
              </Button>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>
                <b className="text-ink">Google Calendar</b> (on a computer): Other calendars → + → From URL → paste.
              </li>
              <li>
                <b className="text-ink">iPhone</b>: <a className="font-semibold text-accent underline" href={url.replace(/^https:/, "webcal:")}>open this link</a> and tap Subscribe.
              </li>
            </ul>
            <p className="font-semibold text-warn">Treat this link like a password: anyone who has it can see your schedule.</p>
            <Button variant="ghost" disabled={busy} onClick={() => void load(true)}>
              Reset link
            </Button>
          </>
        )}
      </Card>
    </section>
  );
}
