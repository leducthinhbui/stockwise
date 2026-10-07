// lib/alerts-db.js
// SIT774 Task 10.3HD - Portfolio News Alerts (implementing the Task 7.3HD proposal)
//
// Data layer for the feature: the schema, the plan limits, a small demo seed,
// and the queries the routes use.
//
// One rule runs through every function that touches personal data
// (holdings, preferences, push subscriptions): it takes the user id as an
// argument and puts it in the WHERE clause. The id always comes from the
// server-side session (see lib/alerts-routes.js), never from the request
// body or URL. That is the defence against an insecure direct object
// reference (IDOR): there is simply no query that could return another
// user's rows, whatever the client sends.

'use strict';

// What each plan buys is DEPTH and BREADTH, never speed (Task 7.3HD, Step 6):
// the alert itself is instant for every plan. Free covers 5 holdings,
// Standard 30, Full is unlimited, the same caps as the plans table on
// plans.html.
const PLAN_HOLDING_LIMITS = { free: 5, standard: 30, full: Infinity };

// Only these plans get the full explanation and the analyst commentary.
const FULL_EXPLANATION_PLANS = new Set(['standard', 'full']);

function initAlertsSchema(db) {
  // Node's built-in SQLite leaves foreign keys off unless asked.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL CHECK (plan IN ('free', 'standard', 'full'))
    );

    -- Which stocks each user holds. This is the sensitive table (identity
    -- plus wealth signal), so it is only ever read through the scoped
    -- helpers below.
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      UNIQUE (user_id, ticker)
    );

    -- The user's INTENT, stored on the server. Whether a notification can
    -- actually be shown also depends on the browser's own permission, which
    -- can change outside the app, so the page reads both (public/js/alerts.js).
    -- show_on_lock_screen is kept even when notify_immediately is switched
    -- off, so turning alerts back on restores the earlier choice.
    CREATE TABLE IF NOT EXISTS alert_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      notify_immediately INTEGER NOT NULL DEFAULT 0,
      show_on_lock_screen INTEGER NOT NULL DEFAULT 0
    );

    -- One row per browser/device the user turned alerts on for. The
    -- endpoint is a live channel to that device, so these rows are deleted,
    -- not just ignored, when alerts are turned off.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL
    );

    -- The news. In production this table would be filled by a job polling a
    -- licensed news API. In this prototype it holds a few clearly fictional
    -- sample items; released_at stays NULL until one is "released" (see
    -- releaseNextNews), which stands in for "the news just broke".
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY,
      ticker TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      analyst_name TEXT NOT NULL,
      analyst_firm TEXT NOT NULL,
      analyst_quote TEXT NOT NULL,
      source_url TEXT NOT NULL,
      released_at TEXT,
      -- The raw, jargon-heavy wire copy the plain-English explanation is
      -- written from, and who wrote the explanation ('template' or 'ai').
      source_text TEXT,
      explained_by TEXT NOT NULL DEFAULT 'template'
    );

    -- Which user has already been sent which item, so a re-run of the
    -- delivery job never sends the same alert twice.
    CREATE TABLE IF NOT EXISTS deliveries (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      news_id INTEGER NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      PRIMARY KEY (user_id, news_id)
    );

    -- The delivery job asks "who holds THIS ticker" and "does this user have
    -- a subscription". Without these two indexes SQLite scans the whole table
    -- for both (measured in test/experiments/fanout-scale.js), so they are
    -- there because an experiment showed the need, not by habit.
    CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings (ticker);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);
  `);

  // A database created by an earlier version has no source_text/explained_by.
  ensureColumn(db, 'news_items', 'source_text', 'TEXT');
  ensureColumn(db, 'news_items', 'explained_by', "TEXT NOT NULL DEFAULT 'template'");
}

function ensureColumn(db, table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Sample data only. Company names and tickers are invented, and the
// "analyst" quotes are written for this demo and attributed to an invented
// firm, so nothing here puts words in the mouth of a real company or analyst.
// None of it is real news. Every explanation describes what happened and
// never what will happen next (the site never forecasts or recommends).
const SAMPLE_NEWS = [
  {
    id: 1, ticker: 'SCM',
    source_text: 'SCM June qtr: shipped 4.1Mt (prev. record 3.8Mt, Mar qtr). Realised price flat on prior qtr. Unit cost A$62/t, unchanged. FY guidance not updated in this release.',
    headline: 'Southern Cross Mining reports its highest quarterly shipments',
    summary: 'Southern Cross Mining said it shipped more ore this quarter than in any earlier quarter.',
    detail: 'A shipment figure counts how much product a miner physically sent to customers in a period. ' +
      'Southern Cross Mining reported the largest quarterly figure in its history. Shipments are reported ' +
      'separately from profit: profit also depends on the price received and the cost of digging, so this ' +
      'number alone does not say how much the company earned.',
    analyst_name: 'Priya Nair', analyst_firm: 'Example Securities (fictional)',
    analyst_quote: 'Shipments for the quarter were above the figure we had in our own model.',
    source_url: 'https://example.com/sample-news/scm-shipments'
  },
  {
    id: 2, ticker: 'HBK',
    source_text: 'HBK ASX release: Ms R. Tan, CFO, to step down effective 31 Dec. Mr D. Kaur, currently Group Treasurer, appointed CFO from 1 Jan. Board thanks Ms Tan. No change to results timetable.',
    headline: 'Harbour Bank names a new chief financial officer',
    summary: 'Harbour Bank announced that its chief financial officer will be replaced by an internal appointment.',
    detail: 'The chief financial officer is the executive responsible for the company\'s accounts and ' +
      'financial reporting. Harbour Bank said the role will be filled by someone already working at the bank. ' +
      'A change of officer is an announcement about who does the job; it is not, by itself, a result or a ' +
      'financial figure.',
    analyst_name: 'Daniel Okafor', analyst_firm: 'Example Securities (fictional)',
    analyst_quote: 'The bank has chosen an internal candidate, which is the more common route.',
    source_url: 'https://example.com/sample-news/hbk-cfo'
  },
  {
    id: 3, ticker: 'MRH',
    source_text: 'MRH declares interim dividend 14.0c per share fully franked. Record date 15 Oct, payment date 29 Oct. Prior interim dividend: 14.0c fully franked.',
    headline: 'Meridian Health pays a fully franked dividend',
    summary: 'Meridian Health paid a dividend with the full franking credit attached.',
    detail: 'A dividend is a share of profit paid to shareholders. "Fully franked" means the company has ' +
      'already paid tax on those profits, and passes a credit for that tax on to you so the same profit is ' +
      'not taxed twice. The credit appears on your annual tax statement, separate from the cash you receive.',
    analyst_name: 'Lena Hoffmann', analyst_firm: 'Sample Research Group (fictional)',
    analyst_quote: 'The dividend per share matches the amount paid for the previous half.',
    source_url: 'https://example.com/sample-news/mrh-dividend'
  },
  {
    id: 4, ticker: 'PTL',
    source_text: 'Regulator approves PTL application to transfer 3.5GHz spectrum licence block (regional area). Approval effective on registration of transfer. Consideration not disclosed.',
    headline: 'Pacific Telecom receives regulator approval for a spectrum transfer',
    summary: 'The communications regulator approved Pacific Telecom\'s transfer of a block of radio spectrum.',
    detail: 'Spectrum is the range of radio frequencies that mobile networks use to carry calls and data, and ' +
      'it is licensed by a regulator. Pacific Telecom asked to transfer a block of its licence, and the ' +
      'regulator approved the request. The approval is a permission; it does not state a price or a result.',
    analyst_name: 'Marcus Webb', analyst_firm: 'Sample Research Group (fictional)',
    analyst_quote: 'This approval had been listed as a pending item in the company\'s last report.',
    source_url: 'https://example.com/sample-news/ptl-spectrum'
  },
  {
    id: 5, ticker: 'KDC',
    source_text: 'KDC half-year results to 31 Dec: revenue A$1.82b (pcp A$1.74b), NPAT A$96m (pcp A$91m), interim dividend 9.0c (pcp 8.5c). Net debt A$410m.',
    headline: 'Kiwi Dairy Co releases its half-year results',
    summary: 'Kiwi Dairy Co published its half-year financial results.',
    detail: 'Half-year results are a company\'s accounts for the first six months of its financial year: ' +
      'revenue (what it sold), expenses, and profit (what is left). Listed companies must publish them. ' +
      'This explanation covers what the report contains; the figures themselves are in the company\'s own release.',
    analyst_name: 'Priya Nair', analyst_firm: 'Example Securities (fictional)',
    analyst_quote: 'Revenue for the half was within the range the company described at its last update.',
    source_url: 'https://example.com/sample-news/kdc-results'
  },
  {
    id: 6, ticker: 'SCM',
    source_text: 'SCM advises scheduled 12-day maintenance shutdown at Mount Ridley site from 3 Nov. Notice given under continuous disclosure obligations. Other sites unaffected.',
    headline: 'Southern Cross Mining schedules maintenance at one of its sites',
    summary: 'Southern Cross Mining said one site will pause for planned maintenance.',
    detail: 'Mines stop for planned maintenance so equipment can be inspected and repaired. The company said ' +
      'which site is affected and for how long. A scheduled stop is routine and announced in advance, which ' +
      'is different from an unplanned stop caused by a fault or an accident.',
    analyst_name: 'Daniel Okafor', analyst_firm: 'Example Securities (fictional)',
    analyst_quote: 'The company gave the same type of notice before its previous maintenance period.',
    source_url: 'https://example.com/sample-news/scm-maintenance'
  }
];

const DEMO_USERS = [
  { id: 1, name: 'Alex Demo', plan: 'free', holdings: ['SCM', 'HBK', 'MRH'] },
  { id: 2, name: 'Sam Demo', plan: 'standard', holdings: ['HBK', 'PTL', 'KDC'] }
];

// Inserts the demo users and sample news once, on an empty database.
function seedDemoData(db) {
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (!hasUsers) {
    const addUser = db.prepare('INSERT INTO users (id, name, plan) VALUES (?, ?, ?)');
    const addHolding = db.prepare('INSERT INTO holdings (user_id, ticker) VALUES (?, ?)');
    for (const u of DEMO_USERS) {
      addUser.run(u.id, u.name, u.plan);
      for (const t of u.holdings) addHolding.run(u.id, t);
    }
  }
  const hasNews = db.prepare('SELECT COUNT(*) AS n FROM news_items').get().n > 0;
  if (!hasNews) {
    const addNews = db.prepare(`
      INSERT INTO news_items (id, ticker, headline, summary, detail,
        analyst_name, analyst_firm, analyst_quote, source_url, source_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const n of SAMPLE_NEWS) {
      addNews.run(n.id, n.ticker, n.headline, n.summary, n.detail,
        n.analyst_name, n.analyst_firm, n.analyst_quote, n.source_url, n.source_text);
    }
  } else {
    const backfill = db.prepare('UPDATE news_items SET source_text = ? WHERE id = ? AND source_text IS NULL');
    for (const n of SAMPLE_NEWS) backfill.run(n.source_text, n.id);
  }
}

