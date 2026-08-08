# Legal-Readiness Briefing: US Expansion — Property Insights

**This is web research (compiled August 2026) to prepare for a conversation with legal counsel. It is not legal advice, and none of it should be relied on as a substitute for review by a licensed attorney (ideally one with cross-border US/Canada privacy, real estate, and FTC advertising experience). State privacy law is changing every few months — re-verify before any launch date.**

---

## Executive Summary

1. **Almost certainly below CCPA/CPRA's numeric thresholds today** ($26.625M revenue, 100k CA consumers/households, or 50% revenue from data sales) — but the calculation is closer than it looks once affiliate tracking pixels are counted, and it needs re-checking as traffic grows.
2. **Texas and a handful of other states have no revenue/consumer-count threshold at all.** Texas exempts via the SBA "small business" (<500 employees) definition — a status that evaporates if you sell "sensitive" personal data. Confirm with counsel that nothing sent to affiliates counts as sensitive data.
3. **The consent banner does not substitute for a CCPA-style "Do Not Sell or Share My Personal Information" link + Global Privacy Control (GPC) honoring.** These are two different legal mechanisms (opt-in banner vs. opt-out link) and 12 states now require honoring GPC as of Jan 1, 2026, including a new "visible confirmation" requirement in CA/CO. **Action needed.**
4. **Affiliate click-tracking (RentCast, DealCheck, and planned partners) likely qualifies as a "sale" or "share" of personal information** under CCPA's broad definitions (any transfer for valuable consideration, or for cross-context behavioral advertising even without payment). Recommend treating the site as already subject to sale/share obligations rather than waiting to cross a threshold.
5. **The direct relationship with users (they sign up, submit their own address) likely keeps the site out of "data broker" registration regimes** in CA/VT/OR/TX, which target businesses selling data about people who are *not* their customers — but this needs explicit counsel confirmation given the stated future "consented lead-gen product" goal.
6. **The intent score computed from behavioral events may qualify as "profiling"** under Colorado/Connecticut/Virginia-style laws, which can trigger a documented Data Protection Assessment obligation. Ask counsel whether a DPA is needed now or only at lead-gen productization.
7. **Modeled county-level estimates are legally fine as long as clearly disclaimed like Zillow's Zestimate** ("not an appraisal," "not for lending/underwriting decisions," "modeled from public government data"). No appraiser license is needed for a software-generated, non-transaction-specific estimate — but the disclaimer needs to live next to every displayed number, not just in the Terms.
8. **FTC affiliate-disclosure rules require a disclosure adjacent to each CTA/link itself** (not just a footer or a general disclosures page), using plain language like "Ad" or "Paid Link." Per-violation civil penalties ~$51,744–$53,088 as of 2025.
9. **RESPA, insurance-licensing, and real-estate-referral-fee law all turn on the exact mechanics of each partner agreement.** Before signing any mortgage, insurance, or agent-referral deal, counsel should read the actual partner contract to confirm a flat/CPL fee unrelated to whether a policy binds or a loan closes, and that Property Insights is never the party "soliciting" or negotiating.
10. **Cross-border structure (BC sole prop serving US consumers) raises open questions for counsel/cross-border tax advisor**: state "doing business" nexus, whether a US LLC helps or creates a CRA double-tax trap, BC choice-of-law enforceability against California consumers specifically, and E&O/media/cyber liability insurance before scaling the lead-gen product.

---

## 1. US state privacy laws applicable to a small foreign-owned site

