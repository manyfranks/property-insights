# Trust / spam-score audit — W1-TRUST (2026-08-14)

Triggered by the DataForSEO snapshot dated 2026-08-12: spam score 65 on a
2-backlink, 2-referring-domain profile for propertyinsights.xyz. A high spam
score on a near-zero link profile is not a link-graph problem — spam
classifiers with almost no external signal fall back almost entirely on
on-page and site-structure heuristics. This document only claims things
that are directly verifiable in this repository as of commit `37cb62e`
(branch `w1-trust`). Anything that requires an external tool or account is
called out explicitly as "verify externally" and is not treated as fact.

## 1. Timing: a ~9,500-page burst finished the day before the snapshot

This is the single most concrete finding in this audit, and it is fully
verifiable from `git log`.

The site's first commit is 2026-03-06. Its **entire programmatic county
page footprint** was built in a five-day window immediately before the
spam-score snapshot:

| Date | Commit | Pages added |
|---|---|---|
| 2026-08-07 | `Programmatic US county market pages (Phase 4)` | ~3,144 base county pages |
| 2026-08-08 | `County Rent Lookup tool: 3,076 programmatic FMR pages` | +3,076 `/rent` pages |
| 2026-08-08 | `SEO tool suite: appeal checker, property-tax pages (3,135) ... sitemap +3,300 URLs` | +3,135 `/property-tax` pages + rankings |
| 2026-08-09 | `Mass US Discover seed: 45 metros / 2,250 listings` | +2,250 US property pages |

By 2026-08-11 the sitemap had grown from a few hundred URLs to the
~11,858 reported in the brief. The DataForSEO crawl is dated **2026-08-12
— the day after this burst completed**, on a domain that is 5 months old
overall and had, by the project's own history, essentially no content at
that scale a week earlier.

Sudden order-of-magnitude page-count growth with a flat backlink count is
a textbook signal in most spam-scoring models (Moz's is public about
using it; DataForSEO's methodology is not published, but the shape of the
input — near-zero authority, near-instant 40x+ page count increase — is
exactly the pattern these scores are built to catch). This is independent
of whether any individual page is low quality.

**Verify externally:** DataForSEO's exact spam-score formula and weighting
are not published; the above is the mechanism that is publicly documented
for comparable tools (e.g. Moz Spam Score), not a confirmed DataForSEO
input.

## 2. Affiliate-network verification meta tags in `<head>`

`src/app/layout.tsx` (not modified in this work package — read-only per
constraints) renders four raw verification `<meta>` tags on every page of
the site:

```
<meta name="impact-site-verification" value="0ace5bae-67e1-46b6-8692-148801f40b03" />
<meta name="impact-site-verification" value="eabea977-5970-488e-8500-e9900ed31327" />
<meta name="impact-site-verification" value="1d89ecb8-4d2f-4c48-a3ca-4da67527c699" />
<meta name="fo-verify" content="f7a80bd4-10ee-4813-941a-6be2253e7186" />
```

Three separate Impact Radius verification IDs plus one FlexOffers ID, on
a domain that (per the brief) has 2 referring domains total. `src/config/affiliate-vendors.ts`
additionally lists vendors on CJ (Commission Junction, 4 entries) and
PartnerStack, which have no corresponding verification tag in `layout.tsx`
— i.e. the verification tags are incomplete relative to the live vendor
roster, which on its own is not a spam signal, just an integration gap.

How this plausibly reads to a link-graph/spam classifier: affiliate-network
verification tags are commonly found on link-farm and doorway sites,
because they are the easiest way to monetize a domain that doesn't have
real audience or backlinks yet. A crawler that pattern-matches on these
tag names (`impact-site-verification`, `fo-verify`, `cj-verification`,
etc.) as a heuristic — the same way it would pattern-match on
`google-site-verification` for legitimacy — could plausibly score them as
a negative rather than neutral signal when combined with the near-zero
backlink count and the page-count burst above. Three separate Impact IDs
on one domain (normally a single Impact account only needs one) is the
kind of detail that stands out on inspection, though whether the classifier
itself weights count is not knowable from this repo.

