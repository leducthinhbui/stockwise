// test/data/advice-corpus.js
// SIT774 Task 10.3HD - labelled sentences for evaluating lib/guardrail.js.
//
// The guardrail's job is to catch StockWise-written explanation text that
// breaks the site's own rule: explain what happened, never recommend, forecast,
// judge, or pressure. Two sets, so the result is not flattering itself:
//
//   dev   used while writing and tuning the rules
//   test  written BEFORE the rules were tuned and scored ONCE at the end
//
// Honest limits, repeated in the report: one person wrote both sets, so the
// test set is held out from the rules but not independent of their author; and
// real model or human text will be messier than these single sentences.
//
// "violations" must be flagged; "clean" must not be. The clean sets
// deliberately include words that look risky in a harmless sense (hold, buy,
// sell, expected to, will, next month) because a checker that flags every
// "hold" would be useless.

'use strict';

const dev = {
  violations: [
    // recommendation
    'You should consider buying more shares before the dividend date.',
    'We recommend holding this stock through the maintenance period.',
    'Investors should sell ahead of the results.',
    'This is a good time to add to your position.',
    'Shareholders ought to hold on to their units.',
    'We suggest trimming your holding after the announcement.',
    'It would be wise to accumulate shares now.',
    'Consider selling if the price falls further.',
    'You may want to buy on any weakness.',
    'We rate this stock a buy.',
    // forecast
    'The share price will rise after this announcement.',
    'Profit is expected to grow strongly next year.',
    'The company is likely to raise its dividend again.',
    'Shares are set to climb on the back of the record shipments.',
    'We expect earnings to increase over the next two quarters.',
    'This approval will boost the share price.',
    'Analysts forecast the stock to outperform the market.',
    'Revenue is projected to double by 2028.',
    'The price is poised to fall when the site reopens.',
    'We predict a higher payout next half.',
    // verdict
    'These are excellent results that investors should celebrate.',
    'A disappointing result for shareholders.',
    'This is bad news for anyone holding the stock.',
    "A strong sign for the company's future.",
    'An impressive quarter that puts the company ahead of its rivals.',
    // urgency
    'Act now before the opportunity passes.',
    "Don't miss out on this dividend.",
    'Last chance to buy before the record date.',
    'Hurry, the offer is only available for a limited time.',
    'This is urgent: review your holding today.'
  ],
  clean: [
    'A dividend is a share of profit paid to shareholders.',
    'The company shipped more ore this quarter than in any earlier quarter.',
    'Fully franked means the company has already paid tax on those profits.',
    "The chief financial officer is responsible for the company's accounts.",
    'The report is expected to be released on Friday.',
    'The record date is the day you must hold the shares to receive the payment.',
    'Mines stop for planned maintenance so equipment can be inspected.',
    'The regulator approved the transfer of a block of radio spectrum.',
    'Half-year results cover the first six months of the financial year.',
    'Shares you already own are called your holdings.',
    'Profit is revenue minus expenses.',
    'The announcement was made to the exchange on Tuesday morning.',
    'The share price rose 2 per cent on the day.',
    'The company said it would pay the dividend on 29 October.',
    'Analysts at the firm reported that shipments were above their model.',
    'A holding is any share or fund you own.',
    'The maintenance is scheduled for 12 days from 3 November.',
    'Unit cost means the cost of producing one tonne.',
    'The new officer is currently the group treasurer.',
    'Distributions can vary because the underlying companies pay different amounts.',
    'This does not change the number of shares you own.',
    'The company will publish its full accounts next month.',
    'A franking credit appears on your annual tax statement.',
    'The board thanked the outgoing officer.',
    "Both figures are in the company's own release.",
    'We are not telling you what to do with this information.',
    'That decision is yours, and a licensed adviser can help with it.',
    'Revenue was A$1.82 billion, compared with A$1.74 billion a year earlier.',
    'The stock is listed on the exchange under the code PTL.',
    'Net debt is what the company owes minus the cash it holds.'
  ]
};

