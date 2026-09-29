# Task 5.2D — Inspiration site research notes

Raw observations only, recorded while viewing each site. Sites chosen by Le Duc Thinh Bui.
Accessed 14 August 2026, desktop viewport 1440x900.

These are working notes, not the submission text. The write-up for Design Task 1
("identify two or three website examples... highlight the features/layout/styles...
and explain why they are of interest") will be drawn from these.

---

## 1. Stake — https://hellostake.com

**Navigation / header**
- Very sparse top bar: wordmark far left, nav links grouped in a centred rounded "pill"
  container (Trade, Super, Accumulate, Learn), account actions far right.
- Two-tier call to action: plain "Login" text link beside a solid dark pill button
  "Open an account" — the primary action is visually dominant.

**Hero**
- Full-bleed abstract 3D image occupying most of the viewport.
- Very large serif headline ("Your money, unstoppable") — unusual for fintech, which
  usually uses sans-serif.
- App-store rating badges pinned bottom-left ("4.6 on App Store", "4.6 on Google Play").

**Body structure**
- Alternating product blocks: short heading, one paragraph, single text link
  ("Find out more", "About Stake Super", "About Accumulate").
- Social-proof band: "Join 750K+ people..." plus a row of four award labels
  (Canstar, WeMoney x3).
- Four-item feature grid: Simple low brokerage / Easy-to-use app / Extended Hours /
  CHESS sponsorship — each a short title plus one or two sentences.
- Single pull-quote testimonial with attribution ("Ewan W.").
- Three-step numbered onboarding: "Download the app or start on web" → "Sign up with
  zero paperwork" → "Add funds to your new account".
- Market-intel teaser cards linking to articles ("Top 5 ASX silver stocks to watch in 2026").

**Notable detail**
- Repeated small-print disclaimers directly under data/imagery: "Stock, prices and data
  shown for illustrative purposes only", "Past performance is not indicative of future
  performance."

---

## 2. Simply Wall St — https://simplywall.st

**Navigation / header**
- Dark theme throughout.
- **A search input sits in the primary navigation bar** (placeholder referencing
  researching stocks) — search is treated as a top-level navigation tool, not a
  separate page.
- "Create free account" as a filled accent button, "Log in" as a plain link.

**Hero**
- Split layout: text column left, large product screenshot right (shows the actual
  app UI rather than an abstract image).
- Headline split across two colours ("Welcome to your" in white, "Portfolio Command
  Center." in an accent colour).
- Dual CTA — "View Portfolio demo" and "Try Simply Wall St free" — plus a risk-reducing
  line underneath: "No credit card required."
- Review band immediately under the hero: star ratings and review counts from
  Trustpilot, App Store and Google Play, with a short quoted review.

**Body structure**
- Benefit sections written as short heading + one-sentence explanation pairs, e.g.
  "Master your portfolio.", "Find your next hidden gem.", "Keep your finger on the pulse."
- The same CTA pair is repeated after each major section.
- Signature data visualisation: the "Portfolio Snowflake" — a single graphic summarising
  portfolio health at a glance.
- Feature checklists ("Realized & Unrealized Gains & Losses", "Dividend Payments",
  "Currency Gains & Losses", "Annualized Return (IRR)").

---

## 3. moomoo — https://www.moomoo.com (Australian site)

**Navigation / header**
- Thin promotional strip above the header carrying a scam/security warning with a
  "learn more" link.
- Main nav: Invest, Experience moomoo, Pricing, Insights, Promotions, Forum, About us.
- Search reduced to a magnifier icon; separate "Download" and "Sign up" actions.
- Strong single accent colour (orange) used for the brand and all primary buttons.

**Registration modal (appears on load)** — directly relevant to Task 5.1P
- Sign-up offered as two tabs: **Email** or **Phone**.
- Phone entry is a **country-code select next to a phone number field**, not one
  free-text box.
- Social sign-in row as an alternative path.
- **Two separate consent checkboxes**: one for Privacy Policy / Terms of Service
  (mandatory), one for optional promotional messaging — consent is split rather than
  bundled into a single tick.

**Body structure**
- Headline stacked over three lines with the middle line emphasised
  ("Australia's / Most downloaded / trading App, two years running*").
- Four-item "Why choose moomoo" grid: CHESS sponsored / Dedicated support /
  Trade globally / Competitive pricing.
- Product tiles by asset class: Stocks, Options, ETFs.
- Heavy use of asterisked footnotes tying every claim to a source (e.g. download
  ranking attributed to Sensor Tower with an explicit date range).

---

## Patterns worth carrying into StockWise

1. **Search as a first-class navigation element** (Simply Wall St) — satisfies the
   5.2D requirement for a search input function.
2. **Four-item feature grid** (Stake and moomoo both use it) — maps onto Bootstrap
   `col-md-3` cards, already used in Task 4.2C.
3. **Numbered three-step onboarding** (Stake) — a clear pattern for a Home page
   section explaining how membership works.
4. **Split consent checkboxes** (moomoo) — already reflected in the 5.1P form
   (separate newsletter and terms checkboxes).
5. **Visible disclaimers under any figures** (all three) — StockWise already carries
   "Not financial advice"; the sites confirm this is standard practice.
6. **News/market-intel teaser cards** (Stake) — supports the brief's "latest news and
   events" hint for the Home page.
