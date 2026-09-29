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
var RESERVED_NAME_PATTERN = /^(total|subtotal|balance|cash|grand total|portfolio value)\b/i;

function parseCsv(text) {
  var lines = text.split(/\r\n|\r|\n/).filter(function (l) { return l.trim() !== ''; });
  if (lines.length === 0) return [];

  var delimiter = detectDelimiter(lines[0]);

  // A broker export sometimes has an account/date line above the real
  // header ("Account: 1234"). Scan the first few lines for one that
  // actually names a holding/quantity column, rather than assuming line 1.
  var headerRow = -1;
  var nameIdx = -1, tickerIdx = -1, qtyIdx = -1;
  for (var h = 0; h < Math.min(10, lines.length); h++) {
    var candidate = splitCsvLine(lines[h], delimiter).map(function (c) { return c.trim().toLowerCase(); });
    var n = findColumn(candidate, ['name', 'holding', 'security']);
    var q = findColumn(candidate, ['quantity', 'units', 'shares', 'volume']);
    if (n !== -1 && q !== -1) {
      headerRow = h;
      nameIdx = n;
      qtyIdx = q;
      tickerIdx = findColumn(candidate, ['ticker', 'code', 'symbol']);
      break;
    }
  }

  if (headerRow === -1) {
    return [{
      name: '(unknown)', ticker: '', quantity: null,
      confidence: 'low',
      reason: 'Could not find a header row naming a holding and a quantity column in the first 10 lines of this file.'
    }];
  }

  var rows = [];
  for (var i = headerRow + 1; i < lines.length; i++) {
    var fields = splitCsvLine(lines[i], delimiter);
    var name = nameIdx >= 0 ? (fields[nameIdx] || '').trim() : '';
    var ticker = tickerIdx >= 0 ? (fields[tickerIdx] || '').trim() : '';
    var qtyRaw = qtyIdx >= 0 ? (fields[qtyIdx] || '').trim() : '';
    var qtyClean = qtyRaw.replace(/[,$]/g, '').trim();
    var quantity = parseFloat(qtyClean);

    var confidence = 'high';
    var reason = null;
    if (name === '') {
      confidence = 'low';
      reason = 'No holding name found in this row.';
    } else if (RESERVED_NAME_PATTERN.test(name)) {
      confidence = 'low';
      reason = 'This looks like a total or summary line, not a holding.';
    } else if (isNaN(quantity)) {
      confidence = 'low';
      reason = 'Quantity column did not contain a number ("' + qtyRaw + '").';
    } else if (!/^-?\d+(\.\d+)?$/.test(qtyClean)) {
      confidence = 'low';
      reason = 'Quantity column had extra text after the number ("' + qtyRaw + '"); only ' + quantity + ' was used.';
    } else if (quantity <= 0) {
      confidence = 'low';
      reason = 'Quantity is zero or negative.';
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

function detectDelimiter(headerLine) {
  var counts = { ',': (headerLine.match(/,/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length };
  var best = ',';
  Object.keys(counts).forEach(function (d) {
    if (counts[d] > counts[best]) best = d;
  });
  return best;
}

function splitCsvLine(line, delimiter) {
  // A small quoted-field-aware split - good enough for a broker CSV export,
  // not a full RFC 4180 parser.
  delimiter = delimiter || ',';
  var fields = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// A loose match: "Security Name" matches the "security" or "name"
// candidate, not just an exact "security name" == "name" comparison,
// since real broker exports rarely use the exact word alone.
function findColumn(header, candidates) {
  for (var i = 0; i < header.length; i++) {
    for (var j = 0; j < candidates.length; j++) {
      if (header[i].indexOf(candidates[j]) !== -1) return i;
    }
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

  // The tolerance for "same line" scales with the statement's own font
  // size, rather than a fixed 3pt: a tightly-set 7pt statement can pack
  // two lines within 3pt of each other, and a large 14pt layout can spread
  // one line across more than 3pt. pdf.js gives every text item a real
  // height (it.height, passed through as item.h), so the median height on
  // the page is a better basis than a guess.
  var heights = items.map(function (it) { return it.h; }).filter(function (h) { return h > 0; }).sort(function (a, b) { return a - b; });
  var medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  var Y_TOLERANCE = Math.max(1, 0.4 * medianHeight);

  // 1. Group into lines by y-coordinate (per page, so page breaks never merge).
  var lines = [];
  items
    .slice()
    .sort(function (a, b) { return a.page - b.page || a.y - b.y || a.x - b.x; })
    .forEach(function (item) {
      var line = lines[lines.length - 1];
      if (line && line.page === item.page && Math.abs(line.firstY - item.y) <= Y_TOLERANCE) {
        line.items.push(item);
        // firstY is kept fixed (not re-averaged) so the reference position
        // cannot drift line by line as more items are added to it.
      } else {
        lines.push({ page: item.page, firstY: item.y, items: [item] });
      }
    });

  // 2. Within each line, sort left-to-right and split into columns by gap size.
  var GAP_THRESHOLD = 20; // points; a bigger horizontal gap than this = new column
  var rows = [];
  var lastRow = null;

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var sorted = line.items.slice().sort(function (a, b) { return a.x - b.x; });
    var columns = [];
    var current = [sorted[0]];

    for (var i = 1; i < sorted.length; i++) {
      var prevItem = current[current.length - 1];
      // Real item width (it.width, passed through as item.w) when pdf.js
      // supplies one; str.length * 4 is only a fallback estimate, and was
      // the reason long names were splitting into extra columns.
      var prevWidth = prevItem.w > 0 ? prevItem.w : prevItem.str.length * 4;
      if (sorted[i].x - (prevItem.x + prevWidth) > GAP_THRESHOLD) {
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
    // the report's own column headings) is simply not treated as a row -
    // except when it looks like a wrapped continuation of the name just
    // above it (letters only, no number anywhere on the line), in which
    // case it is folded into that row instead of silently dropped.
    var qtyColIndex = -1;
    var qtyValue = null;
    for (var c = 0; c < texts.length; c++) {
      var stripped = texts[c].replace(/[$]/g, '');
      var asNumber = parseFloat(stripped.replace(/,/g, ''));
      if (!isNaN(asNumber) && stripped.replace(/[\s,.\d]/g, '') === '') {
        qtyColIndex = c;
        qtyValue = asNumber;
        break;
      }
    }

    var hasAnyDigits = /\d/.test(texts.join(''));

    if (qtyColIndex === -1) {
      if (lastRow && !hasAnyDigits && texts.some(function (t) { return /[A-Za-z]{3,}/.test(t); })) {
        lastRow.name = (lastRow.name + ' ' + texts.join(' ').trim()).trim();
        lastRow.confidence = 'low';
        lastRow.reason = 'This name may include text merged from a wrapped second line - please check it.';
      }
      continue; // not a data row - most likely a header, footer or page title
    }

    // Find the ticker first (a short, mostly-uppercase token that can
    // include digits, since ASX codes such as A2M and 4DX are common),
    // then take the longest remaining text column as the name. Doing it
    // in this order matters: on a statement where the ticker column comes
    // before the name column, picking "the first column with letters" as
    // the name (the previous approach) grabbed the ticker instead.
    var tickerColIndex = -1;
    for (var t = 0; t < texts.length; t++) {
      if (t !== qtyColIndex && /^[A-Z0-9]{2,5}$/.test(texts[t]) && /[A-Z]/.test(texts[t])) {
        tickerColIndex = t;
        break;
      }
    }

    var nameColIndex = -1;
    var longest = -1;
    for (var n = 0; n < texts.length; n++) {
      if (n === qtyColIndex || n === tickerColIndex) continue;
      if (/[A-Za-z]{3,}/.test(texts[n]) && texts[n].length > longest) {
        longest = texts[n].length;
        nameColIndex = n;
      }
    }

    if (nameColIndex === -1) {
      continue; // not a data row - most likely a header, footer or page title
    }

    var name = texts[nameColIndex];
    var ticker = tickerColIndex === -1 ? '' : texts[tickerColIndex];

    var confidence = 'high';
    var reason = null;
    if (RESERVED_NAME_PATTERN.test(name)) {
      confidence = 'low';
      reason = 'This looks like a total or summary line, not a holding.';
    } else if (qtyValue <= 0) {
      confidence = 'low';
      reason = 'Quantity is zero or negative.';
    } else if (texts.length > 4) {
      // More columns than expected for a simple holdings line - the
      // heuristic may have split one field into two, so it is flagged
      // rather than trusted silently.
      confidence = 'low';
      reason = 'Found ' + texts.length + ' columns on this line; expected 3-4. Please check the values.';
    }

    var row = {
      name: name,
      ticker: ticker,
      quantity: qtyValue,
      confidence: confidence,
      reason: reason
    };
    rows.push(row);
    lastRow = row;
  }

  return rows;
}
