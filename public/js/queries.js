/* ==========================================================================
   StockWise - administrator review of contact-form queries
   SIT774 Task 10.2D (Website Project, Part 3 - database integration)

   Loads queries.html's table from GET /api/queries, re-fetching whenever the
   search box, sort order or page changes, rather than filtering rows already
   on the page - the server holds the full set and only sends one page at a
   time. Delete removes a row via DELETE /api/queries/:id and reloads the
   current page of results.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var filterForm = document.getElementById('queryFilterForm');
    var body = document.getElementById('queriesBody');
    if (!filterForm || !body) {
      return; // this page has no query table
    }

    var errorBox = document.getElementById('queriesError');
    var summary = document.getElementById('queriesSummary');
    var pagination = document.getElementById('queriesPagination');
    var qInput = document.getElementById('filterQ');
    var sortSelect = document.getElementById('filterSort');

    var currentPage = 1;
    var PAGE_SIZE = 5;

    filterForm.addEventListener('submit', function (event) {
      event.preventDefault();
      currentPage = 1;
      loadQueries();
    });

    loadQueries();

    function loadQueries() {
      var params = new URLSearchParams({
        q: qInput.value.trim(),
        sort: sortSelect.value,
        page: String(currentPage),
        pageSize: String(PAGE_SIZE)
      });

      fetch('/api/queries?' + params.toString())
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            showError(result.data.error || 'Could not load queries.');
            return;
          }
          hideError();

          // If a delete emptied the current page (e.g. the last row on the
          // last page), the server still echoes back the page we asked for.
          // Step back one page and reload rather than showing an empty page
          // that looks like "no search results" when nothing was searched.
          if (result.data.queries.length === 0 && currentPage > 1 && currentPage > result.data.totalPages) {
            currentPage = result.data.totalPages;
            loadQueries();
            return;
          }

          render(result.data);
        })
        .catch(function () {
          showError('Could not reach the server. Is it running?');
        });
    }

    function render(data) {
      body.innerHTML = '';

      if (data.queries.length === 0) {
        var emptyRow = document.createElement('tr');
        var emptyCell = document.createElement('td');
        emptyCell.colSpan = 6;
        emptyCell.className = 'text-center text-body-secondary';
        emptyCell.textContent = 'No queries match this search.';
        emptyRow.appendChild(emptyCell);
        body.appendChild(emptyRow);
      }

      data.queries.forEach(function (item) {
        var row = document.createElement('tr');

        row.appendChild(cell(formatDate(item.created_at)));
        row.appendChild(cell(item.name));
        row.appendChild(cell(item.email));
        row.appendChild(cell(item.phone || '–'));
        row.appendChild(cell(item.query));

        var actionCell = document.createElement('td');
        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-sm btn-outline-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', function () {
          deleteQuery(item.id);
        });
        actionCell.appendChild(deleteBtn);
        row.appendChild(actionCell);

        body.appendChild(row);
      });

      summary.textContent = 'Showing ' + data.queries.length + ' of ' + data.total +
        (data.total === 1 ? ' query' : ' queries') +
        (qInput.value.trim() !== '' ? ' matching "' + qInput.value.trim() + '"' : '') + '.';

      renderPagination(data.page, data.totalPages);
    }

    function renderPagination(page, totalPages) {
      pagination.innerHTML = '';

      addPageItem('Previous', page - 1, page <= 1);
      for (var p = 1; p <= totalPages; p++) {
        addPageItem(String(p), p, false, p === page);
      }
      addPageItem('Next', page + 1, page >= totalPages);
    }

    function addPageItem(label, targetPage, disabled, active) {
      var li = document.createElement('li');
      li.className = 'page-item' + (disabled ? ' disabled' : '') + (active ? ' active' : '');

      if (disabled) {
        var span = document.createElement('span');
        span.className = 'page-link';
        span.textContent = label;
        li.appendChild(span);
      } else {
        var link = document.createElement('a');
        link.className = 'page-link';
        link.href = '#';
        link.textContent = label;
        if (active) {
          link.setAttribute('aria-current', 'page');
        }
        link.addEventListener('click', function (event) {
          event.preventDefault();
          currentPage = targetPage;
          loadQueries();
        });
        li.appendChild(link);
      }

      pagination.appendChild(li);
    }

    function deleteQuery(id) {
      fetch('/api/queries/' + id, { method: 'DELETE' })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            showError(result.data.error || 'Could not delete this query.');
            return;
          }
          hideError();
          loadQueries();
        })
        .catch(function () {
          showError('Could not reach the server. Is it running?');
        });
    }

    function cell(text) {
      var td = document.createElement('td');
      td.textContent = text;
      return td;
    }

    function formatDate(isoString) {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) {
        return isoString;
      }
      return d.toLocaleString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }

    function showError(message) {
      errorBox.textContent = message;
      errorBox.classList.remove('d-none');
    }

    function hideError() {
      errorBox.classList.add('d-none');
      errorBox.textContent = '';
    }
  });
})();
