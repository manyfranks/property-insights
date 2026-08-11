# Execution Phasemap v3 — US Expansion + Monetization

_Reconciled 2026-08-11 against `main`. Supersedes v2. Tracks: **[M]** = Matt (accounts, approvals, legal, spend decisions), **[A]** = agentic dev. Repository-backed work is marked complete only with commit evidence; external dashboard/account state remains explicitly unverified until checked by Matt. Related: `07-US-AFFILIATE-CTA-SPEC.md`, `09-US-ADVANTAGE-DESIGN.md`, `10-AFFILIATE-APPLICATION-KIT.md`, and `docs/legal/US-EXPANSION-LEGAL-BRIEFING.md`._

> **Next product/data program:** `13-PROPERTY-INTELLIGENCE-PHASEMAP.md` sequences evidence preservation, assessment-subject resolution, property classification/capabilities, explicit per-assessment goals, investor/landlord journeys, and the gated insurance-distribution track. It is the source of truth for that work; this document remains the source of truth for the existing US expansion and monetization backlog.

## Program boundaries and file coordination

- **This document:** residual US expansion operations, external monetization activation, partner applications, production QA, and compliance follow-through.
- **Phasemap 13:** all new subject-resolution, classification/capability, goal, persona-journey, and insurance-distribution product work.
- **Shared-file rule:** work affecting `src/app/api/assess/route.ts`, assessment result components, email, CTA routing, billing entitlements, or pipeline persistence must have explicit file ownership before concurrent implementation. The former assumption of “minimal overlap” no longer holds.

Suggested monetization-session opening prompt: *"Read docs/plans/08-EXECUTION-PHASEMAP.md remaining backlog, docs/plans/07-US-AFFILIATE-CTA-SPEC.md, and docs/plans/13-PROPERTY-INTELLIGENCE-PHASEMAP.md shared-file rules; claim file ownership before editing shared assessment paths."*

---

## ✅ COMPLETE (shipped to main)

| Phase | Deliverable | Evidence |
|---|---|---|
| 0 | SEO foundation fixes (breadcrumb JSON-LD, manifest, Organization/ItemList schema, .env.example) | be2be16, bc9f36e |
| 0 | Assessment Gap Calculator + BC data-note post (n=15, median +7.4%) | bc9f36e |
| 1 | State-aware affiliate registry, adaptive CTA block, FTC disclosure line, click tracking w/ vertical/state/source | c5a13d9 |
| 2 | Adapter interface + registry, evidenceClass/assessmentBasis, Census geocoder, regional_econ seeded (ACS 25.7k / FHFA 105k / FEMA 51k rows) | df12c25 |
| 2→3 | US assessment flow v1 (county-median) + market panel + inline result | 264c4d1 |
| 3.5 | US-readiness: autocomplete ca+us, home US pill, error states, ~40 copy neutralizations, en_US locale | b47be23 |
| 4 | 3,144 county pages + /us hub + 51 state indexes + sitemap (+3,196 URLs) + county OG images | 0542d1e |
| — | Legal briefing for counsel (docs/legal/) | 7f47060 |
| — | LLM swap: qwen3.7-flash + reasoning-off (52x cheaper, 51% faster, schema parity) | 2941b94 |
| — | **RentCast unified US flow (POC)**: cache-first client, quota guard, listed US properties run the full Canadian pipeline (signals/score/offer cascade), off-market AVM variant, county-median fallback | 56b245f |
| — | LinkedIn sameAs, RentCast + DealCheck CTAs enabled | 1f27f59 + later |
| — | US Advantage layer: equity/tenure, triangulation, yield, risk/momentum, and over-assessment signals | bb81793 |
| — | HUD FMR read/ingest path plus county rent lookup product (3,076 pages) | df12c25, c6cf9b1 |
| — | Rent-to-price data note and investment/property-tax tool suite | 9720d5d, bfc1816 |
| — | US Discover V1 through mass seed: enrichment, guarded refresh, 45 metros / 2,250 listings / 29 states | 5400e57, a98f5da, 385c299 |
| — | Live county assessment expansion: five metros plus basis-correctness rules | 9ddb628 |
| — | Wipe-proof pipeline, sharded listing store, slow-fill engine, quota/floor guards | ed4fa5a |
| — | Journey-mapped CTA system and adjacent FTC disclosure/affiliate hygiene | 89cb714, 9a941af |
| — | GPC honoring, Do Not Sell/Share flow, opt-out enforcement, and unified US privacy-rights implementation | 81b0c93, 3f774af |
| — | Stripe Pro scaffold: pricing, checkout/webhook/portal, subscription storage, and cap bypass; inert until production billing configuration | e6bd4c9 |
| — | Kiavi approved and live with investor-mode routing and health guard | 8d2df69 |
| — | Insurance distribution research and staged proposal | 68b8617, a749501, 282b628 |

