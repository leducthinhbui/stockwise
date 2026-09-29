/* ==========================================================================
   StockWise - register page confirmation (prototype only)
   SIT774 Task 5.2D / 10.3HD

   This page has never had a real account database behind it - it is a
   design prototype (Task 5.2D), and the only part of it with a working
   backend is the "Your holdings" import feature (js/holdings-import.js,
   Task 10.3HD). Without this script, clicking "Create account" made a
   plain GET request to this same page with every field appended to the
   URL as a query string, since the <form> has no action or handler - which
   looked like the button did nothing.

   This intercepts that submit, relies on the browser's own required-field
   validation (the form has no novalidate, so a genuinely incomplete form
   is still blocked before this ever runs), and shows an honest on-page
   message instead of a silent, confusing page reload.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('registerForm');
    var banner = document.getElementById('registerSuccessBanner');
    if (!form || !banner) {
      return; // this page has no register form
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      banner.classList.remove('d-none');
      banner.focus();
    });
  });
})();
