// SIT774 Task 10.3HD - regression tests for the "Import your holdings"
// parsing worker (public/js/holdings-import-worker.js).
//
// Every case here is a bug an AI-assisted code review found by reading the
// worker and running these same inputs by hand: a wrong result was silently
// marked "high confidence" rather than flagged. This file exists so that
// claim isn't just "I checked it once" - run it with:
//
//   node --test test/
//
// and a future change to the worker that reintroduces any of these bugs
// fails a real assertion instead of passing unnoticed.
//
// These are synthetic inputs, not real broker statement exports - the PDF
// cases in particular only test the row-grouping heuristic's logic, not
// how pdf.js itself breaks a real statement's layout into text items.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, groupPdfItemsIntoRows } = require('../public/js/holdings-import-worker.js');

// Builds fake pdf.js text items from rows of { str, x, w? } cells, laying
// each row out at an increasing y so groupPdfItemsIntoRows sees them as
// separate lines.
function pdfItems(rows, startY) {
  var out = [];
  rows.forEach(function (row, i) {
    row.forEach(function (cell) {
      out.push({
        str: cell.str,
        x: cell.x,
        w: cell.w || cell.str.length * 5,
        y: (startY || 100) + i * 12,
        page: 1,
        h: 10
      });
    });
  });
  return out;
}

test('CSV: a normal row with a matching header parses as a high-confidence holding', function () {
  var rows = parseCsv('name,ticker,quantity\nCommonwealth Bank,CBA,250\n');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { name: 'Commonwealth Bank', ticker: 'CBA', quantity: 250, confidence: 'high', reason: null });
});

test('CSV: a compound header like "Security Name" still matches by substring, not exact equality', function () {
  var rows = parseCsv('Security Name,Code,Units Held\nCommonwealth Bank,CBA,250\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Commonwealth Bank');
  assert.equal(rows[0].confidence, 'high');
});

test('CSV: an account/date line above the real header does not corrupt every row', function () {
  var rows = parseCsv('Account: 1234\nname,ticker,quantity\nCommonwealth Bank,CBA,250\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Commonwealth Bank');
  assert.equal(rows[0].confidence, 'high');
});

test('CSV: trailing text after the quantity number is flagged, not silently accepted', function () {
  var rows = parseCsv('name,ticker,quantity\nVanguard ETF,VAS,10 (pending)\n');
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].confidence, 'low');
  assert.match(rows[0].reason, /extra text/);
});

test('CSV: a "Total" row is flagged as a summary line, not imported as a holding', function () {
  var rows = parseCsv('name,ticker,quantity\nTotal,,1250\n');
  assert.equal(rows[0].confidence, 'low');
  assert.match(rows[0].reason, /total or summary/);
});

test('CSV: semicolon-delimited exports are detected and parsed', function () {
  var rows = parseCsv('name;ticker;quantity\nCommonwealth Bank;CBA;250\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Commonwealth Bank');
  assert.equal(rows[0].ticker, 'CBA');
});

test('PDF: a ticker-before-name layout does not pick the ticker as the name', function () {
  var rows = groupPdfItemsIntoRows(pdfItems([
    [{ str: 'CBA', x: 10 }, { str: 'COMMONWEALTH BANK', x: 50 }, { str: '250', x: 250 }, { str: '118.20', x: 300 }]
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'COMMONWEALTH BANK');
  assert.equal(rows[0].ticker, 'CBA');
});

test('PDF: a totals/portfolio-value line is flagged, not imported as a holding', function () {
  var rows = groupPdfItemsIntoRows(pdfItems([
    [{ str: 'Total portfolio value', x: 10 }, { str: '45,210.00', x: 250 }]
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].confidence, 'low');
  assert.match(rows[0].reason, /total or summary/);
});

test('PDF: a wrapped name on its own line is merged into the row above, flagged, not dropped', function () {
  var rows = groupPdfItemsIntoRows([
    { str: 'VAS', x: 10, y: 100, page: 1, h: 10, w: 15 },
    { str: 'VANGUARD AUST SHARES', x: 50, y: 100, page: 1, h: 10, w: 100 },
    { str: '100', x: 250, y: 100, page: 1, h: 10, w: 15 },
    { str: 'INDEX ETF FUND', x: 50, y: 112, page: 1, h: 10, w: 70 }
  ]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].name, /VANGUARD AUST SHARES.*INDEX ETF FUND/);
  assert.equal(rows[0].confidence, 'low');
});

test('PDF: a $-prefixed value is still recognised as the quantity column', function () {
  var rows = groupPdfItemsIntoRows(pdfItems([
    [{ str: 'Some Holding Pty Ltd', x: 10 }, { str: '$4,210.00', x: 250 }]
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 4210);
});

test('PDF: a page header/footer line with no number is dropped, not treated as a row', function () {
  var rows = groupPdfItemsIntoRows(pdfItems([
    [{ str: 'Holdings Statement', x: 10 }, { str: 'Page 1 of 3', x: 200 }]
  ]));
  assert.equal(rows.length, 0);
});
