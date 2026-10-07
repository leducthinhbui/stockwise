// test/guardrail.test.js
// SIT774 Task 10.3HD - the explain-never-recommend guardrail, and the AI explainer built on it.
//
// H9 (guardrail). Thresholds are on the HELD-OUT set, not the one the rules were
// tuned on. The adversarial numbers are not asserted here because they are a
// documented weakness, not a promise; test/experiments/guardrail-eval.js prints them.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkExplanation, MAX_LENGTH } = require('../lib/guardrail');
const { SAMPLE_NEWS } = require('../lib/alerts-db');
const { evaluate } = require('./experiments/guardrail-eval');
const corpus = require('./data/advice-corpus');

test('held-out set: at least 80% of violating sentences are caught', () => {
  const r = evaluate(corpus.test);
  assert.ok(r.recall >= 0.8, `recall was ${r.recall}`);
});

test('held-out set: no more than 10% of plain sentences are wrongly flagged', () => {
  const r = evaluate(corpus.test);
  assert.ok(r.falsePositiveRate <= 0.1, `false positive rate was ${r.falsePositiveRate}`);
});

test('development set is a regression guard: nothing it once caught regresses', () => {
  const r = evaluate(corpus.dev);
  assert.equal(r.caught, r.total);
  assert.equal(r.falseAlarmCount, 0);
});

test("the site's own sample explanations contain no advice, forecast, verdict or pressure language", () => {
  for (const n of SAMPLE_NEWS) {
    for (const field of ['headline', 'summary', 'detail']) {
      const r = checkExplanation(n[field]);
      assert.ok(r.ok, `${n.ticker} ${field}: ${JSON.stringify(r.problems)}`);
    }
  }
});

test('each problem reports its category and the words that triggered it', () => {
  const r = checkExplanation('You should consider buying more shares.');
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].category, 'recommendation');
  assert.match(r.problems[0].match, /should/i);
});

test('empty, non-string and over-long text is rejected without throwing', () => {
  assert.equal(checkExplanation('').ok, false);
  assert.equal(checkExplanation('   ').ok, false);
  assert.equal(checkExplanation(undefined).ok, false);
  assert.equal(checkExplanation(42).ok, false);
  assert.equal(checkExplanation('a'.repeat(MAX_LENGTH + 1)).problems[0].category, 'too-long');
});
