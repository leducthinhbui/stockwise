# StockWise

A plain-English portfolio-explanation website, built across SIT774's website project
(Tasks 5.2D, 7.2D, 10.2D) and its awesome-feature extension (Tasks 7.3HD, 10.3HD).
StockWise explains holdings a user already has; it never connects to a trading
account and never recommends buying, selling or holding anything.

## Running it

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

`server.js` opens/creates `stockwise.db` (SQLite, via Node's built-in `node:sqlite`)
on first run. On first run it also creates `vapid-keys.json`, the key pair the server
uses to send push messages. That file is git-ignored: the private key can send to every
subscribed device and must never be committed.

```bash
npm test      # 72 tests (54 for Portfolio News Alerts)
```

## Task 10.3HD: Portfolio News Alerts

The feature implemented for Task 10.3HD, extending the proposal from Task 7.3HD, is
on the **My alerts** page (`/alerts.html`). When news breaks about a stock a signed-in
user holds, they get a browser notification immediately, even with every StockWise tab
closed. Tapping it opens a plain-English explanation of what happened
(`/news.html`), with one named analyst's reported words where the plan includes them.

It uses three browser APIs together: the **Notifications API**, a **Service Worker**
(`public/sw.js`) and the **Push API**, with `web-push` on the server.

The rule behind every decision: the alert is instant for everyone. A plan changes how
much detail you read, never how soon you are told. The site explains; it never predicts
or recommends.

To try it: open `/alerts.html`, choose a demo account, tick "Notify me immediately",
allow notifications, then press "Send me a test alert now". (On macOS, Chrome must also
be allowed to show notifications in System Settings.)

A full implementation walkthrough, written as a tutorial for another developer, is at
[`public/alerts-tutorial.html`](public/alerts-tutorial.html), also viewable live at
`/alerts-tutorial.html` once the server is running.

What is real and what is a stand-in (also explained on the tutorial page):

- Real: the permission prompt, service worker, push subscription, web-push delivery with
  VAPID, encrypted payloads, the notification, session-scoped queries, deleting
  subscriptions on request, plan-shaped explanations.
- Stand-in: the news. All companies, tickers and analysts are invented sample data, and a
  button releases the next sample item. A production job would poll a licensed news API.
- Stand-in: sign-in. Two demo accounts, no passwords.

Tests: `test/alerts*.test.js`, `test/guardrail.test.js` and `test/explainer.test.js` run against an
in-memory database and a fake push sender. `test/manual/alerts-flow-chrome.js` and
`test/manual/alerts-keyboard-chrome.js` drive a real Chrome (see the header of each file).

### Evidence: hypotheses and experiments

Each claim made in the Task 7.3HD proposal was written as a hypothesis and tested, and the
code was changed where the result disagreed. The scripts are in `test/experiments/` and write
their results to `test/experiments/results/`; `make-charts.py` draws the charts from those files.
The full table and charts are on `public/alerts-tutorial.html`.

| Script | Tests |
|---|---|
| `latency.js` (real Chrome, needs the server) | push vs polling speed, Free vs Standard timing, the push service's size limit |
| `fanout-scale.js` | delivery time at 1,000 to 50,000 users, with and without indexes (about 5 min; `--quick` skips the largest) |
| `send-concurrency.js` | one push at a time vs several at once |
| `old-vs-new.js` | the first drafts' double-send, subscription takeover and payload size, next to the fixes |
| `api-latency.js` (needs the server) | API response times |
| `accessibility-audit.js` (real Chrome, needs the server) | axe-core on eight page states |
| `guardrail-eval.js` | the advice-language checker on development, held-out and adversarial sentences |
| `payload-boundary.js` (real Chrome, needs the server) | the push size limit, 3,990 to 3,996 bytes, 3 trials each, against a prediction written first (4,096 - 103 bytes of encryption overhead = 3,993) |

The browser experiments need `npm install --no-save puppeteer-core axe-core`.

### AI

`lib/explainer.js` can draft a plain-English explanation with a language model, and
`lib/guardrail.js` filters advice, forecast, verdict and pressure language. The evaluation showed
the filter is only a first line of defence, so a draft always needs a person's approval and is never
published automatically. `test/manual/ai-explainer-live.js` runs it once against a real model if you
set `ANTHROPIC_API_KEY`.

## Earlier experiment: "Import your holdings"

An earlier proposal for 7.3HD/10.3HD, a client-side CSV/PDF broker-statement reader, is
also implemented on the **Register** page under "Your holdings", with its own tutorial at
[`public/import-tutorial.html`](public/import-tutorial.html). It is not the feature
submitted for Task 10.3HD; it is kept because it works and has its own tests.

## Task 10.2D: database integration

The contact page's query form (`public/contact.html`) saves to a SQLite `queries`
table. An administrator review page at `/queries.html` lists, searches, sorts,
paginates and deletes submitted queries.

## Project structure

```
server.js                  Express server, SQLite setup, API routes
lib/
  alerts-db.js                 Alerts tables, plan limits, sample data, session-scoped queries
  alerts.js                    Payload building, plan shaping, delivery job, VAPID keys
  alerts-routes.js             Alerts HTTP API (Express router)
  guardrail.js                 Advice / forecast / verdict / pressure language checker
  explainer.js                 Draft-only AI explanation, behind the guardrail
public/                    Static site (HTML/CSS/JS)
  sw.js                        Service worker: push + notificationclick
  alerts.html, news.html       The alerts page and the page a notification opens
  js/alerts.js                 Page logic: holdings, Account & Privacy, the in-app list
  js/alerts-state.js           The permission state function (also tested in Node)
  js/news.js                   Plan-shaped explanation
  alerts-tutorial.html         How Portfolio News Alerts is built
  js/holdings-import.js        (earlier experiment) Import feature controller
  js/holdings-import-worker.js (earlier experiment) Web Worker: CSV/PDF parsing
  js/queries.js                 Admin queries page
  js/validation.js              Contact form validation + submission
test/
  *.test.js                    Unit and integration tests
  experiments/                 Hypothesis experiments and their saved results
  manual/                      Real-Chrome scripts, live-model script, accessibility checklist
wireframes/                 Lo-fi wireframes from Task 5.2D
wireframes-7.3hd/           Wireframes for the Import experiment
DESIGN-DECISIONS.md         Accessibility and design decisions recorded during the build
```
