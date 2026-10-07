// SIT774 Task 10.3HD - runs the AI explainer against a REAL model, once.
//
// The unit tests (test/explainer.test.js) use a fake model, so they prove the
// plumbing and the safety behaviour but say nothing about what a real model
// writes. This script does: it drafts an explanation for each sample news item
// and shows what the guardrail made of it. It costs a few cents and needs a key.
//
//   ANTHROPIC_API_KEY=sk-... node test/manual/ai-explainer-live.js
//   (optional) ALERTS_AI_MODEL=claude-haiku-4-5-20251001
//
// Nothing here is saved or published: drafts are only printed, because a draft
// always needs a person's approval (see lib/explainer.js).

'use strict';

const { SAMPLE_NEWS } = require('../../lib/alerts-db');
const { draftExplanation, createAnthropicClient } = require('../../lib/explainer');

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY first. Nothing was sent.');
  process.exit(1);
}
const model = process.env.ALERTS_AI_MODEL || 'claude-haiku-4-5-20251001';
const client = createAnthropicClient({ apiKey, model });

(async () => {
  const tally = { 'needs-review': 0, rejected: 0, error: 0 };
  for (const item of SAMPLE_NEWS) {
    const started = Date.now();
    const r = await draftExplanation({ client, newsItem: item });
    tally[r.status] = (tally[r.status] || 0) + 1;
    console.log(`\n[${item.ticker}] ${item.headline}`);
    console.log(`  status: ${r.status}  (${Date.now() - started} ms, model ${model})`);
    if (r.text) console.log(`  draft:  ${r.text}`);
    if (r.problems && r.problems.length) console.log('  guardrail:', JSON.stringify(r.problems));
    if (r.error) console.log('  error:', r.error);
  }
  console.log('\nSummary:', JSON.stringify(tally));
})();
