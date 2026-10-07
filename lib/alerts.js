// lib/alerts.js
// SIT774 Task 10.3HD - Portfolio News Alerts (implementing the Task 7.3HD proposal)
//
// The logic that is not tied to Express: what goes into a notification, what
// each plan is allowed to read, how a news item is "released", and the
// delivery job that matches news to holdings and sends Web Push messages.
// Kept separate from the routes so it can be tested without a server
// (test/alerts.test.js passes in a fake sender instead of the real one).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FULL_EXPLANATION_PLANS } = require('./alerts-db');

const GENERIC_BODY = "There's news about one of your holdings.";

// How many users one delivery run sends to at the same time.
const DEFAULT_SEND_CONCURRENCY = 25;

// ---------------------------------------------------------------------------
// 1. What goes into the notification
// ---------------------------------------------------------------------------

// The lock screen is visible to anyone near the phone with no sign-in, so by
// default the notification names nothing. This is decided HERE, on the
// server: the service worker (public/sw.js) only displays whatever title and
// body it is sent, so a generic payload simply never contains the ticker or
// the headline. We are not relying on the phone to hide anything.
//
// Only a user who ticked "Show holding details on my lock screen" gets the
// specific text. Even then, the payload carries only the headline the user
// could read for free: never the analyst commentary or any plan-gated depth.
function buildPushPayload(prefs, newsItem, now = Date.now()) {
  const specific = prefs.showOnLockScreen === true;
  return {
    title: 'StockWise',
    body: specific ? `${newsItem.ticker}: ${truncate(newsItem.headline, MAX_HEADLINE_CHARS)}` : GENERIC_BODY,
    // An opaque id, enough for the click handler to open the right page.
    // The page itself checks the session and holdings before showing anything.
    newsId: newsItem.id,
    // Same tag means a repeat of the same item replaces, not stacks.
    tag: `stockwise-news-${newsItem.id}`,
    // When the server sent it. The service worker stamps its own receive time
    // next to this, so the real send-to-screen delay can be measured.
    sentAt: now
  };
}

// A Web Push message is limited to about 4 KB once encrypted, and a push that
// is too large is rejected outright. A very long headline would therefore
// cost the user the alert entirely, so the specific text is capped. (Found by
// test/experiments/payload-limits.js, not assumed.)
const MAX_HEADLINE_CHARS = 120;
function truncate(text, max) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '\u2026';
}

// ---------------------------------------------------------------------------
// 2. What each plan may read. Depth, never speed.
// ---------------------------------------------------------------------------

// Every plan is told the same fact at the same moment (the push is sent to
// all of them at once). What differs is what they can read when they open it:
//  - Free: the short summary of what happened.
//  - Standard and Full: the fuller plain-English explanation plus the
//    attributed analyst comment.
// StockWise never averages or scores analyst views, and it never forecasts:
// the comment is one named person's reported words, shown with its source.
function shapeNewsForPlan(item, plan) {
  const base = {
    id: item.id,
    ticker: item.ticker,
    headline: item.headline,
    summary: item.summary,
    releasedAt: item.released_at,
    sample: true,
    fullExplanation: FULL_EXPLANATION_PLANS.has(plan)
  };
  if (!base.fullExplanation) return base;
  return {
    ...base,
    detail: item.detail,
    analyst: {
      name: item.analyst_name,
      firm: item.analyst_firm,
      quote: item.analyst_quote,
      sourceUrl: item.source_url
    }
  };
}

// ---------------------------------------------------------------------------
// 3. "The news just broke"
// ---------------------------------------------------------------------------

