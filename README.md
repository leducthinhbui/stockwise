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
on first run.

## Task 10.3HD: "Import your holdings"

The feature implemented for Task 10.3HD, extending the proposal from Task 7.3HD, is
on the **Register** page under "Your holdings." It reads a CSV or PDF broker
statement entirely in the browser (File System Access API with a fallback, parsed in
a Web Worker using `pdf.js` for PDF), with nothing uploaded.

A full implementation walkthrough, written as a tutorial for another developer, is at
[`public/import-tutorial.html`](public/import-tutorial.html), also viewable live at
`/import-tutorial.html` once the server is running.

## Task 10.2D: database integration

The contact page's query form (`public/contact.html`) saves to a SQLite `queries`
table. An administrator review page at `/queries.html` lists, searches, sorts,
paginates and deletes submitted queries.

## Project structure

```
server.js                  Express server, SQLite setup, API routes
public/                    Static site (HTML/CSS/JS)
  js/holdings-import.js        Main-thread controller for the import feature
  js/holdings-import-worker.js Web Worker: CSV parsing, PDF row-grouping heuristic
  js/queries.js                 Admin queries page
  js/validation.js              Contact form validation + submission
wireframes/                 Lo-fi wireframes from Task 5.2D
wireframes-7.3hd/           Wireframes for the Import feature, from Task 7.3HD
DESIGN-DECISIONS.md         Accessibility and design decisions recorded during the build
```
