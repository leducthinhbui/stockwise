/* ==========================================================================
   StockWise - Portfolio News Alerts, page logic
   SIT774 Task 10.3HD (implementing the Task 7.3HD proposal)

   Runs on alerts.html. It does five things:
     1. signs in a demo user and lists/edits their holdings
     2. turns instant alerts on and off (permission, service worker, push
        subscription), as ONE feature with a small state machine
     3. keeps the second checkbox ("show the name on my lock screen")
        dependent on the first, without hiding it from keyboard users
     4. shows every permission in one "Account & Privacy" table
     5. shows the in-app "For your portfolio" list (also the fallback for
        browsers that cannot receive push)

   Three browser APIs make the instant part work:
     - Notification  : asks the user's permission, and shows the alert
     - Service Worker: a background script (sw.js) that can run with every
                       tab closed
     - PushManager   : subscribes this browser to the push service, which is
                       what lets the server reach it when the page is closed

   Everything is drawn with textContent / createElement, never innerHTML,
   because the values come from a server.
   ========================================================================== */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var el = {
    loading: $('loadingMessage'),
    signedOut: $('signedOut'),
    signinError: $('signinError'),
    signedIn: $('signedIn'),
    whoami: $('whoamiHeading'),
    signOut: $('signOutBtn'),
    holdingsList: $('holdingsList'),
    holdingsCount: $('holdingsCount'),
    holdingsMessage: $('holdingsMessage'),
    addForm: $('addHoldingForm'),
    ticker: $('tickerInput'),
    notify: $('notifyImmediately'),
    lock: $('showOnLock'),
    lockHelp: $('lockHelp'),
    alertState: $('alertState'),
    retry: $('retryBtn'),
    release: $('releaseBtn'),
    reset: $('resetBtn'),
    demoMessage: $('demoMessage'),
    privacyBody: $('privacyBody'),
    deleteData: $('deleteDataBtn'),
    privacyMessage: $('privacyMessage'),
    newsList: $('newsList'),
    newsEmpty: $('newsEmpty')
  };

  // Can this browser receive push at all? Not every one can: for example
  // iOS Safari only supports it for sites added to the home screen. Those
  // users still get every alert in the in-app list below.
  var pushCapable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  var swRegistration = null;   // set once sw.js is registered
  var me = null;               // the signed-in user, from /api/me
  var state = {                // what reconcile() last read
    prefs: { notifyImmediately: false, showOnLockScreen: false, subscriptionCount: 0 },
    permission: 'default',     // the browser's own answer: default | granted | denied
    subscription: null,        // this browser's push subscription, if any
    setupFailed: false         // permission is granted but subscribing failed
  };

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  // fetch wrapper: always JSON, always sends the session cookie, throws an
  // Error (with .status) carrying the server's own message on a non-2xx.
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok) {
          var err = new Error((json && json.error) || 'Request failed (' + res.status + ').');
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  // Only writes when the text really changed, so a live region (role=status)
  // does not announce the same sentence again on every refresh.
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  // The push subscription needs the server's public key as bytes, but the
  // server sends it as URL-safe base64.
  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // -------------------------------------------------------------------------
  // Sign in / out and start-up
  // -------------------------------------------------------------------------

  function showSignedOut() {
    el.loading.classList.add('d-none');
    el.signedIn.classList.add('d-none');
    el.signedOut.classList.remove('d-none');
  }

  async function showSignedIn(user) {
    me = user;
    el.loading.classList.add('d-none');
    el.signedOut.classList.add('d-none');
    el.signedIn.classList.remove('d-none');
    setText(el.whoami, 'Signed in as ' + me.name + ' (' + me.plan + ' plan)');

    await registerServiceWorker();
    await loadHoldings();
    await reconcile();
    await loadNews();
  }

  async function start() {
    try {
      await showSignedIn(await api('GET', '/api/me'));
    } catch (err) {
      if (err.status === 401) {
        showSignedOut();
      } else {
        el.loading.textContent = 'Could not load this page: ' + err.message;
      }
    }
  }

  document.querySelectorAll('[data-user-id]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      el.signinError.textContent = '';
      try {
        await api('POST', '/api/session', { userId: Number(btn.dataset.userId) });
        await showSignedIn(await api('GET', '/api/me'));
        el.whoami.focus(); // move keyboard / screen reader focus to the new view
      } catch (err) {
        el.signinError.textContent = err.message;
      }
    });
  });

  el.signOut.addEventListener('click', async function () {
    await api('DELETE', '/api/session');
    me = null;
    showSignedOut();
  });

  // -------------------------------------------------------------------------
  // Holdings
  // -------------------------------------------------------------------------

  function drawHoldings(holdings) {
    el.holdingsList.textContent = '';
    holdings.forEach(function (ticker) {
      var li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      var name = document.createElement('span');
      name.textContent = ticker;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-light btn-sm';
      btn.textContent = 'Remove';
      // The visible word is just "Remove", so the accessible name says which one.
      btn.setAttribute('aria-label', 'Remove ' + ticker);
      btn.addEventListener('click', async function () {
        try {
          drawHoldings((await api('DELETE', '/api/holdings/' + encodeURIComponent(ticker))).holdings);
          setText(el.holdingsMessage, ticker + ' removed.');
          await loadNews();
        } catch (err) {
          setText(el.holdingsMessage, err.message);
        }
      });
      li.appendChild(name);
      li.appendChild(btn);
      el.holdingsList.appendChild(li);
    });
    var limit = me.holdingLimit === null ? 'unlimited' : me.holdingLimit;
    setText(el.holdingsCount, holdings.length + ' of ' + limit + ' holdings on the ' + me.plan + ' plan.');
  }

  async function loadHoldings() {
    drawHoldings((await api('GET', '/api/holdings')).holdings);
  }

  el.addForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var ticker = el.ticker.value.trim().toUpperCase();
    // The server checks this again: the page can be bypassed, the server cannot.
    if (!/^[A-Z]{2,5}$/.test(ticker)) {
      setText(el.holdingsMessage, 'A ticker is 2 to 5 letters, for example HBK.');
      el.ticker.focus();
      return;
    }
    try {
      drawHoldings((await api('POST', '/api/holdings', { ticker: ticker })).holdings);
      setText(el.holdingsMessage, ticker + ' added.');
      el.ticker.value = '';
      await loadNews();
    } catch (err) {
      setText(el.holdingsMessage, err.message);
      el.ticker.focus();
    }
  });

  // -------------------------------------------------------------------------
  // Alerts: service worker, subscription, and the state machine
  // -------------------------------------------------------------------------

  async function registerServiceWorker() {
    if (!pushCapable || swRegistration) return;
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // sw.js tells open tabs when it has just shown a notification.
      navigator.serviceWorker.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'news-pushed') loadNews();
      });
    } catch (err) {
      console.error('Service worker registration failed:', err);
      swRegistration = null; // behaves like an unsupported browser from here
    }
  }

  function canPush() {
    return pushCapable && swRegistration !== null;
  }

  async function saveSubscription(subscription) {
    await api('POST', '/api/push/subscribe', subscription.toJSON());
  }

  // Subscribes this browser and tells the server about it. If a subscription
  // already exists it is reused. If the server's keys changed since it was
  // made, the browser refuses it (InvalidStateError), so the old one is
  // dropped and a fresh one made.
  async function subscribe() {
    var key = (await api('GET', '/api/push/public-key')).publicKey;
    var options = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) };
    var sub = await swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await swRegistration.pushManager.subscribe(options);
    }
    await saveSubscription(sub);
    return sub;
  }

  async function subscribeWithRepair() {
    try {
      return await subscribe();
    } catch (err) {
      if (err && err.name === 'InvalidStateError') {
        var old = await swRegistration.pushManager.getSubscription();
        if (old) await old.unsubscribe();
        return subscribe();
      }
      throw err;
    }
  }

  function putPrefs(notifyImmediately, showOnLockScreen) {
    return api('PUT', '/api/alerts/prefs', {
      notifyImmediately: notifyImmediately,
      showOnLockScreen: showOnLockScreen
    });
  }

  // Reads the two independent sources of truth and redraws:
  //   1. the server's stored INTENT ("I want alerts")
  //   2. the browser's live PERMISSION (granted / denied / default)
  // They can disagree, because the user can change the browser permission in
  // its own settings at any time, outside this page. So the permission is
  // read fresh every time, never remembered from earlier.
  async function reconcile() {
    state.prefs = await api('GET', '/api/alerts/prefs');
    state.permission = canPush() ? Notification.permission : 'unsupported';
    state.subscription = canPush() ? await swRegistration.pushManager.getSubscription() : null;

    if (canPush() && state.prefs.notifyImmediately && state.permission === 'granted') {
      if (!state.subscription) {
        // Wanted and allowed, but nothing subscribed (for example the
        // browser's data was cleared). No prompt is needed, so repair quietly.
        try {
          state.subscription = await subscribeWithRepair();
          state.setupFailed = false;
        } catch (err) {
          console.error('Subscribing failed:', err);
          state.setupFailed = true;
        }
      } else if (state.prefs.subscriptionCount === 0) {
        // The browser has a subscription the server lost: send it again.
        try { await saveSubscription(state.subscription); } catch (err) { state.setupFailed = true; }
      }
    }
    render();
  }

  // The five states from the proposal's permission diagram (Figure 2):
  //   off         intent is off
  //   active      intent on + permission granted + subscribed
  //   blocked     intent on + permission denied. Cannot be re-asked from
  //               JavaScript; only the user can undo it, in browser settings
  //   failed      permission granted but subscribing failed (our side), retry
  //   unsupported this browser cannot receive push: in-app list only
  // plus "needs permission": intent saved but the browser has not been asked.
  function currentMode() {
    // The decision itself lives in js/alerts-state.js so it can be tested
    // exhaustively; this just feeds it what the page has read.
    return AlertsState.computeMode({
      intent: state.prefs.notifyImmediately,
      permission: state.permission,
      hasSubscription: !!state.subscription,
      setupFailed: state.setupFailed
    });
  }

  var MESSAGES = {
    off: ['alert-secondary', 'Alerts are off. Nothing is sent to this browser.'],
    active: ['alert-success', 'Alerts are on for this browser. You will be notified as soon as there is news about a holding.'],
    blocked: ['alert-warning', 'Notifications for StockWise are blocked in your browser. Look for a site permissions or site settings option near the address bar to allow them. Your choice here is saved, so alerts start as soon as you allow them.'],
    failed: ['alert-warning', 'We could not finish turning on alerts. That is on our side, not your browser. Please try again.'],
    unsupported: ['alert-info', 'This browser cannot show push notifications. Your alerts will still appear in the list under "For your portfolio" below.'],
    'needs-permission': ['alert-info', 'Alerts are saved as on, but this browser has not been asked yet. Tick the box to allow notifications.']
  };

  function render() {
    var mode = currentMode();
    var prefs = state.prefs;

    // Checkbox 1 shows whether alerts are REALLY working, not just wanted.
    // Blocked / failed / needs-permission show unticked, so the box is never
    // a quiet lie about something the browser has vetoed.
    el.notify.checked = AlertsState.isBoxTicked(mode);

    // Checkbox 2 keeps the stored value even while inert, so turning alerts
    // back on restores the earlier choice instead of resetting it silently.
    var lockAvailable = prefs.notifyImmediately;
    el.lock.checked = prefs.showOnLockScreen;
    el.lock.setAttribute('aria-disabled', lockAvailable ? 'false' : 'true');
    el.lock.classList.toggle('opacity-50', !lockAvailable);
    setText(el.lockHelp, lockAvailable
      ? 'Off by default. Anyone near your phone can read its lock screen, so only turn this on if that is fine for you.'
      : 'Available once "Notify me immediately" is on. Your choice here is kept.');

    var msg = MESSAGES[mode];
    el.alertState.className = 'alert mb-2 ' + msg[0];
    setText(el.alertState, msg[1]);
    el.retry.classList.toggle('d-none', mode !== 'failed');

    drawPrivacyTable(mode);
  }

  // Turning alerts ON. Must be reached straight from the user's click:
  // browsers only show the permission prompt for a user-initiated action, and
  // Chrome quietly downgrades prompts fired without one.
  async function enableAlerts() {
    // A busy flag and aria-busy instead of the native "disabled" attribute,
    // which would drop focus off the checkbox in the middle of the request.
    busy = true;
    el.notify.setAttribute('aria-busy', 'true');
    try {
      var permission = canPush() ? Notification.permission : 'unsupported';
      if (permission === 'default') {
        permission = await Notification.requestPermission(); // the browser's own prompt
      }
      // The intent is saved whatever the answer was; the page then reads the
      // real permission, so a "denied" shows as blocked rather than as on.
      await putPrefs(true, state.prefs.showOnLockScreen);
      state.setupFailed = false;
      if (canPush() && permission === 'granted') {
        try {
          state.subscription = await subscribeWithRepair();
        } catch (err) {
          console.error('Subscribing failed:', err);
          state.setupFailed = true;
        }
      }
    } finally {
      busy = false;
      el.notify.removeAttribute('aria-busy');
      await reconcile();
    }
  }

  // Turning alerts OFF. The server also deletes the stored subscriptions when
  // it sees notifyImmediately=false, so the channel is gone, not just unused.
  async function disableAlerts() {
    try {
      if (canPush()) {
        var sub = await swRegistration.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      await putPrefs(false, state.prefs.showOnLockScreen);
      state.setupFailed = false;
    } finally {
      await reconcile();
    }
  }

  var busy = false; // true while turning alerts on, so a double click is ignored

  el.notify.addEventListener('change', function () {
    if (busy) return;
    if (el.notify.checked) {
      enableAlerts();
    } else {
      disableAlerts();
    }
  });

  // Checkbox 2 is inert until checkbox 1 is on. It stays focusable (so a
  // keyboard user can find it and hear why), and the click is cancelled here.
  el.lock.addEventListener('click', function (event) {
    if (el.lock.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
    }
  });
  el.lock.addEventListener('change', async function () {
    if (el.lock.getAttribute('aria-disabled') === 'true') return;
    await putPrefs(state.prefs.notifyImmediately, el.lock.checked);
    await reconcile();
  });

  el.retry.addEventListener('click', async function () {
    state.setupFailed = false;
    await reconcile(); // tries to subscribe again, then redraws
  });

  // -------------------------------------------------------------------------
  // Account & Privacy: everything granted, in one table
  // -------------------------------------------------------------------------

  function row(permission, status, meaning) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.scope = 'row';
    th.textContent = permission;
    tr.appendChild(th);
    [status, meaning].forEach(function (text) {
      var td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    return tr;
  }

  var STATUS_TEXT = {
    off: 'Off',
    active: 'On, this browser',
    blocked: 'Requested, but blocked by your browser',
    failed: 'Requested, setup failed',
    unsupported: 'On, in-app list only',
    'needs-permission': 'Requested, waiting for browser permission'
  };

  function drawPrivacyTable(mode) {
    el.privacyBody.textContent = '';
    el.privacyBody.appendChild(row(
      'Notify me immediately',
      STATUS_TEXT[mode],
      'Lets StockWise send a notification to this browser when there is news about a holding. Turning it off deletes the stored push subscription.'
    ));
    el.privacyBody.appendChild(row(
      "Show the holding's name on my lock screen",
      state.prefs.showOnLockScreen ? 'On' : 'Off',
      state.prefs.showOnLockScreen
        ? 'Notifications name the stock and the headline, so anyone who can see your lock screen can too.'
        : 'Notifications only say there is news about one of your holdings.'
    ));
    el.privacyBody.appendChild(row(
      'Push subscriptions stored for your account',
      String(state.prefs.subscriptionCount),
      'Each one is a live channel to one browser. It is deleted when you turn alerts off or delete your alert data.'
    ));
  }

  el.deleteData.addEventListener('click', async function () {
    if (!window.confirm('Turn off alerts and delete your alert settings and push subscriptions?')) return;
    try {
      if (canPush()) {
        var sub = await swRegistration.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      await api('DELETE', '/api/alerts');
      state.setupFailed = false;
      await reconcile();
      setText(el.privacyMessage, 'Your alert settings and subscriptions were deleted.');
    } catch (err) {
      setText(el.privacyMessage, err.message);
    }
  });

  // -------------------------------------------------------------------------
  // In-app news list ("For your portfolio")
  // -------------------------------------------------------------------------

  async function loadNews() {
    if (!me) return;
    var items;
    try {
      items = (await api('GET', '/api/news')).news;
    } catch (err) {
      return; // signed out meanwhile; the next sign-in reloads the list
    }
    el.newsList.textContent = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'list-group-item';
      var link = document.createElement('a');
      link.href = 'news.html?id=' + encodeURIComponent(item.id);
      link.textContent = item.headline;
      var meta = document.createElement('div');
      meta.className = 'small text-body-secondary';
      meta.textContent = item.ticker + ' · ' + new Date(item.released_at).toLocaleString();
      li.appendChild(link);
      li.appendChild(meta);
      el.newsList.appendChild(li);
    });
    el.newsEmpty.classList.toggle('d-none', items.length > 0);
  }

  // -------------------------------------------------------------------------
  // Demo controls (prototype only; the server omits these in production)
  // -------------------------------------------------------------------------

  el.release.addEventListener('click', async function () {
    try {
      var result = await api('POST', '/api/dev/release-news');
      if (!result.released) {
        setText(el.demoMessage, result.message);
      } else {
        var sent = result.delivered.sent;
        setText(el.demoMessage,
          'Released a sample item about ' + result.released.ticker + '. ' +
          (sent > 0
            ? sent + ' push notification' + (sent === 1 ? '' : 's') + ' sent.'
            : 'No push was sent because alerts are off or this browser is not subscribed. It is in the list below.'));
      }
      await loadNews();
    } catch (err) {
      setText(el.demoMessage, err.message);
    }
  });

  el.reset.addEventListener('click', async function () {
    try {
      await api('POST', '/api/dev/reset-news');
      setText(el.demoMessage, 'Sample news reset.');
      await loadNews();
    } catch (err) {
      setText(el.demoMessage, err.message);
    }
  });

  // Keep the list fresh without the user reloading: when the tab becomes
  // visible again, and every 20 seconds while it is open.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && me) { reconcile().then(loadNews); }
  });
  setInterval(loadNews, 20000);

  start();
})();
