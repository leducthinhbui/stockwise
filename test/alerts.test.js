// test/alerts.test.js
// SIT774 Task 10.3HD - tests for Portfolio News Alerts.
//
// Each test pins down one claim made in the Task 7.3HD proposal, so that
// "every query is scoped to the session" and "the lock screen names nothing"
// are checked by the code rather than only asserted in prose.
//
// Run with: npm test   (uses Node's built-in test runner and an in-memory
// SQLite database, so it never touches stockwise.db)

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const store = require('../lib/alerts-db');
const alerts = require('../lib/alerts');
const { createAlertsRouter } = require('../lib/alerts-routes');

// A throwaway app: fresh in-memory database, demo seed, and a fake push
// sender that records what it was asked to send instead of contacting a
// real push service.
function makeApp(options = {}) {
  const db = new DatabaseSync(':memory:');
  store.initAlertsSchema(db);
  store.seedDemoData(db);
  const sent = [];
  const send = options.send || (async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createAlertsRouter({
    db, send, publicKey: 'TEST_PUBLIC_KEY', devRoutes: options.devRoutes !== false
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, sent, base, close: () => server.close() };
}

async function call(base, cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* an HTML 404 from a missing route is fine */ }
  return { status: res.status, json, res };
}

async function signIn(base, userId) {
  const r = await call(base, null, 'POST', '/api/session', { userId });
  assert.equal(r.status, 201);
  return r.res.headers.get('set-cookie').split(';')[0]; // "sw_session=<token>"
}

const fakeSub = (n) => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: 'p256dh-key-' + n, auth: 'auth-key-' + n }
});

function releaseAll(db) {
  db.exec("UPDATE news_items SET released_at = '2026-10-01T00:00:00.000Z'");
}

// ---------------------------------------------------------------------------

test('every personal route refuses a request with no session', async () => {
  const app = makeApp();
  try {
    const checks = [
      ['GET', '/api/me'], ['GET', '/api/holdings'], ['GET', '/api/alerts/prefs'],
      ['GET', '/api/news'], ['GET', '/api/news/1'],
      ['PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false }],
      ['POST', '/api/push/subscribe', fakeSub(1)], ['DELETE', '/api/alerts']
    ];
    for (const [method, path, body] of checks) {
      const r = await call(app.base, null, method, path, body);
      assert.equal(r.status, 401, `${method} ${path} should be 401`);
    }
  } finally { app.close(); }
});

test('the public key is available without signing in, and is only the public key', async () => {
  const app = makeApp();
  try {
    const r = await call(app.base, null, 'GET', '/api/push/public-key');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { publicKey: 'TEST_PUBLIC_KEY' });
  } finally { app.close(); }
});

test('signing in reports the plan, and signing out ends the session', async () => {
  const app = makeApp();
  try {
    const cookie = await signIn(app.base, 1);
    const me = await call(app.base, cookie, 'GET', '/api/me');
    assert.equal(me.json.plan, 'free');
    assert.equal(me.json.holdingLimit, 5);
    await call(app.base, cookie, 'DELETE', '/api/session');
    assert.equal((await call(app.base, cookie, 'GET', '/api/me')).status, 401);
  } finally { app.close(); }
});

test('an unknown demo user cannot sign in', async () => {
  const app = makeApp();
  try {
    assert.equal((await call(app.base, null, 'POST', '/api/session', { userId: 999 })).status, 400);
  } finally { app.close(); }
});

test('the plan holding cap is enforced on the server', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1); // free: 5 holdings, starts with 3
    assert.equal((await call(app.base, alex, 'POST', '/api/holdings', { ticker: 'AAA' })).status, 201);
    assert.equal((await call(app.base, alex, 'POST', '/api/holdings', { ticker: 'BBB' })).status, 201);
    const over = await call(app.base, alex, 'POST', '/api/holdings', { ticker: 'CCC' });
    assert.equal(over.status, 403);
    assert.match(over.json.error, /free plan covers up to 5/);
    assert.equal((await call(app.base, alex, 'POST', '/api/holdings', { ticker: 'AAA' })).status, 409);
    assert.equal((await call(app.base, alex, 'POST', '/api/holdings', { ticker: 'not a ticker' })).status, 400);
  } finally { app.close(); }
});

test('a user id in the request cannot reach another user (IDOR)', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    // Asking for user 2's holdings through the query string changes nothing.
    const list = await call(app.base, alex, 'GET', '/api/holdings?userId=2&user_id=2');
    assert.deepEqual(list.json.holdings, ['HBK', 'MRH', 'SCM']);
    // A userId in the body is ignored: the row is created for the session user.
    await call(app.base, alex, 'POST', '/api/holdings', { userId: 2, ticker: 'ZZZ' });
    assert.deepEqual(store.listHoldings(app.db, 2), ['HBK', 'KDC', 'PTL']);
    assert.ok(store.listHoldings(app.db, 1).includes('ZZZ'));
    // Same for preferences.
    await call(app.base, alex, 'PUT', '/api/alerts/prefs',
      { userId: 2, notifyImmediately: true, showOnLockScreen: true });
    assert.deepEqual(store.getPrefs(app.db, 2), { notifyImmediately: false, showOnLockScreen: false });
  } finally { app.close(); }
});

