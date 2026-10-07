# Review table accessibility checklist (Task 10.3HD)

Covers what `review-table-a11y.js` can't: real Tab order, Enter/Space
activation, and whether a screen reader actually announces what the code
sets up to announce.

**How to fill this in:** for each line, circle YES or NO based on what
really happens. Only add a note if something felt off or surprising -
otherwise YES/NO is enough. Don't fill in results you haven't observed.

**Date run:** 2 Oct 2026
**Browser / version:** Chromium (Claude's built-in browser pane, real keyboard events via the OS-level key-press API - not simulated clicks)
**macOS version:** n/a for this pass (browser-only; see note below)

**Who ran this:** Claude, not the student - run because the student's own screen recording of this part didn't save correctly and they asked for it to be done so testing wasn't skipped entirely. Flagged here plainly rather than left unstated. The student still needs to do Part 2 (VoiceOver) themselves, since that needs a real screen reader, which this pass could not use.

## Part 1 — keyboard only (don't touch the mouse)

Server running at http://localhost:3000/register.html.

1. Tab to "Choose statement file", press Enter. File picker opens? **YES** (partial)
   - Note: The button is reachable by keyboard, clearly shows a visible focus ring, and Enter fires its click handler. Whether the native OS file picker itself then opens could not be confirmed this way - browser automation cannot drive a real OS-level dialog, so this one line is weaker evidence than the rest below.
2. Cancel it. Tab to "Add a holding manually", press Enter. Cursor lands in the new row's Name box? **YES**
   - Note: Confirmed via real focus state after a real Enter keypress.
3. Type a name, Tab past Quantity (leave blank), Tab to Remove, press Enter. Row disappears and focus lands somewhere sensible (not lost)? **YES**
   - Note: Row removed; focus fell back to the "Review before saving" heading, not lost to the page body.
4. Add two more rows the same way (3 rows total). Tab to the 2nd row's Remove button, press Enter. Focus lands on the 3rd row's Remove button? **YES**
   - Note: Confirmed - focus moved to the next remaining row's Remove button, which also had the correct dynamic aria-label.
5. With a row still flagged "Needs review", Tab to "Save holdings", press Enter. Focus jumps to the flagged row's Name box (not nothing)? **YES**
   - Note: Save correctly refused with both rows still blank; focus moved to a flagged row's Name field and the status region announced "2 rows need fixing before you can save."
6. Fix that row properly (name + quantity filled in), Tab to Save, press Enter. Confirmation banner appears? **YES**
   - Note: Both rows fixed by real typing (Commonwealth Bank/250, BHP Group/180); status region announced "Fixed. Nothing else needs review."; Save then succeeded, banner appeared and received focus.

## Part 2 — VoiceOver (press Cmd+F5 to turn on, Cmd+F5 again to turn off)

1. Import a CSV file. Once it finishes, does VoiceOver say something like "Found N holdings" on its own, without you moving? YES / NO
   - Note:
2. Tab into a row flagged "Needs review", land on Name. Does VoiceOver also read the reason it's flagged? YES / NO
   - Note:
3. Fix that field. Does VoiceOver say anything ("Fixed...") right when it's fixed? YES / NO
   - Note:
4. Tab to a Remove button. Does it name the holding ("Remove Commonwealth Bank"), not just "Remove, button"? YES / NO
   - Note:
5. With a row still flagged, Tab to Save, press Enter. Does VoiceOver explain why nothing saved? YES / NO
   - Note:

## Anything else surprising

(one or two lines is fine, or leave blank)
