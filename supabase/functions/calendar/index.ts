// Supabase Edge Function "calendar" (Deno). Deploy with: supabase functions deploy calendar --no-verify-jwt
// GET ?token=<feed token>: the owner's classes, open deadlines and events as an iCalendar feed.
// Calendar apps cannot sign in, so the unguessable token is the key; Settings can reset it.
import { createClient } from "jsr:@supabase/supabase-js@2.119.0"; // exact version: this code holds the service key
import { buildCalendar } from "./ics.ts";

const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const sb = createClient(Deno.env.get("SUPABASE_URL")!, secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const notFound = () => new Response("Not found", { status: 404 });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return notFound();
  const { data: feed } = await sb.from("calendar_feeds").select("user_id, time_zone").eq("token", token).maybeSingle();
  if (!feed) return notFound();

  // Service-role reads bypass Row Level Security, so every query is pinned to the feed's owner.
  // Paged: the API returns at most 1000 rows per request.
  const rows = async (table: string, columns: string) => {
    const data: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await sb.from(table).select(columns).eq("user_id", feed.user_id).order("id").range(from, from + 999);
      if (page.error) return page;
      data.push(...(page.data ?? []));
      if ((page.data ?? []).length < 1000) return { data, error: null };
    }
  };
  const results = await Promise.all([
    rows("terms", "id, start_date, end_date, holidays"),
    rows("subjects", "id, term_id, name"),
    rows("slots", "id, subject_id, day, start_time, end_time, room, kind, effective_from, effective_to"),
    rows("marks", "id, subject_id, slot_id, date, start_time, end_time, status"),
    rows("tasks", "id, title, notes, due_at, done_at, reminders"),
    rows("events", "id, title, notes, start_at, end_at, all_day, location, repeat, repeat_until, skip_dates, reminders"),
  ]);
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error(failed.error);
    return new Response("Could not build the calendar", { status: 500 });
  }
  const [terms, subjects, slots, marks, tasks, events] = results.map((r) => r.data ?? []);
  // deno-lint-ignore no-explicit-any
  const ics = buildCalendar({ timeZone: feed.time_zone, terms, subjects, slots, marks, tasks, events } as any, new Date());
  return new Response(req.method === "HEAD" ? null : ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="home-base.ics"', "cache-control": "private, max-age=900" },
  });
});