test('news is only visible for stocks the user holds, and only once released', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1); // SCM, HBK, MRH
    // Nothing released yet: even a stock Alex holds is a 404.
    assert.equal((await call(app.base, alex, 'GET', '/api/news/1')).status, 404);
    releaseAll(app.db);
    assert.equal((await call(app.base, alex, 'GET', '/api/news/1')).status, 200);
    // Item 5 is about KDC, which Alex does not hold: same 404 as "doesn't exist".
    assert.equal((await call(app.base, alex, 'GET', '/api/news/5')).status, 404);
    assert.equal((await call(app.base, alex, 'GET', '/api/news/999')).status, 404);
    const list = await call(app.base, alex, 'GET', '/api/news');
    assert.deepEqual(list.json.news.map((n) => n.id).sort(), [1, 2, 3, 6]);
  } finally { app.close(); }
});

test('Free sees the summary; Standard sees the full explanation and the attributed analyst comment', async () => {
  const app = makeApp();
  try {
    releaseAll(app.db);
    const alex = await signIn(app.base, 1); // free
    const sam = await signIn(app.base, 2);  // standard
    const free = (await call(app.base, alex, 'GET', '/api/news/2')).json;   // HBK, held by both
    const paid = (await call(app.base, sam, 'GET', '/api/news/2')).json;
    assert.equal(free.fullExplanation, false);
    assert.ok(free.summary);
    assert.equal(free.detail, undefined);
    assert.equal(free.analyst, undefined);
    assert.equal(paid.fullExplanation, true);
    assert.ok(paid.detail);
    assert.ok(paid.analyst.name && paid.analyst.firm && paid.analyst.quote && paid.analyst.sourceUrl);
  } finally { app.close(); }
});

test('the default notification is generic: no ticker, no headline', () => {
  const news = { id: 2, ticker: 'HBK', headline: 'Harbour Bank names a new chief financial officer' };
  const payload = alerts.buildPushPayload({ showOnLockScreen: false }, news);
  assert.equal(payload.body, alerts.GENERIC_BODY);
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes('HBK'), 'ticker must not be in a generic payload');
  assert.ok(!serialised.includes('Harbour'), 'headline must not be in a generic payload');
});

test('a user who opted in gets the specific text, and only the headline', () => {
  const news = {
    id: 2, ticker: 'HBK', headline: 'Harbour Bank names a new chief financial officer',
    analyst_quote: 'SECRET-ANALYST-TEXT', detail: 'SECRET-DETAIL'
  };
  const payload = alerts.buildPushPayload({ showOnLockScreen: true }, news);
  assert.equal(payload.body, 'HBK: Harbour Bank names a new chief financial officer');
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes('SECRET'), 'plan-gated depth never travels in the push');
});

test('delivery goes only to holders who turned alerts on and have a subscription, each with their own lock-screen choice', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    const sam = await signIn(app.base, 2);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    await call(app.base, sam, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: true });
    await call(app.base, sam, 'POST', '/api/push/subscribe', fakeSub('sam'));

    // Item 2 (HBK) is held by both; item 5 (KDC) only by Sam.
    const hbk = app.db.prepare('SELECT * FROM news_items WHERE id = 2').get();
    const result = await alerts.deliverNews(app.db, hbk, async (sub, payload) => {
      app.sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
    assert.equal(result.sent, 2);
    const alexMsg = app.sent.find((m) => m.endpoint.endsWith('/alex')).payload;
    const samMsg = app.sent.find((m) => m.endpoint.endsWith('/sam')).payload;
    assert.equal(alexMsg.body, alerts.GENERIC_BODY);
    assert.match(samMsg.body, /^HBK: /);

    app.sent.length = 0;
    const kdc = app.db.prepare('SELECT * FROM news_items WHERE id = 5').get();
    await alerts.deliverNews(app.db, kdc, async (sub, payload) => {
      app.sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
    assert.deepEqual(app.sent.map((m) => m.endpoint), ['https://push.example.com/send/sam']);
  } finally { app.close(); }
});

test('running the delivery job twice never sends the same alert twice', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    const item = app.db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    const send = async (sub, payload) => { app.sent.push(JSON.parse(payload)); };
    assert.equal((await alerts.deliverNews(app.db, item, send)).sent, 1);
    assert.equal((await alerts.deliverNews(app.db, item, send)).sent, 0);
    assert.equal(app.sent.length, 1);
  } finally { app.close(); }
});