**Verify externally:** whether DataForSEO's classifier inspects `<meta>`
tag content at all (many spam-score models are link-graph-only and never
parse on-page HTML); whether these three duplicate Impact IDs represent
three real, distinct affiliate applications or leftover IDs from
abandoned signups.

## 3. Programmatic county page thinness

Read: `src/app/us/[state]/[county]/page.tsx` (430 lines), plus its
`/rent` and `/property-tax` siblings (353 and 344 lines).

The registry backing these pages (`src/lib/data/us-counties.json`) has
**3,144 counties**. Each of the three page types is a single template
that swaps in county name/state and up to ~10 numeric fields pulled from
`getCountyMarketPanel(fips)`:

- Median home value, median gross rent, vacancy rate, median household
  income (`hasHero` block)
- One HPI figure + a templated up/down sentence (`"Home prices in {county}
  have risen/fallen about {pct}..."` — the sentence structure is fixed,
  only the number and direction word change)
- One FEMA composite risk score + a banded label from a 5-bucket lookup
  table (`femaRiskBand()`) + up to 3 hazard chips
- Up to 5 Fair Market Rent figures by bedroom count

Everything else on the page — headings, the "Looking at a specific
{county} property?" CTA box, the methodology footnote, the sibling-county
link list, the assessment-gap-calculator link, the breadcrumb — is
identical boilerplate re-rendered per page with only the county/state
name substituted. The actual unique payload per page is on the order of
10 numbers plus one or two template-filled sentences, sourced from a
Census/FHFA/FEMA/HUD aggregate table (`regional_econ`) that is not
county-specific research, it's the same public dataset every other
county-data site can pull from the same government APIs.

3,144 counties × 3 near-identical templates ≈ 9,432 pages (the brief's
9,510 programmatic county pages, plus rankings/hub pages, land in this
range) built from one shared numeric table, on a domain with 2 referring
domains, is a strong doorway-page/thin-content shape independent of
whether the individual numbers are accurate — and per Section 1, all of
it appeared inside one week.

**Verify externally:** how a spam classifier measures "thinness" (word
count, template-similarity hashing, or something else) — not observable
from the repo.

## 4. Affiliate link density and sponsored/nofollow consistency

Per-page-type affiliate surface:

- **Property pages** (`src/app/property/[slug]/page.tsx`, 2,238 pages):
  3 `<PartnerCta>` blocks + 2 `<PartnerCtaRow>` blocks + 2
  `<InsuranceModule>` blocks. Each `PartnerCta`/`PartnerCtaRow` can render
  a hero link plus up to 2 pill links (up to 3 outbound affiliate URLs per
  block); `InsuranceModule` links to an internal `/coverage-profile`
  handoff rather than the vendor URL directly (see Task 2 below), with the
  actual outbound vendor link one click further in
  `coverage-handoff.tsx`. In the worst case a single property page can
  surface on the order of 15 affiliate-tagged CTA slots across the three
  vendor-selection touchpoints, before de-duplication by vendor.
- **County pages**: one `<PartnerCta heading="Tools for this market">`
  block (up to 3 links) per page, ×~9,500 pages.
- **Insurance** (`/insurance`, `coverage-profile-wizard.tsx` →
  `coverage-handoff.tsx`): one outbound link per completed wizard flow.
- Vendor registry (`src/config/affiliate-vendors.ts`): 27 vendors defined,
  8 currently `enabled: true`, across 5 networks (`direct`, `Impact`,
  `FlexOffers`, `CJ`, `PartnerStack`, plus one `unconfirmed`).

Consistency check (full detail in Section "Task 2 findings" below): every
outbound anchor tag found in this repo that points at a live
`getAffiliateUrl()`/`AFFILIATE_VENDORS` URL already carries
`rel="noopener noreferrer sponsored"` and `target="_blank"`. This repo
does not have a rel/nofollow-attribution gap. Link *density* — many CTA
slots per page, several networks — is real and is a legitimate factor in
some spam models (a page whose primary purpose reads as "route the
visitor to a paid referral" rather than "answer the visitor's question"
can score as low-value regardless of attribution correctness), but
attribution hygiene itself is not contributing to the score.

## 5. Missing trust signals

Checked and confirmed absent from the repo:

