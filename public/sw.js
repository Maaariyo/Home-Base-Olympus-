// Service worker: shows push reminders and handles their buttons.
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
  const url = new URL(n.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