test('a user who holds the stock but has alerts off is not sent anything', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    // Alex never turned "notify immediately" on.
    const item = app.db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    const result = await alerts.deliverNews(app.db, item, async () => { throw new Error('should not send'); });
    assert.equal(result.sent, 0);
  } finally { app.close(); }
});

test('a subscription the push service reports as gone (410) is deleted', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    const item = app.db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    const result = await alerts.deliverNews(app.db, item, async () => {
      const e = new Error('gone'); e.statusCode = 410; throw e;
    });
    assert.equal(result.expired, 1);
    assert.equal(store.countSubscriptions(app.db, 1), 0);
  } finally { app.close(); }
});

test('a transient push failure keeps the subscription and allows a retry', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    const item = app.db.prepare('SELECT * FROM news_items WHERE id = 1').get();
    const failed = await alerts.deliverNews(app.db, item, async () => {
      const e = new Error('push service unavailable'); e.statusCode = 503; throw e;
    });
    assert.equal(failed.failed, 1);
    assert.equal(store.countSubscriptions(app.db, 1), 1);
    const retried = await alerts.deliverNews(app.db, item, async () => {});
    assert.equal(retried.sent, 1);
  } finally { app.close(); }
});

test('turning alerts off deletes the stored subscription but keeps the lock-screen choice', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: true });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    assert.equal(store.countSubscriptions(app.db, 1), 1);
    const off = await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: false, showOnLockScreen: true });
    assert.equal(off.json.subscriptionCount, 0, 'the push channel must be gone, not just unused');
    assert.deepEqual(store.getPrefs(app.db, 1), { notifyImmediately: false, showOnLockScreen: true });
    // Turning it back on restores the earlier lock-screen choice.
    const on = await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: true });
    assert.equal(on.json.showOnLockScreen, true);
  } finally { app.close(); }
});

test('"delete my alert data" removes preferences and every subscription', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: true });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('a'));
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('b'));
    const r = await call(app.base, alex, 'DELETE', '/api/alerts');
    assert.equal(r.json.subscriptionsRemoved, 2);
    assert.deepEqual(store.getPrefs(app.db, 1), { notifyImmediately: false, showOnLockScreen: false });
  } finally { app.close(); }
});

test('subscription input is validated', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    const bad = [
      { endpoint: 'http://push.example.com/x', keys: { p256dh: 'a', auth: 'b' } }, // not https
      { endpoint: 'not a url', keys: { p256dh: 'a', auth: 'b' } },
      { endpoint: 'https://push.example.com/x', keys: { p256dh: 'a' } },            // missing auth
      {}
    ];
    for (const body of bad) {
      assert.equal((await call(app.base, alex, 'POST', '/api/push/subscribe', body)).status, 400);
    }
    assert.equal(store.countSubscriptions(app.db, 1), 0);
  } finally { app.close(); }
});

test('preferences must be real booleans', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    assert.equal((await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: 'yes', showOnLockScreen: false })).status, 400);
    assert.equal((await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true })).status, 400);
  } finally { app.close(); }
});

test('the demo "release news" control runs the real delivery path end to end', async () => {
  const app = makeApp();
  try {
    const alex = await signIn(app.base, 1);
    await call(app.base, alex, 'PUT', '/api/alerts/prefs', { notifyImmediately: true, showOnLockScreen: false });
    await call(app.base, alex, 'POST', '/api/push/subscribe', fakeSub('alex'));
    const r = await call(app.base, alex, 'POST', '/api/dev/release-news');
    assert.equal(r.status, 201);
    assert.equal(r.json.released.ticker, 'SCM');
    assert.equal(r.json.delivered.sent, 1);
    assert.equal(app.sent[0].payload.body, alerts.GENERIC_BODY);
    // The released item now shows in Alex's in-app list.
    const list = await call(app.base, alex, 'GET', '/api/news');
    assert.deepEqual(list.json.news.map((n) => n.id), [1]);
    // Reset puts the sample news back, so the demo can be run again.
    await call(app.base, alex, 'POST', '/api/dev/reset-news');
    assert.deepEqual((await call(app.base, alex, 'GET', '/api/news')).json.news, []);
  } finally { app.close(); }
});

test('the demo controls do not exist when devRoutes is off (production)', async () => {
  const app = makeApp({ devRoutes: false });
  try {
    const alex = await signIn(app.base, 1);
    assert.equal((await call(app.base, alex, 'POST', '/api/dev/release-news')).status, 404);
    assert.equal((await call(app.base, alex, 'POST', '/api/dev/reset-news')).status, 404);
  } finally { app.close(); }
});
