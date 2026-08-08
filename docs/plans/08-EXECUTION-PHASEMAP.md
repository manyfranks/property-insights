# Execution Phasemap v2 — US Expansion + Monetization

_Updated 2026-08-07 (v2 — post RentCast pivot). Supersedes v1. Tracks: **[M]** = Matt (accounts, approvals, legal, spend decisions), **[A]** = agentic dev. Related: `07-US-AFFILIATE-CTA-SPEC.md` (vendor slate), `09-US-ADVANTAGE-DESIGN.md` (US signal layer), `docs/legal/US-EXPANSION-LEGAL-BRIEFING.md` (counsel prep)._

## Recommended session split (fragmentation control)

- **Track 1 — Product & Data** (this session's lineage): US Advantage layer, HUD/data verification, deploy QA, Phase 5 evidence upgrades, SEO/content cadence.
- **Track 2 — Monetization & Compliance** (spin up a fresh session): affiliate stack completion, Stripe pro tier, privacy-compliance engineering (GPC/Do-Not-Sell), FTC disclosure pass, email variants. Clean file boundary: `src/config/affiliate-vendors.ts`, `partner-cta`, billing, legal pages — minimal overlap with Track 1's pipeline files.

Suggested Track 2 opening prompt: *"Read docs/plans/08-EXECUTION-PHASEMAP.md Track 2 backlog and docs/plans/07-US-AFFILIATE-CTA-SPEC.md, then execute the Track 2 items in order."*

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

## 🔄 IN FLIGHT

| Item | Owner | State |
|---|---|---|
| US Advantage layer (equity/tenure signal, valuation triangulation, yield, risk/momentum, over-assessment flag) + `09-US-ADVANTAGE-DESIGN.md` | [A] agent running | Audit + commit on completion |
| HUD FMR ingest (single clean run) | [A] background | Verify `source='hud'` rows; rerun `npx tsx scripts/ingest-us-hud-fmr.ts --commit` if dead |
| Kiavi affiliate application | [M] | Under review |
| DealMachine affiliate link | [M] | Reply drafted (name/email/promo code PROPERTYINSIGHTS + logo for co-branded page) |
| GSC sitemap status | [M] | Recheck ~Aug 9; expect Success + resubmit after next deploy for US URLs |

## 🔲 TRACK 1 BACKLOG — Product & Data (priority order)

1. **Deploy QA pass**: after Vercel deploy, verify US flow end-to-end in prod (listed + off-market + quota-fallback), county pages, calculator; browser-test calculator interaction.
2. **US assessment email variant** (Resend verified working): county/RentCast result email mirroring the CA assessment email; reuse `getAffiliateUrl(id, "email")`.
3. **Disclaimer/attribution pass** (from legal briefing — engineering half): modeled-estimate disclaimer adjacent to every modeled number, FEMA "planning purposes only" on risk scores, "This product uses the Census Bureau Data" attribution, county-page methodology notes audit.
4. **Phase 5 (reframed)**: RentCast already returns per-address tax-assessed values, so county assessor adapters are now an *evidence upgrade* (observed-government vs API-records) + RentCast-independence hedge, not a blocker. Start with NYC/Cook/King/Travis open portals when justified. Regrid decision stays revenue-gated.
5. **Data note #2 (US)**: e.g. "counties where rents outrun home prices" (FHFA + HUD FMR) — linkbait + Qwoted ammunition.
6. **Discover-mode US** (needs paid RentCast tier — /listings city queries): rank motivated sellers by equity/DOM/price-cut signals. Gate on quota economics.
7. Semrush trial batch-export when 3+ domains ready [M+A].

## 🔲 TRACK 2 BACKLOG — Monetization & Compliance (priority order)

1. **Vercel env vars** [M]: `NEXT_PUBLIC_AFFILIATE_URL_RENTCAST`, `NEXT_PUBLIC_AFFILIATE_URL_DEALCHECK`, rotated `OPENROUTER_API_KEY`, confirm `RESEND_API_KEY` — nothing monetizes in prod until these are set.
2. **Affiliate registrations completion** [M]: FlexOffers (it IS a marketplace — finish signup; unlocks Ownwell), The Zebra (direct), HomeLight affiliate arm, then CJ (LendingTree) when traffic justifies.
3. **Privacy compliance engineering** [A, after counsel review]: "Do Not Sell or Share" footer link + GPC signal honoring (12 states, visible confirmation per CA/CO 2026 rules), unified US State Privacy Rights section, DSR intake via legal@.
4. **FTC disclosure tightening** [A]: disclosure adjacent to every CTA cluster (email CTAs included), audit all affiliate link rel attributes.
5. **Stripe pro tier** [A+M]: $19–49/mo — unlimited US assessments (funds RentCast paid tier; free users get N/day), saved analyses, exports. Now justified earlier than v1 planned because RentCast quota economics create a direct cost-to-revenue link. Includes pricing page, Stripe webhook, entitlement checks in assess route.
6. **RentCast tier upgrade decision** [M]: Foundation $74/mo when demo/real traffic arrives (~250-300 assessments/mo); Scale ~$449-650/mo at ~10k lookups. Quota guard makes overage impossible meanwhile.
7. **EPC review loop** [A]: partner_click data by vendor/vertical/state → reorder cpaTiers quarterly.
8. **Lead-gen product** (intent-score dashboard): long game, revisit at volume.

## [M] STANDING ITEMS

- Legal counsel review: privacy policy US section, ToS rider, LLC/tax questions (briefing in docs/legal/).
- Qwoted: say "scan Qwoted" in any session for a pitch pass against live journalist requests.
- LinkedIn page: post the data notes when published.
