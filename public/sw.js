/* ==========================================================================
   StockWise - service worker for Portfolio News Alerts
   SIT774 Task 10.3HD (implementing the Task 7.3HD proposal)

   A service worker is a script the browser keeps alive in the background,
   separate from any page. That is what makes the feature work with every
   StockWise tab closed: the browser's push service wakes this worker, the
   worker shows the notification, and the page does not need to exist.

   It does three small jobs:
     1. 'push'              - show the notification the server sent
     2. 'notificationclick' - open (or focus) the explanation page
     3. tell any open StockWise tab to refresh its "For your portfolio" list

   It is served from the site root (/sw.js) so its scope covers the whole
   site. The page registers it in js/alerts.js.
   ========================================================================== */

'use strict';

// Take over straight away rather than waiting for old tabs to close, so a
// freshly registered worker can receive the very next push.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// Fired when the push service delivers a message. The server decides what
// the text says (lib/alerts.js buildPushPayload): by default it is generic
// and names no stock, because a lock screen has no authentication. This
// worker never adds anything to it, it only displays what it was sent.
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {}; // an unreadable payload still gets a generic, safe notification
  }

  var title = data.title || 'StockWise';
  var options = {
    body: data.body || "There's news about one of your holdings.",
    // Same tag means a repeat of the same item replaces the earlier
    // notification instead of stacking a second one.
    tag: data.tag || 'stockwise-news',
    // Carried back to us when the user taps. An opaque id only: the page
    // checks the signed-in session before it shows anything.
    // sentAt is the server's clock, receivedAt is this browser's: the gap is the
    // real send-to-device delay (test/experiments/latency.js reads both).
    data: { newsId: data.newsId, sentAt: data.sentAt, receivedAt: Date.now() }
  };

  event.waitUntil(
    Promise.all([
      // Browsers require every push to show a notification (userVisibleOnly),
      // so this always runs.
      self.registration.showNotification(title, options),
      // If a StockWise tab is open, let it refresh its in-app list too.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
        clients.forEach(function (client) {
          client.postMessage({ type: 'news-pushed' });
        });
      })
    ])
  );
});

// The user tapped the notification. Open the explanation page, reusing an
// existing StockWise tab if there is one.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var newsId = event.notification.data && event.notification.data.newsId;
  var target = newsId ? '/news.html?id=' + encodeURIComponent(newsId) : '/alerts.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if ('navigate' in clients[i]) {
          return clients[i].navigate(target).then(function (c) { return c && c.focus(); });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
