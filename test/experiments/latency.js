// test/experiments/latency.js
// SIT774 Task 10.3HD - Experiments H1, H8 and H3 (live), in REAL Chrome.
//
// H1 (immediacy). A push reaches the user's screen within a couple of seconds
//    of the news being released, far sooner than a page that polls every 20 s.
// H8 (depth, never speed). A Free user and a Standard user are told at the same
//    moment (within about a second of each other), while only the detail differs.
// H3 (live). The push service refuses a push that is too large; find the real
//    boundary, instead of trusting a number from documentation.
//
// METHOD. Each browser is a real (non-incognito) Chrome with a throwaway profile
// and a REAL push subscription with Google's push service. The service worker
// stamps notification.data.receivedAt with its own clock when the push event
// fires, and the server stamps sentAt when it builds the message (see
// public/sw.js and lib/alerts.js). Everything runs on one machine so the clocks
// agree. Latency = receivedAt minus the moment the release request left.
//
// Needs: the server running (npm start), `npm install --no-save puppeteer-core`,
// Chrome, and internet access. Takes about 3 minutes (part B waits on a 20 s timer).
//
// Run: node test/experiments/latency.js

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const webpush = require('web-push');

const ORIGIN = 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// `--only=h3` runs just the payload-limit probe (about 20 seconds) instead of everything.
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const run = (k) => !ONLY || ONLY === k;

const stats = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
};
const fmt = (st) => `n=${st.n}  min ${st.min}  median ${st.median}  mean ${st.mean}  p95 ${st.p95}  max ${st.max}`;

async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sw-lat-')),
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(ORIGIN, ['notifications']);
  const page = await context.newPage();
  return { browser, page };
}

async function signIn(page, userId) {
  await page.goto(ORIGIN + '/alerts.html', { waitUntil: 'networkidle0' });
  await page.click(`[data-user-id="${userId}"]`);
  await page.waitForSelector('#signedIn:not(.d-none)');
  await page.evaluate(() => fetch('/api/alerts', { method: 'DELETE' }));
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);
}

async function turnAlertsOn(page) {
  await page.click('#notifyImmediately');
  await page.waitForFunction(() => /Alerts are on/.test(document.getElementById('alertState').textContent), { timeout: 20000 });
}

const post = (page, url) => page.evaluate((u) => fetch(u, { method: 'POST' }).then((r) => r.json()), url);

// Wait until a notification with the tag shows up whose receivedAt is after t0.
async function waitForNotification(page, tag, t0, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate(async (tag, t0) => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const list = await reg.getNotifications({ tag });
      const fresh = list.map((n) => n.data).filter((d) => d && d.receivedAt >= t0);
      return fresh.length ? fresh[0] : null;
    }, tag, t0);
    if (found) return found;
    await sleep(30);
  }
  return null;
}

