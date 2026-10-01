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

// Guarded rather than called unconditionally: this file is also require()'d
// directly, unmodified, by test/holdings-import-worker.test.js, so parseCsv
// and groupPdfItemsIntoRows can be tested without a real Worker/browser. In
// an actual Worker, self.addEventListener exists and this runs as normal.
if (typeof self !== 'undefined' && self.addEventListener) {
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
      var groupStart = performance.now();
      var rows2 = groupPdfItemsIntoRows(msg.items);
      var groupMs = performance.now() - groupStart;
      // Logged from inside the worker (visible in DevTools under its own
      // thread), so it can be compared against the main-thread extraction
      // time holdings-import.js logs for the same import.
      console.log('[timing] worker row-grouping (' + msg.items.length + ' items): ' +
        groupMs.toFixed(1) + 'ms, vs ' + (msg.extractMs || 0).toFixed(1) + 'ms main-thread extraction');
      self.postMessage({ type: 'result', rows: rows2 });
      return;
    }
  });
}


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
  var NAME_X_TOLERANCE = 25; // points; how far a wrapped line's start can drift from the name column
  var rows = [];
  var lastRow = null; // the row a wrapped continuation line may merge into
  var lastRowMeta = null; // { page, y, nameX } for the line lastRow came from

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
    // number-like column that is a unit count, not a dollar figure - a
    // column containing "$" is a value, never the quantity, even when it
    // is the only number on the line (a market-value or cash-balance line
    // has no unit count to read).
    var qtyColIndex = -1;
    var qtyValue = null;
    var dollarColIndex = -1;
    for (var c = 0; c < texts.length; c++) {
      var hasDollar = texts[c].indexOf('$') !== -1;
      var stripped = texts[c].replace(/[$]/g, '');
      var asNumber = parseFloat(stripped.replace(/,/g, ''));
      var isNumericColumn = !isNaN(asNumber) && stripped.replace(/[\s,.\d]/g, '') === '';
      if (!isNumericColumn) continue;
      if (hasDollar) {
        if (dollarColIndex === -1) {
          dollarColIndex = c;
        }
        continue;
      }
      qtyColIndex = c;
      qtyValue = asNumber;
      break;
    }

    var hasAnyDigits = /\d/.test(texts.join(''));

    if (qtyColIndex === -1 && dollarColIndex === -1) {
      // Not obviously a data row. It may be a wrapped continuation of the
      // name directly above it - but only if it is on the same page,
      // close enough vertically (within ~1.5 line-heights) and starts at
      // roughly the same x as that row's name column, so a section
      // heading, a repeated page-2 column heading, or a disclaimer
      // paragraph below the table does not get folded in just because it
      // happens to contain only letters. At most one line merges: lastRow
      // is cleared below regardless, so a second, unrelated text-only
      // line right after it cannot also merge.
      if (lastRow && lastRowMeta && !hasAnyDigits &&
          texts.some(function (t) { return /[A-Za-z]{3,}/.test(t); }) &&
          line.page === lastRowMeta.page &&
          Math.abs(line.firstY - lastRowMeta.y) <= 1.5 * medianHeight &&
          Math.abs(sorted[0].x - lastRowMeta.nameX) <= NAME_X_TOLERANCE) {
        lastRow.name = (lastRow.name + ' ' + texts.join(' ').trim()).trim();
        lastRow.confidence = 'low';
        lastRow.reason = 'This name may include text merged from a wrapped second line - please check it.';
      }
      lastRow = null;
      lastRowMeta = null;
      continue;
    }

    // Find the ticker first (a short, mostly-uppercase token that can
    // include digits, since ASX codes such as A2M and 4DX are common),
    // then take the longest remaining text column as the name. Doing it
    // in this order matters: on a statement where the ticker column comes
    // before the name column, picking "the first column with letters" as
    // the name (the previous approach) grabbed the ticker instead.
    var tickerColIndex = -1;
    for (var t = 0; t < texts.length; t++) {
      if (t !== qtyColIndex && t !== dollarColIndex && /^[A-Z0-9]{2,5}$/.test(texts[t]) && /[A-Z]/.test(texts[t])) {
        tickerColIndex = t;
        break;
      }
    }

    var nameColIndex = -1;
    var longest = -1;
    for (var n = 0; n < texts.length; n++) {
      if (n === qtyColIndex || n === dollarColIndex || n === tickerColIndex) continue;
      if (/[A-Za-z]{3,}/.test(texts[n]) && texts[n].length > longest) {
        longest = texts[n].length;
        nameColIndex = n;
      }
    }

    if (nameColIndex === -1) {
      lastRow = null;
      lastRowMeta = null;
      continue; // not a data row - most likely a header, footer or page title
    }

    var name = texts[nameColIndex];
    var ticker = tickerColIndex === -1 ? '' : texts[tickerColIndex];

    var confidence = 'high';
    var reason = null;
    if (RESERVED_NAME_PATTERN.test(name)) {
      confidence = 'low';
      reason = 'This looks like a total or summary line, not a holding.';
    } else if (qtyColIndex === -1) {
      // Only a dollar figure was found - a market value or cash balance,
      // not a number of units. Kept and flagged rather than guessed at.
      confidence = 'low';
      reason = 'Only a dollar value was found here (' + texts[dollarColIndex] + '), no unit quantity.';
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
      quantity: qtyColIndex === -1 ? null : qtyValue,
      confidence: confidence,
      reason: reason
    };
    rows.push(row);
    lastRow = row;
    lastRowMeta = { page: line.page, y: line.firstY, nameX: columns[nameColIndex][0].x };
  }

  return rows;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCsv: parseCsv, groupPdfItemsIntoRows: groupPdfItemsIntoRows };
}
