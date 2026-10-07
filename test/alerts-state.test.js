// test/alerts-state.test.js
// SIT774 Task 10.3HD - the permission state function, checked for EVERY input.
//
// H7. The alerts page never claims alerts are working when they are not.
// Method: the function takes four inputs (2 x 4 x 2 x 2 = 32 combinations), so
// instead of sampling a few examples this test runs all 32 and checks the
// promises the proposal makes about them.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeMode, isBoxTicked, MODES } = require('../public/js/alerts-state.js');

const combos = [];
for (const intent of [false, true]) {
  for (const permission of ['default', 'granted', 'denied', 'unsupported']) {
    for (const hasSubscription of [false, true]) {
      for (const setupFailed of [false, true]) {
        combos.push({ intent, permission, hasSubscription, setupFailed });
      }
    }
  }
}

test('all 32 combinations map to exactly one known state', () => {
  assert.equal(combos.length, 32);
  for (const c of combos) {
    assert.ok(MODES.includes(computeMode(c)), `unknown mode for ${JSON.stringify(c)}`);
  }
});

test('"active" is only ever reported when alerts are genuinely working', () => {
  for (const c of combos) {
    if (computeMode(c) === 'active') {
      assert.equal(c.intent, true);
      assert.equal(c.permission, 'granted');
      assert.equal(c.hasSubscription, true);
      assert.equal(c.setupFailed, false);
    }
  }
});

test('every combination that is genuinely working is reported as active', () => {
  for (const c of combos) {
    const working = c.intent && c.permission === 'granted' && c.hasSubscription && !c.setupFailed;
    if (working) assert.equal(computeMode(c), 'active');
  }
});

test('with alerts off, nothing else matters: always "off"', () => {
  for (const c of combos.filter((x) => !x.intent)) {
    assert.equal(computeMode(c), 'off');
  }
});

test('a denied browser permission is always "blocked", whatever else is true', () => {
  for (const c of combos.filter((x) => x.intent && x.permission === 'denied')) {
    assert.equal(computeMode(c), 'blocked');
  }
});

test('the checkbox is never ticked while blocked, failed or waiting for permission', () => {
  for (const c of combos) {
    const mode = computeMode(c);
    if (['blocked', 'failed', 'needs-permission', 'off'].includes(mode)) {
      assert.equal(isBoxTicked(mode), false, `${mode} must not show a ticked box`);
    }
  }
  assert.equal(isBoxTicked('active'), true);
  assert.equal(isBoxTicked('unsupported'), true);
});

test('permission granted but no subscription, or a failed setup, is "failed" (the retry state)', () => {
  assert.equal(computeMode({ intent: true, permission: 'granted', hasSubscription: false, setupFailed: false }), 'failed');
  assert.equal(computeMode({ intent: true, permission: 'granted', hasSubscription: true, setupFailed: true }), 'failed');
});

test('not yet asked is "needs-permission", and a browser without push is "unsupported"', () => {
  assert.equal(computeMode({ intent: true, permission: 'default', hasSubscription: false, setupFailed: false }), 'needs-permission');
  assert.equal(computeMode({ intent: true, permission: 'unsupported', hasSubscription: false, setupFailed: false }), 'unsupported');
});
