// test/explainer.test.js
// SIT774 Task 10.3HD - the AI explainer's safety behaviour, with a FAKE model.
//
// These tests prove the plumbing and the promises around the model (never
// published automatically, never sent user data, never throws, never costs an
// alert). They say nothing about what a REAL model writes: for that, run
// test/manual/ai-explainer-live.js with a key.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PROMPT, buildPrompt, draftExplanation, createAnthropicClient } = require('../lib/explainer');
const { SAMPLE_NEWS } = require('../lib/alerts-db');

const item = SAMPLE_NEWS[0];
const fake = (reply) => ({ complete: async () => reply });

test('the prompt carries the rules and only the public news text', () => {
  const p = buildPrompt({ ...item, user_holdings: 'SECRET-HOLDINGS', user_name: 'SECRET-NAME', analyst_quote: 'SECRET-QUOTE' });
  assert.match(p.system, /Do not recommend/);
  assert.match(p.system, /Do not forecast/);
  assert.match(p.system, /At most 90 words/);
  assert.ok(p.user.includes(item.headline));
  assert.ok(p.user.includes(item.source_text));
  for (const secret of ['SECRET-HOLDINGS', 'SECRET-NAME', 'SECRET-QUOTE']) {
    assert.ok(!p.user.includes(secret) && !p.system.includes(secret), `${secret} must not reach the model`);
  }
});

test('a clean draft is "needs-review", never published or approved by this module', async () => {
  const r = await draftExplanation({
    client: fake('Southern Cross Mining reported that it shipped 4.1 million tonnes this quarter, more than in any earlier quarter.'),
    newsItem: item
  });
  assert.equal(r.status, 'needs-review');
  assert.deepEqual(r.problems, []);
  assert.ok(!['approved', 'published'].includes(r.status));
});

test('a draft containing advice is rejected, with the reason', async () => {
  const r = await draftExplanation({ client: fake('Shipments were a record, so you should buy more shares now.'), newsItem: item });
  assert.equal(r.status, 'rejected');
  assert.ok(r.problems.length > 0);
});

test('a draft containing a forecast is rejected', async () => {
  const r = await draftExplanation({ client: fake('The share price will rise after this announcement.'), newsItem: item });
  assert.equal(r.status, 'rejected');
  assert.equal(r.problems[0].category, 'forecast');
});

test('an empty or non-text reply is rejected, not treated as acceptable', async () => {
  assert.equal((await draftExplanation({ client: fake(''), newsItem: item })).status, 'rejected');
  assert.equal((await draftExplanation({ client: fake(undefined), newsItem: item })).status, 'rejected');
});

test('a model failure returns a status and never throws, so no alert is lost', async () => {
  const boom = { complete: async () => { throw new Error('model unavailable'); } };
  const r = await draftExplanation({ client: boom, newsItem: item });
  assert.equal(r.status, 'error');
  assert.match(r.error, /model unavailable/);
});

test('with no model configured, the status is "unavailable"', async () => {
  assert.equal((await draftExplanation({ client: null, newsItem: item })).status, 'unavailable');
});

test('the real client sends the key and version headers, the rules, and reads the text back', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'A plain explanation.' }] }) };
  };
  const client = createAnthropicClient({ apiKey: 'test-key', model: 'test-model', fetchImpl });
  const text = await client.complete(buildPrompt(item));
  assert.equal(text, 'A plain explanation.');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'test-key');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.body.model, 'test-model');
  assert.equal(seen.body.system, SYSTEM_PROMPT);
  assert.equal(seen.body.messages[0].role, 'user');
});

test('a non-OK model response becomes an error, and the error does not contain the key', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  const client = createAnthropicClient({ apiKey: 'super-secret-key', model: 'm', fetchImpl });
  await assert.rejects(() => client.complete({ system: 's', user: 'u' }), (err) => {
    assert.match(err.message, /429/);
    assert.ok(!err.message.includes('super-secret-key'));
    return true;
  });
});
