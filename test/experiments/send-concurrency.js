// test/experiments/send-concurrency.js
// SIT774 Task 10.3HD - Experiment H2b: how many pushes should go out at once?
//
// HYPOTHESIS (H2b). Sending to one user at a time makes the last person in a
// large audience wait far longer than the first, and a small bounded number of
// simultaneous sends removes that wait without needing unbounded connections.
//
// METHOD. 1,000 users hold the stock, each with one subscription. The sender is
// a fake that takes a fixed 50 ms, a deliberately modest stand-in for a network
// round trip to a push service (a real one is measured in
// test/experiments/latency.js). Time how long until the LAST user has been sent
// to, at different concurrency settings.
//
// Run: node test/experiments/send-concurrency.js

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const store = require('../../lib/alerts-db');
const alerts = require('../../lib/alerts');

const USERS = 1000;
const SEND_MS = 50;

function build() {
  const db = new DatabaseSync(':memory:');
  store.initAlertsSchema(db);
  db.exec(`INSERT INTO news_items (id, ticker, headline, summary, detail, analyst_name, analyst_firm, analyst_quote, source_url)
           VALUES (1, 'SCM', 'h', 's', 'd', 'a', 'f', 'q', 'https://example.com')`);
  db.exec('BEGIN');
  const u = db.prepare("INSERT INTO users (id, name, plan) VALUES (?, 'u', 'free')");
  const h = db.prepare("INSERT INTO holdings (user_id, ticker) VALUES (?, 'SCM')");
  const p = db.prepare('INSERT INTO alert_prefs (user_id, notify_immediately, show_on_lock_screen) VALUES (?, 1, 0)');
  const s = db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= USERS; i++) { u.run(i); h.run(i); p.run(i); s.run(i, 'https://p.example/' + i, 'k', 'a'); }
  db.exec('COMMIT');
  return db;
}

(async () => {
  const rows = [];
  console.log(`\nH2b ${USERS} users, each push takes ${SEND_MS} ms\n`);
  console.log('concurrency | time until the last user is sent to | vs one at a time');
  let baseline;
  for (const concurrency of [1, 5, 25, 100]) {
    const db = build();
    const item = db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    const t = performance.now();
    const r = await alerts.deliverNews(db, item, () => new Promise((res) => setTimeout(res, SEND_MS)), { concurrency });
    const seconds = (performance.now() - t) / 1000;
    if (concurrency === 1) baseline = seconds;
    rows.push({ concurrency, seconds: Number(seconds.toFixed(2)), sent: r.sent });
    console.log(`${String(concurrency).padEnd(11)} | ${(seconds.toFixed(2) + ' s').padEnd(35)} | ${(baseline / seconds).toFixed(1)}x faster  (sent ${r.sent})`);
  }
  console.log(`\nAt the default of ${alerts.DEFAULT_SEND_CONCURRENCY}, the last of ${USERS} users is reached in ${rows.find((x) => x.concurrency === 25).seconds} s instead of ${rows[0].seconds} s.`);
  const out = path.join(__dirname, 'results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'send-concurrency.json'), JSON.stringify({ users: USERS, sendMs: SEND_MS, rows }, null, 2));
})();
