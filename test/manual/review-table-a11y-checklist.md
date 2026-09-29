# Review table accessibility checklist (Task 10.3HD)

Covers what `review-table-a11y.js` can't: real Tab order, Enter/Space
activation, and whether a screen reader actually announces what the code
sets up to announce. Run this yourself; do not fill in results you haven't
observed.

**Date run:**
**Browser / version:**
**macOS version:**
**Screen reader used:** VoiceOver (Cmd+F5)

## Part 1 — keyboard only (mouse unplugged or untouched)

For each step: what you did, what you expected, what actually happened.

1. Tab to "Choose statement file" and activate it with Enter/Space. Does the
   native file picker open?
   - Expected:
   - Actual:
2. Cancel the picker, then Tab to "Add a holding manually" and activate it.
   Does focus land in the new row's Name field?
   - Expected:
   - Actual:
3. Type a name, Tab to Quantity, leave it blank, Tab to Remove, activate it.
   Does focus land somewhere sensible (there's no next row, so the previous
   row's Remove button, or the review heading if none is left)?
   - Expected:
   - Actual:
4. Add two more rows. Tab to the second row's Remove button and activate
   it. Does focus land on the third row's Remove button?
   - Expected:
   - Actual:
5. With a row still flagged "Needs review", Tab to "Save holdings" and
   activate it. Does focus move to the flagged row's Name field instead of
   the button doing nothing silently?
   - Expected:
   - Actual:
6. Fix that row (valid name and quantity), Tab to Save, activate it. Does
   the save banner appear and receive focus?
   - Expected:
   - Actual:

## Part 2 — VoiceOver (Cmd+F5 to turn on, Cmd+F5 again to turn off)

1. Import a CSV (drag a small test file onto the drop zone, or use Choose
   File). Once parsing finishes, what does VoiceOver say? Does it announce
   the result ("Found N holdings...") without you having to move focus?
   - Expected: the result is announced automatically
   - Actual:
2. Tab into a row flagged "Needs review". When focus lands on the Name
   field, does VoiceOver read the reason (e.g. "No holding name found in
   this row") along with the field?
   - Expected:
   - Actual:
3. Fix that field. Does VoiceOver announce anything at the moment it's
   fixed, without you needing to move focus again?
   - Expected: something like "Fixed. N rows need review."
   - Actual:
4. Tab to a Remove button. Does VoiceOver say which holding it will remove
   (e.g. "Remove Commonwealth Bank"), not just "Remove, button"?
   - Expected:
   - Actual:
5. With a row still flagged, Tab to Save and activate it. Does VoiceOver
   say anything about why saving didn't happen?
   - Expected:
   - Actual:

## Notes

Record anything unexpected here, even if it isn't one of the specific
checks above - a confusing announcement, a focus jump that felt wrong, a
label that didn't make sense out of context.
