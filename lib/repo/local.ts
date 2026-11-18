import { DEFAULT_SETTINGS, TABLES, type Data, type Settings, type TableName, type Tables } from "../types";
import { seedData } from "./seed";
import { ConflictError, type AuthState, type NewRow, type Repo } from "./types";

const KEY = "campus-planner-demo-v1";

/** Demo mode: all data lives in this browser's localStorage. */
export class LocalRepo implements Repo {
  readonly mode = "demo" as const;

  private read(): Data {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Data;
        return { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
      }
    } catch {
      /* fall through to seed */
    }
    const seed = seedData();
    this.write(seed);
    return seed;
  }

  private write(d: Data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* storage blocked: the demo keeps working until reload */
    }
  }

  async getAuth(): Promise<AuthState> {
    return { kind: "signed-in", email: "demo" };
  }
  async signIn() {}
  async signUp() {
    return "signed-in" as const;
  }
  async signOut() {}
  onAuthChange() {
    return () => {};
  }

  async load() {
    return this.read();
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    const d = this.read();
    const now = new Date().toISOString();
    (d[table] as Tables[T][]).push({ created_at: now, ...row, updated_at: now } as Tables[T]);
    this.write(d);
  }

  async update<T extends TableName>(table: T, seen: Tables[T], patch: Partial<Tables[T]>) {
    const d = this.read();
    const row = (d[table] as Tables[T][]).find((r) => r.id === seen.id);
    if (!row || row.updated_at !== seen.updated_at) throw new ConflictError();
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    this.write(d);
  }

  async remove(table: TableName, id: string) {
    const d = this.read();
    (d[table] as { id: string }[]) = d[table].filter((r) => r.id !== id);
    // Same cascade as the database: a term owns subjects, a subject owns slots and marks.
    if (table === "terms") d.subjects = d.subjects.filter((s) => s.term_id !== id);
    const subjects = new Set(d.subjects.map((s) => s.id));
    d.slots = d.slots.filter((s) => subjects.has(s.subject_id));
    const slots = new Set(d.slots.map((s) => s.id));
    d.marks = d.marks.filter((m) => subjects.has(m.subject_id) && (!m.slot_id || slots.has(m.slot_id)));
    this.write(d);
  }

  async saveSettings(settings: Settings) {
    this.write({ ...this.read(), settings });
  }

  async replaceAll(data: Data) {
    const clean = { settings: { ...DEFAULT_SETTINGS, ...data.settings } } as Data;
    for (const t of TABLES) (clean[t] as unknown[]) = data[t] ?? [];
    this.write(clean);
  }

  async syncNotifications() {}
  async savePushSubscription() {}
}

export function resetDemoData() {
  localStorage.removeItem(KEY);
}
