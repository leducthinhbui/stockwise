// lib/alerts-routes.js
// SIT774 Task 10.3HD - Portfolio News Alerts (implementing the Task 7.3HD proposal)
//
// The HTTP API for the feature, as an Express router mounted at /api by
// server.js. It is built by a factory function so tests can hand it an
// in-memory database and a fake push sender.
//
// Security idea used throughout: the signed-in user comes ONLY from the
// server-side session cookie (requireUser below). No route reads a user id
// from the body, the URL or the query string, so changing an id in a request
// cannot reach someone else's holdings, preferences or subscriptions.

'use strict';

const crypto = require('node:crypto');
const express = require('express');
const store = require('./alerts-db');
const { shapeNewsForPlan, releaseNextNews, resetSampleNews, deliverNews } = require('./alerts');

const SESSION_COOKIE = 'sw_session';
const TICKER_PATTERN = /^[A-Z]{2,5}$/;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 256;

// Same error shape as the rest of server.js: `errors` (list) and `error`.
function fail(res, status, message) {
  return res.status(status).json({ errors: [message], error: message });
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function createAlertsRouter({ db, send, publicKey, devRoutes }) {
  const router = express.Router();

  // Prototype sign-in: a random token in an HttpOnly cookie mapped to a user
  // id in memory. HttpOnly keeps the token away from page scripts and
  // SameSite=Lax stops other sites riding on it. A real site would add a
  // password and HTTPS (the Secure flag); that is outside this task.
  const sessions = new Map();

  function requireUser(req, res, next) {
    const token = readCookie(req, SESSION_COOKIE);
    const userId = token ? sessions.get(token) : undefined;
    const user = userId ? store.getUser(db, userId) : undefined;
    if (!user) return fail(res, 401, 'Please sign in first.');
    req.user = user; // from the session, never from the request
    next();
  }

  // --- Session ---------------------------------------------------------------

  router.post('/session', (req, res) => {
    const user = store.getUser(db, Number(req.body && req.body.userId));
    if (!user) return fail(res, 400, 'Choose one of the demo accounts.');
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    res.status(201).json({ id: user.id, name: user.name, plan: user.plan });
  });

  router.delete('/session', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.status(200).json({ message: 'Signed out.' });
  });

  router.get('/me', requireUser, (req, res) => {
    const limit = store.holdingLimitFor(req.user.plan);
    res.json({
      id: req.user.id,
      name: req.user.name,
      plan: req.user.plan,
      holdingLimit: Number.isFinite(limit) ? limit : null // null means unlimited
    });
  });

  // --- Holdings (scoped to the session user) ------------------------------------

  router.get('/holdings', requireUser, (req, res) => {
    res.json({ holdings: store.listHoldings(db, req.user.id) });
  });

  router.post('/holdings', requireUser, (req, res) => {
    const ticker = String((req.body && req.body.ticker) || '').trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) {
      return fail(res, 400, 'A ticker is 2 to 5 letters, for example HBK.');
    }
    const outcome = store.addHolding(db, req.user, ticker);
    if (outcome === 'exists') return fail(res, 409, `You already hold ${ticker}.`);
    if (outcome === 'limit') {
      return fail(res, 403,
        `Your ${req.user.plan} plan covers up to ${store.holdingLimitFor(req.user.plan)} holdings.`);
    }
    res.status(201).json({ holdings: store.listHoldings(db, req.user.id) });
  });

  router.delete('/holdings/:ticker', requireUser, (req, res) => {
    const ticker = String(req.params.ticker).toUpperCase();
    if (!store.removeHolding(db, req.user.id, ticker)) {
      return fail(res, 404, `You do not hold ${ticker}.`);
    }
    res.json({ holdings: store.listHoldings(db, req.user.id) });
  });

  // --- Alert preferences (the stored intent) -----------------------------------

  router.get('/alerts/prefs', requireUser, (req, res) => {
    res.json({
      ...store.getPrefs(db, req.user.id),
      subscriptionCount: store.countSubscriptions(db, req.user.id)
    });
  });

  router.put('/alerts/prefs', requireUser, (req, res) => {
    const { notifyImmediately, showOnLockScreen } = req.body || {};
    if (typeof notifyImmediately !== 'boolean' || typeof showOnLockScreen !== 'boolean') {
      return fail(res, 400, 'Both notifyImmediately and showOnLockScreen must be true or false.');
    }
    store.setPrefs(db, req.user.id, { notifyImmediately, showOnLockScreen });
    // Turning alerts off removes the stored push channel on the server as
    // well, so a client that forgets to unsubscribe cannot leave one behind.
    // showOnLockScreen is deliberately left as the user set it.
    if (!notifyImmediately) store.deleteSubscriptions(db, req.user.id);
    res.json({
      ...store.getPrefs(db, req.user.id),
      subscriptionCount: store.countSubscriptions(db, req.user.id)
    });
  });

  // "Delete my alert data": preferences and all subscriptions.
  router.delete('/alerts', requireUser, (req, res) => {
    const removed = store.deleteAlertData(db, req.user.id);
    res.json({ message: 'Your alert settings and subscriptions were deleted.', subscriptionsRemoved: removed });
  });

  // --- Push subscription ---------------------------------------------------------

  // The public key is not secret: the browser needs it to subscribe. The
  // private key stays on the server (see loadVapidKeys in lib/alerts.js).
  router.get('/push/public-key', (req, res) => {
    res.json({ publicKey });
  });

  router.post('/push/subscribe', requireUser, (req, res) => {
    const sub = req.body || {};
    const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
    const keys = sub.keys || {};
    let url;
    try { url = new URL(endpoint); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || endpoint.length > MAX_ENDPOINT_LENGTH) {
      return fail(res, 400, 'A valid https push endpoint is required.');
    }
    for (const k of ['p256dh', 'auth']) {
      if (typeof keys[k] !== 'string' || keys[k] === '' || keys[k].length > MAX_KEY_LENGTH) {
        return fail(res, 400, 'The push subscription keys are missing or invalid.');
      }
    }
    const stored = store.saveSubscription(db, req.user.id, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    if (!stored) return fail(res, 409, 'That push subscription is already registered.');
    res.status(201).json({ subscriptionCount: store.countSubscriptions(db, req.user.id) });
  });

  router.delete('/push/subscribe', requireUser, (req, res) => {
    const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : undefined;
    store.deleteSubscriptions(db, req.user.id, endpoint);
    res.json({ subscriptionCount: store.countSubscriptions(db, req.user.id) });
  });

  // --- News ---------------------------------------------------------------------

  // The in-app "For your portfolio" list. This is also the fallback for
  // browsers that cannot receive push (for example iOS Safari outside an
  // installed home-screen app): they still see every alert, just not instantly.
  router.get('/news', requireUser, (req, res) => {
    res.json({ news: store.listNewsForUser(db, req.user.id) });
  });

  router.get('/news/:id', requireUser, (req, res) => {
    const item = store.getNewsForUser(db, req.user.id, Number(req.params.id));
    // Same 404 whether the item doesn't exist, isn't released, or is about a
    // stock this user doesn't hold: the response never confirms which.
    if (!item) return fail(res, 404, 'No such news item.');
    res.json(shapeNewsForPlan(item, req.user.plan));
  });

  // --- Demo controls (never mounted when NODE_ENV is "production") -----------------

  if (devRoutes) {
    // Stands in for "news just broke": releases the next sample item for a
    // stock the signed-in user holds, then runs the real delivery job.
    router.post('/dev/release-news', requireUser, async (req, res) => {
      try {
        const item = releaseNextNews(db, req.user.id);
        if (!item) {
          return res.json({ released: null, message: 'No unreleased sample news left for your holdings. Reset the sample news to run the demo again.' });
        }
        const delivered = await deliverNews(db, item, send);
        res.status(201).json({ released: { id: item.id, ticker: item.ticker }, delivered });
      } catch (err) {
        console.error('Release failed:', err.message);
        fail(res, 500, 'Could not release the sample news.');
      }
    });

    router.post('/dev/reset-news', requireUser, (req, res) => {
      resetSampleNews(db);
      res.json({ message: 'Sample news reset.' });
    });
  }

  return router;
}

module.exports = { createAlertsRouter, SESSION_COOKIE };
