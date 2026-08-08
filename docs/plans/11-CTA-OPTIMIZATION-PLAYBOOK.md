# CTA Optimization Playbook — Placement, Design, Copy

_Synthesized 2026-08-08 from: (1) full production audit of all 3,463 URLs; (2) competitor research across 106 sites in three cohorts — real-estate/valuation (34), personal-finance affiliate publishers (35+), insurance comparison + investor SaaS (37); (3) evidence review of CTA design literature (NN/g, Baymard, CXL, MECLABS, FTC 2023 guides). Full agent reports in session transcripts; key sources cited inline in 07/10 docs style._

## 1. The headline findings

1. **3,209 of 3,463 production URLs carry zero monetized CTAs.** CTAs exist only on property pages (222), county pages (3,144 — wait, these DO have CTAs), calculator (post-submit), and the CA email. Dead surfaces: 51 state indexes, /us hub, 18 discover pages (3 US metros), dashboard, home, 6 blog posts, 14 tag pages.
2. **Vendor enablement outweighs every design decision.** County + US property pages render only RentCast/DealCheck because they're the only `enabled` US vendors. Each network/brand approval automatically propagates to 3,100+ pages via `getVendorsForRegion` — zero code. The Ownwell↔OverAssessmentCallout pairing is the single most valuable flip waiting to happen.
3. **Do NOT go flashy.** Strongest evidence (NN/g banner-blindness eye-tracking): ad-like treatment triggers the ignore-reflex and bleeds distrust onto adjacent content — fatal for a credibility-first analysis product. Peer-reviewed native-ad literature: disclosed native units are trusted MORE than banner-styled ones. The winning pattern across all 106 competitors: **native card + one accent element + adjacent plain disclosure**.
4. **Placement depth should match page intent** (validated across cohorts): transactional pages (user typed an address → result) monetize immediately under the headline number; informational pages (county/blog SEO traffic) monetize after context, but repeated at 2–3 scroll depths.

## 2. Design spec — the component (`partner-cta.tsx`)

Direction: **"contrast without ad-signaling"** (evidence-backed; low risk):

