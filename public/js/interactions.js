/* ==========================================================================
   StockWise - shared page interactivity
   SIT774 Task 7.2D (Website Project, Part 2 of 3 - interactive prototype)

   Loaded on every page. Handles the one dynamic element that is genuinely
   hand-written rather than a Bootstrap data-attribute component: a
   "back to top" link that appears once the visitor has scrolled a page
   down, and disappears again near the top.

   The accordion (Plans & Services) and the modal (Home) are Bootstrap
   components, wired up with data-bs-* attributes in the markup itself, so
   they need no JavaScript of their own here.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var backToTop = document.getElementById('backToTop');
    if (!backToTop) {
      return; // page has no back-to-top link
    }

    // Shown only after the visitor has scrolled past roughly one screen's
    // worth of content, so it is never visible on a page short enough that
    // "back to top" would be meaningless. Tied to the actual viewport height
    // rather than a fixed pixel guess, so "one screen" means one screen on
    // both a small laptop and a tall external monitor.
    var SHOW_AFTER_PX = window.innerHeight;

    function updateVisibility() {
      if (window.scrollY > SHOW_AFTER_PX) {
        backToTop.classList.add('is-visible');
      } else {
        backToTop.classList.remove('is-visible');
      }
    }

    // Runs once on load in case the page opens already scrolled (e.g. to a
    // fragment link), then again on every scroll event.
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });

    backToTop.addEventListener('click', function (event) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Keyboard users land back at the skip link, the first focusable
      // element on the page, rather than staying focused on a link that has
      // just scrolled off screen.
      var skipLink = document.querySelector('.skip-link');
      if (skipLink) {
        skipLink.focus();
      }
    });
  });
})();
