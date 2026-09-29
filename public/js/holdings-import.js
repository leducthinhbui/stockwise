/* ==========================================================================
   StockWise - "Import your holdings" feature
   SIT774 Task 10.3HD (implementing the Task 7.3HD proposal)

   Reads a broker statement (CSV or PDF) entirely in the browser - nothing is
   uploaded, no server and no brokerage connection is involved at any point -
   and hands the raw content to holdings-import-worker.js for parsing, so a
   large file does not freeze the page. Parsed rows land in an editable
   review table; nothing is added to the account until the user clicks
   "Save holdings" (Step 6 of the proposal: parsed rows are never
   auto-committed).

   File System Access API (window.showOpenFilePicker) is used where the
   browser supports it, offering both CSV and PDF in the same native
   picker; a plain <input type="file"> + FileReader fallback covers PDF
   parsing either way and browsers without File System Access support
   (Safari and Firefox, as of this trimester) - the feature degrades
   gracefully rather than failing.
   ========================================================================== */

// Converts one pdf.js TextItem into the { str, x, y, w, h, page } shape the
// worker reads. Pulled out of extractPdfTextItems below so it can be
// require()'d and tested in Node (test/holdings-import.test.js) without a
// real PDF or DOM - the actual coordinate flip and width/height pass-through
// is the step a fake-item test can't otherwise reach. Returns null for a
// whitespace-only run, which pdf.js emits for the gaps between real text and
// which would otherwise show up as an empty "column" during row-grouping.
function pdfTextItemToPoint(it, pageNum, viewportHeight) {
  if (!it.str || it.str.trim() === '') {
    return null;
  }
  return {
    str: it.str,
    x: it.transform[4],
    // Flip to a top-down y so page order matches reading order.
    y: viewportHeight - it.transform[5],
    page: pageNum,
    w: it.width,
    h: it.height
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pdfTextItemToPoint: pdfTextItemToPoint };
}

