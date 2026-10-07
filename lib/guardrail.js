// lib/guardrail.js
// SIT774 Task 10.3HD - the "explain, never recommend" rule, as code.
//
// StockWise's promise is that it explains what happened and never recommends,
// forecasts, judges or pressures. That promise is easy to state and easy to
// break by accident, especially if a language model drafts the explanation.
// This module checks a piece of StockWise-written text against four kinds of
// forbidden language before it is allowed to reach a user:
//
//   recommendation   telling the reader what to buy, sell or hold
//   forecast         saying which way a price or earnings will go
//   verdict          calling a result good or bad (a rating with extra steps)
//   urgency          pressure to act now (the site bans "don't miss out")
//
// It is a set of regular expressions, not understanding. It is fast, free,
// predictable and easy to read, which makes it a sensible FIRST filter, but a
// determined paraphrase can slip past it. The evaluation in
// test/experiments/guardrail-eval.js measures how often, on sentences written
// for the purpose, and the report states the limits. In production it would
// sit in front of human review, not replace it.
//
// It checks StockWise's own words. An analyst's reported quote is attributed
// to its author and is shown as theirs, so it is not run through this.

'use strict';

const MAX_LENGTH = 1200;

// Words that, after a modal like "should", make a sentence advice.
const ACTION = '(?:buy|buying|sell|selling|hold|holding|add|adding|trim|trimming|top up|accumulate|accumulating|exit|reduce|avoid|stay|keep|take profits?|celebrate)';
// Words that say which way a quantity is going.
const DIRECTION = '(?:rise|fall|drop|climb|grow|increase|decrease|jump|surge|plunge|double|outperform|underperform|rally|recover|decline|boost|lift|improve|expand|keep growing|go up|go down|raise|cut)';

const RULES = [
  // --- recommendation ------------------------------------------------------
  { category: 'recommendation',
    pattern: new RegExp(`\\b(?:should|ought to|need to|may want to|might want to|would do well to|could consider|would be wise to|best to)\\b[^.!?]{0,30}\\b${ACTION}\\b`, 'i') },
  { category: 'recommendation',
    pattern: /\b(?:we|i|our)\b[^.!?]{0,15}\b(?:recommend|suggest|advise|advice is|rate|would not sell|would sell|would buy|would avoid)\b/i },
  { category: 'recommendation',
    pattern: /\b(?:consider|think about)\s+(?:buying|selling|holding|adding|trimming|accumulating)\b/i },
  { category: 'recommendation',
    pattern: /\b(?:good|great|right|best|ideal)\s+(?:time|moment|opportunity)\s+to\b/i },
  { category: 'recommendation',
    pattern: /\b(?:now|this)\s+(?:might be|may be|is)\s+the\s+(?:moment|time)\s+to\b/i },
  { category: 'recommendation',
    pattern: /^\s*(?:buy|sell|accumulate)\b/i },
  { category: 'recommendation',
    pattern: /\b(?:buy|sell)\s+(?:now|today|more|the dip|on any)\b/i },
  { category: 'recommendation',
    pattern: /\b(?:a|the)\s+(?:cautious|prudent|sensible|wise)\s+(?:investor|shareholder)\s+would\b/i },
  { category: 'recommendation',
    pattern: /\bmakes sense to\b[^.!?]{0,20}\b(?:top up|buy|sell|add|trim)\b/i },

  // --- forecast ------------------------------------------------------------
  { category: 'forecast',
    pattern: new RegExp(`\\b(?:will|is going to|are going to|is set to|are set to|is poised to|are poised to|could|should|is likely to|are likely to|is expected to|are expected to|is projected to|is forecast to|are forecast to)\\s+(?:\\w+\\s+){0,2}${DIRECTION}\\b`, 'i') },
  { category: 'forecast',
    pattern: /\bwill\s+(?:likely|probably)\b/i },
  { category: 'forecast',
    pattern: /\b(?:we|i|analysts?|experts?|economists?)\s+(?:expect|predict|forecast|anticipate|project)\b/i },
  { category: 'forecast',
    pattern: /^\s*expect\b/i },
  { category: 'forecast',
    pattern: /\b(?:forecast|projected|expected)\s+to\s+(?:outperform|underperform)\b/i },
  { category: 'forecast',
    pattern: /\b(?:heading|headed|moving)\s+(?:higher|lower|up|down)\b/i },
  { category: 'forecast',
    pattern: /\b(?:price target|target price|upside|downside)\b/i },
  { category: 'forecast',
    pattern: /\b(?:higher|lower|stronger|weaker|better|worse)\s+\w+\s+ahead\b/i },
  { category: 'forecast',
    pattern: /\bfrom here\b/i },

  // --- verdict -------------------------------------------------------------
  { category: 'verdict',
    pattern: /\b(?:excellent|impressive|disappointing|terrible|great|worrying|alarming|solid|strong|weak|poor|bullish|bearish)\b/i },
  { category: 'verdict',
    pattern: /\b(?:good|bad)\s+news\b/i },

  // --- urgency -------------------------------------------------------------
  { category: 'urgency',
    pattern: /\b(?:act now|act today|must act|don't miss|do not miss|don't wait|do not wait|last chance|hurry|limited time|urgent|running out|grab|while you can|be quick|before the opportunity)\b/i }
];

// Returns { ok, problems }. Each problem is { category, match } or, for text
// that is unusable regardless of wording, { category: 'empty' | 'too-long' }.
function checkExplanation(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, problems: [{ category: 'empty' }] };
  }
  if (text.length > MAX_LENGTH) {
    return { ok: false, problems: [{ category: 'too-long' }] };
  }
  const problems = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) problems.push({ category: rule.category, match: m[0].trim() });
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { checkExplanation, RULES, MAX_LENGTH };