## 🔄 IN FLIGHT

| Item | Owner | State |
|---|---|---|
| DealMachine affiliate link | [M] | Reply drafted (name/email/promo code PROPERTYINSIGHTS + logo for co-branded page) |
| GSC sitemap recovery | [M] | Fresh `sitemap-main.xml` route shipped in 71caf49; current Search Console acceptance/indexing state requires an external dashboard check |
| Stripe Pro production activation | [M] | Scaffold is shipped but billing keys, price, webhook, and live checkout state are not verifiable from the repository |
| Counsel review | [M] | Engineering privacy baseline is shipped; counsel still needs to review profiling, state-rights language, insurance distribution, and operating structure |

## 🔲 PRODUCT / DATA RESIDUAL BACKLOG

1. **Deploy QA pass**: after Vercel deploy, verify US flow end-to-end in prod (listed + off-market + quota-fallback), county pages, calculator; browser-test calculator interaction.
2. **US assessment email variant** (Resend verified working): county/RentCast result email mirroring the CA assessment email; reuse `getAffiliateUrl(id, "email")`.
3. **Disclaimer/attribution residual audit**: modeled-estimate and county-median caveats exist in current result UI; verify FEMA “planning purposes only,” Census attribution, and methodology placement across every remaining surface rather than rebuilding already-correct fallback copy.
4. **County evidence expansion**: five live metros are shipped. Treat any additional county adapter or Travis live-path work as a capability/coverage investment, not a blocker; coordinate it with Phasemap 13’s matrix.
5. **US Discover operations**: V1 and mass seed are shipped. Further per-address enrichment remains quota-gated; preserve the no-fan-out and quota-reserve rules.
6. **GSC recovery and indexing readout** [M]: check the fresh sitemap path, record accepted/discovered/indexed counts, and remove this item only with dashboard evidence.
7. **Semrush trial batch-export** when 3+ domains are ready [M+A].

## 🔲 MONETIZATION / COMPLIANCE RESIDUAL BACKLOG

1. **Production environment audit** [M]: verify affiliate URLs, rotated OpenRouter key, Resend key, and all Stripe variables in Vercel; repository presence does not prove deployment configuration.
2. **Partner follow-through** [M]: send the DealMachine reply; reconcile `10-AFFILIATE-APPLICATION-KIT.md` against current approvals; prioritize direct programs while network applications remain traffic-gated.
3. **Activate or defer Stripe Pro** [A+M]: if activating, configure the product/price/webhook, perform live checkout/renewal/cancellation QA, and decide whether saved analyses/exports are required before marketing Pro. Do not count the inert scaffold as production activation.
4. **Counsel/privacy follow-through** [M]: review the shipped US rights/GPC implementation and explicitly include occupancy-driven personalization, intent profiling, insurance intake, and affiliate routing. Engineering completion is not legal approval.
5. **RentCast tier upgrade decision** [M]: Foundation buys volume, not better data quality. Upgrade only when observed assessment/discover demand and journey economics justify it.
6. **EPC review loop** [A]: use `partner_clicks` by vendor/vertical/state/source when volume is sufficient; do not optimize on anecdotal clicks.
7. **Lead-gen/intent-profile product**: deferred behind Phasemap 13’s subject/goal contracts and counsel profiling review.

## [M] STANDING ITEMS

- Legal counsel review: privacy profiling, insurance distribution, ToS, entity/tax questions, and shipped US-rights language.
- Qwoted: say "scan Qwoted" in any session for a pitch pass against live journalist requests.
- LinkedIn page: post the data notes when published.