// Guarded the same way as holdings-import-worker.js: this file is also
// require()'d directly, unmodified, by test/holdings-import.test.js, and
// there is no `document` in that context to attach a listener to.
if (typeof document !== 'undefined') {
  (function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
      var panel = document.getElementById('importPanel');
    if (!panel) {
      return; // this page has no import feature
    }

    var chooseFileBtn = document.getElementById('chooseFileBtn');
    var fileInputFallback = document.getElementById('fileInputFallback');
    var dropZone = document.getElementById('importDropZone');
    var addManualBtn = document.getElementById('addManualRowBtn');
    var saveBtn = document.getElementById('saveHoldingsBtn');
    var progressRegion = document.getElementById('importProgress');
    var progressBarWrap = document.getElementById('importProgressBarWrap');
    var progressBar = document.getElementById('importProgressBar');
    var progressText = document.getElementById('importProgressText');
    var reviewSection = document.getElementById('reviewSection');
    var reviewHeading = document.getElementById('reviewHeading');
    var reviewBody = document.getElementById('reviewBody');
    var reviewSummary = document.getElementById('reviewSummary');
    var savedBanner = document.getElementById('holdingsSavedBanner');

    var worker = null;
    var rowCounter = 0;

    // --- File System Access API support check -----------------------------
    // Feature-detected once, not assumed. Both formats are offered in the
    // same picker: which file the user chose is only known after they
    // choose it, so the picker can't be format-specific ahead of time.
    var supportsFileSystemAccess = typeof window.showOpenFilePicker === 'function';

    chooseFileBtn.addEventListener('click', function () {
      if (supportsFileSystemAccess) {
        openWithFileSystemAccess();
      } else {
        fileInputFallback.click();
      }
    });

    fileInputFallback.addEventListener('change', function () {
      var file = fileInputFallback.files[0];
      if (file) {
        handleFile(file);
      }
      fileInputFallback.value = ''; // allow re-selecting the same file later
    });

    // Drag-and-drop is a convenience, never the only path (Step 6 of the
    // proposal) - the Choose File button above always works and is itself a
    // real, keyboard-focusable, screen-reader-operable button.
    ['dragover', 'dragenter'].forEach(function (evtName) {
      dropZone.addEventListener(evtName, function (event) {
        event.preventDefault();
        dropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend'].forEach(function (evtName) {
      dropZone.addEventListener(evtName, function () {
        dropZone.classList.remove('is-dragover');
      });
    });
    dropZone.addEventListener('drop', function (event) {
      event.preventDefault();
      dropZone.classList.remove('is-dragover');
      var file = event.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    });

    async function openWithFileSystemAccess() {
      try {
        var handles = await window.showOpenFilePicker({
          types: [{
            description: 'Holdings export (CSV or PDF)',
            accept: { 'text/csv': ['.csv'], 'application/pdf': ['.pdf'] }
          }],
          multiple: false
        });
        var file = await handles[0].getFile();
        handleFile(file);
      } catch (err) {
        // AbortError is the user closing the picker without choosing a
        // file - not a failure worth reporting.
        if (err.name !== 'AbortError') {
          showImportError('Could not open that file: ' + err.message);
        }
      }
    }

    function handleFile(file) {
      var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      var isCsv = file.type === 'text/csv' || /\.csv$/i.test(file.name);

      if (!isPdf && !isCsv) {
        showImportError('Please choose a .csv or .pdf file. StockWise only reads these two formats locally, in your browser.');
        return;
      }

      // A new file replaces the rows from a previous import, rather than
      // adding to them - otherwise dropping the same statement twice (or
      // importing two different ones) silently doubles every holding.
      // Rows added with "Add a holding manually" are a different source
      // and are left alone.
      clearImportedRows();

      showProgress(10, 'Reading ' + file.name + ' (nothing is uploaded)');

      if (isCsv) {
        var textReader = new FileReader();
        textReader.onload = function () {
          showProgress(35, 'Parsing ' + file.name + ' in a background worker');
          sendToWorker({ type: 'csv', text: textReader.result });
        };
        textReader.onerror = function () {
          showImportError('Could not read that file.');
        };
        textReader.readAsText(file);
      } else {
        extractPdfTextItems(file);
      }
    }

    /**
     * pdf.js (loaded from the CDN script tag in register.html) manages its
     * own internal worker for the heavy binary PDF parsing, so this stays
     * on the main thread via its async API - the main thread is not
     * blocked while it runs, since pdf.js itself is already off-thread for
     * the expensive part. The lightweight { str, x, y, page } items this
     * produces are then handed to holdings-import-worker.js, which does the
     * CPU-bound row-grouping heuristic (see that file's header comment for
     * why that step, specifically, is not also inside pdf.js's own worker).
     */
    async function extractPdfTextItems(file) {
      try {
        showProgress(20, 'Opening ' + file.name);
        var arrayBuffer = await file.arrayBuffer();
        var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        var items = [];
        for (var pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          showProgress(20 + Math.round((pageNum / pdf.numPages) * 30),
            'Reading page ' + pageNum + ' of ' + pdf.numPages);
          var page = await pdf.getPage(pageNum);
          var content = await page.getTextContent();
          var viewport = page.getViewport({ scale: 1 });

          content.items.forEach(function (it) {
            // pdf.js already measures each run; the worker's row/column
            // grouping uses width/height instead of guessing from string
            // length, and whitespace-only runs are dropped here rather
            // than reaching the worker as empty columns.
            var point = pdfTextItemToPoint(it, pageNum, viewport.height);
            if (point) {
              items.push(point);
            }
          });
        }

        showProgress(55, 'Grouping ' + items.length + ' text runs into rows');
        sendToWorker({ type: 'pdf', items: items });
      } catch (err) {
        showImportError('Could not read that PDF: ' + err.message);
      }
    }

    function sendToWorker(message) {
      if (!worker) {
        worker = new Worker('js/holdings-import-worker.js');
        worker.addEventListener('message', onWorkerMessage);
        worker.addEventListener('error', function (err) {
          showImportError('The parser hit an unexpected problem: ' + err.message);
        });
      }
      worker.postMessage(message);
    }

    function onWorkerMessage(event) {
      var msg = event.data;
      if (msg.type === 'progress') {
        showProgress(msg.percent, 'Parsing…');
      } else if (msg.type === 'result') {
        finishProgress(msg.rows);
        addRowsToReview(msg.rows);
      }
    }

    // --- Progress state (Wireframe B): explicit that nothing has been
    // uploaded, announced via aria-live rather than on every tick so a
    // screen-reader user is not flooded with updates. ----------------------
    function showProgress(percent, label) {
      progressRegion.classList.remove('d-none');
      progressBarWrap.classList.remove('d-none');
      progressBar.classList.remove('bg-danger');
      progressBar.style.width = percent + '%';
      progressBar.setAttribute('aria-valuenow', String(percent));
      progressText.textContent = label + '. This file has not been uploaded - it is only being read on this device.';
    }

    function hideProgress() {
      progressRegion.classList.add('d-none');
    }

    // The only aria-live region disappearing the moment results arrive
    // meant a screen-reader user heard "Parsing…" and then nothing. This
    // keeps the region visible and gives it something to announce - only
    // the progress bar itself (no longer meaningful once parsing is done)
    // is hidden.
    function finishProgress(rows) {
      progressBarWrap.classList.add('d-none');
      var needsReview = rows.filter(function (r) { return r.confidence === 'low'; }).length;
      progressText.textContent = rows.length === 0
        ? 'No holdings found in this file.'
        : 'Found ' + rows.length + (rows.length === 1 ? ' holding' : ' holdings') +
          (needsReview > 0 ? ', ' + needsReview + (needsReview === 1 ? ' needs' : ' need') + ' review' : '') + '.';
    }

    function showImportError(message) {
      hideProgress();
      progressRegion.classList.remove('d-none');
      progressBarWrap.classList.remove('d-none');
      progressText.textContent = message;
      progressBar.style.width = '100%';
      progressBar.classList.add('bg-danger');
    }

    // --- Review table (Wireframe C) ----------------------------------------
    var RESERVED_NAME_PATTERN = /^(total|subtotal|balance|cash|grand total|portfolio value)\b/i;

    addManualBtn.addEventListener('click', function () {
      var added = addRowsToReview([{ name: '', ticker: '', quantity: null, confidence: 'low', reason: 'Please enter a holding name and quantity.', manual: true }]);
      // The new row lands at the bottom of the table, possibly off
      // screen - focus its Name field rather than leaving focus on the
      // button that no longer has anywhere useful to go next.
      added[0].querySelector('[data-field="name"]').focus();
    });

    function clearImportedRows() {
      reviewBody.querySelectorAll('tr[data-source="import"]').forEach(function (tr) {
        tr.remove();
      });
      updateSummary();
    }

    function addRowsToReview(rows) {
      if (rows.length === 0) return [];
      reviewSection.classList.remove('d-none');
      savedBanner.classList.add('d-none');

      var created = [];

      rows.forEach(function (row) {
        rowCounter += 1;
        var tr = document.createElement('tr');
        tr.dataset.rowId = String(rowCounter);
        tr.dataset.source = row.manual ? 'manual' : 'import';

        tr.appendChild(editableCell(tr, 'name', row.name));
        tr.appendChild(editableCell(tr, 'ticker', row.ticker));
        tr.appendChild(editableCell(tr, 'quantity', row.quantity === null ? '' : String(row.quantity)));

        var statusCell = document.createElement('td');
        tr.appendChild(statusCell);

        var actionCell = document.createElement('td');
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-outline-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', function () {
          // Removing a row deletes the focused button with it, which
          // would otherwise drop focus back to <body> and force a keyboard
          // user to Tab through the whole form again for every row they
          // remove. Move focus to the next row's Remove button, or the
          // previous row's if this was the last one, or the review
          // heading if the table is now empty.
          var allRows = Array.prototype.slice.call(reviewBody.querySelectorAll('tr'));
          var idx = allRows.indexOf(tr);
          var focusRow = allRows[idx + 1] || allRows[idx - 1];
          tr.remove();
          updateSummary();
          if (focusRow) {
            var nextBtn = focusRow.querySelector('.btn-outline-danger');
            if (nextBtn) nextBtn.focus();
          } else if (reviewHeading) {
            reviewHeading.focus();
          }
        });
        actionCell.appendChild(removeBtn);
        tr.appendChild(actionCell);

        reviewBody.appendChild(tr);
        setRowStatus(tr, row.confidence, row.reason);
        created.push(tr);
      });

      updateSummary();
      return created;
    }

    function editableCell(tr, field, value) {
      var td = document.createElement('td');
      var input = document.createElement('input');
      input.type = field === 'quantity' ? 'number' : 'text';
      input.className = 'form-control form-control-sm';
      input.value = value;
      input.setAttribute('aria-label', field.charAt(0).toUpperCase() + field.slice(1));
      input.dataset.field = field;
      // Editing a flagged row should be able to clear the flag (and a
      // clean row can be edited into a bad one) - re-checked live rather
      // than only ever reflecting whatever the parser decided at import
      // time.
      input.addEventListener('input', function () {
        revalidateRow(tr);
      });
      td.appendChild(input);
      return td;
    }

    // Plain field-level checks, used once a row is edited by hand. This is
    // deliberately simpler than the parser's own reasons (extra columns
    // found, etc.) - those were about how the row was read; this is about
    // whether the row, as it now stands, looks like a real holding.
    function revalidateRow(tr) {
      var nameInput = tr.querySelector('[data-field="name"]');
      var qtyInput = tr.querySelector('[data-field="quantity"]');
      var name = nameInput.value.trim();
      var qtyRaw = qtyInput.value.trim();
      var quantity = parseFloat(qtyRaw);

      var confidence = 'high';
      var reason = null;
      var invalidField = null;
      if (name === '') {
        confidence = 'low';
        reason = 'Please enter a holding name.';
        invalidField = 'name';
      } else if (RESERVED_NAME_PATTERN.test(name)) {
        confidence = 'low';
        reason = 'This looks like a total or summary line, not a holding.';
        invalidField = 'name';
      } else if (qtyRaw === '' || isNaN(quantity)) {
        confidence = 'low';
        reason = 'Please enter a quantity.';
        invalidField = 'quantity';
      } else if (quantity <= 0) {
        confidence = 'low';
        reason = 'Quantity must be greater than zero.';
        invalidField = 'quantity';
      }

      nameInput.setAttribute('aria-invalid', String(invalidField === 'name'));
      qtyInput.setAttribute('aria-invalid', String(invalidField === 'quantity'));

      setRowStatus(tr, confidence, reason, true);
      updateSummary();
    }

    function setRowStatus(tr, confidence, reason, announceChange) {
      var previousConfidence = tr.dataset.confidence || null;
      tr.dataset.confidence = confidence;
      tr.classList.toggle('table-warning', confidence === 'low');
      var statusCell = tr.children[3];
      statusCell.innerHTML = '';

      // Tabbing through a flagged row previously never mentioned why it
      // was flagged - the reason lived in a later cell, linked to
      // nothing. Every editable field in the row now points at it.
      var reasonId = 'holding-reason-' + tr.dataset.rowId;
      var inputs = tr.querySelectorAll('input[data-field]');

      if (confidence === 'low') {
        var badge = document.createElement('span');
        badge.className = 'badge text-bg-warning';
        badge.textContent = 'Needs review';
        statusCell.appendChild(badge);
        if (reason) {
          var reasonText = document.createElement('div');
          reasonText.id = reasonId;
          reasonText.className = 'small text-body-secondary mt-1';
          reasonText.textContent = reason;
          statusCell.appendChild(reasonText);
          inputs.forEach(function (input) { input.setAttribute('aria-describedby', reasonId); });
        } else {
          inputs.forEach(function (input) { input.removeAttribute('aria-describedby'); });
        }
      } else {
        // "Parsed", not "Included": this only means the checks StockWise
        // runs found nothing wrong, not that the row is guaranteed
        // correct - especially for a PDF, where there is no structure to
        // check against beyond column count and simple name/number shape.
        var goodBadge = document.createElement('span');
        goodBadge.className = 'badge text-bg-success';
        goodBadge.textContent = 'Parsed';
        statusCell.appendChild(goodBadge);
        inputs.forEach(function (input) {
          input.removeAttribute('aria-describedby');
          input.removeAttribute('aria-invalid');
        });
      }

      updateRemoveLabel(tr);

      // Fixing or breaking a row is announced once, through the same
      // status region the import progress uses - not reviewSummary, which
      // changes on every keystroke and would read out constantly if it
      // were a live region.
      if (announceChange && previousConfidence && previousConfidence !== confidence) {
        var stillNeedsReview = reviewBody.querySelectorAll('tr.table-warning').length;
        var message = confidence === 'high' ? 'Fixed. ' : 'This row needs review. ';
        message += stillNeedsReview === 0
          ? 'Nothing else needs review.'
          : stillNeedsReview + (stillNeedsReview === 1 ? ' row needs' : ' rows need') + ' review.';
        progressRegion.classList.remove('d-none');
        progressBarWrap.classList.add('d-none');
        progressText.textContent = message;
      }
    }

    // Every row previously had identical "Remove" buttons - a keyboard
    // user tabbing through, or a screen-reader user listing the buttons on
    // the page, could not tell one from another. Kept in sync with the
    // name field so it reads e.g. "Remove Commonwealth Bank".
    function updateRemoveLabel(tr) {
      var removeBtn = tr.querySelector('.btn-outline-danger');
      if (!removeBtn) return;
      var name = tr.querySelector('[data-field="name"]').value.trim();
      removeBtn.setAttribute('aria-label', name ? 'Remove ' + name : 'Remove row ' + tr.dataset.rowId);
    }

    function updateSummary() {
      var rowEls = reviewBody.querySelectorAll('tr');
      var needsReview = reviewBody.querySelectorAll('tr.table-warning').length;
      reviewSummary.textContent = rowEls.length === 0
        ? 'No holdings in this import yet.'
        : rowEls.length + (rowEls.length === 1 ? ' holding' : ' holdings') + ' ready to review' +
          (needsReview > 0 ? ', ' + needsReview + ' needs a closer look' : '') + '.';
    }

    // --- Save (Step 4 of the proposal): nothing is added to the account
    // until this point. This is a working front-end prototype of the
    // staged-confirmation step - StockWise's register form has no backend
    // holdings storage yet, so this demonstrates the interaction itself:
    // the moment past which rows are treated as confirmed, matching what
    // the manual-entry consent checkboxes already on this page govern. -----
    //
    // Save is never disabled: a disabled button is skipped by Tab, so a
    // keyboard user could reach it but never learn why it does nothing.
    // Instead, a flagged row blocks the save, moves focus to that row's
    // Name field, and announces why through the same status region.
    saveBtn.addEventListener('click', function () {
      var rows = reviewBody.querySelectorAll('tr');
      if (rows.length === 0) {
        return;
      }
      var firstFlagged = reviewBody.querySelector('tr.table-warning');
      if (firstFlagged) {
        var needsReview = reviewBody.querySelectorAll('tr.table-warning').length;
        progressRegion.classList.remove('d-none');
        progressBarWrap.classList.add('d-none');
        progressText.textContent = needsReview + (needsReview === 1 ? ' row needs' : ' rows need') +
          ' fixing before you can save.';
        firstFlagged.querySelector('[data-field="name"]').focus();
        return;
      }
      savedBanner.classList.remove('d-none');
      savedBanner.focus();
      reviewSection.classList.add('d-none');
    });
  });
  })();
}
