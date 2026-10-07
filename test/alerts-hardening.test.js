// test/alerts-hardening.test.js
// SIT774 Task 10.3HD - problems found by experiment, now fixed and pinned.
//
// Each test here exists because an experiment in test/experiments/ showed the
// earlier code was wrong, not because the problem was guessed at in advance.
//
//   H4  a broad cross-user attack sweep leaks nothing
//   H5  two overlapping delivery runs never send the same alert twice
//   H6  a stranger cannot take over someone else's push channel
//   H3  a very long headline can never make a push too big to send

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const store = require('../lib/alerts-db');
const alerts = require('../lib/alerts');
const { createAlertsRouter } = require('../lib/alerts-routes');

function makeApp() {
  const db = new DatabaseSync(':memory:');
  store.initAlertsSchema(db);
  store.seedDemoData(db);
  const app = express();
  app.use(express.json());
  app.use('/api', createAlertsRouter({ db, send: async () => {}, publicKey: 'K', devRoutes: true }));
  const server = app.listen(0);
  return { db, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function call(base, cookie, method, path, body, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
  return { status: res.status, json, res };
}

async function signIn(base, userId) {
  const r = await call(base, null, 'POST', '/api/session', { userId });
  return r.res.headers.get('set-cookie').split(';')[0];
}

const sub = (n, keySuffix = n) => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: 'p256dh-' + keySuffix, auth: 'auth-' + keySuffix }
});

const snapshot = (db, userId) => JSON.stringify({
  holdings: store.listHoldings(db, userId),
  prefs: store.getPrefs(db, userId),
  subs: db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY endpoint').all(userId)
});

// ---------------------------------------------------------------------------

test('H4: a sweep of cross-user attacks changes and leaks nothing of the other user', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    const sam = await signIn(app.base, 2);
    await call(app.base, sam, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: true });
    await call(app.base, sam, 'POST', '/api/push/subscribe', sub('sam'));
    app.db.exec("UPDATE news_items SET released_at = '2026-10-01T00:00:00.000Z'");

    const before = snapshot(app.db, 2);
    const samOnlyTickers = ['PTL', 'KDC'];        // Sam holds them, Alex does not
    const samOnlyNews = [4, 5];                    // news about PTL and KDC
    const attempts = [];

    // Alex pointing every identifier he can think of at Sam
    for (const q of ['userId=2', 'user_id=2', 'id=2', 'user=2', 'uid=2']) {
      attempts.push(call(app.base, alex, 'GET', `/api/holdings?${q}`));
      attempts.push(call(app.base, alex, 'GET', `/api/alerts/prefs?${q}`));
      attempts.push(call(app.base, alex, 'GET', `/api/news?${q}`));
    }
    for (const h of [{ 'X-User-Id': '2' }, { 'X-Forwarded-User': '2' }, { 'X-Original-User': '2' }, { Authorization: 'Bearer 2' }]) {
      attempts.push(call(app.base, alex, 'GET', '/api/holdings', undefined, h));
    }
    for (const t of samOnlyTickers) attempts.push(call(app.base, alex, 'DELETE', `/api/holdings/${t}`));
    for (const id of samOnlyNews) attempts.push(call(app.base, alex, 'GET', `/api/news/${id}`));
    attempts.push(call(app.base, alex, 'PUT', '/api/alerts/prefs', { userId: 2, user_id: 2, notifyImmediately: false, showOnLockScreen: false }));
    attempts.push(call(app.base, alex, 'POST', '/api/holdings', { userId: 2, user_id: 2, ticker: 'ZZZ' }));
    attempts.push(call(app.base, alex, 'DELETE', '/api/push/subscribe', { userId: 2, endpoint: 'https://push.example.com/send/sam' }));
    attempts.push(call(app.base, alex, 'DELETE', '/api/alerts', { userId: 2 }));
    const results = await Promise.all(attempts);

    // Nothing of Sam's was changed...
    assert.equal(snapshot(app.db, 2), before, "Sam's holdings, preferences and subscription must be untouched");
    // ...and no SUCCESSFUL response contained Sam-only data. (An error that
    // echoes back a ticker the attacker typed, such as "You do not hold PTL.",
    // is not a leak: it only repeats their own input.)
    const leaked = results
      .filter((r) => r.status < 400)
      .filter((r) => /PTL|KDC|push\.example\.com\/send\/sam/.test(JSON.stringify(r.json)));
    assert.equal(leaked.length, 0, 'no successful response may contain data that is only Sam\'s');
    for (const r of results.filter((x) => x.res.url.includes('/news/'))) assert.equal(r.status, 404);
  } finally { app.close(); }
});

