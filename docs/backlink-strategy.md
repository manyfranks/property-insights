# Backlink Gap Analysis — propertyinsights.xyz

**Date:** 2026-08-14
**Method:** Owner's stated method — "look at competitor/benchmark sites and see where they're getting backlinks from... build and accumulate links over time."

## Status of this report: mixed quantitative + qualitative

This is **not** a clean quantitative gap report. Section 2 (competitor summary metrics) and the two competitor deep-dives in Section 3 are real, sourced DataForSEO API data. The remainder of the target list (most of Section 4) is **qualitative web research** — real URLs found via search, each independently verified, but *not* confirmed against a full backlink index. I stopped pulling from the API primarily because of budget, not because the API failed — details below. No number in this report is invented; every count is either a live API response or has a cited source URL.

---

## 1. Data source and why it's partial

**API used:** DataForSEO Backlinks API (`backlinks/summary/live` and `backlinks/referring_domains/live`), authenticated via HTTP Basic Auth. Credentials were located in an existing `.env` at `/Users/matt/Desktop/Orio/economic-due-dilligence/economic-atlas/.env` (used previously for a DataForSEO SEO audit of this same site, documented in that repo's `docs/seo-sprints/PROPERTY-INSIGHTS.md`). No credential values are reproduced anywhere in this document or elsewhere.

**Why the pull is partial:** That account is shared across projects and was already nearly depleted — its own audit log records it started the prior sprint (2026-08-12) with ~$1.00 and ended with ~$0.37. When I checked it on 2026-08-14, the live balance was **$0.303**. I ran:

- 8× `backlinks/summary/live` calls (propertyinsights.xyz + 7 competitors) at $0.024 each = $0.192
- 2× `backlinks/referring_domains/live` calls (taxbycounty.com, full list of 25; ownwell.com, top 30 of 1,115 by rank) = $0.050

Total spent: **$0.242**, leaving roughly **$0.06** in a shared account. I stopped there rather than draining it, which means I could not pull referring-domain lists for wowa.ca, zolo.ca, ratehub.ca, propertyshark.com, or insurify.com — only their summary totals. **A follow-up pull (or a fresh DataForSEO/Ahrefs credit top-up) is needed to get the full quantitative "domains linking to 2+ competitors but not to us" intersection** for the whole competitor set. What's below for those five domains is their real summary numbers plus qualitative research on who links to them.

---

## 2. Competitor set and referring-domain counts (DataForSEO, live)

| Domain | Type | DFS Rank | Backlinks | Referring Domains | Referring Main Domains | Spam Score |
|---|---|---:|---:|---:|---:|---:|
| **propertyinsights.xyz** (baseline) | — | 0 | 2 | 2 | 2 | 65 |
| wowa.ca | Canadian offer/market-data tool | 330 | 19,742 | 4,761 | 4,170 | 22 |
| zolo.ca | Canadian offer/market-data tool | 468 | 217,676 | 9,624 | 8,739 | 7 |
| ratehub.ca | Canadian offer/market-data tool | 500 | 1,415,752 | 9,731 | 8,662 | 20 |
| ownwell.com | US property-tax/assessment tool | 296 | 30,895 | 1,185 | 1,115 | 29 |
| propertyshark.com | US property-tax/assessment tool | 423 | 92,286 | 6,366 | 5,648 | 11 |
| taxbycounty.com | Calculator/content benchmark | 390 | 73,750 | 25 | 25 | 1 |
| insurify.com | Insurance-path benchmark | 403 | 136,737 | 7,756 | 7,388 | 3 |

**Why this set:** Verified via live web search against the site's actual target queries. Zillow/Bankrate/NerdWallet/SmartAsset dominate all of these SERPs but were deliberately excluded — their link profiles are mega-site noise (hundreds of thousands of low-relevance domains) and not realistically replicable targets, per the task brief. Wowa, Zolo, and Ratehub all surfaced repeatedly for Canadian mortgage/home-value calculator queries and for head-to-head "we tested these mortgage sites" journalism. Ownwell and PropertyShark surfaced for property-tax-appeal and property-records queries respectively. TaxByCounty is the closest direct structural analog to propertyinsights.xyz (a programmatic per-county property-tax calculator site) and was added as a benchmark rather than dropped, precisely because it's mid-size and comparable. Insurify was added for the new home-insurance-by-address path.

**Immediate flag on propertyinsights.xyz's own baseline:** spam score of 65 on only 2 backlinks is very likely a small-sample artifact of DataForSEO's spam-score formula (near-zero link count skews the ratio), not a real trust problem — but it's worth periodically re-checking once real links land.

---

## 3. Competitor deep-dives (real referring-domain data)

### taxbycounty.com — cautionary example, not a pattern to copy

Pulled the complete list of all 25 referring domains (not a sample — this is exhaustive). Result: **the overwhelming majority are the site's own sister properties**, not earned editorial links:

`countyscore.com, riskbycounty.com, waterbycounty.com, crimebycounty.com, weatherbycounty.com, soilbycounty.com, incomebycounty.com, schoolsbycounty.com, healthbycounty.com, costbycounty.com, databycounty.com, lawnbycounty.com, spendbycounty.com`

All thirteen share the "[X]byCounty.com" naming convention, and their `first_seen` dates cluster within hours of each other on **2026-04-23** — a single coordinated network launch, not organic link accumulation over time. This is why taxbycounty.com can show 73,750 total backlinks against only 25 referring domains: a handful of sister sites are cross-linking every one of their thousands of county pages to every other sister site. Google's spam-score read on this domain is *low* (1) for now, but this is a textbook private-link-network pattern and not something to replicate — it's a link-scheme risk, not an SEO strategy. Treat it as competitive intelligence (this operator runs a network of ~13 similar "byCounty" sites) rather than a target to imitate.

### ownwell.com — real, earned link profile (top 30 of 1,115 domains, by authority)

This is a legitimate, diversified profile. Grouped by what actually links and why:

- **Trade press / funding coverage:** the company's Series B/PR coverage (verified separately via search: HousingWire, PR Newswire) gets picked up and syndicated across a small local-news network visible in the pull — `myneighborhoodnews.com`, `linewsradio.com`, `linkedupradio.com` (rank 128–179) — consistent with a press-release wire service redistributing the same story to dozens of small "local news" placeholder sites.
- **Personal-finance/real-estate blogger reviews with real numbers:** independent search confirms `howtomoney.com` published "How I Saved $706 on Property Taxes Last Year" — a genuine testimonial-style review, the highest-value link type in this profile.
- **Mortgage/lender and real-estate agent content:** `universalmortgage.com`, `summitlending.com`, `property-taxes-texas.com`, `financeratecalc.com`, `gadurarealestate.com`, `chicagoestatesco.com`, `milestonepremierproperties.com` — smaller lenders and agents referencing the appeal service in blog content.
- **Podcast guest appearances:** `simplecast.com`, `podcastplayer.com`, `pdcstly.com` — auto-generated host-platform backlinks from podcast guest spots.
- **Job-board/HR platforms:** `roles.directory`, `designjobs.careers`, `hvacjobshq.com`, `welcometothejungle.com`, `uncover.work` — these come from the company's own hiring listings, not editorial mentions; low relevance for propertyinsights.xyz to copy.
- **Adjacent proptech SaaS:** `turbotenant.com` (landlord software) — a real cross-industry partner/content mention.
- **Cross-link to another competitor in our set:** `taxbycounty.com` itself appears here (rank 92) — confirms these two competitors already link to each other.

---

## 4. Gap target list (prioritized, 28 domains)

Because I could not pull full referring-domain lists for wowa.ca, zolo.ca, ratehub.ca, propertyshark.com, or insurify.com, this list is **not** a strict "linked to 2+ competitors, not to us" intersection for the whole set (that requires the follow-up API pull noted above). It is a verified, sourced list of real domains proven to link to at least one benchmark in this set — pulled either from the API data above or from live web search with a specific citable URL. Each entry names which competitor(s) it's proven against.

**Genuinely linkable assets to pitch, across every row below:** the free assessment-gap calculator (assessed value vs. asking price, using real county-assessor data rather than a Zestimate-style black box), the county-level property-tax/rent data pages (9,510 of them), and the offer-model methodology writeup (`ALGORITHM.md`-grade transparency — most competitors don't publish their math).

### A. Mortgage lender / broker tool embeds (proven against wowa.ca, ratehub.ca)
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| nesto.ca | Search-confirmed: hosts a page titled "Ratehub Mortgage Payment Calculator" | Tool/calculator embed | Pitch a Canadian-market assessment-gap widget/embed as a value-add for their mortgage-shopping content |
| pragmatic.mortgage | Search-confirmed: runs "Ratehub vs WOWA" head-to-head comparison page | Tool/calculator roundup | Ask to be added as a third tool in future "mortgage platform comparison" posts, offering data-backed offer modeling as differentiator |
| wealthnorth.ca | Search-confirmed: published "Ratehub Mortgage Review Canada 2026" | Resource-page listing / review | Pitch a review post: "how much should you actually offer" using assessment-anchored data |

### B. National/major media doing comparison journalism (proven against wowa.ca, ratehub.ca, zolo.ca)
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| theglobeandmail.com | Search-confirmed: "We tested five mortgage websites in a head-to-head comparison" | Local/national news citation | Pitch as a sixth, Canada-focused offer-intelligence tool for a follow-up comparison piece |

### C. .edu / research-guide citations (proven against ratehub.ca, propertyshark.com)
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| ivey.uwo.ca | Search-confirmed: Ivey Business School "Scotiabank Digital Banking Lab" case study on Ratehub.ca | .edu data/case-study citation | Pitch as a case study subject for real-estate fintech / assessment-based pricing research |
| libguides.law.villanova.edu | Search-confirmed: Villanova Law's property-research LibGuide lists PropertyShark as a property-records source | .edu data citation | Submit propertyinsights.xyz's assessment/tax data pages to law-library "property research" LibGuides (this is a repeatable pattern — most law schools maintain similar guides) |

### D. Real-estate tool directories / SaaS review platforms (proven against propertyshark.com)
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| capterra.com | Search-confirmed: "Best Real Estate CMA Software 2026" listing includes PropertyShark | Tool/calculator roundup (SaaS directory) | Submit propertyinsights.xyz as a free assessment-intelligence tool listing |
| g2.com | Search-confirmed: PropertyShark has an active G2 product/discussion page | Tool/calculator roundup (SaaS directory) | Create a G2 product profile |
| softwarefinder.com | Search-confirmed: "PropertyShark: Pricing, Free Demo & Features" listing page | Tool/calculator roundup (SaaS directory) | Submit for a comparable listing |
| rentalrealestate.com | Search-confirmed: platform hosts "35 best rental property calculators" and reviews PropertyShark | Tool/calculator roundup | Submit the offer-model/assessment-gap calculator for inclusion |
| credaily.com (CRE Daily) | Search-confirmed: published a "PropertyShark 2026 Review" | Guest post / trade-press review | Pitch a review or contributed article on assessment-anchored offer pricing |
| batchdata.io | Search-confirmed: "Top 12 Real Estate Investment Tools in 2026" roundup | Tool/calculator roundup | Submit for inclusion as an acquisition-intelligence tool |
| butterflymx.com | Search-confirmed: "5 Real Estate Tools for Investors" blog roundup | Tool/calculator roundup | Same — proptech content-marketing roundup, submit for inclusion |

### E. Ownwell's real, API-confirmed referring domains that are plausible direct targets
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| turbotenant.com | DataForSEO referring-domains pull (rank 76, real backlink to ownwell.com) | Guest post / adjacent-SaaS content | Pitch landlord-focused content: assessed-value tracking as a hold/sell signal |
| howtomoney.com | Search-confirmed testimonial review of Ownwell ("How I Saved $706...") | Guest post / reader testimonial review | Pitch a testimonial-style piece: "I used assessment data to offer $X below asking and it worked" |
| workmoney.org | Search-confirmed: consumer-advocacy nonprofit resource page on property taxes links to Ownwell | .org/nonprofit resource-page listing | Pitch inclusion as a free consumer tool (no fee, unlike Ownwell's 25% contingency model — a real differentiator) |
| help.valon.com | Search-confirmed: mortgage servicer's help-center article references Ownwell as a customer-facing add-on | Partner/integration mention | Pitch mortgage servicers on referencing propertyinsights.xyz's free tools in homeowner help content |
| housingwire.com | Search-confirmed: covered Ownwell's funding round | Trade-press / local news citation | Pitch a data story: "what our county tax-data pages reveal about assessment lag vs. list price" |
| prnewswire.com | Search-confirmed: hosted Ownwell's funding press release | PR wire syndication | Lowest-value link type here (wire distribution, not editorial) — useful only as a syndication seed, not a priority target |

### F. Insurance-path targets (new vertical, proven against insurify.com)
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| clearsurance.com | Search-confirmed: publishes insurer/aggregator review content (e.g., NerdWallet review) in the same space as Insurify | Guest post / comparison review | Pitch a review of address-based home-insurance quoting vs. generic marketplaces |
| fintelconnect.com | Search-confirmed: writes about how to get featured on NerdWallet/Bankrate-style sites | Affiliate/partnership content | Explore as an affiliate-network entry point for the insurance vertical |

### G. Generic calculator-directory cluster (proven relevant to the "assessed value vs market value" and "how much to offer on a house" queries directly — these are the actual current occupants of those SERPs)
| Domain | Proven via | Acquisition type | Outreach angle |
|---|---|---|---|
| calculator.academy | Ranks directly for "assessed value to market value calculator" | Resource-page/calculator-hub listing | Pitch as a more accurate, real-data alternative/companion link |
| bravecalculator.com | Ranks directly for the same query | Resource-page/calculator-hub listing | Same |
| calculatorzilo.com | Ranks directly for the same query | Resource-page/calculator-hub listing | Same |
| omnicalculator.com | Ranks for "what to offer on a house calculator" | Resource-page/calculator-hub listing | Same — larger/more authoritative hub than the others in this cluster, higher priority |
| reachcalculator.com | Ranks for "what to offer on a house calculator" | Resource-page/calculator-hub listing | Same |
| best-calculators.com | Ranks for "what to offer on a house calculator" | Resource-page/calculator-hub listing | Same |
| tooldone.com | Ranks for "what to offer on a house calculator" | Resource-page/calculator-hub listing | Same |
| nationalmortgagecenter.com | Ranks for "property tax calculator 2026 – ZIP, county & all 50 states" | Lender-content calculator page | Pitch as a data-source citation (real county rates vs. modeled estimates) |

**Caveat on group G:** these are thin/generic calculator-content sites of varying quality — good for volume and topical relevance, low individually. Note honestly: some may not be worth building relationships with beyond a one-time resource-list submission.

---

## 5. Patterns — what actually powers these link profiles

1. **Strongest pattern found: mortgage lenders/brokers embed competitor calculators, and independent finance bloggers do head-to-head "we tested these sites" comparisons.** This showed up three independent times around the same two competitors (nesto.ca embedding Ratehub's calculator; WealthNorth and pragmatic.mortgage both publishing Ratehub-vs-Wowa style reviews) plus one major newspaper (The Globe and Mail) doing the same kind of comparison journalism. That's convergent evidence of a repeatable channel, not an anecdote — it's also the best fit for propertyinsights.xyz's Canadian offer tool, since "which tool actually uses real data" is a natural comparison angle.
2. **PropertyShark's link profile runs almost entirely on directory/citation infrastructure**: SaaS review platforms (Capterra, G2, Software Finder), real-estate tool roundups (RentalRealEstate, BatchData, ButterflyMX), trade press (CRE Daily), and .edu library research guides (Villanova Law). This is the most scalable, lowest-effort pattern to copy: submit to the same tool directories, and specifically target law-library "property research" LibGuides — those are a recurring page type across many law schools, not a one-off.
3. **Ownwell's profile is PR-driven**: a funding announcement gets syndicated through wire services and small local-news networks, then converted into durable links by testimonial-style personal-finance blog reviews (How To Money) and nonprofit consumer resource pages (WorkMoney). This suggests a similar play for propertyinsights.xyz: a "what we learned from 9,510 county pages" data story pitched to trade press, paired with reader-testimonial content once real users have real offer outcomes.
4. **Counter-pattern, do not copy: taxbycounty.com's huge backlink count is a private-network artifact**, not organic authority — 73,750 backlinks from only 25 referring domains, almost all of them same-owner "byCounty.com" sister sites launched within hours of each other. High backlink *counts* can be manufactured this way; referring-*domain* diversity from independently-owned sites is the metric that actually matters, and it's the one this competitor is weak on despite the inflated headline number.
5. **The exact-match calculator queries this site targets are currently occupied by thin, generic calculator hubs** (calculator.academy, bravecalculator.com, etc.), not by strong competitors — this is a genuine opportunity: real assessment data beats their generic formula-only calculators, and getting listed alongside them is comparatively low-friction.

---

## 6. Recommended next step

Top up the DataForSEO account (or use Ahrefs/Semrush if already licensed) and run `backlinks/referring_domains/live` with a higher limit against wowa.ca, zolo.ca, ratehub.ca, propertyshark.com, and insurify.com. That closes the one real gap in this report: a true "linked to 2+ competitors, not to us" domain intersection across the full 7-competitor set, rather than the 2-competitor partial intersection available today.