// ---------------------------------------------------------------------------
// Scoped queries. Every one is keyed by the session's userId.
// ---------------------------------------------------------------------------

function getUser(db, userId) {
  return db.prepare('SELECT id, name, plan FROM users WHERE id = ?').get(userId);
}

function listHoldings(db, userId) {
  return db.prepare('SELECT ticker FROM holdings WHERE user_id = ? ORDER BY ticker')
    .all(userId).map((r) => r.ticker);
}

function holdingLimitFor(plan) {
  return PLAN_HOLDING_LIMITS[plan] ?? PLAN_HOLDING_LIMITS.free;
}

// Returns 'added', 'exists' or 'limit'. The cap is enforced here on the
// server, not only in the page, because the page can be bypassed.
function addHolding(db, user, ticker) {
  const current = listHoldings(db, user.id);
  if (current.includes(ticker)) return 'exists';
  if (current.length >= holdingLimitFor(user.plan)) return 'limit';
  db.prepare('INSERT INTO holdings (user_id, ticker) VALUES (?, ?)').run(user.id, ticker);
  return 'added';
}

function removeHolding(db, userId, ticker) {
  return db.prepare('DELETE FROM holdings WHERE user_id = ? AND ticker = ?')
    .run(userId, ticker).changes > 0;
}

