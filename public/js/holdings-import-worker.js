/* ==========================================================================
   StockWise - holdings import parsing worker
   SIT774 Task 10.3HD (implementing the Task 7.3HD "Import your holdings"
   proposal)

   Runs off the main thread so a large statement does not freeze the page
   while it is read. Handles two message types from holdings-import.js:

     { type: 'csv', text: string }
     { type: 'pdf', items: [{ str, x, y, page }, ...] }

   For PDF, this worker does NOT call pdf.js itself. pdf.js already manages
   its own dedicated internal worker (pdf.worker.js) for the heavy binary
   parsing step, so nesting a second copy of pdf.js inside this worker would
   just add a fragile nested-worker setup for no real benefit. Instead, the
   main thread calls pdf.js (holdings-import.js) to get the lightweight
   { str, x, y, page } text items, and hands that array to this worker,
   which does the CPU-bound row-grouping heuristic - the part that is
   actually expensive for a multi-page statement, and the part with no
   built-in pdf.js function to do it.

   Posts back: { type: 'result', rows: [{ name, ticker, quantity, confidence, reason }] }
   confidence is 'high' or 'low'; reason is set only when confidence is 'low'.
   ========================================================================== */

'use strict';

self.addEventListener('message', function (event) {
  var msg = event.data;

  if (msg.type === 'csv') {
    self.postMessage({ type: 'progress', percent: 50 });
    var rows = parseCsv(msg.text);
    self.postMessage({ type: 'result', rows: rows });
    return;
  }

  if (msg.type === 'pdf') {
    self.postMessage({ type: 'progress', percent: 60 });
    var rows2 = groupPdfItemsIntoRows(msg.items);
    self.postMessage({ type: 'result', rows: rows2 });
    return;
  }
});

/**
 * CSV parsing is the confident path (Step 6 of the proposal): delimited
 * fields, no layout reconstruction needed. Expects a header row containing
 * name/ticker/quantity in some order (case-insensitive), then one holding
 * per line.
 */
function parseCsv(text) {
  var lines = text.split(/\r\n|\r|\n/).filter(function (l) { return l.trim() !== ''; });
  if (lines.length === 0) return [];

  var header = splitCsvLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
  var nameIdx = findColumn(header, ['name', 'holding', 'security']);
  var tickerIdx = findColumn(header, ['ticker', 'code', 'symbol']);
  var qtyIdx = findColumn(header, ['quantity', 'units', 'shares', 'shares held', 'volume']);

  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var fields = splitCsvLine(lines[i]);
    var name = nameIdx >= 0 ? (fields[nameIdx] || '').trim() : '';
    var ticker = tickerIdx >= 0 ? (fields[tickerIdx] || '').trim() : '';
    var qtyRaw = qtyIdx >= 0 ? (fields[qtyIdx] || '').trim() : '';
    var quantity = parseFloat(qtyRaw.replace(/,/g, ''));

    var confidence = 'high';
    var reason = null;
    if (name === '') {
      confidence = 'low';
      reason = 'No holding name found in this row.';
    } else if (isNaN(quantity)) {
      confidence = 'low';
      reason = 'Quantity column did not contain a number ("' + qtyRaw + '").';
    }

    rows.push({
      name: name || '(unknown)',
      ticker: ticker,
      quantity: isNaN(quantity) ? null : quantity,
      confidence: confidence,
      reason: reason
    });
  }
  return rows;
}

function splitCsvLine(line) {
  // A small quoted-field-aware split - good enough for a broker CSV export,
  // not a full RFC 4180 parser.
  var fields = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function findColumn(header, candidates) {
  for (var i = 0; i < header.length; i++) {
    if (candidates.indexOf(header[i]) !== -1) return i;
  }
  return -1;
}

/**
 * The hard part, honestly (Step 5 of the proposal): a PDF has no built-in
 * concept of a table. pdf.js gives us text runs with x/y coordinates; this
 * groups runs into rows by similar y-coordinate (allowing a small
 * tolerance, since a wrapped line is rarely pixel-perfect), then estimates
 * columns within each row by gaps in x-coordinate. This is a heuristic, not
 * a guarantee, and rows it cannot confidently split are flagged rather than
 * guessed at.
 */
function groupPdfItemsIntoRows(items) {
  if (!items || items.length === 0) return [];

  var Y_TOLERANCE = 3; // points; runs within this band are the same line

  // 1. Group into lines by y-coordinate (per page, so page breaks never merge).
  var lines = [];
  items
    .slice()
    .sort(function (a, b) { return a.page - b.page || a.y - b.y || a.x - b.x; })
    .forEach(function (item) {
      var line = lines[lines.length - 1];
      if (line && line.page === item.page && Math.abs(line.y - item.y) <= Y_TOLERANCE) {
        line.items.push(item);
        line.y = (line.y + item.y) / 2; // drift the reference y slightly
      } else {
        lines.push({ page: item.page, y: item.y, items: [item] });
      }
    });

  // 2. Within each line, sort left-to-right and split into columns by gap size.
  var GAP_THRESHOLD = 20; // points; a bigger horizontal gap than this = new column
  var rows = [];

  lines.forEach(function (line) {
    var sorted = line.items.slice().sort(function (a, b) { return a.x - b.x; });
    var columns = [];
    var current = [sorted[0]];

    for (var i = 1; i < sorted.length; i++) {
      if (sorted[i].x - (current[current.length - 1].x + current[current.length - 1].str.length * 4) > GAP_THRESHOLD) {
        columns.push(current);
        current = [sorted[i]];
      } else {
        current.push(sorted[i]);
      }
    }
    columns.push(current);

    var texts = columns.map(function (col) {
      return col.map(function (it) { return it.str; }).join(' ').trim();
    });

    // A holdings row candidate needs at least a name-like column and a
    // number-like column. A line that doesn't (page headers, footers,
    // the report's own column headings) is simply not treated as a row.
    var qtyColIndex = -1;
    var qtyValue = null;
    for (var c = 0; c < texts.length; c++) {
      var asNumber = parseFloat(texts[c].replace(/,/g, ''));
      if (!isNaN(asNumber) && texts[c].replace(/[\s,.\d]/g, '') === '') {
        qtyColIndex = c;
        qtyValue = asNumber;
        break;
      }
    }

    var nameColIndex = texts.findIndex(function (t, idx) {
      return idx !== qtyColIndex && /[A-Za-z]{3,}/.test(t);
    });

    if (nameColIndex === -1 || qtyColIndex === -1) {
      return; // not a data row - most likely a header, footer or page title
    }

    var tickerGuess = texts.find(function (t, idx) {
      return idx !== nameColIndex && idx !== qtyColIndex && /^[A-Z]{2,5}$/.test(t);
    }) || '';

    var confidence = 'high';
    var reason = null;
    if (texts.length > 4) {
      // More columns than expected for a simple holdings line - the
      // heuristic may have split one field into two, so it is flagged
      // rather than trusted silently.
      confidence = 'low';
      reason = 'Found ' + texts.length + ' columns on this line; expected 3-4. Please check the values.';
    }

    rows.push({
      name: texts[nameColIndex],
      ticker: tickerGuess,
      quantity: qtyValue,
      confidence: confidence,
      reason: reason
    });
  });

  return rows;
}
