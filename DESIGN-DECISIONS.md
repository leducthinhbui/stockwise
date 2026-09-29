# Task 5.2D — design decisions and what changed

Source: the AI design conversation
<https://claude.ai/share/20c458ce-8e38-4ed8-94f0-7f946724160f>

The first version of these draft pages was built before that conversation. Several of its
conclusions contradicted what had been built, so the site was rebuilt against them. This file
records what changed and why, so the reasoning is available for the design PDF and the demo.

---

## 1. Business positioning — StockWise is a comprehension layer, not an advice service

**The insight.** "Investment education" and "portfolio support" are two different businesses under
Australian regulation. Anything that tells a specific user what to hold is financial product
advice and needs an AFSL. The strongest differentiator is *what the product refuses to do*: a
broker's job is execution and it profits from trading; an adviser's job is a personal
recommendation and it carries liability for it; StockWise's job is comprehension, which lets it
credibly say it has no incentive to make anyone trade.

**What was wrong before.** The first build was full of advice-adjacent features:

| Was | Problem | Now |
|---|---|---|
| "Plain-English risk score for every holding" | A score is a rating, and a rating implicitly answers "is this good" | Descriptive explanations only — what a holding is, what changed and why |
| "Register → set your goals → get your guidance" | "Guidance" reads as advice | Three-step flow used **only** for adding a portfolio, ending "you decide, elsewhere" |
| Portfolio Types cards (Growth / Balanced / Income / Conservative) with "Best suited for: investors with a 10+ year horizon" | Suitability language aimed at an individual | Removed. General educational examples are labelled as such and explicitly not tailored |
| "tailored watchlist, risk scores and alerts" | Personalisation framed as recommendation | Preferences change only the *order* explanations appear in, stated on the form itself |

**Added.** A non-advice promise near the top of the home page as a trust headline rather than
footer boilerplate — "We explain what is happening. We never tell you what to buy or sell." —
plus an About page table comparing broker / adviser / StockWise, and an explicit
"we will / we will not" list.

---

## 2. Primary persona — someone catching up on a portfolio they already own

**The insight.** Of two personas, the stronger primary audience is the one who already holds a
portfolio and needs to understand it, not the beginner starting from zero. That audience is
better matched to the differentiator, has a real deadline driving retention, and is primed to
value a service that refuses to sell. Content aimed at total beginners reads as condescending
to them.

**Applied.**

- Home page leads with "See what your portfolio is actually telling you", not "New to investing?"
- No foundational "what is a share" content on first contact.
- Content anchored to real events — "Why did $340 in franking credits appear in my account?"
  rather than "Franking credits explained".
- No urgency, countdowns, streaks or "don't miss out" language anywhere. The old
  "Ready to start?" call-to-action band was removed.
- Tone is calm and factual, with no congratulatory or reassuring filler.

**A correction carried over from the conversation:** the accessibility needs in that persona are
treated as **universal defaults**, not something inferred from age. Larger base text, real
contrast, no autoplay and no gesture-only interaction apply to every visitor. Nothing on the site
is styled as a "senior mode".

---

## 3. Inspiration sites — what to borrow and what to avoid

| Pattern | Decision | Reason |
|---|---|---|
| Stake — shallow, text-labelled nav | **Taken** | Serves clarity for everyone; no icon-only or hover-only controls |
| Stake — three-step process | **Reshaped** | Their flow ends in a funded account and a KYC identity check. Ours is used only for adding a portfolio; copying the shape would imply a licence StockWise does not hold |
| Simply Wall St — prominent search | **Taken, leaned on** | The only non-broker of the three. Search sits in the header and works before sign-up |
| Simply Wall St — product example | **Taken, changed** | A real worked example on the home page, but purely descriptive. Never a colour-coded score. The Snowflake is their signature device and is deliberately not imitated |
| moomoo — feature cards | **Taken, trimmed** | Kept to three or four cards doing real explanatory work. Their density signals "trading terminal", which is the opposite of the intended read |
| moomoo — separated consent | **Taken, rewritten** | The pattern of itemised plain-language consent is good. Their items exist to satisfy AFSL risk disclosure; ours cover data and privacy — storing holdings read-only, ordering explanations, marketing email |

---

## 4. Accessibility — review findings and what was done

Findings marked *verified* were measured against this build, not estimated.

| Finding | Status |
|---|---|
| No skip-to-main-content link on any page | **Fixed** — added on all six; confirmed as the first focusable element, target `#main` exists |
| Footer link contrast reported as 3.43:1 | **Did not apply.** That assumed Bootstrap defaults; `styles.css` already set these. Measured on this build: **11.74:1** |
| Step-number circle contrast | **Was failing at 3.35:1** — a custom colour the reviewer could not check. Darkened; now **6.30:1** |
| Primary button at exactly 4.50:1 with no margin | **Fixed** — darkened to **6.44:1** |
| contact.html required fields not exposed to screen readers | **Fixed** — `required` added to name, email and query; the visible `*` stays `aria-hidden` |
| Three identical "Read more" links | **Fixed** — each link now names its own article |
| Hint text not tied to its input | **Fixed** — `aria-describedby` on six fields, all target ids confirmed present |
| Risk/detail radio group had no nested fieldset | **Fixed** — own `<fieldset>` and `<legend>` |
| Disabled "Previous" pagination link still focusable | **Fixed differently.** The suggested `aria-disabled` + `tabindex="-1"` raises a validator warning on an `<a>` that still has `href`. Rendered as a `<span>` instead — Bootstrap's documented pattern, genuinely unfocusable, and validates clean |
| Decorative images described in alt text | **Fixed** — card and thumbnail images now `alt=""` |
| Result titles flat at h2 | **Fixed** — visually hidden "Results" `<h2>` with result titles nested as `<h3>` |
| Form field borders at 1.30:1 | **Fixed** — border darkened to `#6c757d` |
| Focus outlines unverifiable | **Was failing, now fixed.** The outline was amber everywhere: 9.38:1 on navy but only **1.64:1 on white**, where nearly every interactive element sits. A second rule meant to vary it by section set the same amber, so it changed nothing. Base is now the brand blue at **6.44:1** on white, amber kept for navy sections at 9.38:1 |
| Broken `#news` / `#updates` / `#top` anchors | **Fixed** — those placeholder anchors are gone |

All six pages validate with the W3C Nu HTML Checker at **0 errors and 0 warnings**.

---

## 5. Still open

- A fifth prompt has been sent and answered — it produced the focus-outline fix above, and the
  reviewer accepted that its earlier footer-contrast finding had overstated what it could verify.
  **The published share snapshot still shows only 4 prompts**, because a Claude share is a snapshot
  taken when you share, not a live view of the conversation. The snapshot has to be republished
  before this link is submitted.
- The design PDF is built (`Task5.2D-Design.pdf`), covering all three design tasks and the
  five prompts. All three submission PDFs are complete.