- Keep card structure (hero + pills, white card, thin border, rounded-xl).
- Add ONE house accent: a 3px left-edge accent bar in a single deep color used nowhere else on the site (e.g. deep teal). Not a vendor color. It must read as "this app's own module."
- Typography carries salience: hero body copy `text-xs` → `text-sm`; CTA label `font-medium` → `font-semibold`.
- **First-person, specific labels** (best-documented copy test in CRO literature — Aagaard "my" test): "Compare my mortgage rates", "Get my insurance quote", "Track this property's value". Applied via `ctaLabel` in the registry — no component change.
- **Promo-code specificity in offerText** (REtipster/SparkRental pattern): keep "Use code X" but state the value when known ("25% off with code…").
- Section heading above the block, contextual per surface: "Act on this analysis" (result pages), "Tools for this market" (county pages). Currently the cards float with no framing.
- Disclosure: keep exactly as is — "Sponsored" tag per card + cluster sentence. Matches FTC 2023 "clear and conspicuous, same-time visibility." Every competitor doing this well (NerdWallet, MoneyGeek) shows disclosure *adjacent and visible*, and the evidence says visible disclosure raises trust and CTR.
- Mobile: verify tap targets ≥ 7mm (Baymard). A mobile-only sticky bottom bar (thumb-zone research) is an **A/B candidate only** — the sticky-bar hype stats circulating online are fabricated; ship plainest-possible styling if tested.
- Later (needs 3+ same-vertical US vendors live): comparison-table variant — the table structure itself signals neutrality (NerdWallet's core mechanic).

## 3. Placement map — surface by surface

### Assessment / property result pages (transactional — peak intent)
- **Move the primary CTA block to directly beneath the headline offer number** (NerdWallet calculator→lender-table, Redfin estimate→consultation). Currently at ~73% depth after the full data stack. Keep a secondary block at the current "Next Steps" position (repetition at scroll depths is a proven pattern, same copy both places).
- When 3+ US vendors are live: card-grid of parallel paths (HomeLight pattern) — insurance / investor tools / financing / tax appeal — user self-selects.
- Over-assessment flag → tax-appeal CTA adjacency stays; goes live the day Ownwell flips.

### County pages (3,144 — informational SEO traffic)
- Back-loaded placement is *correct* for this intent (LendingTree vs Annuity.org front/back-load evidence) — but fix the ordering: **partner block must render above the internal "Search any address" box**, not below it (currently the internal CTA cannibalizes the monetized one), or merge them into one "Next steps for [County]" module: search input + partner cards together.
- **Topic-matched inline units** (HomeLight 1:1 mapping): rent table section → RentCast inline card ("Track rents in [County]"); FEMA risk section → insurance CTA when a US insurance vendor is live. One inline unit mid-page + the existing bottom block = 2 scroll-depth exposures (MoneyGeek repeat pattern), same vendors.
- Do NOT add more than 2 exposures — GOBankingRates-level density reads as spam and this surface's job is ranking.

### State indexes (51) + /us hub (dead today)
- Add the PartnerCta block (country="US", state=the state) after the county grid + a calculator cross-link. These pages sit atop the SEO hierarchy; even modest CTR here is free money.

### Discover pages (18, incl. Austin/Miami/Phoenix — dead today, plumbing exists)
- Wire `<PartnerCta source="discover">` below the listing grid. The `"discover"` source enum and API allow-list already exist — this was built and never connected.

### Blog (6 posts + 14 tag pages — dead today)
- **Restrained editorial style** (Motley Fool pattern): in-content plain text links reading as citations + ONE partner card at post end, topic-matched:
  - us-rent-to-price-ratio-by-county → RentCast/DealCheck (most obvious miss on the site)
  - CA offer/negotiation posts → Ratehub/nesto
  - bc-assessment-gap post → Square One + calculator cross-link
- No buttons mid-article; protect dwell time (it's what the county pages' rankings feed on).

### Calculator
- Keep post-result gating (earned moment — correct per MECLABS). Add below-result partner block prominence per the result-page spec.
- **Carry inputs into partner links** where a vendor supports prefill params (Realtor.com calc→lender-form pattern) — check RentCast/DealCheck URL params.

### `/resources` page (new surface — REtipster pattern)
- Build a categorized "Tools we use" page: investor tools / financing / insurance / tax appeal, each card with logo-less name, 2-sentence use case, promo code inline. One master disclosure at top. Linked from footer Product column + every blog post end. Bookmarkable, SEO-indexable, compounds with every vendor approval. Uses the registry as its data source — zero-maintenance.

### Email
- Branch the email CTA by listing country via the registry (currently hardcoded Square One for all sends; US flow doesn't email yet but Track 1's US email variant will hit this trap).

### Dashboard + home
- Dashboard: one restrained partner block under the ranked listings (browsing-intent surface, sitemap priority 0.9).
- Home: leave unmonetized — its job is search entry; every competitor treats their front door as funnel, not inventory.

## 4. Implementation queue (impact × effort)

| # | Item | Effort | Notes |
|---|---|---|---|
| 0 | ✅ DealCheck/RentCast ctaLabel+description (shipped b9b4ef3) | done | was rendering bare vendor names |
| 1 | Component polish: accent bar, typography, section headings, first-person labels | S | one file + registry copy |
| 2 | County page: partner block above internal search (or merged module) | S | ordering fix, big surface |
| 3 | Result pages: primary CTA under the headline number (+ keep bottom block) | M | highest-intent placement |
| 4 | Wire discover + state indexes + /us hub | S | dead surfaces, plumbing exists |
| 5 | Blog: topic-matched end-of-post cards + inline citation links | S | 1:1 mapping table above |
| 6 | /resources page (registry-driven) | M | compounding SEO surface |
| 7 | County inline topic-matched units (rent→RentCast; risk→insurance when live) | M | second scroll-depth exposure |
| 8 | Email registry branch by country | S | before Track 1's US email variant |
| 9 | Mobile sticky bar A/B | M | weakest evidence; plainest styling; measure |
| 10 | Comparison-table variant | M | gated on 3+ same-vertical US vendors |

**Standing rule: every vendor approval is worth more than any item on this list** — flip `enabled`/`affiliateReady` same-day, add to `REVENUE_CRITICAL_IDS`, verify rate → cpaTier in-dashboard.

## 5. Measurement

- `partner_clicks` already captures vendor/vertical/state/source/affiliate. Read EPC per `source` (sub_id) once volume exists; reorder cpaTiers quarterly (phasemap Track 2 item 7).
- Add `source` values as new surfaces go live: state-index/hub → "county-page" is wrong — add `"state-page"` and `"resources"` to `AffiliateSource` + partner-connect allow-list when wiring.
- Success metric: clicks per 1,000 sessions per surface, not raw clicks.
