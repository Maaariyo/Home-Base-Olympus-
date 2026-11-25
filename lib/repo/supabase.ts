import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NO_OWNER, type PlannedNotification } from "../reminders";
import { DEFAULT_SETTINGS, TABLES, type Data, type Settings, type TableName, type Tables } from "../types";
import { ConflictError, OfflineError, type AuthState, type NewRow, type Repo } from "./types";

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };

const CACHE_PREFIX = "home-base-cache:";
const unreachable = (message: string) => (typeof navigator !== "undefined" && !navigator.onLine) || /failed to fetch|networkerror|load failed|network request failed/i.test(message);

function check<T>(res: Res<T>): T {
  if (res.error) {
    if (res.error.code === "23505") throw new ConflictError(); // unique key: another device got there first
    if (unreachable(res.error.message)) throw new OfflineError();
    throw new Error(res.error.message);
  }
  return res.data as T;
}

/** Plain-English versions of the Supabase Auth errors people actually hit. */
function authMessage(e: { message: string; code?: string }): string {
  if (e.code === "signup_disabled" || /signups? not allowed/i.test(e.message)) return "New sign-ups are closed on this site.";
  if (e.code === "over_email_send_rate_limit" || /rate limit/i.test(e.message)) return "Too many emails sent. Try again in an hour.";
  if (/not authori[sz]ed/i.test(e.message)) return "This site can't email that address yet. Its owner needs to set up custom email (README, step 2).";
  if (e.message === "Invalid login credentials") return "Wrong email or password";
  return e.message;
}

/** Hosted mode. Every table is private to its owner through Row Level Security (supabase/schema.sql). */
export class SupabaseRepo implements Repo {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private url: string;
  private lastSync = "";
  private recovery = false;
  private pendingRecovery: { access_token: string; refresh_token: string } | null = null;
  private linkError: string | null = null;
  private cleanUrl = false;

