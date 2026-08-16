# BC Digital Home-Insurance Brokerage: Data & Underwriting Infrastructure Report

*Prepared August 16, 2026 (Sonnet research agent). Sources: vendor sites, insurer sites, broker/underwriter trade press (Canadian Underwriter, Insurance Business Canada, insurance-canada.ca, BetaKit), cross-referenced against prior verified BD research (`insurance-path-status` memory). Claims without a citable primary source are marked **[UNVERIFIED]**.*

---

## TL;DR

- A bindable Canadian home quote needs roughly **5 data blocks**: applicant/prior-insurance info, property construction & systems, protection class, loss history, and coverage selections. We hold pieces of only the first two (partially).
- **Opta iClarify (Verisk-owned)** is the dominant Canadian prefill vendor — ~90% of new-business quotes, ~12 construction fields per address — but access is sold to **licensed brokerages/insurers**, not unlicensed lead-gen platforms.
- **HITS (CGI/Opta habitational claims database)** and carrier rating engines (Applied Rating Services, direct carrier APIs) are **licensed-access-only** — this is the hard wall between "content/referral site" and "real brokerage."
- **APOLLO** is no longer a clean "instant quote/instant bind" story for personal lines post-Gallagher (Aug 5, 2026) — advisor-assisted per our BD notes. Square One remains the cleanest self-serve/instant-bind BC comparator.
- The manual-review flag taxonomy is large and mostly **not covered by our current wizard** — we collect only roof-age bucket, claims-count bucket, occupancy, and unit count from the underwriting-relevant set.
- Near-term: we can produce a fast **indicative, non-bindable range** instantly; genuine instant-bind requires (a) a licensed partner's own flow, or (b) becoming a licensed brokerage with Opta + HITS + a rating engine.

---

## 1. What it takes to produce a real, bindable Canadian home quote

