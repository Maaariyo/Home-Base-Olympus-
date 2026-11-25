"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { planNotifications } from "./reminders";
import { ConflictError, getRepo, OfflineError, type AuthState, type Repo } from "./repo";
import type { Session } from "./sessions";
import type { CalEvent, Data, Status, Task } from "./types";

export type Editor =
  | { kind: "task"; task?: Task }
  | { kind: "event"; event?: CalEvent; date?: string }
  | { kind: "extra"; date?: string }
  | null;

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

interface Store {
  repo: Repo;
  auth: AuthState | null;
  data: Data | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Runs a write, reloads data, and turns failures into a toast. */
  run: (fn: (repo: Repo) => Promise<unknown>, success?: string) => Promise<boolean>;
  mark: (s: Session, status: Status) => Promise<boolean>;
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  editor: Editor;
  setEditor: (e: Editor) => void;
  /** Re-renders every minute so "in 3 h" and "now" stay current. */
  now: Date;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => getRepo(), []);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => new Date());
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info", action?: Toast["action"]) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, tone, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : tone === "error" ? 5000 : 2500);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const a = await repo.getAuth();
      setAuth(a);
      if (a.kind === "signed-in" && a.notice) toast(a.notice, "error");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setAuth({ kind: "signed-out" });
    }
  }, [repo, toast]);

  const refresh = useCallback(async () => {
    try {
      setData(await repo.load());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [repo]);

  useEffect(() => {
    void refreshAuth();
    return repo.onAuthChange(() => void refreshAuth());
  }, [repo, refreshAuth]);

  // The service worker keeps the site's pages so it opens with no signal (production builds only).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Offline support unavailable", e));
    }
  }, []);

  const signedIn = auth?.kind === "signed-in";
  useEffect(() => {
    if (!signedIn) return setData(null);
    void refresh();
    // Another device may have changed something: reload whenever the tab comes back.
    const onFocus = () => document.visibilityState === "visible" && void refresh();
    const onOnline = () => void refresh();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      clearInterval(tick);
    };
  }, [signedIn, refresh]);

  // Keep the server's reminder queue in step with the data, a moment after the last change. Never from the
  // offline copy: it may be out of date (e.g. a task finished on another device would get reminders again).
  const syncError = useRef("");
  useEffect(() => {
    if (!data || repo.mode !== "supabase" || data.offlineSince) return;
    const timer = setTimeout(() => {
      repo.syncNotifications(planNotifications(data, new Date())).then(
        () => (syncError.current = ""),
        (e) => {
          const message = e instanceof Error ? e.message : String(e);
          // Say it once, not on every change: a silent failure would mean reminders quietly stop.
          if (message !== syncError.current && !(e instanceof OfflineError)) toast(`Reminders couldn't be updated: ${message}`, "error");
          syncError.current = message;
        },
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [data, repo, toast]);

  const run = useCallback(
    async (fn: (r: Repo) => Promise<unknown>, success?: string) => {
      try {
        await fn(repo);
        await refresh();
        if (success) toast(success);
        return true;
      } catch (e) {
        if (e instanceof ConflictError) await refresh();
        toast(e instanceof Error ? e.message : String(e), "error");
        return false;
      }
    },
    [repo, refresh, toast],
  );

  const mark = useCallback(
    (s: Session, status: Status) =>
      run((r) =>
        s.mark
          ? r.update("marks", s.mark, { status })
          : r.insert("marks", {
              id: crypto.randomUUID(),
              subject_id: s.subject_id,
              slot_id: s.slot_id,
              date: s.date,
              start_time: s.start_time,
              end_time: s.end_time,
              weight: s.weight,
              status,
            }),
      ),
    [run],
  );

  const value: Store = { repo, auth, data, loadError, refresh, run, mark, toasts, toast, editor, setEditor, now };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

/** For screens that render only once data has loaded (AppShell guarantees it). */
export function useData(): Store & { data: Data } {
  const s = useStore();
  if (!s.data) throw new Error("Data not loaded");
  return s as Store & { data: Data };
}