(async () => {
  const report = {};
  let A, B;
  try {
    // ------------------------------------------------------------------ H1
    A = await launch();
    await signIn(A.page, 1);
    await post(A.page, '/api/dev/reset-news');
    await turnAlertsOn(A.page);

    console.log('\nH1a. Push latency: release -> notification on screen (milliseconds, 10 trials)');
    const total = [], prep = [], transit = [], requestMs = [];
    for (let i = 0; i < (run('h1') ? 10 : 0); i++) {
      await post(A.page, '/api/dev/reset-news');
      await A.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); (await r.getNotifications()).forEach((n) => n.close()); });
      await sleep(400);
      const t0 = await A.page.evaluate(() => Date.now());
      const released = await post(A.page, '/api/dev/release-news');
      const tResp = await A.page.evaluate(() => Date.now());
      const data = await waitForNotification(A.page, 'stockwise-news-1', t0);
      if (!data) { console.log(`  trial ${i + 1}: NO notification within 25 s (sent=${released.delivered && released.delivered.sent})`); continue; }
      total.push(data.receivedAt - t0);
      prep.push(data.sentAt - t0);
      transit.push(data.receivedAt - data.sentAt);
      requestMs.push(tResp - t0);
      await sleep(600);
    }
    report.H1a = { totalMs: total, serverPrepMs: prep, pushTransitMs: transit, releaseRequestMs: requestMs };
    if (total.length) {
      console.log('  release request -> payload built (server work): ' + fmt(stats(prep)));
      console.log('  payload built -> service worker received it:    ' + fmt(stats(transit)));
      console.log('  TOTAL release -> notification shown:            ' + fmt(stats(total)));
      console.log('  how long the release request itself took:      ' + fmt(stats(requestMs)));
    }

    // ------------------------------------------------------------- H3 live
    console.log('\nH3 (live). What does Google\'s push service do with an oversize push? (real subscription)');
    const sub = await A.page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return (await reg.pushManager.getSubscription()).toJSON();
    });
    const vapid = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vapid-keys.json'), 'utf8'));
    const options = { vapidDetails: { subject: 'mailto:hello@stockwise.example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 };
    const probe = [];
    console.log('  payload bytes | push service response');
    for (const bytes of [500, 2000, 3500, 3800, 3900, 3950, 3980, 3990, 3994, 3995, 4000, 4078, 4096, 10000]) {
      const base = JSON.stringify({ title: 'StockWise', body: '', newsId: 1, tag: 'probe' });
      const body = 'x'.repeat(Math.max(0, bytes - Buffer.byteLength(base)));
      const payload = JSON.stringify({ title: 'StockWise', body, newsId: 1, tag: 'probe' });
      let outcome;
      try {
        const r = await webpush.sendNotification(sub, payload, options);
        outcome = `accepted (HTTP ${r.statusCode})`;
      } catch (err) {
        outcome = `REFUSED (HTTP ${err.statusCode || 'n/a'}${err.body ? ': ' + String(err.body).slice(0, 60) : ''}${err.statusCode ? '' : ': ' + err.message})`;
      }
      probe.push({ bytes: Buffer.byteLength(payload), outcome });
      console.log(`  ${String(Buffer.byteLength(payload)).padEnd(13)} | ${outcome}`);
      await sleep(250);
    }
    report.H3live = probe;
    await A.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); (await r.getNotifications()).forEach((n) => n.close()); });

    // ------------------------------------------------------------------ H1b
    console.log('\nH1b. Polling baseline: alerts OFF, tab open, the page polls its list every 20 s (5 trials, random phase)');
    await A.page.click('#notifyImmediately');                       // turn alerts off
    await sleep(800);
    const polling = [];
    for (let i = 0; i < (run('h1') ? 5 : 0); i++) {
      await post(A.page, '/api/dev/reset-news');
      await A.page.evaluate(() => { document.getElementById('newsList').textContent = ''; });
      await sleep(1000 + Math.floor(Math.random() * 18000));        // land at a random point in the 20 s cycle
      const t0 = await A.page.evaluate(() => Date.now());
      await post(A.page, '/api/dev/release-news');
      const deadline = Date.now() + 30000;
      let seenAt = null;
      while (Date.now() < deadline) {
        const n = await A.page.evaluate(() => document.querySelectorAll('#newsList li').length);
        if (n > 0) { seenAt = await A.page.evaluate(() => Date.now()); break; }
        await sleep(100);
      }
      if (seenAt) { polling.push(seenAt - t0); console.log(`  trial ${i + 1}: item appeared ${(seenAt - t0) / 1000} s after release`); }
      else console.log(`  trial ${i + 1}: did not appear within 30 s`);
    }
    report.H1b = { pollingMs: polling };
    if (polling.length) console.log('  polling delay: ' + fmt(stats(polling)));
    if (polling.length && report.H1a.totalMs.length) {
      console.log(`  => median push ${stats(report.H1a.totalMs).median} ms versus median polling ${stats(polling).median} ms`);
    }
    await A.browser.close(); A = null;

    // ------------------------------------------------------------------ H8
    console.log('\nH8. Free (Alex) and Standard (Sam) in two separate real browsers, both holding HBK (6 trials)');
    if (!run('h8')) { await A.browser.close(); A = null; return; }
    const fa = await launch();
    const fs2 = await launch();
    A = fa;
    B = fs2;
    await signIn(fa.page, 1);
    await signIn(fs2.page, 2);
    await turnAlertsOn(fa.page);
    await turnAlertsOn(fs2.page);
    const freeMs = [], stdMs = [], gaps = [];
    for (let i = 0; i < 6; i++) {
      await post(fa.page, '/api/dev/reset-news');
      for (const p of [fa.page, fs2.page]) {
        await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); (await r.getNotifications()).forEach((n) => n.close()); });
      }
      await post(fa.page, '/api/dev/release-news');                  // burns item 1 (SCM): only Alex holds it
      await sleep(1500);
      for (const p of [fa.page, fs2.page]) {
        await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); (await r.getNotifications()).forEach((n) => n.close()); });
      }
      const t0 = Date.now();
      const r = await post(fa.page, '/api/dev/release-news');        // item 2 (HBK): both hold it
      const [dFree, dStd] = await Promise.all([
        waitForNotification(fa.page, 'stockwise-news-2', t0),
        waitForNotification(fs2.page, 'stockwise-news-2', t0)
      ]);
      if (!dFree || !dStd) { console.log(`  trial ${i + 1}: a notification did not arrive (sent=${r.delivered && r.delivered.sent})`); continue; }
      freeMs.push(dFree.receivedAt - t0);
      stdMs.push(dStd.receivedAt - t0);
      gaps.push(Math.abs(dFree.receivedAt - dStd.receivedAt));
      await sleep(800);
    }
    report.H8 = { freeMs, standardMs: stdMs, gapMs: gaps };
    if (gaps.length) {
      console.log('  Free     arrival (ms after release): ' + fmt(stats(freeMs)));
      console.log('  Standard arrival (ms after release): ' + fmt(stats(stdMs)));
      console.log('  gap between the two arrivals:        ' + fmt(stats(gaps)));
    }
    // What differs is the detail they can read.
    const depth = await Promise.all([fa.page, fs2.page].map((p) => p.evaluate(() => fetch('/api/news/2').then((r) => r.json()))));
    report.H8.detail = { freeHasDetail: 'detail' in depth[0], standardHasDetail: 'detail' in depth[1], freeHasAnalyst: 'analyst' in depth[0], standardHasAnalyst: 'analyst' in depth[1] };
    console.log('  what each can read:  Free has full detail=' + report.H8.detail.freeHasDetail + ' analyst=' + report.H8.detail.freeHasAnalyst +
      ' | Standard has full detail=' + report.H8.detail.standardHasDetail + ' analyst=' + report.H8.detail.standardHasAnalyst);
  } finally {
    // leave the demo database clean
    try {
      const p = (A && A.page) || (B && B.page);
      if (p) {
        for (const id of [1, 2]) {
          await p.evaluate((uid) => fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid }) })
            .then(() => fetch('/api/alerts', { method: 'DELETE' })), id);
        }
        await p.evaluate(() => fetch('/api/dev/reset-news', { method: 'POST' }));
      }
    } catch (e) { /* best effort */ }
    if (A) await A.browser.close().catch(() => {});
    if (B) await B.browser.close().catch(() => {});
    fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'results', 'latency.json'), JSON.stringify(report, null, 2));
  }
})().catch((e) => { console.error('experiment error:', e); process.exit(1); });
