import type { PlannedNotification } from "../reminders";
import type { Data, Settings, TableName, Tables } from "../types";

export type AuthState =
  | { kind: "signed-out"; notice?: string }
  | { kind: "signed-in"; email: string }
  /** Arrived from a password-reset email: must choose a new password before using the site. */
  | { kind: "recovery"; email: string };

/** The device has no connection (or the server can't be reached). */
export class OfflineError extends Error {
  constructor() {
    super("You're offline. This change wasn't saved; try again when you're connected.");
  }
}

/** The row changed or was deleted on another device since this one loaded it. */
export class ConflictError extends Error {
  constructor() {
    super("This changed on another device. The latest version is loaded; please try again.");
  }
}

export type NewRow<T extends TableName> = Omit<Tables[T], "created_at" | "updated_at"> & { created_at?: string };

/** Everything the UI does to data goes through this. LocalRepo = demo (this browser), SupabaseRepo = hosted. */
export interface Repo {
  readonly mode: "demo" | "supabase";
  getAuth(): Promise<AuthState>;
  signIn(email: string, password: string): Promise<void>;
  /** "check-email" when the Supabase project requires email confirmation. */
  signUp(email: string, password: string): Promise<"signed-in" | "check-email">;
  signOut(): Promise<void>;
  /** Emails a link that opens this site on a "set a new password" screen. */
  requestPasswordReset(email: string): Promise<void>;
  /** Sets the signed-in user's password and ends recovery mode. */
  updatePassword(password: string): Promise<void>;
  onAuthChange(cb: () => void): () => void;

  load(): Promise<Data>;
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<void>;
  /** Saves only if `seen` is still the latest version; otherwise throws ConflictError. */
  update<T extends TableName>(table: T, seen: Tables[T], patch: Partial<Tables[T]>): Promise<void>;
  /** Deletes always win: a delete never needs a version check. */
  remove(table: TableName, id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  /** Import: replaces every row this user owns. */
  replaceAll(data: Data): Promise<void>;

  /** Replaces the planned (unsent) reminders on the server. No-op in demo mode. */
  syncNotifications(list: PlannedNotification[]): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON): Promise<void>;
  /** The private calendar-feed address (created on first use); `reset` replaces it. Null in demo mode. */
  calendarFeed(reset: boolean): Promise<string | null>;
}
