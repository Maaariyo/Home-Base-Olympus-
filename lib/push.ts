import type { Repo } from "./repo";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** "unsupported" | "unconfigured" | "blocked" | "off" | "on" for this browser. */
export async function pushState(): Promise<string> {
  if (!KEY) return "unconfigured";
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

export async function enablePush(repo: Repo) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser can't receive reminders. On iPhone, add this site to your Home Screen first, then open it from there.");
  }
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site in your browser settings.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  // Always a fresh subscription: a leftover one may belong to an account that used this browser before.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(KEY) });
  await repo.savePushSubscription(sub.toJSON());
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
