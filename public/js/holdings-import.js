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

   File System Access API (window.showOpenFilePicker) is used for CSV, with
   a plain <input type="file"> + FileReader fallback for PDF and for
   browsers without File System Access support (Safari and Firefox, as of
   this trimester) - the feature degrades gracefully rather than failing.
   ========================================================================== */

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
    var progressBar = document.getElementById('importProgressBar');
    var progressText = document.getElementById('importProgressText');
    var reviewSection = document.getElementById('reviewSection');
    var reviewBody = document.getElementById('reviewBody');
    var reviewSummary = document.getElementById('reviewSummary');
    var savedBanner = document.getElementById('holdingsSavedBanner');

    var worker = null;
    var rowCounter = 0;

    // --- File System Access API support check -----------------------------
    // Feature-detected once, not assumed. showOpenFilePicker is used only
    // for CSV (per the proposal); PDF always goes through the fallback,
    // since PDF handling here does not depend on which file-open API
    // supplied the bytes.
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
            description: 'CSV holdings export',
            accept: { 'text/csv': ['.csv'] }
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
            items.push({
              str: it.str,
              x: it.transform[4],
              // Flip to a top-down y so page order matches reading order.
              y: viewport.height - it.transform[5],
              page: pageNum
            });
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
        hideProgress();
        addRowsToReview(msg.rows);
      }
    }

    // --- Progress state (Wireframe B): explicit that nothing has been
    // uploaded, announced via aria-live rather than on every tick so a
    // screen-reader user is not flooded with updates. ----------------------
    function showProgress(percent, label) {
      progressRegion.classList.remove('d-none');
      progressBar.style.width = percent + '%';
      progressBar.setAttribute('aria-valuenow', String(percent));
      progressText.textContent = label + '. This file has not been uploaded - it is only being read on this device.';
    }

    function hideProgress() {
      progressRegion.classList.add('d-none');
    }

    function showImportError(message) {
      hideProgress();
      progressRegion.classList.remove('d-none');
      progressText.textContent = message;
      progressBar.style.width = '100%';
      progressBar.classList.add('bg-danger');
    }

    // --- Review table (Wireframe C) ----------------------------------------
    addManualBtn.addEventListener('click', function () {
      addRowsToReview([{ name: '', ticker: '', quantity: null, confidence: 'high', reason: null, manual: true }]);
    });

    function addRowsToReview(rows) {
      if (rows.length === 0) return;
      reviewSection.classList.remove('d-none');
      savedBanner.classList.add('d-none');

      rows.forEach(function (row) {
        rowCounter += 1;
        var tr = document.createElement('tr');
        tr.dataset.rowId = String(rowCounter);
        if (row.confidence === 'low') {
          tr.classList.add('table-warning');
        }

        tr.appendChild(editableCell('name', row.name));
        tr.appendChild(editableCell('ticker', row.ticker));
        tr.appendChild(editableCell('quantity', row.quantity === null ? '' : String(row.quantity)));

        var statusCell = document.createElement('td');
        if (row.confidence === 'low') {
          var badge = document.createElement('span');
          badge.className = 'badge text-bg-warning';
          badge.textContent = 'Needs review';
          statusCell.appendChild(badge);
          if (row.reason) {
            var reasonText = document.createElement('div');
            reasonText.className = 'small text-body-secondary mt-1';
            reasonText.textContent = row.reason;
            statusCell.appendChild(reasonText);
          }
        } else {
          var goodBadge = document.createElement('span');
          goodBadge.className = 'badge text-bg-success';
          goodBadge.textContent = 'Included';
          statusCell.appendChild(goodBadge);
        }
        tr.appendChild(statusCell);

        var actionCell = document.createElement('td');
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-outline-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', function () {
          tr.remove();
          updateSummary();
        });
        actionCell.appendChild(removeBtn);
        tr.appendChild(actionCell);

        reviewBody.appendChild(tr);
      });

      updateSummary();
    }

    function editableCell(field, value) {
      var td = document.createElement('td');
      var input = document.createElement('input');
      input.type = field === 'quantity' ? 'number' : 'text';
      input.className = 'form-control form-control-sm';
      input.value = value;
      input.setAttribute('aria-label', field.charAt(0).toUpperCase() + field.slice(1));
      input.dataset.field = field;
      td.appendChild(input);
      return td;
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
    saveBtn.addEventListener('click', function () {
      var rows = reviewBody.querySelectorAll('tr');
      if (rows.length === 0) {
        return;
      }
      savedBanner.classList.remove('d-none');
      savedBanner.focus();
      reviewSection.classList.add('d-none');
    });
  });
})();
