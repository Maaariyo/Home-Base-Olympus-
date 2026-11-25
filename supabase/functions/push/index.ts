// Supabase Edge Function "push" (Deno). Deploy with: supabase functions deploy push --no-verify-jwt
//   POST with header x-cron-secret: sends every reminder that is due (called each minute by pg_cron).
//   POST ?id=<notification id>&act=<action>: a notification button was tapped (called by public/sw.js).
//     The id is an unguessable UUID that only ever reaches the owner's device, so it acts as the key.
import { createClient } from "jsr:@supabase/supabase-js@2.119.0"; // exact versions: this code holds the service key
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Supabase retires the legacy service_role key by the end of 2026: prefer the new secret key when present.
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const sb = createClient(SUPABASE_URL, secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*" };

// Browsers show at most two buttons; Cancelled is marked in the app.
const ACTIONS: Record<string, { action: string; title: string }[]> = {
  TASK: [{ action: "done", title: "Mark done" }, { action: "snooze10", title: "Snooze 10 min" }],
  EVENT: [{ action: "snooze10", title: "Snooze 10 min" }, { action: "snooze60", title: "Snooze 1 h" }],
  CLASS: [{ action: "PRESENT", title: "Present" }, { action: "ABSENT", title: "Absent" }],
};

// Only real browser push services: a made-up endpoint could otherwise make this function call any host.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const pushable = (endpoint: string) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false; // a malformed address is skipped, never allowed to stop the run
  }
};
const LATE = 6 * 3600_000; // reminders more than 6 h late are dropped (e.g. after the free project was paused)

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Headers": "content-type" } });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  try {
    if (id) return req.method === "POST" ? await act(id, url.searchParams.get("act") ?? "") : json({ error: "use POST" }, 405);
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);
    return await send();
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

type Due = { id: string; user_id: string; kind: string; title: string; body: string; url: string };

async function send() {
  const now = new Date();
  // Old unsent rows are purged rather than selected, so a pile of them cannot crowd out today's reminders.
  await sb.from("notifications").delete().is("sent_at", null).lt("fire_at", new Date(now.getTime() - LATE).toISOString());
  let sent = 0;
  // Batches of 100, at most 10 per account each (claim_due_notifications in schema.sql), so one account
  // cannot hold up everyone else. Up to 5 batches a minute.
  for (let round = 0; round < 5; round++) {
    const { data: due, error } = await sb.rpc("claim_due_notifications", { batch: 100, per_user: 10 });
    if (error) throw error;
    if (!due?.length) break;
    sent += await deliver(due as Due[]);
    if (due.length < 100) break;
  }
  await sb.from("notifications").delete().lt("sent_at", new Date(now.getTime() - 14 * 86400_000).toISOString());
  return json({ sent });
}

async function deliver(due: Due[]): Promise<number> {
  // At most 100 accounts x 10 devices, inside the API's 1000-row page.
  const { data: subs } = await sb.from("push_subscriptions").select("*").in("user_id", [...new Set(due.map((n) => n.user_id))]);

  const jobs = due.flatMap((n) => {
    const payload = JSON.stringify({
      id: n.id,
      title: n.title,
      body: n.body,
      url: n.url,
      actions: ACTIONS[n.kind] ?? [],
      actUrl: `${SUPABASE_URL}/functions/v1/push?id=${n.id}`,
    });
    return (subs ?? [])
      .filter((s) => s.user_id === n.user_id && pushable(s.endpoint))
      .map(async (s) => {
        try {
          // A 10 s limit, and all sends in parallel, so one slow endpoint cannot stall everyone's reminders.
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, timeout: 10_000 });
          return true;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
          else console.error("push failed", code, e);
          return false;
        }
      });
  });
  return (await Promise.allSettled(jobs)).filter((r) => r.status === "fulfilled" && r.value).length;
}

async function act(id: string, action: string) {
  const { data: n } = await sb.from("notifications").select("*").eq("id", id).maybeSingle();
  if (!n?.sent_at || Date.now() - new Date(n.sent_at).getTime() > 7 * 86400_000) return json({ error: "not found" }, 404);
  const now = new Date();

  if (action === "done" && n.kind === "TASK") {
    await sb.from("tasks").update({ done_at: now.toISOString() }).eq("id", n.owner_id).eq("user_id", n.user_id);
  } else if ((action === "snooze10" || action === "snooze60") && n.source === "plan") {
    // Only planned reminders can be snoozed, so snoozes cannot snowball into more snoozes.
    const { id: _id, created_at: _c, sent_at: _s, ...rest } = n;
    const at = new Date(now.getTime() + (action === "snooze10" ? 10 : 60) * 60_000);
    // One snooze per button per notification: repeating the request does not stack reminders.
    await sb.from("notifications").upsert({ ...rest, key: `snooze:${n.id}:${action}`, fire_at: at.toISOString(), source: "snooze" }, { onConflict: "user_id,key", ignoreDuplicates: true });
  } else if ((action === "PRESENT" || action === "ABSENT") && n.kind === "CLASS" && n.payload) {
    const p = n.payload;
    // The database only accepts a mark whose class and subject belong to n.user_id (same-owner foreign keys).
    if (p.slot_id) {
      await sb.from("marks").upsert(
        { user_id: n.user_id, subject_id: p.subject_id, slot_id: p.slot_id, date: p.date, start_time: p.start_time, end_time: p.end_time, weight: p.weight, status: action },
        { onConflict: "slot_id,date" },
      );
    } else if (p.mark_id) {
      await sb.from("marks").update({ status: action }).eq("id", p.mark_id).eq("user_id", n.user_id);
    }
  } else {
    return json({ error: "unknown action" }, 400);
  }
  return json({ ok: true });
}
