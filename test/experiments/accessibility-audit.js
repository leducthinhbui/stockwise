// test/experiments/accessibility-audit.js
// SIT774 Task 10.3HD - Experiment H11: is the feature accessible in every state it can be in?
//
// HYPOTHESIS (H11). An automated audit finds no WCAG 2.2 A or AA violation on
// the alerts page in any of its states, on the explanation page for either plan,
// on the tutorial, or at phone width.
//
// METHOD. axe-core (Deque Systems) is injected into a real Chrome page and run
// against eight states, including the hard ones: after the browser permission
// is DENIED, and with a real subscription ACTIVE. Rules checked: WCAG 2.0, 2.1
// and 2.2 level A and AA, plus axe's best-practice rules. Colour contrast is
// computed from the real rendered colours.
//
// LIMIT, stated plainly. Automated tools find roughly a third of accessibility
// problems at best (they cannot judge whether alt text is meaningful, whether
// the reading order makes sense, or what a screen reader actually says). This
// audit is a floor, not proof of accessibility. The keyboard and screen-reader
// checks are separate (test/manual/).
//
// Needs the server running, `npm install --no-save puppeteer-core axe-core`, Chrome.
// Run: node test/experiments/accessibility-audit.js

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const ORIGIN = 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function launch(grant) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sw-a11y-')),
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const context = browser.defaultBrowserContext();
  if (grant) await context.overridePermissions(ORIGIN, ['notifications']);
  const page = await context.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  return { browser, page };
}

async function audit(page, label) {
  await page.evaluate(axeSource);
  const r = await page.evaluate((tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
  const violations = r.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 4),
    count: v.nodes.length,
    wcag: v.tags.filter((t) => /^wcag\d/.test(t)).join(',')
  }));
  console.log(`\n${label}`);
  console.log(`  rules passed: ${r.passes.length}   violations: ${violations.length}   needs manual check: ${r.incomplete.length}`);
  for (const v of violations) {
    console.log(`  VIOLATION [${v.impact}] ${v.id} (${v.count} element${v.count === 1 ? '' : 's'}): ${v.help}`);
    console.log(`     e.g. ${v.nodes.join(' | ')}`);
  }
  return { label, passes: r.passes.length, violations, incomplete: r.incomplete.map((i) => i.id) };
}

async function signIn(page, userId) {
  // start signed out, whoever was signed in before
  await page.goto(ORIGIN + '/alerts.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => fetch('/api/session', { method: 'DELETE' }));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click(`[data-user-id="${userId}"]`);
  await page.waitForSelector('#signedIn:not(.d-none)');
  await page.evaluate(() => fetch('/api/alerts', { method: 'DELETE' }));
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(800);
}

(async () => {
  const results = [];
  const granted = await launch(true);
  const denied = await launch(false);
  try {
    const p = granted.page;
    await p.goto(ORIGIN + '/alerts.html', { waitUntil: 'networkidle0' });
    results.push(await audit(p, '1. alerts page, signed out'));

    await signIn(p, 1);
    results.push(await audit(p, '2. alerts page, signed in, alerts off'));

    await p.click('#notifyImmediately');
    await p.waitForFunction(() => /Alerts are on/.test(document.getElementById('alertState').textContent), { timeout: 20000 });
    await p.click('#releaseBtn');
    await sleep(1500);
    results.push(await audit(p, '3. alerts page, alerts ACTIVE (real push subscription), one item in the list'));

    await p.setViewport({ width: 375, height: 800 });
    await sleep(300);
    results.push(await audit(p, '4. alerts page at phone width (375 px)'));
    await p.setViewport({ width: 1200, height: 900 });

    await p.goto(ORIGIN + '/news.html?id=1', { waitUntil: 'networkidle0' });
    await sleep(400);
    results.push(await audit(p, '5. explanation page, Free plan (summary and plan note)'));

    // Sam (Standard) needs a released item he holds
    await signIn(p, 2);
    await p.evaluate(() => fetch('/api/dev/release-news', { method: 'POST' }));
    await p.goto(ORIGIN + '/news.html?id=2', { waitUntil: 'networkidle0' });
    await sleep(400);
    results.push(await audit(p, '6. explanation page, Standard plan (full detail and analyst quote)'));

    await p.goto(ORIGIN + '/alerts-tutorial.html', { waitUntil: 'networkidle0' });
    results.push(await audit(p, '7. tutorial page'));

    const d = denied.page;
    await signIn(d, 1);
    await d.click('#notifyImmediately');
    await d.waitForFunction(() => /blocked in your browser/.test(document.getElementById('alertState').textContent), { timeout: 15000 });
    results.push(await audit(d, '8. alerts page, browser permission DENIED (the blocked state)'));
  } finally {
    try {
      for (const id of [1, 2]) {
        await granted.page.evaluate((uid) => fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid }) })
          .then(() => fetch('/api/alerts', { method: 'DELETE' })), id);
      }
      await granted.page.evaluate(() => fetch('/api/dev/reset-news', { method: 'POST' }));
    } catch (e) { /* best effort */ }
    await granted.browser.close().catch(() => {});
    await denied.browser.close().catch(() => {});
  }

  const total = results.reduce((n, r) => n + r.violations.length, 0);
  console.log(`\nSUMMARY: ${results.length} states audited, ${total} violation${total === 1 ? '' : 's'} in total.`);
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'accessibility-audit.json'), JSON.stringify({ axe: require('axe-core').version, tags: TAGS, results }, null, 2));
})().catch((e) => { console.error('audit error:', e); process.exit(1); });
