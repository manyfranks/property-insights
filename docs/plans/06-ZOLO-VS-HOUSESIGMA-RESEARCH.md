# Research: Zolo vs HouseSigma vs Alternatives

**Date:** March 2026
**Purpose:** Evaluate data sources for property valuations, price history, and comparables

---

## Zolo.ca

### What They Have
- **Estimated home values** with 1.9% on-market error rate, 6.9% off-market (competitive with HouseSigma)
- Listing data refreshes every 15 minutes
- Market trends/stats per city (avg price, inventory, DOM)
- Coverage across all Canadian provinces

### Can We Access It?
**No. Zolo is behind aggressive Cloudflare bot protection.**
- `robots.txt` returns a Cloudflare challenge page (not even accessible)
- Direct `curl` with browser UA returns 403
- City listing pages return 403
- Individual property pages return 403
- No public API documented anywhere
- No developer portal or data partnership program visible

**Verdict: Zolo is a dead end for automated access.** Even Browserless/Puppeteer would need to solve Cloudflare Turnstile challenges, which is unreliable and likely violates their ToS. The Cloudflare protection is more aggressive than bcassessment.ca.

---

## HouseSigma

### What They Have
- **Estimated values** with 2.72% on-market error, 6.79% off-market
- 18+ years of sales records
- Relist history, price change history, cumulative DOM
- Comparable sold properties with prices and dates
- Coverage: Ontario, Alberta, British Columbia

### Can We Access It?
**Extremely difficult.** React SPA behind login. No public API. The current codebase has a stub (`src/lib/housesigma.ts`) that just builds a Google site-search URL and returns `{ found: false }`.

Automated extraction would require:
1. Maintaining authenticated browser sessions
2. Navigating a React SPA programmatically
3. Handling CAPTCHAs and rate limiting
4. Risk of account bans

**Verdict: Not viable for automated pipeline. Useful for manual enrichment of HOT picks only.**

---

## CREA DDF API (realtor.ca)

### What They Have
- Full MLS listing data (price, coordinates, rooms, media, property details)
- Agent/broker roster
- Open house data
- OData query support with filtering/pagination

### What They DON'T Have
- No assessment values
- No estimated home values / AVMs
- No price history or sold data
- No comparable sales

### Access
- OAuth 2.0, requires approved data feed credentials
- Restricted to licensed brokerages/boards — not available to general developers
- Rate limits and pricing not publicly documented

**Verdict: Not useful for valuations. We already get the same listing data from the realtor.ca public API via ScraperAPI, which is more accessible.**

---

## Wahi

### What They Have
- Property valuations rated as "more locally precise for Canadian addresses" by real estate analysts
- Transparent methodology — shows how numbers are modeled
- Emerged in 2025 as a preferred tool

### Can We Access It?
- Not researched in depth yet
- Likely similar Cloudflare/bot protection situation
- No known public API

**Verdict: Worth investigating further, but probably same access problem as Zolo.**

---

## Recommendation

### Short Term: Don't Chase Scraped Valuations
None of the Canadian valuation platforms (Zolo, HouseSigma, Wahi) offer API access, and all are increasingly locked down behind Cloudflare. Building a scraper for any of them is:
- Fragile (breaks when they update their SPA)
- Expensive (requires browser automation infrastructure)
- Risky (account bans, ToS violations)
- Unreliable (Cloudflare Turnstile has ~30% failure rate even with solvers)

### Instead: Double Down on What Works

1. **BC Assessment** — We already have a working Puppeteer scraper. BC Assessment's bot protection is lighter than Zolo/HouseSigma. Populate the cache for all BC listings and this covers ~85% of our inventory.

2. **Alberta municipal assessment tools** — Calgary and Edmonton have public lookup portals. Build similar scrapers.

3. **For Ontario** — Implement the language-based offer model (Phase 3). Don't anchor on stale MPAC values or chase Zolo/HouseSigma estimates.

4. **For the future** — If the product grows to the point where you need third-party AVMs at scale, the real path is:
   - **MPAC Propertyline** ($14/report or bulk subscription) for Ontario
   - **Teranet/GeoWarehouse** for Ontario sold data
   - **Direct partnership with Zolo or HouseSigma** (business development, not scraping)

### The Honest Truth
The competitive moat isn't in getting the same valuation data everyone else has. It's in the **language-first scoring model** (detecting motivated sellers from listing descriptions) + **the offer cascade** (turning signals into a specific dollar recommendation). No other Canadian platform does this. The assessment data is an input, not the product.

---

Sources:
- [Is Zolo's Home Valuation Tool Accurate?](https://intempuspropertymanagement.com/is-zolos-home-valuation-tool-accurate-3-alternatives-to-try/)
- [The Canadian Race to Automated Property Valuation Supremacy](https://realestatemagazine.ca/the-canadian-race-to-automated-property-valuation-supremacy/)
- [REALTOR.ca DDF Web API Documentation](https://ddfapi-docs.realtor.ca/)
- [HouseSigma Review](https://hardbacon.ca/en/mortgage/housesigma-review/)
- [Best Real Estate Websites in Canada](https://www.thepaintedhinge.com/best-real-estate-websites-in-canada-with-accurate-home-valuations/)
