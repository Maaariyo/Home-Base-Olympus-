// Service worker: keeps the site usable offline, shows push reminders and handles their buttons.
// Bump CACHE when the caching rules change; old caches are deleted on activate.
const CACHE = "home-base-v1";
const PAGES = ["/", "/calendar", "/tasks", "/attendance", "/timetable", "/settings", "/plan"];

// On install, store every page and the scripts and styles they load, so the site opens with no signal.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const page of PAGES) {
        try {
          const res = await fetch(page, { cache: "no-cache" });
          if (!res.ok) continue;
          const html = await res.clone().text();
          await cache.put(page, res);
          const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]))];
          await Promise.all(assets.map(async (a) => (await cache.match(a)) || cache.add(a).catch(() => {})));
        } catch {
          /* offline during install: runtime caching fills in later */
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files. Data (Supabase) is never cached here; the app keeps its own copy.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const save = (res) => {
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (url.pathname.startsWith("/_next/static/")) {
    // File names contain a content hash, so a cached copy is always correct.
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(save)));
    return;
  }
  // Pages: network first so a new deploy shows at once; the stored copy when offline.
  event.respondWith(
    fetch(req)
      .then(save)
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" && (await caches.match("/"))) || Response.error()),
  );
});

self.addEventListener("push", (event) => {
  const n = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(n.title || "Reminder", {
      body: n.body,
      tag: n.id,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: n,
      actions: n.actions || [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification.data || {};
  event.notification.close();
  // A button: tell the server (mark done, snooze, mark attendance) without opening the site.
  if (event.action && n.actUrl) {
    event.waitUntil(fetch(`${n.actUrl}&act=${encodeURIComponent(event.action)}`, { method: "POST" }));
    return;
  }
  // Only ever open a page of this site.
  const target = new URL(n.url || "/", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