  constructor(url: string, anonKey: string) {
    // Sessions in the address bar are only accepted from a password-reset link (type=recovery). The client's
    // own URL detection is off: it would sign anyone into whatever account a crafted link names.
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
      const access_token = p.get("access_token");
      const refresh_token = p.get("refresh_token");
      if (p.get("type") === "recovery" && access_token && refresh_token) this.pendingRecovery = { access_token, refresh_token };
      // Fixed wording: never echo text from the link itself.
      if (p.get("error") || p.get("error_code")) {
        this.linkError = p.get("error_code") === "otp_expired" ? "That email link has expired or was already used. Request a new one." : "That link didn't work. Request a new one.";
      }
      this.cleanUrl = !!(access_token || this.linkError);
    }
    this.url = url;
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }

  private async userId() {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error("Not signed in");
    return id;
  }

  async getAuth(): Promise<AuthState> {
    if (this.cleanUrl) {
      // Take the tokens out of the address bar (history, screenshots). After an await, so it runs once the
      // Next.js router has written its own initial history entry, which still contains them; its state is kept.
      await Promise.resolve();
      this.cleanUrl = false;
      history.replaceState(history.state, "", window.location.pathname + window.location.search);
    }
    if (this.pendingRecovery) {
      const tokens = this.pendingRecovery;
      this.pendingRecovery = null;
      // Set first: setSession fires SIGNED_IN, which re-reads auth before this call returns.
      this.recovery = true;
      const { error } = await this.sb.auth.setSession(tokens);
      if (error) {
        this.recovery = false;
        this.linkError = "That email link has expired or was already used. Request a new one.";
      }
    }
    const { data } = await this.sb.auth.getSession();
    const email = data.session?.user.email;
    if (!email) return this.linkError ? { kind: "signed-out", notice: this.linkError } : { kind: "signed-out" };
    return this.recovery ? { kind: "recovery", email } : { kind: "signed-in", email };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(authMessage(error));
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(authMessage(error));
    return data.session ? ("signed-in" as const) : ("check-email" as const);
  }

  async signOut() {
    this.recovery = false;
    // This device must stop receiving this account's reminders, or the next person to use it would see them.
    try {
      const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        await this.sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
    } catch {
      /* sign out regardless */
    }
    // The offline copy is personal data: never leave it behind on a shared computer.
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    await this.sb.auth.signOut();
  }

  async requestPasswordReset(email: string) {
    // The link returns to this site; Supabase allows it when it matches Site URL or a listed Redirect URL.
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` });
    // "Not authorized" only happens for existing accounts outside the Supabase team: reporting it would
    // reveal that the account exists, so it gets the same answer as an unknown email.
    if (error && !/not authori[sz]ed/i.test(error.message)) throw new Error(authMessage(error));
  }

  async updatePassword(password: string) {
    // Leave recovery mode first: the USER_UPDATED event re-reads auth before updateUser returns.
    this.recovery = false;
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) {
      this.recovery = true;
      throw new Error(authMessage(error));
    }
  }

  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") cb();
    });
    return () => data.subscription.unsubscribe();
  }

  /** Loads everything; with no connection, falls back to the copy saved at the last successful load. */
  async load(): Promise<Data> {
    const key = CACHE_PREFIX + (await this.userId());
    try {
      const [settings, ...rows] = await Promise.all([
        this.sb.from("settings").select("data").maybeSingle(),
        ...TABLES.map((t) => this.sb.from(t).select("*")),
      ]);
      const out = { settings: { ...DEFAULT_SETTINGS, ...(check(settings) as { data: Settings } | null)?.data } } as Data;
      TABLES.forEach((t, i) => ((out[t] as unknown[]) = check(rows[i])));
      try {
        localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), data: out }));
      } catch {
        /* storage full or blocked: offline copy is a convenience */
      }
      return out;
    } catch (e) {
      const saved = e instanceof OfflineError ? localStorage.getItem(key) : null;
      if (!saved) throw e;
      const { at, data } = JSON.parse(saved) as { at: string; data: Data };
      for (const t of TABLES) (data[t] as unknown[]) ??= [];
      return { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings }, offlineSince: at };
    }
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    check(await this.sb.from(table).insert(row));
  }

  async update<T extends TableName>(table: T, seen: Tables[T], patch: Partial<Tables[T]>) {
    const { id: _id, created_at: _c, updated_at: _u, ...fields } = patch as Record<string, unknown>; // the database sets updated_at
    const rows = check(
      await this.sb.from(table).update(fields).eq("id", seen.id).eq("updated_at", seen.updated_at).select("id"),
    ) as unknown[];
    if (rows.length === 0) throw new ConflictError();
  }

  async remove(table: TableName, id: string) {
    check(await this.sb.from(table).delete().eq("id", id));
  }

  async saveSettings(data: Settings) {
    check(await this.sb.from("settings").upsert({ user_id: await this.userId(), data }, { onConflict: "user_id" }));
  }

  /**
   * Import (rows already checked and given fresh ids by prepareImport). New rows go in first and the old
   * ones are removed only once everything saved, so a failure part-way never leaves the account empty.
   * Terms cascade to subjects and everything under them; tasks and events stand alone.
   */
  async replaceAll(data: Data) {
    const user_id = await this.userId();
    const roots = ["terms", "tasks", "events"] as const;
    const ids = async (t: (typeof roots)[number]) => ((check(await this.sb.from(t).select("id")) as { id: string }[]) ?? []).map((r) => r.id);
    const old = { terms: await ids("terms"), tasks: await ids("tasks"), events: await ids("events") };
    // Ids travel in the URL: 100 per request keeps it well under server limits.
    const remove = async (t: (typeof roots)[number], list: string[]) => {
      for (let i = 0; i < list.length; i += 100) check(await this.sb.from(t).delete().in("id", list.slice(i, i + 100)));
    };
    try {
      for (const t of TABLES) {
        const rows = (data[t] ?? []).map((r) => ({ ...r, user_id }));
        for (let i = 0; i < rows.length; i += 500) check(await this.sb.from(t).insert(rows.slice(i, i + 500)));
      }
    } catch (e) {
      // Undo the half-finished import; the account keeps its previous data.
      for (const t of roots) await remove(t, (data[t] ?? []).map((r) => r.id)).catch(() => {});
      throw e;
    }
    for (const t of roots) await remove(t, old[t]);
    await this.saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
  }

  async syncNotifications(list: PlannedNotification[]) {
    const cutoff = new Date(Date.now() + 60_000).toISOString(); // leave the next minute to the sender
    const rows = list.filter((n) => n.fire_at > cutoff);
    const signature = JSON.stringify(rows);
    if (signature === this.lastSync) return;
    const user_id = await this.userId();
    check(await this.sb.from("notifications").delete().eq("source", "plan").is("sent_at", null).gt("fire_at", cutoff));
    if (rows.length) {
      const payload = rows.map((n) => ({ ...n, user_id, source: "plan" }));
      check(await this.sb.from("notifications").upsert(payload, { onConflict: "user_id,key", ignoreDuplicates: true }));
    }
    this.lastSync = signature;
  }

  async sendTestReminder() {
    const user_id = await this.userId();
    // source "snooze" so the next reminder re-plan does not delete it before the sender runs.
    check(
      await this.sb.from("notifications").insert({
        user_id,
        key: `test:${Date.now()}`,
        fire_at: new Date().toISOString(),
        kind: "DIGEST",
        owner_id: NO_OWNER,
        title: "Test reminder",
        body: "Reminders reach this device. You can turn them off in Settings.",
        url: "/settings",
        source: "snooze",
      }),
    );
  }

  async calendarFeed(reset: boolean) {
    const user_id = await this.userId();
    const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (reset) check(await this.sb.from("calendar_feeds").delete().eq("user_id", user_id));
    // Upsert keeps the existing token and refreshes the time zone the feed uses for class times.
    const row = check(
      await this.sb.from("calendar_feeds").upsert({ user_id, time_zone }, { onConflict: "user_id" }).select("token").single(),
    ) as { token: string };
    return `${this.url}/functions/v1/calendar?token=${row.token}`;
  }

  async savePushSubscription(sub: PushSubscriptionJSON) {
    const user_id = await this.userId();
    check(
      await this.sb
        .from("push_subscriptions")
        .upsert({ user_id, endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth }, { onConflict: "endpoint" }),
    );
  }
}
