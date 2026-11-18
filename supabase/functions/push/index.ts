// Supabase Edge Function "push" (Deno). Deploy with: supabase functions deploy push --no-verify-jwt
//   POST with header x-cron-secret: sends every reminder that is due (called each minute by pg_cron).
//   POST ?id=<notification id>&act=<action>: a notification button was tapped (called by public/sw.js).
//     The id is an unguessable UUID that only ever reaches the owner's device, so it acts as the key.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*" };

// Browsers show at most two buttons; Cancelled is marked in the app.
const ACTIONS: Record<string, { action: string; title: string }[]> = {
  TASK: [{ action: "done", title: "Mark done" }, { action: "snooze10", title: "Snooze 10 min" }],
  EVENT: [{ action: "snooze10", title: "Snooze 10 min" }, { action: "snooze60", title: "Snooze 1 h" }],
  CLASS: [{ action: "PRESENT", title: "Present" }, { action: "ABSENT", title: "Absent" }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Headers": "content-type" } });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  try {
    if (id) return await act(id, url.searchParams.get("act") ?? "");
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);
    return await send();
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function send() {
  const now = new Date();
  const { data: due, error } = await sb.from("notifications").select("*").is("sent_at", null).lte("fire_at", now.toISOString()).order("fire_at").limit(200);
  if (error) throw error;
  if (!due.length) return json({ sent: 0 });
  // Claim the batch first, so an overlapping run cannot send it twice.
  await sb.from("notifications").update({ sent_at: now.toISOString() }).in("id", due.map((n) => n.id));
  const { data: subs } = await sb.from("push_subscriptions").select("*").in("user_id", [...new Set(due.map((n) => n.user_id))]);

  let sent = 0;
  for (const n of due) {
    // Skip anything more than 6 h late (e.g. after the free project was paused): a stale buzz is noise.
    if (now.getTime() - new Date(n.fire_at).getTime() > 6 * 3600_000) continue;
    const payload = JSON.stringify({
      id: n.id,
      title: n.title,
      body: n.body,
      url: n.url,
      actions: ACTIONS[n.kind] ?? [],
      actUrl: `${SUPABASE_URL}/functions/v1/push?id=${n.id}`,
    });
    for (const s of (subs ?? []).filter((x) => x.user_id === n.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
        else console.error("push failed", code, e);
      }
    }
  }
  await sb.from("notifications").delete().lt("sent_at", new Date(now.getTime() - 14 * 86400_000).toISOString());
  return json({ sent });
}

async function act(id: string, action: string) {
  const { data: n } = await sb.from("notifications").select("*").eq("id", id).maybeSingle();
  if (!n?.sent_at || Date.now() - new Date(n.sent_at).getTime() > 7 * 86400_000) return json({ error: "not found" }, 404);
  const now = new Date();

  if (action === "done" && n.kind === "TASK") {
    await sb.from("tasks").update({ done_at: now.toISOString() }).eq("id", n.owner_id).eq("user_id", n.user_id);
  } else if (action === "snooze10" || action === "snooze60") {
    const { id: _id, created_at: _c, sent_at: _s, ...rest } = n;
    const at = new Date(now.getTime() + (action === "snooze10" ? 10 : 60) * 60_000);
    await sb.from("notifications").insert({ ...rest, key: `snooze:${n.id}:${at.getTime()}`, fire_at: at.toISOString(), source: "snooze" });
  } else if ((action === "PRESENT" || action === "ABSENT") && n.kind === "CLASS" && n.payload) {
    const p = n.payload;
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