test('H4: forged, expired and malformed session cookies are all refused', async () => {
  const app = makeApp();
  try {
    await signIn(app.base, 1);
    for (const cookie of ['sw_session=deadbeef', 'sw_session=', 'sw_session=1', 'sw_session=../../etc', 'sw_session=%00', 'other=1']) {
      assert.equal((await call(app.base, cookie, 'GET', '/api/me')).status, 401, cookie);
    }
  } finally { app.close(); }
});

test('H5: two overlapping delivery runs never send the same alert twice', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
    await call(app.base, alex, 'POST', '/api/push/subscribe', sub('alex'));
    const item = app.db.prepare('SELECT * FROM news_items WHERE id = 1').get();

    let sends = 0;
    const slowSend = async () => { sends += 1; await new Promise((r) => setTimeout(r, 40)); };
    // Both runs start before either has finished sending.
    const [a, b] = await Promise.all([
      alerts.deliverNews(app.db, item, slowSend),
      alerts.deliverNews(app.db, item, slowSend)
    ]);
    assert.equal(sends, 1, 'the alert must be sent exactly once');
    assert.equal(a.sent + b.sent, 1);
  } finally { app.close(); }
});

test('H5: fifty overlapping runs still send exactly once per user', async () => {
  const app = makeApp();
  try {
    for (const id of [1, 2]) {
      const c = await signIn(app.base, id);
      await call(app.base, c, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
      await call(app.base, c, 'POST', '/api/push/subscribe', sub('u' + id));
    }
    const item = app.db.prepare('SELECT * FROM news_items WHERE id = 2').get(); // HBK: both hold it
    const sentTo = [];
    const send = async (s) => { sentTo.push(s.endpoint); await new Promise((r) => setTimeout(r, 5)); };
    await Promise.all(Array.from({ length: 50 }, () => alerts.deliverNews(app.db, item, send)));
    assert.equal(sentTo.length, 2);
    assert.equal(new Set(sentTo).size, 2);
  } finally { app.close(); }
});

test('H5: a claim left behind by a crash is cleared at start-up so the alert is not lost', async () => {
  const app = makeApp();
  try {
    app.db.prepare("INSERT INTO deliveries (user_id, news_id, status) VALUES (1, 1, 'sending')").run();
    app.db.prepare("INSERT INTO deliveries (user_id, news_id, status) VALUES (2, 2, 'sent')").run();
    assert.equal(alerts.recoverStaleClaims(app.db), 1);
    const left = app.db.prepare('SELECT user_id, status FROM deliveries').all();
    assert.deepEqual(left.map((r) => ({ ...r })), [{ user_id: 2, status: 'sent' }]);
  } finally { app.close(); }
});

test('H6: someone who only knows an endpoint cannot take over another user\'s push channel', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    const sam = await signIn(app.base, 2);
    assert.equal((await call(app.base, alex, 'POST', '/api/push/subscribe', sub('shared', 'alex-keys'))).status, 201);
    // Sam learns the endpoint but cannot know Alex's secret keys.
    const steal = await call(app.base, sam, 'POST', '/api/push/subscribe', sub('shared', 'guessed-keys'));
    assert.equal(steal.status, 409);
    const owner = app.db.prepare('SELECT user_id, auth FROM push_subscriptions').get();
    assert.equal(owner.user_id, 1);
    assert.equal(owner.auth, 'auth-alex-keys');
  } finally { app.close(); }
});

test('H6: the same browser (same endpoint and keys) can legitimately be used by another account', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    const sam = await signIn(app.base, 2);
    await call(app.base, alex, 'POST', '/api/push/subscribe', sub('browser', 'k1'));
    const moved = await call(app.base, sam, 'POST', '/api/push/subscribe', sub('browser', 'k1'));
    assert.equal(moved.status, 201);
    assert.equal(app.db.prepare('SELECT user_id FROM push_subscriptions').get().user_id, 2);
  } finally { app.close(); }
});

test('H3: a very long headline cannot make the push too large to send', () => {
  const huge = { id: 9, ticker: 'SCM', headline: 'X'.repeat(50000) };
  const payload = alerts.buildPushPayload({ showOnLockScreen: true }, huge);
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  assert.ok(bytes < 1000, `payload was ${bytes} bytes`);
  assert.ok(payload.body.endsWith('…'), 'a shortened headline is marked as shortened');
  assert.ok(payload.body.length <= 'SCM: '.length + alerts.MAX_HEADLINE_CHARS);
});

test('H3: a short headline is left exactly as written', () => {
  const news = { id: 1, ticker: 'HBK', headline: 'Harbour Bank names a new chief financial officer' };
  assert.equal(alerts.buildPushPayload({ showOnLockScreen: true }, news).body,
    'HBK: Harbour Bank names a new chief financial officer');
});

test('H3: the payload records when the server sent it, so delay can be measured', () => {
  const p = alerts.buildPushPayload({ showOnLockScreen: false }, { id: 1, ticker: 'SCM', headline: 'h' }, 1700000000000);
  assert.equal(p.sentAt, 1700000000000);
});
