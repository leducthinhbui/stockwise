// test/experiments/fanout-scale.js
// SIT774 Task 10.3HD - Experiment H2: does matching news to holders scale?
//
// HYPOTHESIS (H2). When news breaks, finding every user who holds the ticker and
// sending them an alert takes time proportional to the number of AFFECTED users,
// not to the total number of rows in the database, so a site with 50,000 users
// can still process a news item about one stock in well under a second.
//
// METHOD. In-memory databases of 1,000 / 10,000 / 50,000 users, each holding the
// news ticker plus four others (so one news item matches EVERY user: the worst
// case for the send loop), each with alerts on and one subscription. Time the
// whole deliverNews run with an instant fake sender, and time the matching query
// on its own. Then also time a NARROW case: the news ticker is held by only
// 1% of users, which is the realistic one. Repeat 5 times, report the median.
// Run once WITH the two indexes and once WITHOUT, and print SQLite's own query
// plan so the cause is visible, not guessed.
//
// Run: node test/experiments/fanout-scale.js        (about 5 minutes: the no-index runs are the slow part)
//      node test/experiments/fanout-scale.js --quick (skips the 50,000-user cases)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const store = require('../../lib/alerts-db');
const alerts = require('../../lib/alerts');

const TICKERS = ['SCM', 'HBK', 'MRH', 'PTL', 'KDC', 'AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ'];
const MATCHING_SQL = `
  SELECT DISTINCT p.user_id, p.show_on_lock_screen
  FROM holdings h
  JOIN alert_prefs p ON p.user_id = h.user_id AND p.notify_immediately = 1
  WHERE h.ticker = ?
    AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)
    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.user_id = p.user_id AND d.news_id = ?)`;

function build(n, withIndexes, fractionHoldingSCM) {
  const db = new DatabaseSync(':memory:');
  store.initAlertsSchema(db);
  if (!withIndexes) {
    db.exec('DROP INDEX IF EXISTS idx_holdings_ticker; DROP INDEX IF EXISTS idx_push_subscriptions_user;');
  }
  db.exec(`INSERT INTO news_items (id, ticker, headline, summary, detail, analyst_name, analyst_firm, analyst_quote, source_url)
           VALUES (1, 'SCM', 'Test headline', 's', 'd', 'a', 'f', 'q', 'https://example.com')`);
  db.exec('BEGIN');
  const addUser = db.prepare("INSERT INTO users (id, name, plan) VALUES (?, ?, 'free')");
  const addHold = db.prepare('INSERT INTO holdings (user_id, ticker) VALUES (?, ?)');
  const addPref = db.prepare('INSERT INTO alert_prefs (user_id, notify_immediately, show_on_lock_screen) VALUES (?, 1, 0)');
  const addSub = db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)');
  for (let u = 1; u <= n; u++) {
    addUser.run(u, 'user' + u);
    const holdsSCM = u <= Math.max(1, Math.round(n * fractionHoldingSCM));
    if (holdsSCM) addHold.run(u, 'SCM');
    for (let k = 0; k < 4; k++) addHold.run(u, TICKERS[1 + ((u + k) % (TICKERS.length - 1))]);
    addPref.run(u);
    addSub.run(u, 'https://push.example.com/send/' + u, 'p' + u, 'a' + u);
  }
  db.exec('COMMIT');
  return db;
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x) => Number(x.toFixed(2));

async function measure(n, withIndexes, fraction) {
  const runs = [];
  const queryRuns = [];
  for (let i = 0; i < 5; i++) {
    const db = build(n, withIndexes, fraction);
    const item = db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    const q = db.prepare(MATCHING_SQL);
    let t = performance.now();
    const matched = q.all('SCM', 1).length;
    queryRuns.push(performance.now() - t);
    t = performance.now();
    const result = await alerts.deliverNews(db, item, async () => {});
    runs.push(performance.now() - t);
    if (i === 0) var info = { matched, sent: result.sent };
    if (i === 0 && n === 1000 && fraction === 1) {
      var plan = db.prepare('EXPLAIN QUERY PLAN ' + MATCHING_SQL).all('SCM', 1).map((r) => r.detail);
    }
  }
  return { n, withIndexes, fraction, matched: info.matched, sent: info.sent,
    deliverMs: ms(median(runs)), queryMs: ms(median(queryRuns)), plan };
}

(async () => {
  const rows = [];
  // --quick skips the 50,000-user cases (the slow ones without indexes take minutes).
  const quick = process.argv.includes('--quick');
  const cases = quick ? [[1000, 1], [10000, 1], [10000, 0.01]]
                      : [[1000, 1], [10000, 1], [50000, 1], [10000, 0.01], [50000, 0.01]];
  for (const withIndexes of [false, true]) {
    for (const [n, fraction] of cases) {
      rows.push(await measure(n, withIndexes, fraction));
    }
  }
  console.log('\nH2 delivery job at scale (median of 5 runs, fake instant sender)\n');
  console.log('indexes | users  | holding the stock | matched | job total ms | matching query ms');
  for (const r of rows) {
    console.log(`${r.withIndexes ? 'yes    ' : 'no     '} | ${String(r.n).padEnd(6)} | ${String(Math.round(r.fraction * 100) + '%').padEnd(17)} | ${String(r.matched).padEnd(7)} | ${String(r.deliverMs).padEnd(12)} | ${r.queryMs}`);
  }
  const planNo = rows.find((r) => !r.withIndexes && r.plan).plan;
  const planYes = rows.find((r) => r.withIndexes && r.plan).plan;
  console.log('\nSQLite query plan WITHOUT indexes:\n  ' + planNo.join('\n  '));
  console.log('\nSQLite query plan WITH indexes:\n  ' + planYes.join('\n  '));

  const out = path.join(__dirname, 'results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'fanout-scale.json'), JSON.stringify({ rows, planNo, planYes }, null, 2));
})();
