# Execution Phasemap — US Expansion + Monetization

_Sequenced 2026-08-07. Two tracks run in parallel throughout: **[M]** = Matt (registrations, accounts, approvals — things requiring a human/owner), **[A]** = agentic dev (Claude + subagents). Each phase has an exit gate; don't start the next build phase before the gate, but [M] items can always run ahead._

Related docs: `07-US-AFFILIATE-CTA-SPEC.md` (vendor slate + CTA system), SEO playbook, memory roadmap.

---

## Phase 0 — Ship + Register (this week; unblocks everything)

**[M] Registrations (~2h total, mostly waiting-for-email):**
1. Free government API keys for the US data layer (instant/email turnaround):
   - `CENSUS_API_KEY` — api.census.gov/data/key_signup.html
   - `BEA_API_KEY` — apps.bea.gov/api/signup
   - `HUD_API_KEY` — huduser.gov/hudapi/public/register (FHFA + FEMA + Census Geocoder need no key)
2. Affiliate batch 1 (W-8BEN as individual, treaty benefits): RentCast, DealCheck, DealMachine (direct, fast) · FlexOffers publisher account (unlocks Ownwell) · Kiavi via PartnerStack (mention "software/analytics tool" in application — agents/brokers ineligible; confirm cross-border payout)
3. LinkedIn company page → send URL for `sameAs` wiring
4. GSC: check Sitemaps report in 24–72h → expect "Success" + ~40 discovered URLs; optionally Request Indexing on /, /tools/assessment-gap, blog post

**[A] Ship:** commit staged Phase-1/2 batch (calculator, data note, ItemList/Organization schema, .env.example) on Matt's go. Post-deploy: validate a property page in Google Rich Results Test.

**Exit gate:** batch deployed; ≥2 API keys in hand; ≥2 affiliate applications submitted.

---

## Phase 1 — Affiliate Registry (1 session [A]; parallel with Phase 2)

Build per `07-US-AFFILIATE-CTA-SPEC.md`:
1. `src/config/affiliate-vendors.ts` + state-gate resolver + `getAffiliateUrl` (env pattern `NEXT_PUBLIC_AFFILIATE_URL_{ID}`, `sub_id` source tracking) + prod health guard
2. Migrate Ratehub/nesto/SquareOne into registry (`country: "CA"`) — zero visual change, ship
3. Adaptive CTA block ("Finance It / Insure It / Close It") on property + assess-result pages: hero (top cpaTier for state+mode) + pills + FTC disclosure line per cluster
4. Extend `/api/partner-connect` payload: `{vendor, vertical, state, source, affiliate}` → per-vertical EPC becomes measurable
5. Wire US vendors as approvals land ([M] pastes env vars into Vercel)

**Exit gate:** CA CTAs unchanged in prod through the new registry; first US vendor env var live.

---

## Phase 2 — US Data Foundation (2–3 sessions [A]; the load-bearing phase)

1. **Adapter refactor first** (everything else depends on it): formal `AssessmentAdapter` interface (fix 3 inconsistent param orders), registry-based dispatch replacing the province switch, `REGION_MAP` (50 states + provinces) replacing Canada-only `PROVINCE_MAP` in `/api/assess`, un-hardcode CAD/`en_CA`, add `assessmentBasis` + `evidenceClass` (observed|derived|modeled|proxy|missing) to `Assessment`
2. **Census Geocoder client** (~50 lines, free, no key): one-line US address → state/county FIPS + lat/lon
3. **`regional_econ` table in Neon** (one-wide-table pattern from Economic-Atlas) + port 4 ingest scripts as `scripts/ingest-us-*.ts` (dry-run/`--commit` convention): ACS county medians+MOE, FHFA HPI, HUD FMR, FEMA NRI. Run once locally, seed Neon.
4. **`us.ts` adapter v1**: geocode → county FIPS → ACS county median, `source: "area_median"` — US offers work in all 3,143 counties, honestly labeled
5. Testing: golden-path tests for 5 addresses per region (BC/AB/ON regression + US new)

**Exit gate:** a US address returns an offer + market panel (median value/rent, FMR, HPI trend, FEMA risk) end-to-end in prod.

---

## Phase 3 — US Surface + Monetization Live (1–2 sessions [A])

1. US market-context panel UI on result pages (richer than CA: FMR by bedroom, FEMA peril scores — CA parity later)
2. Calculator gains US mode (county median context via new data)
3. US CTAs go live in the adaptive block (Kiavi/Ownwell state gates active); email CTAs reuse `getAffiliateUrl(id, "email")`
4. [M] Affiliate batch 2 as traffic justifies: ShareASale (Hippo), Impact (Lemonade), Zebra direct, Steadily Ambassador, HomeLight affiliate, CJ (LendingTree)

**Exit gate:** first tracked US partner click with `sub_id` attribution.

---

## Phase 4 — US Programmatic SEO (1–2 sessions [A] + ongoing)

1. `/us/[state]/[county]` market pages from `regional_econ` (start top-100 metros by population, expand after indexing proves out) — every page carries real data: values, rents, HPI trend, permits, FEMA risk + CTA block
2. Sitemap index-splitting (will exceed comfortable single-sitemap size), Organization/ItemList/Breadcrumb reuse, internal linking state↔county↔calculator
3. Data note #2: first US analysis (e.g., "counties where rents outrun home prices" from FHFA+FMR) — linkbait + Qwoted ammunition
4. [M] Qwoted cadence: pitch when relevant requests appear ([A] drafts from our data)

**Exit gate:** US pages indexed in GSC; first non-branded US impressions.

---## Phase 5 — US Exact Assessments (2+ sessions [A]; parallel with 4)

1. Config-driven county adapter registry (generalize `ab.ts` platform clients): Socrata + ArcGIS clients exist; add per-county `{platform, endpoint, fieldMap, assessmentBasis}` configs
2. First metros (open data, $0): NYC, Cook County IL, King County WA, Travis County TX — upgrade those counties from `area_median` to `government`
3. **Regrid decision gate**: at meaningful affiliate revenue or a concrete need, ~$375–500/mo buys national parcels + upgrades Canada. Not before revenue.

**Exit gate:** ≥3 metros returning exact assessed values with `evidenceClass: "observed"`.

---

## Phase 6 — Growth Loop (ongoing; starts once 0–3 are done)

- Monthly data note cadence (alternate CA/US) → Qwoted/LinkedIn distribution
- [M] Semrush trial batch-export when 3+ domains ready (keyword gap + backlink prospects for PI + siblings in one window)
- EPC review per vertical from partner-connect data → reorder cpaTiers, kill losers
- **Stripe pro tier gate** ($19–49/mo: unlimited assessments, saved analyses, exports): build only after US organic traffic exists (~5k visits/mo threshold) — before that it's premature
- Intent-score lead product (agent-facing dashboard): the long game; revisit at real volume

---

## Dependency picture

```
P0 registrations ──→ P2 data foundation ──→ P3 US surface ──→ P4 programmatic SEO
P0 affiliate apps ─→ P1 registry ─────────→ P3 CTAs live      P5 exact assessments (∥ P4)
P0 ship batch ────→ (SEO compounding starts)                  P6 growth loop (ongoing)
```

Fastest path to first US dollar: P0 apps → P1 registry → P2 steps 1–4 → P3 step 3.
