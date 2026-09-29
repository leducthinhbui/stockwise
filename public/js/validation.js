/* ==========================================================================
   StockWise - client-side validation for the query / feedback form
   SIT774 Task 5.2D (Website Project, Part 1 - draft pages)
   Extended in Task 10.2D (Part 3) to actually send the query to the server
   once it passes validation, instead of only showing a success message.

   The task specification requires that, when the query form is submitted:
     - no required field is left blank;
     - the email address is in an email format;
     - the phone number is digits only and within a maximum length;
     - if validation fails the form is NOT submitted, and the error message
       appears on the web page itself rather than in a pop-up dialog.

   Server-side, POST /api/queries (server.js) re-checks every one of these
   rules itself, since a request does not have to come from this form.
   ========================================================================== */

(function () {
  'use strict';

  var MAX_PHONE_DIGITS = 10;

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('queryForm');
    if (!form) {
      return; // this page has no query form
    }

    var errorBox = document.getElementById('formErrors');
    var errorHeading = document.getElementById('formErrorsHeading');
    var errorList = document.getElementById('formErrorList');
    var successBox = document.getElementById('formSuccess');
    var DEFAULT_ERROR_HEADING = 'Please fix the following before sending:';
    var PROBLEM_HEADING = 'There was a problem sending your query:';

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var errors = collectErrors(form);

      if (errors.length > 0) {
        // Stop the submission and report the problems on the page.
        showErrors(errors);
        return;
      }

      hideErrors();
      submitQuery(form);
    });

    /* Sends the validated query to the server. The server re-validates
       everything above, so a rejection here (400) is reported the same way
       a client-side failure is, rather than assumed impossible. */
    function submitQuery(f) {
      var submitBtn = f.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
      }

      fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.elements.name.value,
          email: f.elements.email.value,
          phone: f.elements.phone.value,
          query: f.elements.query.value
        })
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
        })
        .then(function (result) {
          if (submitBtn) {
            submitBtn.disabled = false;
          }
          if (!result.ok) {
            // A 400 lists problems the user can fix on the form; a 5xx is the
            // server's fault, so it gets the same heading as a network failure.
            showErrors(result.data.errors || ['Could not save your query.'],
              result.status >= 500 ? PROBLEM_HEADING : undefined);
            return;
          }
          f.reset();
          if (successBox) {
            successBox.classList.remove('d-none');
            successBox.focus();
          }
        })
        .catch(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
          }
          // Not something the user can fix by editing the form, so this
          // gets a different heading from a validation failure.
          showErrors(['Could not reach the server. Is it running?'], PROBLEM_HEADING);
        });
    }

    /* Gather every problem so the user sees all of them at once, rather
       than being told about one field at a time. */
    function collectErrors(f) {
      var found = [];
      var name = f.elements.name.value.trim();
      var email = f.elements.email.value.trim();
      var phone = f.elements.phone.value.trim();
      var query = f.elements.query.value.trim();

      if (name === '') {
        found.push('Please enter your name.');
      }

      if (email === '') {
        found.push('Please enter your email address.');
      } else if (!isEmail(email)) {
        found.push('Please enter a valid email address, for example name@example.com.');
      }

      // Phone is optional, but if it is supplied it must be valid.
      if (phone !== '') {
        if (!/^[0-9]+$/.test(phone)) {
          found.push('Your phone number must contain digits only, with no spaces or symbols.');
        } else if (phone.length > MAX_PHONE_DIGITS) {
          found.push('Your phone number must be no longer than ' + MAX_PHONE_DIGITS + ' digits.');
        }
      }

      if (query === '') {
        found.push('Please tell us what your query is about.');
      }

      return found;
    }

    /* A deliberately simple check: some text, an @, some text, a dot, then
       at least two more characters. */
    function isEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value);
    }

    function showErrors(messages, heading) {
      if (errorHeading) {
        errorHeading.textContent = heading || DEFAULT_ERROR_HEADING;
      }
      errorList.innerHTML = '';
      messages.forEach(function (message) {
        var item = document.createElement('li');
        item.textContent = message;
        errorList.appendChild(item);
      });
      errorBox.classList.add('is-visible');
      if (successBox) {
        successBox.classList.add('d-none');
      }
      errorBox.focus();
    }

    function hideErrors() {
      errorList.innerHTML = '';
      errorBox.classList.remove('is-visible');
      if (errorHeading) {
        errorHeading.textContent = DEFAULT_ERROR_HEADING;
      }
    }
  });
})();
