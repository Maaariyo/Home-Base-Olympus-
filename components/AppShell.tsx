"use client";

import { CalendarDays, CheckSquare, Grid3x3, Home, LoaderCircle, PieChart, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Editors } from "./Editors";
import { LoginScreen } from "./LoginScreen";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Today", Icon: Home },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/tasks", label: "Tasks", Icon: CheckSquare },
  { href: "/attendance", label: "Attendance", Icon: PieChart },
];
const MORE = [
  { href: "/timetable", label: "Timetable", Icon: Grid3x3 },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { auth, data, loadError, toasts, repo, refresh } = useStore();
  const pathname = usePathname();

  if (!auth) return <FullScreenLoader />;
  if (auth.kind === "signed-out") return <LoginScreen />;
  if (!data) {
    return loadError ? (
      <div className="grid h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-bold">Couldn&apos;t load your planner</p>
          <p className="mt-1 text-sm text-muted">{loadError}</p>
          <button className="mt-4 font-semibold text-accent underline" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    ) : (
      <FullScreenLoader />
    );
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-card px-3 py-4 md:flex">
        <Link href="/" className="px-2 pb-6 text-lg font-extrabold tracking-tight">
          Campus Planner
        </Link>
        <nav className="space-y-1">
          {[...NAV, ...MORE].map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold",
                isActive(href) ? "bg-paper text-ink" : "text-muted hover:bg-paper/60 hover:text-ink",
              )}
            >
              <Icon size={19} /> {label}
            </Link>
          ))}
        </nav>
        {repo.mode === "demo" && (
          <div className="mt-auto rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn">
            <b>Demo mode.</b> Sample data, saved in this browser only.
          </div>
        )}
      </aside>

      <main className="relative min-w-0 flex-1 overflow-y-auto pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-[900] flex border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={cx("flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold", isActive(href) ? "text-ink" : "text-muted")}
          >
            <Icon size={22} strokeWidth={isActive(href) ? 2.4 : 2} />
            {label}
          </Link>
        ))}
      </nav>

      <Editors />

      <div className="pointer-events-none fixed inset-x-0 top-3 z-[1100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              "animate-sheet pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg",
              t.tone === "error" ? "bg-red-700 text-white" : "bg-ink text-on-ink",
            )}
          >
            {t.text}
            {t.action && (
              <button type="button" className="font-extrabold underline" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Page title row. On phones it carries the Settings gear, since Settings is not in the bottom bar. */
export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur md:px-8 md:pt-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-extrabold tracking-tight md:text-2xl">{title}</h1>
        {sub && <div className="truncate text-sm text-muted">{sub}</div>}
      </div>
      {children}
      <Link href="/settings" aria-label="Settings" className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-ink/5 md:hidden">
        <Settings size={20} />
      </Link>
    </header>
  );
}

/** Floating add button. With `menu`, it opens a small list of actions instead. */
export function Fab({ label, onClick, menu }: { label: string; onClick?: () => void; menu?: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[800] flex flex-col items-end gap-2 md:right-8 md:bottom-8">
      {open &&
        menu?.map((m) => (
          <button
            key={m.label}
            type="button"
            className="animate-sheet rounded-xl bg-card px-4 py-2.5 text-sm font-bold shadow-lg ring-1 ring-line"
            onClick={() => {
              setOpen(false);
              m.run();
            }}
          >
            {m.label}
          </button>
        ))}
      <button
        type="button"
        aria-label={label}
        aria-expanded={menu ? open : undefined}
        onClick={() => (menu ? setOpen(!open) : onClick?.())}
        className="grid h-14 w-14 place-items-center rounded-2xl bg-ink text-on-ink shadow-xl shadow-ink/25 transition-transform active:scale-95"
      >
        <Plus size={26} strokeWidth={2.5} className={cx("transition-transform", open && "rotate-45")} />
      </button>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="grid h-dvh place-items-center">
      <LoaderCircle className="animate-spin text-muted" />
    </div>
  );
}
