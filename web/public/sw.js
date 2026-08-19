/* Service worker: shows IPO and allotment pushes, and focuses the right page on click. */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Nirantara IPO', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Nirantara IPO', {
      body: payload.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: payload.data ?? {},
      // Allotment results replace any earlier alert for the same IPO instead of stacking up.
      tag: payload.data?.ipoId ? `ipo-${payload.data.ipoId}` : undefined,
      renotify: Boolean(payload.data?.ipoId),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ipoId = event.notification.data?.ipoId;
  const target = ipoId ? `/ipo/${ipoId}` : '/alerts';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
