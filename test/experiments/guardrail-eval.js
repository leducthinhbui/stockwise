// test/experiments/guardrail-eval.js
// SIT774 Task 10.3HD - Experiment: how well does the advice-language guardrail work?
//
// HYPOTHESIS (H9). On sentences it was not tuned on, the guardrail flags at
// least 80% of recommendation / forecast / verdict / urgency sentences (recall)
// and wrongly flags no more than 10% of plain explanatory sentences (false
// positive rate).
//
// METHOD. test/data/advice-corpus.js has two sets of 30 violating and 30 clean
// sentences. The "dev" set was used to write the rules; the "test" set was
// written beforehand and scored once. Both are reported, because a score on the
// set you tuned on flatters you. Misses are listed in full.
//
// A third, adversarial set (never used for tuning) tries to get past the rules and
// includes harmless sentences full of trigger words, to find the real limits.
//
// Run: node test/experiments/guardrail-eval.js

'use strict';

const { checkExplanation } = require('../../lib/guardrail');
const corpus = require('../data/advice-corpus');

function evaluate(set) {
  const missed = set.violations.filter((s) => checkExplanation(s).ok);
  const falseAlarms = set.clean
    .map((s) => ({ s, r: checkExplanation(s) }))
    .filter((x) => !x.r.ok);
  const caught = set.violations.length - missed.length;
  return {
    recall: caught / set.violations.length,
    falsePositiveRate: falseAlarms.length / set.clean.length,
    caught, total: set.violations.length,
    falseAlarmCount: falseAlarms.length, cleanTotal: set.clean.length,
    missed, falseAlarms
  };
}

const pct = (x) => (x * 100).toFixed(1) + '%';

for (const name of ['dev', 'test', 'adversarial']) {
  const r = evaluate(corpus[name]);
  console.log(`\n=== ${name} set ===`);
  console.log(`recall:               ${r.caught}/${r.total} = ${pct(r.recall)}`);
  console.log(`false positive rate:  ${r.falseAlarmCount}/${r.cleanTotal} = ${pct(r.falsePositiveRate)}`);
  if (r.missed.length) console.log('MISSED violations:\n  - ' + r.missed.join('\n  - '));
  if (r.falseAlarms.length) {
    console.log('FALSE ALARMS on clean sentences:\n  - ' +
      r.falseAlarms.map((x) => `${x.s}   [${x.r.problems.map((p) => p.category + ': "' + p.match + '"').join('; ')}]`).join('\n  - '));
  }
}

if (require.main === module && process.argv.includes('--json')) {
  console.log(JSON.stringify({ dev: evaluate(corpus.dev), test: evaluate(corpus.test), adversarial: evaluate(corpus.adversarial) }, null, 2));
}

module.exports = { evaluate };