// In production a scheduled job would poll a licensed news API and insert new
// rows. A prototype can't pay for a feed, so this picks the next sample item
// (for a ticker the given user holds, so the demo is relevant) and stamps it
// as released. Everything after this point (matching, payload, push) is the
// real code path.
function releaseNextNews(db, userId) {
  const next = db.prepare(`
    SELECT n.* FROM news_items n
    JOIN holdings h ON h.ticker = n.ticker AND h.user_id = ?
    WHERE n.released_at IS NULL
    ORDER BY n.id
    LIMIT 1
  `).get(userId);
  if (!next) return null;
  db.prepare("UPDATE news_items SET released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(next.id);
  return db.prepare('SELECT * FROM news_items WHERE id = ?').get(next.id);
}

function resetSampleNews(db) {
  db.exec('DELETE FROM deliveries');
  db.exec('UPDATE news_items SET released_at = NULL');
}

// ---------------------------------------------------------------------------
// 4. The delivery job: match news to holdings, send Web Push
// ---------------------------------------------------------------------------

// Finds every user who (a) holds the ticker, (b) has "notify immediately" on,
// and (c) has at least one push subscription, and sends each of their
// devices the payload that user's own preferences allow.
//
// `send(subscription, payloadString)` is injected: in the server it wraps
// web-push's sendNotification; in tests it is a fake. It should reject with
// an error carrying statusCode 404 or 410 when the push service says the
// subscription no longer exists (the user cleared site data or revoked the
// permission), in which case the stale row is deleted.
//
// CLAIM FIRST, THEN SEND. The delivery row is inserted BEFORE the push is
// sent, and the insert is the lock: if another run (or another request) has
// already claimed this user and item, the insert changes nothing and this run
// skips them. The earlier version checked for a delivery, sent, and only then
// recorded it, so two overlapping runs could both pass the check and send the
// alert twice. test/experiments/concurrency.js reproduced that before the fix.
// If nothing could be sent (a transient failure), the claim is released so a
// later run can retry.
async function deliverNews(db, newsItem, send, { concurrency = DEFAULT_SEND_CONCURRENCY } = {}) {
  const targets = db.prepare(`
    SELECT DISTINCT p.user_id, p.show_on_lock_screen
    FROM holdings h
    JOIN alert_prefs p ON p.user_id = h.user_id AND p.notify_immediately = 1
    WHERE h.ticker = ?
      AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.user_id = p.user_id AND d.news_id = ?)
  `).all(newsItem.ticker, newsItem.id);

  const claim = db.prepare("INSERT OR IGNORE INTO deliveries (user_id, news_id, status) VALUES (?, ?, 'sending')");
  const finish = db.prepare('UPDATE deliveries SET status = ? WHERE user_id = ? AND news_id = ?');
  const unclaim = db.prepare('DELETE FROM deliveries WHERE user_id = ? AND news_id = ?');

  const result = { sent: 0, failed: 0, expired: 0 };
  const subsFor = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?');
  const dropSub = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');

  async function deliverToUser(target) {
    if (claim.run(target.user_id, newsItem.id).changes === 0) return; // someone else has it

    const payload = JSON.stringify(
      buildPushPayload({ showOnLockScreen: target.show_on_lock_screen === 1 }, newsItem)
    );

    let anySent = false;
    for (const s of subsFor.all(target.user_id)) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        anySent = true;
        result.sent += 1;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          dropSub.run(s.endpoint);
          result.expired += 1;
        } else {
          console.error('Push send failed:', err && err.message);
          result.failed += 1;
        }
      }
    }
    if (anySent) finish.run('sent', target.user_id, newsItem.id);
    else unclaim.run(target.user_id, newsItem.id);
  }

  // Send to a bounded number of users at once. A real push is a network call
  // that takes tens to hundreds of milliseconds, so one at a time would make
  // the last user of a large audience wait minutes or hours; unbounded would
  // open thousands of connections at once. test/experiments/send-concurrency.js
  // measures the difference.
  for (let i = 0; i < targets.length; i += concurrency) {
    await Promise.all(targets.slice(i, i + concurrency).map(deliverToUser));
  }
  return result;
}

// A claim is only ever 'sending' for the moment a push is in flight. If the
// server stopped in that window, the claim would block that user's alert
// forever, so on start-up any leftover 'sending' claims are cleared.
function recoverStaleClaims(db) {
  return db.prepare("DELETE FROM deliveries WHERE status = 'sending'").run().changes;
}

// ---------------------------------------------------------------------------
// 5. VAPID keys (identify this server to the push service)
// ---------------------------------------------------------------------------

// The private key can send a push to every subscribed device, so it never
// leaves the server: it is read from a git-ignored file (or the environment),
// never sent to the browser and never logged. Only the public key is served,
// because the browser needs it to subscribe.
function loadVapidKeys(webpush, dir) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(dir, 'vapid-keys.json');
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  console.log('Generated new VAPID keys in vapid-keys.json (git-ignored, keep private).');
  return keys;
}

module.exports = {
  GENERIC_BODY,
  buildPushPayload,
  shapeNewsForPlan,
  releaseNextNews,
  resetSampleNews,
  deliverNews,
  recoverStaleClaims,
  MAX_HEADLINE_CHARS,
  DEFAULT_SEND_CONCURRENCY,
  loadVapidKeys
};
