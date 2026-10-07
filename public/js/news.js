/* ==========================================================================
   StockWise - news explanation page
   SIT774 Task 10.3HD (implementing the Task 7.3HD proposal)

   Runs on news.html, the page a notification opens. It asks the server for
   one news item. The server only answers if (a) there is a signed-in
   session, (b) the user holds that stock, and (c) the item has been
   released, and it shapes the answer by plan:
     - Free: a short summary of what happened
     - Standard / Full: the fuller explanation plus one named analyst's
       reported words, attributed to its source
   The plan changes how much detail is shown, never how soon the user is told:
   the notification went out to every plan at the same moment.
   ========================================================================== */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var status = $('newsStatus');
  var article = $('newsArticle');
  var problem = $('newsProblem');
  var problemText = $('newsProblemText');

  function showProblem(message) {
    status.classList.add('d-none');
    article.classList.add('d-none');
    problem.classList.remove('d-none');
    problemText.textContent = message;
  }

  var id = new URLSearchParams(window.location.search).get('id');
  if (!id || !/^\d+$/.test(id)) {
    showProblem('This page needs a news item. Open one from My alerts.');
    return;
  }

  fetch('/api/news/' + encodeURIComponent(id), { credentials: 'same-origin' })
    .then(function (res) {
      if (res.status === 401) {
        throw new Error('Please sign in on My alerts first, then open this item again.');
      }
      if (res.status === 404) {
        // The same answer for "no such item", "not released yet" and "not a
        // stock you hold", so the page never reveals which one it was.
        throw new Error('We could not find that item for your account.');
      }
      if (!res.ok) {
        throw new Error('Something went wrong loading this item. Please try again.');
      }
      return res.json();
    })
    .then(function (item) {
      // textContent throughout: these strings come from a server.
      $('tickerBadge').textContent = item.ticker;
      $('headline').textContent = item.headline;
      $('releasedAt').textContent = 'Released ' + new Date(item.releasedAt).toLocaleString();

      if (item.fullExplanation) {
        $('whatHappened').textContent = item.detail;
        $('analystQuote').textContent = '“' + item.analyst.quote + '”';

        var who = $('analystWho');
        who.textContent = item.analyst.name + ', ' + item.analyst.firm + '. ';
        // Only ever link out to https. A link from data is not trusted blindly.
        if (/^https:\/\//.test(item.analyst.sourceUrl)) {
          var link = document.createElement('a');
          link.href = item.analyst.sourceUrl;
          link.rel = 'noopener noreferrer';
          link.textContent = 'Source';
          who.appendChild(link);
        }
        $('analystDt').classList.remove('d-none');
        $('analystDd').classList.remove('d-none');
      } else {
        $('whatHappened').textContent = item.summary;
        $('planNote').classList.remove('d-none');
      }

      status.classList.add('d-none');
      article.classList.remove('d-none');
      document.title = 'StockWise — ' + item.headline;
      $('headline').setAttribute('tabindex', '-1');
      $('headline').focus(); // the notification opened this page: start at the news
    })
    .catch(function (err) {
      showProblem(err.message);
    });
})();