function getPrefs(db, userId) {
  const row = db.prepare(
    'SELECT notify_immediately, show_on_lock_screen FROM alert_prefs WHERE user_id = ?'
  ).get(userId);
  return {
    notifyImmediately: row ? row.notify_immediately === 1 : false,
    showOnLockScreen: row ? row.show_on_lock_screen === 1 : false
  };
}

function setPrefs(db, userId, prefs) {
  db.prepare(`
    INSERT INTO alert_prefs (user_id, notify_immediately, show_on_lock_screen)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      notify_immediately = excluded.notify_immediately,
      show_on_lock_screen = excluded.show_on_lock_screen
  `).run(userId, prefs.notifyImmediately ? 1 : 0, prefs.showOnLockScreen ? 1 : 0);
}

// Returns true if the subscription was stored for this user, false if the
// endpoint already belongs to a subscription whose secret keys do not match.
//
// The same browser may legitimately re-subscribe, or be used by a second
// account, and then it presents the SAME endpoint with the SAME two keys, so
// the row is handed to the current user. The auth secret is known only to
// that browser and this server, so someone who merely learned an endpoint URL
// cannot re-point another person's push channel at their own account.
function saveSubscription(db, userId, sub) {
  const result = db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id
    WHERE push_subscriptions.p256dh = excluded.p256dh
      AND push_subscriptions.auth = excluded.auth
  `).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  return result.changes > 0;
}

// Turning alerts off must remove the stored channel, not just stop using it.
function deleteSubscriptions(db, userId, endpoint) {
  if (endpoint) {
    return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, endpoint).changes;
  }
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId).changes;
}

function countSubscriptions(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n;
}

// "Delete my alert data": preferences and every subscription for this user.
function deleteAlertData(db, userId) {
  db.prepare('DELETE FROM alert_prefs WHERE user_id = ?').run(userId);
  return deleteSubscriptions(db, userId);
}

// Released news for tickers THIS user holds. The JOIN on holdings is what
// keeps one user from seeing news about stocks they do not own.
function listNewsForUser(db, userId) {
  return db.prepare(`
    SELECT n.id, n.ticker, n.headline, n.summary, n.released_at
    FROM news_items n
    JOIN holdings h ON h.ticker = n.ticker AND h.user_id = ?
    WHERE n.released_at IS NOT NULL
    ORDER BY n.released_at DESC, n.id DESC
  `).all(userId);
}

function getNewsForUser(db, userId, newsId) {
  return db.prepare(`
    SELECT n.*
    FROM news_items n
    JOIN holdings h ON h.ticker = n.ticker AND h.user_id = ?
    WHERE n.id = ? AND n.released_at IS NOT NULL
  `).get(userId, newsId);
}

module.exports = {
  PLAN_HOLDING_LIMITS,
  FULL_EXPLANATION_PLANS,
  initAlertsSchema,
  seedDemoData,
  SAMPLE_NEWS,
  getUser,
  listHoldings,
  holdingLimitFor,
  addHolding,
  removeHolding,
  getPrefs,
  setPrefs,
  saveSubscription,
  deleteSubscriptions,
  countSubscriptions,
  deleteAlertData,
  listNewsForUser,
  getNewsForUser
};
