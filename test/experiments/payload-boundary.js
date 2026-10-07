// test/experiments/payload-boundary.js
// SIT774 Task 10.3HD - follow-up to H3 (live).
//
// The first probe found 3,990 bytes accepted and 3,994 refused by Google's push
// service. An AI chat predicted the exact edge: the push service limits the
// ENCRYPTED body to 4,096 bytes, and aes128gcm encryption (RFC 8291) adds 103 bytes
// (16 salt + 4 record size + 1 key id length + 65 sender key + 1 padding delimiter
// + 16 tag), so the largest plaintext is 4,096 - 103 = 3,993 bytes.
//
// PREDICTION (written before running): 3,993 accepted, 3,994 refused.
// This script tests every size from 3,990 to 3,996, three times each, against a
// REAL push subscription, and records whether the prediction held.
//
// Needs: the server running (npm start), `npm install --no-save puppeteer-core`,
// Chrome, and internet access. Takes about 30 seconds.
//
// Run: node test/experiments/payload-boundary.js

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const webpush = require('web-push');

const ORIGIN = 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PREDICTED_EDGE = 4096 - 103;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sw-bound-')),
    args: ['--no-first-run', '--no-default-browser-check']
  });
  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(ORIGIN, ['notifications']);
    const page = await context.newPage();
    await page.goto(ORIGIN + '/alerts.html', { waitUntil: 'networkidle0' });
    await page.click('[data-user-id="1"]');
    await page.waitForSelector('#signedIn:not(.d-none)');
    await page.evaluate(() => fetch('/api/alerts', { method: 'DELETE' }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(800);
    await page.click('#notifyImmediately');
    await page.waitForFunction(() => /Alerts are on/.test(document.getElementById('alertState').textContent), { timeout: 20000 });

    const sub = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return (await reg.pushManager.getSubscription()).toJSON();
    });
    const vapid = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vapid-keys.json'), 'utf8'));
    const options = { vapidDetails: { subject: 'mailto:hello@stockwise.example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 };

    const rows = [];
    console.log(`Predicted edge: ${PREDICTED_EDGE} bytes accepted, ${PREDICTED_EDGE + 1} refused\n`);
    console.log('  payload bytes | trials accepted / 3 | first refusal');
    for (let bytes = PREDICTED_EDGE - 3; bytes <= PREDICTED_EDGE + 3; bytes++) {
      const base = JSON.stringify({ title: 'StockWise', body: '', newsId: 1, tag: 'probe' });
      const body = 'x'.repeat(bytes - Buffer.byteLength(base));
      const payload = JSON.stringify({ title: 'StockWise', body, newsId: 1, tag: 'probe' });
      if (Buffer.byteLength(payload) !== bytes) throw new Error('payload size mismatch');
      let accepted = 0, refusal = '';
      for (let t = 0; t < 3; t++) {
        try { await webpush.sendNotification(sub, payload, options); accepted++; }
        catch (err) { refusal = `HTTP ${err.statusCode || 'n/a'}`; }
        await sleep(250);
      }
      rows.push({ bytes, accepted, trials: 3, refusal });
      console.log(`  ${String(bytes).padEnd(13)} | ${accepted} / 3               | ${refusal || '-'}`);
    }

    const heldBelow = rows.filter((r) => r.bytes <= PREDICTED_EDGE).every((r) => r.accepted === r.trials);
    const heldAbove = rows.filter((r) => r.bytes > PREDICTED_EDGE).every((r) => r.accepted === 0);
    const verdict = heldBelow && heldAbove ? 'PREDICTION HELD' : 'PREDICTION DID NOT HOLD';
    console.log('\n' + verdict);

    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); (await r.getNotifications()).forEach((n) => n.close()); });
    fs.writeFileSync(path.join(__dirname, 'results', 'payload-boundary.json'),
      JSON.stringify({ when: new Date().toISOString(), predictedEdge: PREDICTED_EDGE, rows, verdict, note: 'one machine, one Chrome subscription to Google push service' }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
