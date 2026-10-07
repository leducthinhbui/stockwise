// SIT774 Task 10.3HD - full alerts flow in real Chrome (granted and blocked paths)
//
// Drives a REAL Chrome (headless, throwaway profile) through the Portfolio News
// Alerts page, so the parts a unit test cannot reach are actually exercised:
// the service worker, the push subscription with Chrome's push service, and the
// notification Chrome shows.
//
// How to run:
//   1. npm start                      (server on http://localhost:3000)
//   2. npm install --no-save puppeteer-core
//   3. node test/manual/alerts-flow-chrome.js
// Set CHROME_PATH if Chrome is not at the macOS default location. Push needs
// internet access (Chrome contacts its push service). Not part of `npm test`.

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const ORIGIN = 'http://localhost:3000';
const CHROME = (process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(grant) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    userDataDir: fs.mkdtempSync(os.tmpdir() + '/sw-e2e-'),
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const context = browser.defaultBrowserContext();
  if (grant) await context.overridePermissions(ORIGIN, ['notifications']);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 401) problems.push(`http ${r.status()} ${r.url()}`); });
  return { browser, page, problems };
}

async function signInAsAlexFresh(page) {
  await page.goto(ORIGIN + '/alerts.html', { waitUntil: 'networkidle0' });
  await page.click('[data-user-id="1"]');
  await page.waitForSelector('#signedIn:not(.d-none)');
  await page.evaluate(() => fetch('/api/alerts', { method: 'DELETE' }));
  await page.evaluate(() => fetch('/api/dev/reset-news', { method: 'POST' }));
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(1200);
}

const read = (page) => page.evaluate(async () => {
  const t = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  const shown = reg ? await reg.getNotifications() : [];
  const prefs = await (await fetch('/api/alerts/prefs')).json();
  return {
    permission: Notification.permission,
    notifyChecked: document.getElementById('notifyImmediately').checked,
    lockChecked: document.getElementById('showOnLock').checked,
    lockAria: document.getElementById('showOnLock').getAttribute('aria-disabled'),
    alertState: t('alertState'),
    retryVisible: !document.getElementById('retryBtn').classList.contains('d-none'),
    browserHasSub: !!sub,
    serverSubs: prefs.subscriptionCount,
    storedIntent: [prefs.notifyImmediately, prefs.showOnLockScreen],
    notifications: shown.map((n) => ({ title: n.title, body: n.body, tag: n.tag, newsId: n.data && n.data.newsId })),
    demoMessage: t('demoMessage'),
    newsList: [...document.querySelectorAll('#newsList li a')].map((a) => a.textContent)
  };
});

const show = (label, obj) => console.log('\n== ' + label + '\n' + JSON.stringify(obj, null, 1));

(async () => {
  // ---------------- A. Permission granted ----------------
  const A = await launch(true);
  const page = A.page;
  await signInAsAlexFresh(page);

  await page.click('#notifyImmediately');
  await sleep(5000);
  show('A1. alerts on (generic lock screen)', await read(page));

  // Deliver a push through the REAL server path: release -> web-push -> FCM.
  await page.click('#releaseBtn');
  await sleep(2500);
  const afterRelease = await read(page);
  show('A2. test alert released (server sent real web-push to FCM)', {
    demoMessage: afterRelease.demoMessage, newsList: afterRelease.newsList, notificationsShownByBrowser: afterRelease.notifications
  });

  // FCM delivery to a headless browser is not guaranteed, so also deliver the
  // push straight to the service worker over the DevTools protocol. This runs
  // the real push handler in sw.js with the exact payload the server builds.
  const cdp = await page.createCDPSession();
  await cdp.send('ServiceWorker.enable');
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);
  const reg = regs.find((r) => r.scopeURL.startsWith(ORIGIN));
  if (reg) {
    const generic = JSON.stringify({ title: 'StockWise', body: "There's news about one of your holdings.", newsId: 1, tag: 'stockwise-news-1' });
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: reg.registrationId, data: generic });
    await sleep(800);
    show('A3. generic push delivered to sw.js: what the browser is showing', (await read(page)).notifications);
  } else {
    console.log('\n(could not find the registration over CDP)');
  }

  // Lock-screen toggle
  await page.click('#showOnLock');
  await sleep(600);
  show('A4. lock-screen box ticked (alerts on)', { ...(({ lockChecked, lockAria, storedIntent }) => ({ lockChecked, lockAria, storedIntent }))(await read(page)) });

  // Turn alerts off: subscription must be gone in the browser AND on the server;
  // the lock-screen choice must be kept.
  await page.click('#notifyImmediately');
  await sleep(1500);
  const off = await read(page);
  show('A5. alerts turned off', {
    notifyChecked: off.notifyChecked, lockChecked: off.lockChecked, lockAria: off.lockAria, alertState: off.alertState,
    browserHasSub: off.browserHasSub, serverSubs: off.serverSubs, storedIntent: off.storedIntent
  });

  // Turn back on: lock-screen choice restored
  await page.click('#notifyImmediately');
  await sleep(4500);
  const on2 = await read(page);
  show('A6. alerts turned back on', { notifyChecked: on2.notifyChecked, lockChecked: on2.lockChecked, browserHasSub: on2.browserHasSub, serverSubs: on2.serverSubs });
  show('A-problems', A.problems);
  await A.browser.close();

  // ---------------- B. Permission blocked ----------------
  const B = await launch(false);
  await signInAsAlexFresh(B.page);
  await B.page.evaluate(() => { /* headless Chrome denies notification prompts by default */ });
  await B.page.click('#notifyImmediately');
  await sleep(3000);
  const blocked = await read(B.page);
  show('B. permission denied: ticking the box', {
    permission: blocked.permission, notifyChecked: blocked.notifyChecked, alertState: blocked.alertState,
    browserHasSub: blocked.browserHasSub, serverSubs: blocked.serverSubs, storedIntent: blocked.storedIntent
  });
  show('B-problems', B.problems);
  await B.browser.close();
})().catch((e) => { console.error('E2E error:', e); process.exit(1); });