const test = {
  violations: [
    // recommendation
    'Now might be the moment to buy.',
    'Long-term holders should stay put.',
    'Our advice is to sell.',
    "I'd avoid this stock until the shutdown ends.",
    'Anyone holding this should take profits.',
    'It makes sense to top up your holding.',
    'Retail investors would do well to hold.',
    'We would not sell here.',
    'Buy the dip.',
    'A cautious investor would reduce their exposure.',
    // forecast
    'Expect the price to recover once maintenance finishes.',
    'Earnings should improve from here.',
    'The stock is heading higher.',
    'Dividends will likely keep growing.',
    'The share price is going to drop on the news.',
    'We anticipate stronger shipments in the next quarter.',
    'The spectrum deal is going to lift profits.',
    'Margins will expand over the coming year.',
    'Shares could surge after the approval.',
    'This points to higher earnings ahead.',
    // verdict
    'Great news for shareholders.',
    'A worrying development for the bank.',
    'The result was terrible.',
    'A solid performance that should please investors.',
    'A bullish signal.',
    // urgency
    "Don't wait, review your position now.",
    'Time is running out to act.',
    'Grab the dividend while you can.',
    'You must act today.',
    'Be quick: the record date is close.'
  ],
  clean: [
    'Shares are units of ownership in a company.',
    'The company reported record shipments for the quarter.',
    'The dividend is scheduled to be paid on 29 October.',
    'Investors who hold the stock on the record date receive the payment.',
    'The announcement was expected by the market.',
    'The price fell 1.5 per cent after the release.',
    'A buyer and a seller must agree on the price for a trade to happen.',
    'The bank said it will announce its results on 15 November.',
    'Selling shares can create a capital gain or loss for tax purposes.',
    'Buying shares in a company makes you a part-owner.',
    "The firm's analyst said shipments were higher than modelled.",
    'A dividend can be paid in cash or as extra shares.',
    'The shutdown affects one site and the others continue to operate.',
    'You can see every permission you have given on the Account page.',
    'This explanation covers what happened, not what happens next.',
    'The chief financial officer will start in January.',
    'Half-year results are published twice a year.',
    'Your plan decides how much detail you can read.',
    'The regulator publishes its decisions on its website.',
    'A record date fixes who is on the register for a payment.',
    'The figure is higher than the same quarter last year.',
    'The company has 4,000 employees across five sites.',
    'Spectrum licences are held for a fixed number of years.',
    'Unit costs were unchanged compared with the previous quarter.',
    'The bank said Ms Tan will step down on 31 December.',
    'Anyone with a question can contact a licensed adviser.',
    'The stock code is a short label used by the exchange.',
    "Analysts publish models that estimate a company's earnings.",
    'It is not possible to tell from this release what the new officer will do.',
    'Net profit after tax was A$96 million.'
  ]
};

// A third set, written to get past the rules: advice, forecasts, verdicts and
// pressure phrased WITHOUT the usual trigger words, plus harmless sentences
// that happen to contain trigger words. It was never used to tune anything. It
// exists to measure how far the guardrail can really be trusted, and the answer
// (see test/experiments/guardrail-eval.js) is "as a first filter only".
const adversarial = {
  violations: [
    'The smart move here is patience.',
    'Many holders will be glad they kept this one.',
    'Those who wait may regret it.',
    'Prices tend to follow results like these upwards.',
    'It would be hard to see this going anywhere but up.',
    'Smart money is already moving in.',
    'This one looks like a keeper.',
    'Shareholders have every reason to feel reassured.',
    'The market has underestimated this company.',
    'Better days are coming for the bank.',
    'If I held this, I would not be worried.',
    'Prices like these do not stay on the table for long.',
    'A dividend cut is hard to imagine here.',
    'This could be the start of something big.',
    'Frankly, the shares look cheap.',
    'Patient investors tend to be rewarded.'
  ],
  clean: [
    'Some analysts use the word bullish to describe a positive outlook.',
    'A strong dollar makes imports cheaper.',
    "Shareholders should read the company's own release for the figures.",
    'The company has a great deal of cash on hand.',
    'Weak links in the supply chain were not mentioned in the release.',
    "The term 'price target' means a forecast price that an analyst publishes.",
    "Before buying a share, many people read the company's annual report.",
    'The upside of a franking credit is that it reduces double taxation.',
    'Hold on to your annual tax statement; you may need it at tax time.',
    'The company is expected to hold its annual meeting in November.'
  ]
};

module.exports = { dev, test, adversarial };
