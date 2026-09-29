/* SIT774 Task 10.3HD - re-runnable accessibility check for the holdings
   review table (public/js/holdings-import.js).

   This is not an automated test: it exercises real DOM state (focus,
   aria-invalid, aria-describedby, the status region's text) but calls
   .click()/.focus() directly, which proves what the code does, not what a
   keyboard user actually experiences (real Tab order, Enter/Space
   activation, a screen reader speaking the live region). Pair this with
   the manual checklist in test/manual/review-table-a11y-checklist.md,
   which covers what this script can't.

   How to run: open http://localhost:3000/register.html in a browser,
   open DevTools (Cmd+Opt+I), paste this whole file into the Console, and
   press Enter. It logs one line per check with a pass/fail marker and
   ends with a summary. Re-run any time holdings-import.js changes to
   confirm none of this quietly broke.
*/
(function () {
  'use strict';

  var results = [];
  function check(label, actual, expected) {
    var pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ label: label, pass: pass, actual: actual, expected: expected });
    console.log((pass ? '✓' : '✗') + ' ' + label +
      (pass ? '' : ' - expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)));
  }

  // Reset: remove any existing review rows so this can be re-run cleanly.
  document.querySelectorAll('#reviewBody tr').forEach(function (tr) { tr.remove(); });

  var addBtn = document.getElementById('addManualRowBtn');
  var saveBtn = document.getElementById('saveHoldingsBtn');
  var progressText = document.getElementById('importProgressText');
  var progressRegion = document.getElementById('importProgress');

  // 1. Adding a manual row focuses its Name field, not the button.
  addBtn.click();
  var row1 = document.querySelector('#reviewBody tr');
  check('manual add focuses the new row\'s Name field',
    document.activeElement === row1.querySelector('[data-field="name"]'), true);

  // 2. Save is reachable and enabled even while a row is flagged.
  check('Save is not disabled while a row is flagged', saveBtn.disabled, false);
  saveBtn.click();
  check('clicking Save while flagged moves focus to the flagged row\'s Name field',
    document.activeElement === row1.querySelector('[data-field="name"]'), true);
  check('clicking Save while flagged announces how many rows need fixing',
    progressText.textContent.indexOf('need') !== -1, true);
  check('the status region is visible after that announcement',
    progressRegion.classList.contains('d-none'), false);

  // 3. Fixing the row clears aria-invalid/aria-describedby and announces it.
  var nameInput = row1.querySelector('[data-field="name"]');
  var qtyInput = row1.querySelector('[data-field="quantity"]');
  nameInput.value = 'Commonwealth Bank';
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  qtyInput.value = '250';
  qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
  // aria-invalid is removed (not set to "false") when a row is fixed -
  // an absent attribute and aria-invalid="false" are equivalent per ARIA,
  // and removing it is the cleaner markup.
  check('a fixed row has no aria-invalid on Name', nameInput.hasAttribute('aria-invalid'), false);
  check('a fixed row has no aria-describedby', nameInput.hasAttribute('aria-describedby'), false);
  check('fixing the only flagged row announces "Fixed."', progressText.textContent.indexOf('Fixed.') === 0, true);
  check('the Remove button label updates to the holding\'s name',
    row1.querySelector('.btn-outline-danger').getAttribute('aria-label'), 'Remove Commonwealth Bank');

  // 4. A still-flagged row exposes aria-invalid/aria-describedby correctly,
  // from the moment it's created, not only after the user's first edit.
  addBtn.click();
  var rows = document.querySelectorAll('#reviewBody tr');
  var row2 = rows[rows.length - 1];
  var name2 = row2.querySelector('[data-field="name"]');
  check('a freshly added flagged row already has aria-invalid="true" on Name',
    name2.getAttribute('aria-invalid'), 'true');
  name2.value = '';
  name2.dispatchEvent(new Event('input', { bubbles: true }));
  check('an empty Name after editing still has aria-invalid="true"', name2.getAttribute('aria-invalid'), 'true');
  check('an empty Name after editing has aria-describedby pointing at a reason',
    name2.hasAttribute('aria-describedby'), true);
  check('the unnamed row\'s Remove label falls back to "Remove row N"',
    row2.querySelector('.btn-outline-danger').getAttribute('aria-label').indexOf('Remove row') === 0, true);

  // 5. Remove-focus fallback: next row, then previous row, then the heading.
  row2.querySelector('.btn-outline-danger').focus();
  addBtn.click(); // add a third row so removing row2 has a "next" row to land on
  var threeRows = document.querySelectorAll('#reviewBody tr');
  var middle = threeRows[1];
  middle.querySelector('.btn-outline-danger').focus();
  middle.querySelector('.btn-outline-danger').click();
  check('removing a middle row moves focus to the next row\'s Remove button',
    document.activeElement.classList.contains('btn-outline-danger'), true);

  var twoRows = document.querySelectorAll('#reviewBody tr');
  var last = twoRows[twoRows.length - 1];
  last.querySelector('.btn-outline-danger').focus();
  last.querySelector('.btn-outline-danger').click();
  check('removing the last row moves focus to the previous row\'s Remove button',
    document.activeElement.classList.contains('btn-outline-danger'), true);

  var onlyRow = document.querySelector('#reviewBody tr');
  onlyRow.querySelector('.btn-outline-danger').focus();
  onlyRow.querySelector('.btn-outline-danger').click();
  check('removing the only row moves focus to the review heading',
    document.activeElement.id, 'reviewHeading');

  var passed = results.filter(function (r) { return r.pass; }).length;
  console.log('\n' + passed + ' / ' + results.length + ' checks passed.');
  if (passed !== results.length) {
    console.log('Failing checks:', results.filter(function (r) { return !r.pass; }));
  }
})();
