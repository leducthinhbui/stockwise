// lib/explainer.js
// SIT774 Task 10.3HD - using a language model to DRAFT plain-English explanations.
//
// The explanation a user reads when they open an alert has to be written by
// someone. Writing each one by hand does not scale to a live news feed, so the
// natural next step is to let a language model draft it from the raw wire copy.
// This module is that step, built with the limits the evaluation found:
//
//   1. A draft is NEVER published by this module. The best status it can return
//      is 'needs-review': a person approves it. test/experiments/guardrail-eval.js
//      measured the safety filter at 0 of 16 on deliberately disguised advice,
//      so a filter alone cannot be trusted to publish model text unattended.
//   2. The filter (lib/guardrail.js) still runs first and rejects obvious
//      advice, forecast, verdict and pressure language, which saves a reviewer
//      from reading the clearest failures. It is a first filter, not a judge.
//   3. The model is only ever sent PUBLIC news text. It is never sent a user's
//      holdings, name or anything about their account (buildPrompt has no way to
//      receive them), so using a model does not widen the privacy risk the
//      proposal already worried about.
//   4. A model that is down, slow or wrong must not cost anyone their alert:
//      failures return a status, never throw, and the hand-written explanation
//      remains what users see.
//
// The model client is injected, so tests use a fake one and the unit tests
// need no network or key. createAnthropicClient is the real one.

'use strict';

const { checkExplanation } = require('./guardrail');

const SYSTEM_PROMPT = [
  'You write short plain-English explanations of company news for an investing education website.',
  'The reader is an ordinary person who owns shares and may not know the jargon.',
  'Rules, with no exceptions:',
  '1. Explain only what the news item says has HAPPENED. Define any jargon in one short sentence.',
  '2. Do not recommend buying, selling or holding. Do not tell the reader what to do.',
  '3. Do not forecast: no statements about future prices, earnings or direction.',
  '4. Do not judge the news as good, bad, strong, weak, impressive or disappointing.',
  '5. Do not add urgency or pressure.',
  '6. Use only facts in the text you are given. If a detail is not there, do not invent it.',
  '7. At most 90 words. Plain sentences. No headings, lists or markdown.'
].join('\n');

// Only public news fields go in. There is deliberately no parameter for a user.
function buildPrompt(newsItem) {
  const user = [
    `Company ticker: ${newsItem.ticker}`,
    `Headline: ${newsItem.headline}`,
    `Wire copy: ${newsItem.source_text}`,
    '',
    'Write the explanation now.'
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

// Returns { status, text?, problems?, error? } where status is one of:
//   'unavailable'  no model client configured
//   'error'        the model call failed
//   'rejected'     the draft broke the guardrail (text and problems returned)
//   'needs-review' the draft passed the first filter: a person must approve it
async function draftExplanation({ client, newsItem }) {
  if (!client) return { status: 'unavailable' };
  let text;
  try {
    text = await client.complete(buildPrompt(newsItem));
  } catch (err) {
    return { status: 'error', error: err && err.message ? err.message : String(err) };
  }
  text = typeof text === 'string' ? text.trim() : '';
  const check = checkExplanation(text);
  if (!check.ok) return { status: 'rejected', text, problems: check.problems };
  return { status: 'needs-review', text, problems: [] };
}

// The real client: the Anthropic Messages API. The key comes from the
// environment and is never logged or sent anywhere except to that API.
function createAnthropicClient({ apiKey, model, fetchImpl = fetch, timeoutMs = 15000 }) {
  return {
    async complete({ system, user }) {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system,
          messages: [{ role: 'user', content: user }]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) throw new Error(`Model request failed (${res.status}).`);
      const data = await res.json();
      return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
  };
}

module.exports = { SYSTEM_PROMPT, buildPrompt, draftExplanation, createAnthropicClient };
