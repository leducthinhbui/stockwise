// test/experiments/api-latency.js
// SIT774 Task 10.3HD - Experiment H10: do the API calls the page makes feel instant?
//
// HYPOTHESIS (H10). Every API call the alerts page depends on answers in under
// 100 ms at the 95th percentile, the threshold below which people perceive a
// response as instantaneous (Nielsen, 1993), even with 20 requests in flight at
// once.
//
// METHOD. Sign in as Alex (so every route is exercised as a real signed-in user),
// then send 400 requests to each endpoint, 20 at a time, against the running
// server, and report median / 95th percentile / max in milliseconds. This is a
// LOCAL measurement (no network between client and server), so it isolates the
// server's own work, and the sample database is tiny, so it does not claim to
// predict a production system.
//
// Needs the server running (npm start).  Run: node test/experiments/api-latency.js

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ORIGIN = 'http://localhost:3000';
const TOTAL = 400;
const PARALLEL = 20;

async function main() {
  const login = await fetch(ORIGIN + '/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1 })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  // make sure there is a released item to read
  await fetch(ORIGIN + '/api/dev/reset-news', { method: 'POST', headers });
  await fetch(ORIGIN + '/api/dev/release-news', { method: 'POST', headers });

  const endpoints = [
    ['GET  /api/me', () => fetch(ORIGIN + '/api/me', { headers })],
    ['GET  /api/holdings', () => fetch(ORIGIN + '/api/holdings', { headers })],
    ['GET  /api/alerts/prefs', () => fetch(ORIGIN + '/api/alerts/prefs', { headers })],
    ['PUT  /api/alerts/prefs', () => fetch(ORIGIN + '/api/alerts/prefs', { method: 'PUT', headers, body: JSON.stringify({ notifyImmediately: false, showOnLockScreen: false }) })],
    ['GET  /api/news', () => fetch(ORIGIN + '/api/news', { headers })],
    ['GET  /api/news/1', () => fetch(ORIGIN + '/api/news/1', { headers })],
    ['GET  /alerts.html (page)', () => fetch(ORIGIN + '/alerts.html')],
    ['GET  /sw.js', () => fetch(ORIGIN + '/sw.js')]
  ];

  console.log(`\nH10 ${TOTAL} requests per endpoint, ${PARALLEL} at a time (milliseconds)\n`);
  console.log('endpoint                  | median | p95   | max   | verdict (p95 < 100 ms)');
  const out = [];
  for (const [name, call] of endpoints) {
    const times = [];
    let failures = 0;
    let next = 0;
    async function worker() {
      while (next < TOTAL) {
        next += 1;
        const t = performance.now();
        const res = await call();
        await res.arrayBuffer();
        times.push(performance.now() - t);
        if (!res.ok) failures += 1;
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    times.sort((a, b) => a - b);
    const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
    const row = { endpoint: name.trim(), median: Number(q(0.5).toFixed(1)), p95: Number(q(0.95).toFixed(1)), max: Number(times[times.length - 1].toFixed(1)), failures };
    out.push(row);
    console.log(`${name.padEnd(25)} | ${String(row.median).padEnd(6)} | ${String(row.p95).padEnd(5)} | ${String(row.max).padEnd(5)} | ${row.p95 < 100 ? 'yes' : 'NO'}${failures ? `  (${failures} non-2xx)` : ''}`);
  }
  await fetch(ORIGIN + '/api/dev/reset-news', { method: 'POST', headers });
  await fetch(ORIGIN + '/api/session', { method: 'DELETE', headers });
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'api-latency.json'), JSON.stringify({ total: TOTAL, parallel: PARALLEL, rows: out }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
