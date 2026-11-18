import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlannedNotification } from "../reminders";
import { DEFAULT_SETTINGS, TABLES, type Data, type Settings, type TableName, type Tables } from "../types";
import { ConflictError, type AuthState, type NewRow, type Repo } from "./types";

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };

function check<T>(res: Res<T>): T {
  if (res.error) {
    if (res.error.code === "23505") throw new ConflictError(); // unique key: another device got there first
    throw new Error(res.error.message);
  }
  return res.data as T;
}

/** Hosted mode. Every table is private to its owner through Row Level Security (supabase/schema.sql). */
export class SupabaseRepo implements Repo {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private lastSync = "";

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  private async userId() {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error("Not signed in");
    return id;
  }

  async getAuth(): Promise<AuthState> {
    const { data } = await this.sb.auth.getSession();
    const email = data.session?.user.email;
    return email ? { kind: "signed-in", email } : { kind: "signed-out" };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password" : error.message);
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    return data.session ? ("signed-in" as const) : ("check-email" as const);
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") cb();
    });
    return () => data.subscription.unsubscribe();
  }

  async load(): Promise<Data> {
    const [settings, ...rows] = await Promise.all([
      this.sb.from("settings").select("data").maybeSingle(),
      ...TABLES.map((t) => this.sb.from(t).select("*")),
    ]);
    const out = { settings: { ...DEFAULT_SETTINGS, ...(check(settings) as { data: Settings } | null)?.data } } as Data;
    TABLES.forEach((t, i) => ((out[t] as unknown[]) = check(rows[i])));
    return out;
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

  async replaceAll(data: Data) {
    const user_id = await this.userId();
    // Terms cascade to subjects, slots and marks; tasks and events stand alone.
    for (const t of ["terms", "tasks", "events"] as const) check(await this.sb.from(t).delete().eq("user_id", user_id));
    for (const t of TABLES) {
      const rows = (data[t] ?? []).map((r) => ({ ...r, user_id }));
      if (rows.length) check(await this.sb.from(t).insert(rows));
    }
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

  async savePushSubscription(sub: PushSubscriptionJSON) {
    const user_id = await this.userId();
    check(
      await this.sb
        .from("push_subscriptions")
        .upsert({ user_id, endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth }, { onConflict: "endpoint" }),
    );
  }
}