**CCPA/CPRA thresholds (2026):** covered if ANY of: (a) annual gross revenue over $26,625,000 (2026 inflation-adjusted), (b) buys/sells/shares personal information of 100,000+ California consumers or households/year, or (c) 50%+ of annual revenue from selling/sharing PI. A small free site is unlikely to clear (a)/(c) but the 100k-consumer/household threshold is realistically reachable at moderate scale, and it may count *households browsing*, not just registered accounts — flag to counsel.
Sources: [Jackson Lewis](https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126), [IAPP](https://iapp.org/news/a/does-the-ccpa-as-modified-by-the-cpra-apply-to-your-business), [Clym](https://www.clym.io/blog/ccpa-applicability-guide)

**Other state laws — 20 states now in force (2026)**: CA, CO, CT, DE, IN, IA, KY, MD, MN, MT, NE, NH, NJ, OR, RI, TN, TX, UT, VA, WA.
Sources: [MultiState](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026), [Consenteo tracker](https://www.consenteo.com/knowledge-hub/legal/us_state_privacy_law_tracker_2026), [Clym comparison](https://www.clym.io/blog/us-privacy-law-comparison-map)

Notable thresholds:
- **Texas (TDPSA)**: no revenue/consumer-count threshold; exempts SBA-defined "small business" (~<500 employees), but **exemption disappears if selling sensitive data**. [Feroot](https://www.feroot.com/blog/texas-data-privacy-security-act-tdpsa-website-requirements/), [PrivacyLawMap](https://privacylawmap.com/states/texas)
- **Nebraska**: also no numeric threshold, similar small-business carve-outs — verify.
- **Montana**: 25,000 consumers, or 15,000 if 25%+ revenue from data sales (amended Oct 1 2025; cure period ends Apr 1 2026). [Bass Berry](https://www.bassberry.com/news/big-sky-bigger-privacy-montana-broadens-its-consumer-data-privacy-act/)
- **Oregon**: 100,000 consumers, or 25,000 with 25%+ revenue from data sales; AG enforcement begins July 1, 2026 (verify at oregon.gov).
- **Rhode Island**: lowest — 35,000 consumers, or 10,000 if 20%+ revenue from data sale.
- **Virginia/Connecticut/Indiana/Kentucky**: 100,000-consumer threshold; newest two effective Jan 1 2026.

**Is affiliate lead-gen "selling"/"sharing"?** Yes, likely: "sale" = disclosure of PI to a third party for *any* valuable consideration (commissions count); "share" = disclosure for cross-context behavioral advertising, even unpaid. Affiliate tracking IDs/cookies for commission attribution are explicitly called out as a likely "sale."
Sources: [Clym](https://www.clym.io/blog/ccpa-selling-and-sharing-what-counts-as-a-sale-or-share), [TrueVault](https://www.truevault.com/learn/is-sharing-the-same-as-selling-under-the-ccpa), [PMA](https://thepma.org/affiliate-marketing-and-the-california-consumer-privacy-act-ccpa/)

**Consent banner vs. opt-out-of-sale link**: different mechanisms. CCPA/CPRA is opt-out by default — requires a conspicuous "Do Not Sell or Share My Personal Information" (or "Your Privacy Choices") link plus honoring browser opt-out signals, even for consenting users. Sensitive PI: **CO, CT, DE, IN, MT, OR, TN, TX, VA require opt-in consent; CA and UT are opt-out** (via "Limit the Use of My Sensitive PI" link).
Sources: [Didomi](https://www.didomi.io/blog/sensitive-personal-information-spi-usa-data-privacy-laws), [Penrod](https://penrod.co/the-states-of-opt-in-requirements/)

**GPC/Universal Opt-Out**: 12 states require honoring an opt-out preference signal as of Jan 1, 2026 — CA, CO, CT, MT, NE, NH, NJ, MN, MD, DE, OR, TX. New CA/CO rules require **visible confirmation** the opt-out was honored. CA/CO/CT ran a coordinated enforcement sweep Sept 2025 targeting GPC non-compliance; CPPA issued a $2.75M settlement for opt-out failures Feb 2026.
Sources: [Clym on GPC](https://www.clym.io/blog/what-is-global-privacy-control-the-opt-out-signal-12-us-states-now-require-you-to-honor), [Foster Garvey](https://www.foster.com/newsroom/legal-alerts/global-privacy-controls-preparing-for-the-next-wave-of-enforcement/)

**Data broker registration**: CA, VT, OR, TX require annual registration; OR and TX have no threshold. All four definitions turn on selling data about consumers with whom there is **no direct relationship** — users creating accounts and submitting their own addresses likely keeps the site outside this today. Confirm with counsel; re-check if the lead-gen product ever sells aggregated data beyond direct affiliate-click referrals.
Sources: [Captain Compliance](https://captaincompliance.com/education/state-data-broker-laws-compared-ct-ca-tx-vt-mt/), [WilmerHale](https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20231214-texas-and-oregon-adopt-new-rules-for-data-broker-laws), [Cal Lawyers Assoc.](https://calawyers.org/privacy-law/wake-now-discover-that-you-are-a-data-broker/)

**Profiling/automated decision-making**: Colorado's opt-out right applies to profiling with "legal or similarly significant effects" and requires a documented Data Protection Assessment for such profiling; California's draft rules reach more broadly. The intent-score system is a gray area today (marketing/lead-routing, not loan-denial-style decisions) but is exactly what regulators flag once monetized — discuss DPA/DPIA timing with counsel before the lead-gen product ships.
Sources: [Lexology](https://www.lexology.com/library/detail.aspx?g=696412d1-12bd-4e57-8d37-def057ad6ada), [WilmerHale on CO rules](https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20221007-colorado-attorney-generals-office-publishes-proposed-rules-for-colorado-privacy-act)

---

## 2. A compliant small-site US privacy posture

Privacy policy additions (alongside existing PIPEDA/BC PIPA/Alberta PIPA sections):
- **Categories of PI collected**: identifiers/account data (Clerk), address/geolocation inputs, behavioral/commercial data (property views, assessments requested, partner clicks), device/analytics data (Vercel Analytics).
- **Purposes** for each category.
- **Whether data is "sold"/"shared"** — recommend disclosing affiliate click-attribution as a "sale/share" to be conservative, rather than asserting "we do not sell data" and risking a deception claim later.
- **Rights**: standard small-company practice is **one unified "US State Privacy Rights" section** covering the superset of rights (access, deletion, correction, portability, opt-out of sale/share/targeted advertising/profiling), structurally separate from the Canadian section.
- **GPC honoring statement** — technical commitment plus visible confirmation.
- **Do Not Sell/Share link** in the footer, functioning for pre-consent-banner visitors too.

**DSR handling for a solo operator**: most states allow **45 days + one 45-day extension**. Maintain a documented internal process (regulators expect one regardless of size), routed through legal@propertyinsights.xyz, with basic identity verification before disclosure/deletion.
Sources: [IAPP](https://iapp.org/news/a/opt-in-vs-opt-out-approaches-to-personal-information-processing), [BCLP](https://www.bclplaw.com/en-US/events-insights-news/sensitive-personal-information-understanding-and-complying-with-the-new-rules-in-the-united-states.html)

---

## 3. FTC obligations

**Affiliate disclosure**: must be **clear, conspicuous, and near the affiliate link itself** — footer-only or a general disclosures page is insufficient. Use plain terms ("Ad," "Paid Link," "Advertisement," "Sponsored"). Every paid CTA instance needs its own disclosure.
Sources: [FTC Endorsement Guides FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking), [Davis Wright Tremaine](https://www.dwt.com/insights/2023/07/ftc-advertising-endorsement-and-testimonial-guides), [ReferralCandy checklist](https://www.referralcandy.com/blog/ftc-affiliate-disclosure/)

**Penalties**: **$51,744–$53,088 per violation** (2025 figure); each unlabeled instance chargeable separately. Enforcement reaches companies that fail to police their affiliate network, not just individual promoters (Traffic and Funnels $1M; Fashion Nova $10k for failing to require influencer disclosures).
Sources: [Federal Lawyer](https://federal-lawyer.com/ftc-defense/affiliate-disclosure/), [Launchpoint](https://www.launchpointhq.com/blog/brand-liability-ftc-disclosure-violations), [Benesch on Review Rule](https://www.beneschlaw.com/insight/five-stars-zero-tolerance-ftc-turns-up-enforcement-under-consumer-review-rule/)

Note: FTC's 2024 Consumer Reviews and Testimonials Rule (effective Oct 21, 2024) — relevant only if/when reviews or testimonials are added.

**"Estimate" disclaimers**: Zillow's Zestimate is the playbook — "not an appraisal," "not authorized for use as an AVM for credit decisions under Dodd-Frank," "a starting point… one data point." Replicate for county-level modeled estimates: label as "modeled estimate," disclose public-data methodology, disclaim reliance for lending/insurance/tax-appeal/investment — **adjacent to the number**, not only in Terms.
Sources: [DayTrading.com](https://www.daytrading.com/zillow-zestimate-avms-flawed), [FDIC comment letter](https://www.fdic.gov/system/files/2024-06/2023-quality-control-standards-for-automated-valuation-models-3064-ae68-c-012.pdf)

**Interagency AVM Quality Control Rule** (Dodd-Frank §1125, [CFPB final rule](https://files.consumerfinance.gov/f/documents/cfpb_automated-valuation-models_final-rule_2024-06.pdf)): applies to AVMs used by mortgage originators/secondary-market issuers **for credit decisions**. County-level, non-parcel estimates not consumed by lenders are very likely out of scope — confirm with counsel, especially if a mortgage partner ever wants the estimate data programmatically.

---

## 4. Real-estate-specific concerns

**Appraisal licensing (USPAP)**: binds licensed appraisers performing appraisals for federally related transactions; does not reach software producing non-transaction-specific county-level estimates (the same logic behind Zillow/Redfin AVMs). State statutes generally carve out automated estimates if (a) not represented as an appraisal, (b) not tied to a specific transaction by someone holding out as an appraiser. Counsel should specifically review the property-tax-appeal pairing ("our estimate says you're over-assessed → appeal via Ownwell") — the appeal-preparation burden sits with Ownwell, but the optics deserve a look.
Sources: [Appraisal Foundation](https://appraisalfoundation.org/pages/uspap), [LegalClarity](https://legalclarity.org/appraisal-regulations-federal-state-and-uspap-rules/), [NC AVM guidance](https://www.ncrec.gov/pdfs/avm.pdf)

**RESPA §8**: bans referral kickbacks/unearned fees for settlement-service business on federally related mortgage loans. Safe harbors: payment for services actually rendered; properly disclosed Affiliated Business Arrangements (losing the disclosure forfeits the safe harbor). Flat CPL unrelated to loan closing = comparatively safe; success fees tied to closed-loan volume = comparatively risky. Counsel should read the actual marketplace agreement before signing.
Sources: [Bankers Compliance](https://blog.bankerscompliance.com/en/respa-section-8-referral-fees), [MBA materials](https://www.mba.org/docs/default-source/conferences/2025/lirc25/lirc25_complexities_respa_section_8.pdf)

**Insurance lead-gen licensing**: solicitation (urging purchase of a specific policy) requires a state producer license; **passive advertising/link-outs that don't discuss specific policies, collect underwriting info, or take bound-policy commissions are generally not solicitation**. **California is stricter** — even content "mentioning" a policy or conveying premium quotes can trigger licensing. Have counsel confirm CTA copy and compensation structure stay on the "advertising" side, especially for CA traffic.
Sources: [NAIC](https://content.naic.org/insurance-topics/producer-licensing), [Troutman Pepper Locke](https://www.troutman.com/insights/practical-licensing-challenges-solutions-for-producers-brokers-adjusters-other-intermediaries/)

**Agent-referral fees**: HomeLight holds a CA broker license and structures fees broker-to-broker; Clever positions as a matching/advertising service. Most states prohibit referral fees to unlicensed persons; a minority (CA, KS) permit limited unlicensed referral compensation if the referrer performs no licensed activity. Counsel should confirm any HomeLight/Clever-style contract keeps Property Insights as an unlicensed advertiser paid a platform fee — never performing licensed brokerage activity.
Sources: [HousingWire](https://www.housingwire.com/articles/opinion-broker-to-broker-referral-exemption-does-not-apply-to-agent-matching-platforms/), [Consumer Federation of America](https://consumerfed.org/wp-content/uploads/2020/09/Real-Estate-Referral-Fees-Report-9-21-20.pdf)

**Property-tax-appeal (Ownwell-style)**: comparatively low complexity — pure affiliate referral; licensing/practice burden sits on Ownwell.

---

## 5. Cross-border questions to ASK counsel

- **"Doing business"/foreign qualification**: does serving US consumers online (no US office/employees/inventory) from a BC sole proprietorship trigger state registration anywhere? Pure online business without physical presence usually doesn't, but no uniform test exists. Ask whether US contractors, a US bank account, or paid advertising into a state changes the analysis. [Discern](https://www.discern.com/resources/foreign-registration-nexus-us)
- **US federal tax / permanent establishment**: confirm the Canada-US Treaty's PE protections hold given Vercel/Cloudflare US infrastructure and US-region Neon Postgres.
- **State "information services" tax**: some states (TX, NY) tax B2B information services — low-probability, worth one question.
- **US LLC timing**: liability protection + simpler US contracting, but **CRA generally treats a US LLC as a corporation** (not pass-through), creating a documented double-taxation mismatch for Canadian residents. Needs bespoke cross-border tax modeling before incorporating. [BNN CPA](https://www.bnncpa.com/resources/the-unusual-tax-treatment-of-u-s-llcs-in-canada/), [SAL Accounting](https://salaccounting.ca/blog/us-llc-tax-problems-canadians/)
- **E&O / media / cyber liability insurance**: ~$50–$200/month for small media/data businesses. Budget before the lead-gen product launches — selling behavioral/lead data materially increases exposure. [Insureon](https://www.insureon.com/media-business-insurance/cost), [TechInsurance](https://www.techinsurance.com/errors-omissions-insurance/cost)

---

## 6. Government data licensing

All four sources are US federal government works — public domain (17 U.S.C. §105). Live constraints are API terms + agency disclaimers:

- **Census ACS**: API [Terms of Service](https://www.census.gov/data/developers/about/terms-of-service.html) require displaying "*This product uses the Census Bureau Data*" prominently; no implied endorsement; no modifying data while claiming Census as source. Bulk-file use may not technically bind to the API ToS — follow the attribution norm regardless.
- **FHFA HPI**: "public, freely available"; no explicit license text found in this pass (**gap — verify at fhfa.gov/data/hpi**). Cite "Source: FHFA House Price Index."
- **HUD FMR API**: explicit [Terms of Service](https://www.huduser.gov/portal/dataset/api-terms-of-service.html) — as-is, warranties disclaimed. Read full text before production use.
- **FEMA NRI**: [OpenFEMA public-domain terms](https://www.fema.gov/about/openfema/data-sets/national-risk-index-data) + [Disclaimer](https://hazards.fema.gov/nri/DISCLAIMER): "planning purposes only," "not a substitute for local risk assessment." **Mirror this disclaimer wherever NRI-derived risk scores are shown.**

**Bottom line**: no purchased license needed; obligations are API-ToS compliance where live APIs are used, and replicating each agency's accuracy disclaimer downstream.

---

## 7. Terms-of-service updates advisable

- **Modeled-estimate disclaimer** (next to every displayed number): *"This is a modeled, county-level estimate generated from public government data sources (US Census ACS, FHFA House Price Index, HUD Fair Market Rents, FEMA National Risk Index). It is not an appraisal, broker price opinion, or substitute for a licensed real estate appraisal or professional inspection, and should not be relied upon for lending, insurance underwriting, property-tax appeal, or investment decisions."*
- **No-professional-advice clause**: standard boilerplate — low-risk, add regardless.
- **Arbitration/class-action waiver** — discuss pros and cons: FAA generally preempts state rules invalidating class waivers (*AT&T Mobility v. Concepcion*), but CA courts refuse clauses stripping non-waivable state rights; many consumer brands keep a small-claims carve-out for trust reasons. [Purdue Global](https://www.purduegloballawschool.edu/blog/news/online-arbitration-agreements-enforceable), [CRS](https://www.congress.gov/crs-product/IF12764)
- **Governing law (BC)**: not automatically void for US consumers, but CA courts invalidate foreign choice-of-law clauses that strip non-waivable consumer rights. Common middle path: BC law for contract interpretation + explicit carve-out that mandatory consumer-protection/privacy rights of the user's home state apply. Ask counsel about a "United States Users" ToS rider. [TLB primer](https://tlblog.org/a-primer-on-choice-of-law-clauses/), [TermsFeed](https://www.termsfeed.com/blog/choice-law-cross-border-operations/)

---

## Gaps flagged for follow-up

- FHFA HPI formal terms/license page not directly retrievable — verify at source.
- RESPA/insurance/agent-referral conclusions are general-principle summaries; **actual partner contracts are the source of truth** and should be reviewed individually.
- No authoritative "revenue threshold at which a US LLC becomes worthwhile" exists — needs bespoke cross-border tax modeling.
- California sensitive-data mechanics, Colorado DPA/profiling rules, and the Jan 2026 GPC "visible confirmation" requirement are recently changed/actively enforced — re-verify current text immediately before implementation.