- **No `/about` page.** `find src/app -maxdepth 1 -type d` lists
  `api, assess, blog, coverage-profile, dashboard, data-usage,
  disclosures, discover, how-it-works, insurance, pricing, privacy,
  privacy-choices, property, resources, terms, tools, us` — no `about`,
  no `contact`.
- **No blog author attribution.** `BlogPost` (`src/lib/blog.ts`) has no
  `author` field at all — every post is unattributed.
- **No physical address anywhere.** Grepped `privacy`, `terms`,
  `disclosures` pages and `Footer`/`OrganizationEntityJsonLd`/
  `OrganizationJsonLd` (`src/components/json-ld.tsx`, `src/components/footer.tsx`):
  the only contact method site-wide is `privacy@propertyinsights.xyz`
  (email only, in `src/app/privacy/page.tsx`). The `Organization` JSON-LD
  block sets `name`, `url`, `logo`, and a single `sameAs` (one LinkedIn
  URL) — no `address`, no `founder`, no phone.
- **Footer "About"** (`src/components/footer.tsx`) is two sentences
  ("Property Insights is a free research tool... Built by Orio") linking
  to `useorio.com`, with no company registration info, address, or team
  page on either domain from what's in this repo.
- **What does exist:** `/privacy`, `/terms`, `/data-usage`,
  `/privacy-choices`, `/disclosures` are all present and reasonably
  substantive (the privacy page in particular has a real data-category
  table and named third-party recipients) — the legal-hygiene pages are
  not the gap; the *identity/accountability* signals (who is behind this,
  where can they be reached, who wrote this content) are.

This combination — no author bylines, no about/contact page, no address,
one thin footer blurb — is itself a recognized low-trust ("who is
responsible for this content") pattern, distinct from the link-graph
signals above.

## 6. Domain factors — verify externally, not assessed here

None of the following can be checked from this repository; do not treat
any of them as confirmed:

- **TLD reputation.** `.xyz` has a well-documented association with spam
  and abuse in the SEO industry generally (it has historically been one
  of the cheapest gTLDs and a common choice for disposable spam
  properties), which by itself could account for a meaningful fraction of
  a 65 spam score independent of any content on the site. This is a
  reputation-by-association effect, not something this codebase can fix.
- **Domain age / registration history.** Not visible from git history
  (the *codebase* is 5 months old; the *domain* could be older, newer, or
  could have prior ownership/history — whois lookup required).
- **WHOIS privacy status.** Not determinable from the repo.
- **Prior hosting/DNS history** (e.g. whether propertyinsights.xyz was
  ever parked, previously spam-flagged under different ownership, or
  shares infrastructure/IP with flagged sites). Not determinable from the
  repo.
- **The 2 existing backlinks' quality** (are they themselves spammy?
  reciprocal links inflate spam scores in some models). Not determinable
  from the repo.

## Task 2 findings (rel attribute audit — feeds Section 4)

Grepped every `href=` in `src/components/insurance/`, every
`getAffiliateUrl`/`AFFILIATE_VENDORS` call site repo-wide, and every
`target="_blank"` anchor repo-wide (9 total). Result: **no missing rel
attributes were found; no code change was needed for Task 2.**