| Block | Fields | Prefilled? |
|---|---|---|
| **Applicant** | name, DOB, address, mailing history (3yr), mortgage/lienholder, prior insurer + expiry, marital status (some carriers) | Asked — no reliable personal-identity prefill vendor in Canadian P&C |
| **Property construction** | year built, construction type, roof type & age, sqft, storeys, garage, pool, # units | **Prefilled** — Opta iClarify ~12 construction fields ([Canadian Underwriter](https://canadianunderwriter.ca/insurance/how-opta-is-using-ai-to-refine-pre-fill-data-accuracy-1004165368)) |
| **Systems** | heating type/fuel, wiring type, panel amperage, plumbing material, wood stove/WETT, oil tank | Partially prefilled by Opta; often still confirmed/asked |
| **Protection class** | fire hall/hydrant distance, municipal grade | **Prefilled** via Fire Underwriters Survey — Public Fire Protection Classification (1–10, commercial), Dwelling Protection Grade (1–5, personal) ([fireunderwriters.ca](https://fireunderwriters.ca/grading/dwelling-protection-grade.html)) |
| **Loss history** | claims count/type/date in last 5 (sometimes 10) years, cancellations, non-renewals | **Prefilled for licensed entities** via CGI's HITS (7M+ claims, 10+ yrs — [optaintel.ca/Solutions/HITS](https://optaintel.ca/Solutions/HITS)); no consumer-facing habitational equivalent found (myAutoPlus is auto-only) |
| **Coverage selections** | dwelling limit/replacement cost, deductible, liability limit, endorsements (sewer backup, overland water, earthquake) | Always asked/configured — replacement cost is *calculated* (RCT), not assessed value |

**Key vendors/standards:**
- **Opta iClarify** (Verisk): ~12 construction fields, replacement cost, imagery; ~30,000 quotes/day; feeds all major BMS. Enterprise/per-transaction licensing to insurers and brokerages; pricing undisclosed. ([optaintel.ca/about](https://optaintel.ca/about.html))
- **HITS** (CGI, on Opta's data asset): personal-property claims history via web/API/batch; insurer/underwriter access, not consumers or unlicensed platforms. **[Broker-level self-serve access UNVERIFIED]**.
- **Fire Underwriters Survey**: protection grades by municipality/address; financed by Opta.
- **CSIO**: standards body (43k+ members); CSIO XML (licensed from ACORD), eDocs, My Proof of Insurance. Standardizes pipes between BMS and carriers.
- **BMS**: Applied Epic, Vertafore SIG, Power Broker (Acturis, ~30% Canadian share, built by Victoria BC's Zycomp). None available to unlicensed platforms.
- **Rating engines / quote APIs**:
  - **Applied Rating Services (ARS)** — comparative rater for **auto and property**, 24/7 self-service quoting embeddable in brokerage sites, + Applied PreFill. Licensed-brokerage tool. ([Applied ARS](https://www1.appliedsystems.com/en-ca/solutions/for-brokers/insurer-connectivity/applied-rating-services/))
  - **APOLLO Exchange** — instant-quote/bind exchange, API partnership w/ LowestRates.ca; **acquired by Gallagher Aug 5, 2026**; personal-lines flow now advisor-assisted per our BD notes. ([BusinessWire APOLLO/LowestRates API](https://www.businesswire.com/news/home/20210622005260/en/APOLLO-Insurance-and-LowestRates.ca-Partner-to-Offer-Access-to-Embedded-Digital-Insurance-via-an-API))
  - **YouSet** — RIBO-licensed digital broker, 18-20+ insurers, <4 min quotes, **ON/QC only, no BC**.
  - **Zensurance** — commercial/small-business focus; API surface oriented to embedded small-business (e.g., Amazon Canada seller liability), not residential.
  - **ProNavigator** — absorbed/relaunched as an AI assistant inside Guidewire's core systems; not an independent consumer product.
  - **Quandri** — AI renewal automation for brokerages (US$12M raise July 2025, 100+ brokerage customers); not a new-business rating engine.
  - **Duuo** (Co-operators), **Onlia** (Aviva) — direct single-carrier digital brands, not APIs. Onlia home product **[UNVERIFIED]**.
  - **Sonnet** — **not defunct**; exited only Alberta auto (Dec 2024, rate caps). Still sells home + pet; auto in ON/QC/Maritimes. ([Sonnet AB exit](https://www.sonnet.ca/news/sonnet-discontinue-auto-business-alberta))

---

## 2. Time-to-quote reality

| Provider | Flow type | Speed | BC availability |
|---|---|---|---|
| **Square One** | Fully self-serve, single-carrier, online bind | "5 minutes" marketed | Yes — our pinned #1 BC partner |
| **APOLLO** | Multi-carrier exchange (pre-2026 instant bind) | Instant historically; **degraded for personal lines post-Gallagher** | Yes (Vancouver HQ) |
| **YouSet** | Multi-carrier comparison | "<4 minutes" | **No — ON/QC only** |
| **Sonnet** | Direct single-carrier | Online self-serve | ON/QC/Maritimes; BC not confirmed |
| **Duuo** | Direct single-carrier | "Minutes" | National-ish, tenant-strongest |
| **Onlia** | Direct single-carrier | Digital | ON; home **[UNVERIFIED]** |
| **TD/Desjardins** | Traditional insurer flow | Not documented as fast | National |

**Question counts:** no flow publishes an enumerated list; Square One's support page names categories (current address, prior address if moved <3 yrs, consent to loss-history and property-data access, home characteristics, underwriting questions) but no count. **[UNVERIFIED]** ([Square One what-to-expect](https://www.squareone.ca/quote-buy/what-you-can-expect))

**Industry-standard minimum once Opta fills construction data** (synthesized estimate): roughly **15–25 questions** — applicant identity/prior insurance (4–6), occupancy/usage (2–3), loss-history consent + claims disclosure (2–3), confirm prefilled construction (3–5), coverage selections (4–6), payment/binding (2–3).

---

## 3. Manual-review flag taxonomy

Narrative notes:
- **Roof age**: >20yr = detail/inspection wanted; >25yr = ACV shift, decline, or inspection + surcharge. Direct insurers decline faster than brokers can place.
- **Wiring**: knob-and-tube — many insurers refuse until replaced; others bind higher + electrical inspection. Ontario ESA permits K&T under conditions but premiums rise regardless. **Aluminum / 60A-fuse thresholds [UNVERIFIED — general industry knowledge]**. ([MyChoice K&T](https://www.mychoice.ca/blog/knob-and-tube-wiring-home-insurance/))
- **Plumbing (Poly-B, galvanized)**: water-damage exclusion, conditional renewal, non-renewal, or new-business refusal. Poly-B removed from code 2005; exposure concentrated in 1985–2005 builds, BC/AB heavy. ([Poly B Guys AB](https://thepolybplumbingguys.ca/poly-b-pipes-and-home-insurance-in-alberta-what-calgary-homeowners-need-to-know/))
- **Oil tanks**: buried = effectively **uninsurable** until removed + soil-tested. Above-ground steel ~15–20yr life; some insurers reject 14-gauge single-wall outright. ([Canadian Home Inspection](https://www.canadianhomeinspection.com/home-reference-library/heating-systems-air-conditioning/buried-oil-tanks/))
- **Wood stoves**: WETT certification near-universal requirement; undocumented DIY installs = the single most common decline reason; some majors refuse all wood-burning new business. ([ThinkInsure](https://www.thinkinsure.ca/insurance-help-centre/wood-stove-insurance.html))
- **Claims**: **2+ claims (esp. water) in 5 years** = practical referral trigger; repeat claims read as systemic/maintenance issues. ~6–10% of Canadian homes reportedly already uninsurable for water-damage coverage. ([Ratehub water claims](https://www.ratehub.ca/blog/how-making-multiple-water-claims-impacts-your-home-insurance-coverage/))
- **Vacancy/STR**: >30 days vacant without notice risks suspended coverage; 30–90 days undisclosed = misrepresentation/void. Standard insurers decline/exclude STR; specialty STR exists (Aviva, April, Square One).
- **High-value**: **$1M–$1.5M+ replacement cost** = inflection where self-serve tools stop (Intact $1M min RC, Chubb $1.5M min RC); binding-authority examples: Erie Mutual agent authority to $1M RC / $1.5M bind. ([Erie Mutual](https://www.eriemutual.com/insights/high-value-ontario-home-insurance/))
- **BC wildfire moratoriums**: real, recurring — insurers pause new-business binding in threatened areas during active season; renewals unaffected; lifts as threat eases. **No public distance formula** — insurer-specific, likely postal-code/fire-zone level. As of Aug 16, 2026: ~126 active BC fires (45 OOC) — a live operational concern. Digital-broker handling mechanism **[UNVERIFIED — inferred: rating-engine block keyed to FSA/postal code surfacing as referral/"temporarily unavailable"]**. ([IBC BC wildfire](https://www.ibc.ca/news-insights/news/bc-residents-encouraged-to-prepare-for-the-2024-wildfire-season))
- **BC earthquake**: deductible commonly **10–15%** of insured value (range 2–20%), % of insured amount not loss — structurally different mechanic. Near-universal EQ endorsement attachment in BC. ([Ratehub earthquake](https://www.ratehub.ca/insurance/home/earthquake-insurance))
- **Rental unit count**: two distinct thresholds — (1) **3+ unrelated tenants** ("rooming house") → landlord-specialty/commercial; (2) **5-unit** line is a *mortgage financing* boundary (CMHC MLI Select) but a reasonable proxy for insurance product-class shift.
- **Heritage/log/unique construction**: specialist underwriters (e.g., Ecclesiastical), engineering reports, renovation history.
- **Home-based business**: must be disclosed; undisclosed use can void; degree of commercial mix determines endorsement vs separate commercial policy.
- **"4-line" updates**: homes ~30–40yr+ without roof/wiring/plumbing/heating updates draw referral/decline from directs; brokers place via specialty. **[General pattern, UNVERIFIED as numeric rule]**.
- **Premium-threshold referral**: internal underwriting-authority limits per carrier/brokerage; no public standard. **[UNVERIFIED]**.

### Consolidated flag table

| Flag | Typical trigger | Instant / Refer / Decline | Detection source | Do we hold it? |
|---|---|---|---|---|
| Roof age | >20yr detail; >25yr ACV/decline | Refer (20–25) → Decline/ACV (25+) | Wizard roof-age bucket / inspection | **Yes** — bucket collected |
| Knob-and-tube wiring | Any | Decline unless replaced, or Refer + inspection | Disclosure / inspection / Opta | No |
| Panel (60A/fuse) | <100A or fuses | Refer, often upgrade required | Disclosure / inspection | No |
| Plumbing (Poly-B/galvanized) | Any, esp. 1985–2005 builds | Refer → conditional → Decline new business | Disclosure / inspection / Opta | No |
| Oil tank (buried) | Any | **Hard decline** until removed + soil test | Disclosure / historical fuel data | No |
| Oil tank (above-ground) | >15–20yr, single-wall | Refer/Decline by carrier | Disclosure | No |
| Wood stove, no WETT | Any | Decline (most common single reason) | Disclosure / WETT cert | No |
| Wood stove, WETT'd | Any | Refer/Instant carrier-dependent; some ban all | Disclosure / cert | No |
| Claims (water esp.) | ~2+ in 5yr | Refer/surcharge; 3+ often Decline | HITS (licensed) or self-report | **Partial** — count bucket only, no type/date, no HITS |
| Prior cancellation (non-payment) | Within ~2–3yr | Refer, higher-rate market | Disclosure / HITS | No |
| Prior cancellation (misrep/fraud) | Within ~5yr | Decline standard → specialty | Disclosure / HITS | No |
| Vacancy | >30 days undisclosed | Refer/void; vacancy endorsement | Occupancy disclosure | **Partial** — occupancy option, no day-count |
| Short-term rental | Any undisclosed | Decline standard; Refer STR specialty | Occupancy disclosure | **Partial** — STR occupancy option |
| High-value home | ~$1M–$1.5M+ RC | Refer to high-value product/broker | RCT estimate | **No RCT** — assessed value ≠ RC |
| Log/unique construction | Any | Refer specialty | Disclosure / Opta construction type | No |
| Heritage designation | Listed | Refer specialty | Disclosure / municipal registry | No |
| Wildfire proximity | Insurer-specific, FSA-level, active season | Refer / temporary moratorium (new business only) | Insurer backend + BC Wildfire Service data | No integration |
| Earthquake (BC) | Universal — 10–15% deductible | Instant (pricing/deductible mechanic) | Geographic zone | **Partial** — province known, no seismic zone |
| 3+ unrelated tenants | 3+ | Refer landlord-specialty/commercial | Unit count disclosure | **Partial** — unit count collected |
| 5+ units | 5+ | Refer commercial/apartment product | Unit count | **Partial** |
| Home-based business | Undisclosed commercial use | Refer/void; endorse or commercial | Disclosure | No |
| "4-line" aged systems | ~30–40yr+ no updates | Refer (directs), specialty placeable | Year built + system-age disclosure | **Partial** — year built only |
| Premium above referral threshold | Carrier-specific | Refer | Internal to rating engine | N/A |

---

## 4. Gap analysis against our stack

**We hold:** full address, province, Zoocasa listing data (type, year built, beds/baths, sqft, list price, taxes, approx age, acreage, description), assessment value, estimated value. Wizard: line, occupancy, unit count, claims-count bucket, roof-age bucket, name/email/phone, expiry month, consent.

**(a) Derivable/prefillable from our data:**
- Year built → triggers targeted "updated?" follow-ups (not answers).
- Sqft + type + value → **replacement-cost range estimate only** — assessed value systematically diverges from RC (real RCT: Opta iClarify RCT, CoreLogic/Cotality RCT Express, e2Value). Must be labeled estimate per fail-loud standard.
- Description text → NLP hints ("wood stove", "heritage", "poly-B replaced") usable as pre-flag prompts for targeted follow-ups, not verified facts.
- Acreage → rural/well-septic/fire-distance risk hint, not a FUS grade.
- Address → runnable against FUS/Opta only once we have licensed access.

**(b) Must add to the wizard** (all unlicensed-collectable disclosures): construction type; heating type/fuel; wood stove + WETT; wiring type; panel amperage; plumbing material; oil tank presence/age/material; mortgage/lienholder; prior insurer + prior-term/claims detail; DOB + credit-consent fields (provincial credit-scoring restrictions **[UNVERIFIED which provinces]**); vacancy day-count; home-based-business; all coverage selections (dwelling limit, deductible, liability, endorsements).

**(c) Requires a licensed integration** (unfixable by wizard fields): HITS claims pull; Opta iClarify prefill; carrier rating engines / ARS; CSIO eDocs / BMS membership. APOLLO's API is presently our only CA prefill-capable surface, degraded for personal lines post-Gallagher.

**Estimated remaining question count with full prefill from our stack: ~12–18** — systems/construction confirmation (4–6, unsourceable by us), coverage selections (~4), applicant/prior-insurance (4–6). Not dramatically shorter than Square One's ~5-minute flow: our prefill removes property-characteristic questions but not the systems, claims-detail, or coverage-selection blocks. (Synthesized estimate, not a measured comparison.)

---

## 5. Speed-to-actionable-quote ladder

| Tier | Description | Latency | Achievable today? |
|---|---|---|---|
| (i) Instant indicative range, our data | Rough $-range from value + rate heuristic, labeled non-bindable | <5 sec | **Yes** — must be flagged as estimate, never a quote (fail-loud) |
| (ii) Instant bindable via partner API, clean risk | Carrier-side quote/bind, no flags | Minutes | **Partial** — Square One's flow is the true instant-bind path; APOLLO degraded post-Gallagher |
| (iii) Same-day broker callback, flagged | Manual-review flags, human underwriter | Hours–1 biz day | In principle via partner referral; SLA unverified |
| (iv) Multi-day, hard risk/inspection | WETT/electrical inspection, oil-tank remediation, heritage engineering | Days–weeks | Partner/specialty-dependent |

**BC book split per bucket (low-confidence synthesized estimate, no public dataset):** (i)/(ii) clean ~50–65%; (iii) refer ~25–35%; (iv) hard ~10–15%. Grounding point: ~6–10% of Canadian homes already water-damage-uninsurable (floor contributor to iii/iv).

---

## Open questions

1. Does Opta (or any prefill vendor) offer an unlicensed-platform tier?
2. APOLLO post-Gallagher personal-lines flow — instant bind gone entirely, or degraded for certain risk classes only? Confirm directly.
3. Consumer/broker self-serve habitational HITS-equivalent — exists?
4. Actual BC wildfire-moratorium mechanism used by digital brokers (postal-code block list? FSA flag? manual hold)?
5. Provincial restrictions on credit-based insurance scoring for property lines?
6. Square One / APOLLO actual enumerated question counts — needs a live walkthrough (browser automation candidate).
7. Reconcile internal "true prefill count = 6 (not 12)" vs Opta's marketed "12 fields" — ours was a copy-truth correction about our own prefill claims; distinct from Opta's field coverage.
