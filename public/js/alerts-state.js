/* ==========================================================================
   StockWise - Portfolio News Alerts, the permission state function
   SIT774 Task 10.3HD

   The page's whole behaviour for "turn alerts on" comes down to one
   question: given what the user asked for and what the browser will allow,
   what state are we really in? This is that question as a PURE function (no
   DOM, no network), so it can be loaded by the page and also required
   straight from a Node test, which then checks every possible combination
   (test/alerts-state.test.js) instead of a handful of examples.

   Same pattern as the Import feature's worker, which is also loaded by the
   browser and require()'d by its tests.

   Inputs
     intent          the server-stored "notify me immediately" choice
     permission      the browser's live answer: 'default' | 'granted' |
                     'denied' | 'unsupported' (no push in this browser)
     hasSubscription this browser currently holds a push subscription
     setupFailed     subscribing was tried and failed
   ========================================================================== */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(); // Node (tests)
  } else {
    root.AlertsState = factory(); // browser
  }
})(this, function () {
  'use strict';

  var MODES = ['off', 'active', 'blocked', 'failed', 'unsupported', 'needs-permission'];

  function computeMode(s) {
    if (!s.intent) return 'off';
    if (s.permission === 'unsupported') return 'unsupported';
    if (s.permission === 'denied') return 'blocked';
    if (s.permission === 'default') return 'needs-permission';
    // permission is 'granted': working only if a subscription really exists
    if (s.setupFailed || !s.hasSubscription) return 'failed';
    return 'active';
  }

  // Is checkbox 1 shown ticked? Only when alerts are really working (or, in a
  // browser that cannot do push, when the in-app list is working). Never for a
  // blocked or failed state, so the box can't quietly claim something the
  // browser has vetoed.
  function isBoxTicked(mode) {
    return mode === 'active' || mode === 'unsupported';
  }

  return { MODES: MODES, computeMode: computeMode, isBoxTicked: isBoxTicked };
});