| File : line | Link target | Before | After |
|---|---|---|---|
| `src/components/partner-cta.tsx:87-90` | hero vendor URL | `rel="noopener noreferrer sponsored"` | unchanged (already correct) |
| `src/components/partner-cta.tsx:126-129` | pill vendor URL | `rel="noopener noreferrer sponsored"` | unchanged (already correct) |
| `src/components/partner-cta-row.tsx:73-76` | vendor URL | `rel="noopener noreferrer sponsored"` | unchanged (already correct) |
| `src/components/insurance/coverage-handoff.tsx:146-149` | resolved vendor URL (`resolved.url`) | `rel="noopener noreferrer sponsored"` | unchanged (already correct) |
| `src/app/resources/resources-list.tsx:73-76` | vendor URL | `rel="noopener noreferrer sponsored"` | unchanged (already correct) |
| `src/lib/email.ts:142` | `squareOne.url` (email HTML) | `rel="noopener noreferrer sponsored"` | unchanged (already correct) |
| `src/components/insurance/coverage-handoff.tsx:168-169` | `mailHref` (mailto fallback, no matched vendor) | no `rel`, no `target` | unchanged — correct as-is: not an affiliate link, not a new tab |
| `src/app/property/[slug]/page.tsx:434-438, 936-940` | `listing.url` (Zoocasa/Realtor.ca source listing, not monetized) | `rel="noopener noreferrer"` (no `sponsored`) | unchanged — correct as-is: not an affiliate link, "sponsored" would misrepresent the relationship |
| `src/components/footer.tsx:79-83` | `https://useorio.com` (parent company site) | `rel="noopener noreferrer"` (no `sponsored`) | unchanged — correct as-is: not an affiliate link |
| `src/components/insurance/insurance-module.tsx:234, 255, 272` | `buildProfileUrl()` → internal `/coverage-profile` route | N/A (internal `<Link>`, not an outbound anchor) | unchanged — not in scope, not outbound |
| `src/lib/email.ts:134` | internal property page URL | N/A (no `target="_blank"`) | unchanged — not outbound |

Every outbound anchor whose destination resolves through
`getAffiliateUrl()`/`AFFILIATE_VENDORS` already had the full
`rel="noopener noreferrer sponsored"` treatment before this work package.
The insurance module's vendor cards (`insurance-module.tsx`) route through
an internal `/coverage-profile` handoff page first — the actual outbound
affiliate click happens one step later in `coverage-handoff.tsx`, which is
already correct. `us-assessment-result.tsx` only renders `PartnerCta`/
`PartnerCtaRow` (already correct) and one internal `/assess` link — no raw
anchors of its own.

## Prioritized remediation list

1. **SAFE — Reduce/slow future programmatic page bursts.** Section 1 is
   the strongest, most concrete finding here. Any future large URL-count
   additions (more county sub-pages, more discover cities) should ideally
   roll out gradually rather than in single-week multi-thousand-page
   drops, and should be paired with proportional real content/backlink
   growth. This is a process change, not a code change, and does not
   touch affiliate mechanics.
2. **SAFE — Add an `/about` page and a real contact page.** Company
   description, physical address (even a registered-agent address is
   better than none), and a non-mailto contact path. No revenue impact.
3. **SAFE — Add author attribution to blog posts.** Extend `BlogPost` in
   `src/lib/blog.ts` with an `author` field and render it on
   `/blog/[slug]`. No revenue impact.
4. **SAFE — Expand `Organization` JSON-LD** (`src/components/json-ld.tsx`)
   with `address` and additional `sameAs` profiles once they exist. No
   revenue impact, though this is metadata only — it doesn't create the
   underlying signals, it just surfaces them if the About-page/contact
   work above happens first.
5. **SAFE — Audit whether all three `impact-site-verification` tags in
   `layout.tsx` are still needed**, and remove any that correspond to
   abandoned/duplicate Impact applications. This is metadata cleanup, not
   a change to any live affiliate link or revenue path. Flagged as
   read-only for this work package per hard constraint 1 (layout.tsx is
   off-limits while the PostHog install lands) — write up as a proposed
   change for whoever next touches `layout.tsx`.
6. **TRADE-OFF — Programmatic page depth/uniqueness.** Making the ~9,500
   county pages meaningfully less template-similar (more per-page
   narrative, fewer boilerplate CTA blocks, possibly `noindex` on the
   thinnest tier such as counties with only 1-2 of the 4 hero stats
   populated) would directly address Section 3, but changes indexing
   behavior and organic-traffic surface area. Flagging for the owner's
   decision, not implementing.
7. **TRADE-OFF — Affiliate CTA density per property page.** Section 4's
   "up to 15 CTA slots on one page" is a legitimate lever (fewer,
   better-targeted placements could read as less spammy) but directly
   trades off click volume and affiliate revenue. Flagging for the
   owner's decision, not implementing.
8. **Verify externally, no code action possible.** .xyz TLD reputation,
   domain age/history, WHOIS privacy, and the two existing backlinks'
   quality (Section 6) — these may be the largest single contributors to
   a spam score of 65 on a 2-backlink profile, and none of them are
   addressable from this codebase.
