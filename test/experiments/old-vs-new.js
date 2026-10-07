// test/experiments/old-vs-new.js
// SIT774 Task 10.3HD - Experiments H3, H5, H6: three bugs, shown, then fixed.
//
// For each, the EARLIER logic is reproduced here in full next to the current
// logic and both are run, so the claim "this was a real bug" does not rest on
// my word. The earlier versions were the first, reasonable-looking drafts.
//
//   H5  Two overlapping delivery runs never send the same alert twice.
//   H6  Knowing someone's push endpoint is not enough to take over their channel.
//   H3  A very long headline can never make a push too big to send.
//       (Sizes are shown here. Whether the push service really refuses an
//       oversize push is tested against a LIVE push service in latency.js:
//       the web-push library itself does not check the size.)
//
// Run: node test/experiments/old-vs-new.js

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const store = require('../../lib/alerts-db');
const alerts = require('../../lib/alerts');

const results = {};

function freshDb() {
  const db = new DatabaseSync(':memory:');
  store.initAlertsSchema(db);
  store.seedDemoData(db);
  return db;
}

// ---------------------------------------------------------------------------
// H5. Double-send under overlapping runs
// ---------------------------------------------------------------------------

// The first draft: check for a delivery, send, THEN record it.
async function deliverNewsV1(db, newsItem, send) {
  const targets = db.prepare(`
    SELECT DISTINCT p.user_id, p.show_on_lock_screen
    FROM holdings h
    JOIN alert_prefs p ON p.user_id = h.user_id AND p.notify_immediately = 1
    WHERE h.ticker = ?
      AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.user_id = p.user_id AND d.news_id = ?)
  `).all(newsItem.ticker, newsItem.id);
  for (const target of targets) {
    const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(target.user_id);
    for (const s of subs) await send(s, '{}');
    db.prepare('INSERT OR REPLACE INTO deliveries (user_id, news_id, status) VALUES (?, ?, ?)').run(target.user_id, newsItem.id, 'sent');
  }
}

async function doubleSendTrials(deliver, trials) {
  let duplicated = 0;
  for (let i = 0; i < trials; i++) {
    const db = freshDb();
    db.prepare('INSERT INTO alert_prefs (user_id, notify_immediately, show_on_lock_screen) VALUES (1, 1, 0)').run();
    db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://p.example/1', 'k', 'a')").run();
    const item = db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    let sends = 0;
    const slow = async () => { sends += 1; await new Promise((r) => setTimeout(r, 20)); };
    // e.g. the 20-second timer firing while a "release" request is still running
    await Promise.all([deliver(db, item, slow), deliver(db, item, slow)]);
    if (sends > 1) duplicated += 1;
  }
  return duplicated;
}

// ---------------------------------------------------------------------------
// H6. Subscription takeover
// ---------------------------------------------------------------------------

// The first draft: a repeat endpoint is simply reassigned to whoever posts it.
function saveSubscriptionV1(db, userId, sub) {
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

function takeoverResult(save) {
  const db = freshDb();
  const victim = { endpoint: 'https://p.example/victim', keys: { p256dh: 'victim-p256dh', auth: 'victim-auth' } };
  save(db, 1, victim);
  // The attacker (user 2) knows the endpoint URL but not the two secret keys.
  save(db, 2, { endpoint: victim.endpoint, keys: { p256dh: 'attacker-p256dh', auth: 'attacker-auth' } });
  const row = db.prepare('SELECT user_id, auth FROM push_subscriptions').get();
  return { ownerAfterAttack: row.user_id, authAfterAttack: row.auth, takenOver: row.user_id === 2 };
}

// ---------------------------------------------------------------------------
// H3. Payload size
// ---------------------------------------------------------------------------

// The first draft: the whole headline goes into the notification text.
function buildPushPayloadV1(prefs, item) {
  return {
    title: 'StockWise',
    body: prefs.showOnLockScreen ? `${item.ticker}: ${item.headline}` : alerts.GENERIC_BODY,
    newsId: item.id,
    tag: `stockwise-news-${item.id}`
  };
}

// ---------------------------------------------------------------------------

(async () => {
  console.log('\nH5. Two overlapping delivery runs, 40 trials each');
  const v1 = await doubleSendTrials(deliverNewsV1, 40);
  const now = await doubleSendTrials(alerts.deliverNews, 40);
  console.log(`  first draft (check, send, then record): alert sent twice in ${v1}/40 trials`);
  console.log(`  current (claim, then send):             alert sent twice in ${now}/40 trials`);
  results.H5 = { trials: 40, firstDraftDuplicates: v1, currentDuplicates: now };

  console.log('\nH6. An attacker who knows only the endpoint URL tries to take over a subscription');
  const t1 = takeoverResult(saveSubscriptionV1);
  const t2 = takeoverResult(store.saveSubscription);
  console.log(`  first draft: taken over = ${t1.takenOver} (owner is now user ${t1.ownerAfterAttack})`);
  console.log(`  current:     taken over = ${t2.takenOver} (owner is still user ${t2.ownerAfterAttack})`);
  results.H6 = { firstDraft: t1, current: t2 };

  console.log('\nH3. Payload size for a long headline (Web Push guarantees delivery of about 4 KB)');
  console.log('  headline chars | first draft bytes | current bytes');
  const h3 = [];
  for (const len of [50, 120, 500, 2000, 4000, 20000]) {
    const item = { id: 1, ticker: 'SCM', headline: 'x'.repeat(len) };
    const a = Buffer.byteLength(JSON.stringify(buildPushPayloadV1({ showOnLockScreen: true }, item)));
    const b = Buffer.byteLength(JSON.stringify(alerts.buildPushPayload({ showOnLockScreen: true }, item)));
    h3.push({ len, firstDraftBytes: a, currentBytes: b });
    console.log(`  ${String(len).padEnd(14)} | ${String(a).padEnd(17)} | ${b}`);
  }
  results.H3 = h3;

  const out = path.join(__dirname, 'results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'old-vs-new.json'), JSON.stringify(results, null, 2));
})();
