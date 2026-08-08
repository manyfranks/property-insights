# US CTA Journey Map — the definitive monetization surface reference

_Written 2026-08-08. Describes the **target state** currently being implemented by a parallel session: a per-surface vertical-priority system (`SURFACE_VERTICAL_PRIORITY` in `src/config/affiliate-vendors.ts`) plus V1 (current hero+pills card) / V2 (topic-matched, priority-ordered) component treatments. Cross-reference: `07-US-AFFILIATE-CTA-SPEC.md` (vendor slate + rates), `10-AFFILIATE-APPLICATION-KIT.md` (application status), `11-CTA-OPTIMIZATION-PLAYBOOK.md` (placement/design evidence)._

**Why this doc exists**: the registry (`getVendorsForRegion`) currently ranks CTAs by `cpaTier` alone — whichever vendor pays the most wins the hero slot, regardless of page context. That's backwards for a credibility-first product: a tax-appeal tool showing a mortgage CTA first, or a county page leading with landlord banking, reads as generic ad-tech, not "this app's own next step." `SURFACE_VERTICAL_PRIORITY` fixes that by giving every surface an explicit vertical order derived from what a user on that page is actually trying to do next — then `cpaTier` breaks ties *within* a vertical, not across them. This doc is the map of that logic, written once so every future vendor slot-in is a config change, not a design decision.

---

## 1. The user journey

Three journeys, because "buyer" and "investor" want different things from the same address, and a fourth entry (tool-seeker) skips the address entirely.

### (a) BUYER journey

A homebuyer researching or actively evaluating a purchase.

1. **Discovery** — lands on a county page or blog post from Google ("Whatcom County WA property taxes", "how to read a home appraisal").
2. **Search** — enters a specific address.
3. **Result** — sees the assessment-backed offer number. This is peak intent: they now have a real number for a real property.
4. **Natural next steps, in order**:
   a. **Get pre-approved / compare lenders** (mortgage) — the very next action any real buyer takes once they know what a property is worth. Unmonetized until they know what to offer, so this is the #1 thing to solve for.
   b. **Get home insurance** (insurance) — a lender-required step, so it fires immediately after mortgage in the buyer's actual process, not as an afterthought.
   c. **Find an agent** (agent-referral) — needed to actually transact, especially for a self-directed researcher who started on Google rather than with an agent.
   d. **Home warranty** (home-services) — a lower-urgency add-on, right for the closing-adjacent moment, not the first result view.
   e. **Track the home** (investor-tools, repurposed) — RentCast's value/rent tracking works for a buyer as a "stay informed" utility even without investor intent.

### (b) INVESTOR journey

An investor evaluating a property or market as a deal.

1. **Discovery** — county page as market research (cap rate context, rent-to-price ratio, momentum).
2. **Result** — a specific address, evaluated as a deal, not a home.
3. **Natural next steps, in order**:
   a. **Analyze the deal** (investor-tools — DealCheck) — cash flow / ROI modeling is the immediate next action on any specific deal.
   b. **Finance it** (investor-tools — DSCR/hard money: Kiavi, Easy Street, Lima One) — investor financing is structurally distinct from consumer mortgage (RESPA-exempt business-purpose credit) and is the correct financing CTA for this mode, not MRC/LendingTree.
   c. **Landlord insurance** (insurance, investor-flavored — Simply Business, Steadily) — different product than buyer homeowners insurance; must not show the same Allstate/SmartFinancial CTA a buyer sees.
   d. **Manage the rental** (investor-tools — Avail, Baselane) — post-acquisition operations, correctly a later-priority slot than financing.
   e. **Lower the taxes** (tax-appeal — Ownwell) — an ongoing-ownership lever, not a pre-close one, so it sits after acquisition/financing/management in the investor's result-page priority — but promotes to the #1 slot on the calculator surface (see below).

### (c) TOOL-SEEKER journey

Someone who arrives via the assessment-gap calculator rather than a property search — they're not asking "what should I offer," they're asking "is my assessment wrong."

1. **Entry** — assessment-gap calculator, no address-driven result yet.
2. **"My assessment looks too high"** — the calculator's own output is the trigger.
3. **Tax appeal (Ownwell) is THE natural extension** — not a fallback vertical, the literal next click for this specific intent. This is the one surface where tax-appeal outranks everything else, including investor-tools and mortgage.
4. **Then mortgage/insurance** — once the over-assessment question is answered, the visitor is functionally back in the buyer/investor funnel and general next-step verticals resume.

### Journey stage → page template → vertical priority

| Journey | Stage | Page template | Vertical priority (head to tail) |
|---|---|---|---|
| Buyer | Discovery | county-page | investor-tools → mortgage → tax-appeal |
| Buyer | Search | home / search entry | (unmonetized — funnel, not inventory) |
| Buyer | Result | result-buyer | mortgage → insurance → agent-referral → home-services → investor-tools |
| Investor | Discovery | county-page | investor-tools → mortgage → tax-appeal |
| Investor | Result | result-investor | investor-tools → mortgage (DSCR) → insurance (landlord) → tax-appeal |
| Tool-seeker | Entry → answer | calculator | tax-appeal → mortgage → insurance |
| Any | Post-visit | email | mirrors the result surface's priority for that recipient's last-seen mode |

---

## 2. Per-surface placement table

| Surface | `source` value | Vertical priority order | Treatment | Heading text | Why this order |
|---|---|---|---|---|---|
| **result-buyer** | `assess-result` (mode="buyer") | mortgage → insurance → agent-referral → home-services → investor-tools | V2 (topic-matched, priority-sorted hero+pills) | "Act on this offer" | User just got a real offer number on a specific home — financing it is the literal next action; insurance follows because lenders require it; agent and warranty are the remaining pre/post-close needs. |
| **result-investor** | `assess-result` (mode="investor") | investor-tools → mortgage (DSCR/hard money) → insurance (landlord) → tax-appeal | V2 | "Run the numbers" | User is evaluating a deal, not a home — cash-flow analysis and deal-specific financing outrank consumer mortgage/insurance entirely; those verticals don't even apply to this mode. |
| **county-page** | `county-page` | investor-tools → mortgage → tax-appeal | V2 (one hero + inline topic-matched unit per playbook §3) | "Tools for [County]" | Informational SEO traffic researching a market, not a single property — market-research tools (RentCast/DealCheck) are the correct first touch; mortgage and tax-appeal are still relevant but the user hasn't committed to an address yet. |
| **calculator** | `calculator` | tax-appeal → mortgage → insurance | V2, post-result only (gated behind the assessment-gap result) | "Your next step" | The calculator's entire premise is "is my assessment too high" — tax-appeal isn't just topically relevant, it's the answer to the question the user just asked. |
| **email** | `email` | mirrors result surface priority by recipient mode | V1 today (hardcoded Square One CA-only); target V2 once US email variant ships | (per-template) | Not yet built for US (Track 1 backlog) — when it ships it must call `getVendorsForRegion`/priority resolver like every other surface, not hardcode a vendor. |
| **discover** _(not yet wired)_ | `discover` | investor-tools → mortgage → insurance | V1 planned | "Tools for this market" | Browsing-intent listing grid, same logic as county-page — market tools first, transactional verticals second. Enum + API allow-list already exist (playbook §3, queue item 4); component just isn't mounted on the page yet. |
| **state-page** _(not yet wired)_ | `state-page` (new `AffiliateSource` value, not yet added) | investor-tools → mortgage → tax-appeal | V1 planned | "Tools for [State]" | Same informational-SEO logic as county-page, one level up the hierarchy — even modest CTR here compounds across all 51 state indexes + the /us hub. |

---

## 3. Slot-fill matrix — today vs. as approvals land

**Today (Aug 8 2026)**: every US surface renders the same two vendors regardless of priority order, because they're the only `enabled: true` US vendors — RentCast (hero) + DealCheck (pill), both `investor-tools`, both `cpaTier: 2`. The priority system exists to route *future* approvals into the right slot the moment they flip on; it doesn't change what's live today.

| Surface | Renders TODAY | + Allstate/Insurify/SmartFinancial (insurance) | + MRC via CJ (mortgage) | + Simply Business via CJ (landlord insurance) | + Avail via CJ (investor-tools) | + Choice Home Warranty via CJ (home-services) | + Ownwell via FlexOffers reapply (tax-appeal) | + Kiavi/EasyStreet/LimaOne (investor financing) | + HomeLight (agent-referral) | End-state "full stack" |
|---|---|---|---|---|---|---|---|---|---|---|
| **result-buyer** | RentCast hero, DealCheck pill | Insurance CTA slots in as 2nd pill | **MRC becomes hero** (highest-priority vertical, mortgage); RentCast/DealCheck drop to pills | — (buyer mode, not shown) | — | Slots in as a pill once mortgage+insurance filled | Slots in as a pill (buyer over-assessment flag adjacency) | — (buyer mode, not shown) | Slots in as a pill | Hero: MRC · Pills: insurance, agent, warranty (investor-tools drops off if 4+ verticals present) |
| **result-investor** | RentCast hero, DealCheck pill | — (investor mode uses landlord insurance, not consumer) | — (investor mode uses DSCR financing, not consumer mortgage) | Slots in once live — landlord insurance pill | Slots in as investor-tools pill (rental management) | — (lower relevance for investor mode) | Slots in as pill (ongoing-ownership lever) | **Becomes hero** (investor-tools, financing sub-priority, highest cpaTier — Kiavi/EasyStreet $1,000/loan) | — (lower relevance for investor mode) | Hero: Kiavi/EasyStreet/LimaOne (whichever's affiliateReady+highest tier) · Pills: DealCheck, Simply Business, Avail |
| **county-page** | RentCast hero, DealCheck pill | Insurance doesn't fit this surface's priority (deprioritized) | Mortgage pill added | Landlord insurance pill (if investor-heavy county) | Avail/Baselane pill | — | Tax-appeal pill (esp. high-mill-rate counties) | Investor-financing pill possible on investor-flagged counties | — | Hero: RentCast/DealCheck (unchanged — investor-tools stays #1 here) · Pills: mortgage, tax-appeal |
| **calculator** | RentCast hero, DealCheck pill (generic — priority not yet reflecting tax-appeal) | — | Mortgage pill | — | — | — | **Becomes hero** (tax-appeal is the #1 vertical for this surface); **DIY-packet fallback CTA when property's state isn't in Ownwell's 8 full-service states** — needs `stateCoverage` branch, not yet implemented | — | — | Hero: Ownwell (full-service) or DIY Appeals Packet CTA (fallback) · Pills: mortgage, insurance |
| **email (US)** | Doesn't exist | | | | | | | | | Once built: mirrors result-buyer/result-investor priority by last-seen mode, via `getAffiliateUrl(id, "email")` |
| **discover** | Not wired (renders nothing) | | | | | | | | | Once wired: same as county-page pattern |
| **state-page** | Not wired (renders nothing) | | | | | | | | | Once wired: same as county-page pattern |

Notes on ties and fallbacks:
- Within a vertical, `cpaTier` (then `affiliateReady`) still breaks ties — e.g. once both MRC and LendingTree are live, whichever has the higher tier/is affiliate-ready wins the mortgage hero slot; the other drops to a pill or off entirely if the pill slots are full.
- Kiavi's state exclusions (MS, NM, RI, UT, VT) mean result-investor in those 5 states skips straight to EasyStreet/LimaOne for the financing hero — no visible gap, just a different vendor in the same slot.
- Ownwell's 8-state allowlist (CA, CO, FL, GA, IL, NY, TX, WA) means the calculator hero is Ownwell in those states and **nothing** (falls through to mortgage) everywhere else until the DIY-packet fallback CTA is built — that's the one true gap in the priority system as designed, called out in §4.

---

## 4. Gaps

- **No mortgage vendor live — the biggest journey hole.** A buyer's #1 natural next step (get pre-approved / compare lenders) is completely unmonetized on every US surface today. MRC (#7647072) and LendingTree are the CJ path; New American Funding is parked behind the same FlexOffers reapply as Ownwell. Until one of these lands, `result-buyer`'s priority-#1 vertical has zero eligible vendors and the hero slot silently falls back to `investor-tools` (RentCast) — functionally correct fallback behavior, but it means the buyer's most-wanted CTA doesn't exist yet.
- **No insurance vendor live for US — the buyer's #2 step.** Allstate, SmartFinancial, and Insurify applications are out; none approved as of Aug 8. Same fallback pattern as mortgage: priority order is correct, inventory is empty.
- **No agent-referral live.** HomeLight application submitted (`partners.homelight.com/signup`, TUNE-powered) but pending — worth a sanity check per the application kit's "HomeLight Test" label caveat before treating it as fully live once approved.
- **Tax-appeal (Ownwell) is parked behind the FlexOffers reapply**, and even once approved, its two-tier state routing is **not implemented in code yet**: `stateCoverage: ["CA","CO","FL","GA","IL","NY","TX","WA"]` correctly gates the full-service CTA, but there's no fallback branch for the other 42 states — Ownwell's own DIY "National Appeals Packet" (launched Feb 2026) needs a second CTA variant + `stateCoverage`-miss handling before the calculator surface reaches its designed end-state. Sovrn/VigLink is an untried alternate network path if the FlexOffers reapply stalls.
- **Kiavi's state exclusions are implemented** (`stateExclusions`); **Ownwell's allowlist is implemented** but has **no elsewhere-fallback** (same gap as above, stated at the registry level rather than the surface level).
- **Email: the US variant doesn't exist.** Track 1 backlog item. When built, it must call the same priority-resolver path as every other surface (`getVendorsForRegion` + `SURFACE_VERTICAL_PRIORITY["email"]`) — not hardcode Square One the way the current CA-only email does today.
- **discover / state-page / /us hub surfaces are not yet wired** — playbook queue item 4. The `discover` source enum and API allow-list already exist in `AffiliateSource`; the component just isn't mounted on `src/app/discover/[city]/page.tsx`. `state-page` needs a new `AffiliateSource` value added first (does not exist in the type today — only `assess-result | property-page | calculator | email | discover | county-page`).
- **Canadian surfaces have only 3 vendors** (Ratehub, nesto, Square One — mortgage + insurance only) and **no CA investor-tools or tax-appeal equivalents** at all. Noted as a future track, not in scope for this US-focused priority system.
- **EPC feedback loop is inert.** `partner_clicks` already captures vendor/vertical/state/source/affiliate, but there isn't enough volume yet to read EPC-per-source and reorder `cpaTier`s quarterly (playbook §5, phasemap Track 2 item 7). The priority system's vertical *order* is fixed by journey logic; only the *within-vertical* tie-break (`cpaTier`) is meant to move with data, and it can't yet.

---

## 5. CJ apply queue

_From the live CJ dashboard inventory, Aug 8 2026. Ranked by journey fit × urgency, not raw EPC — closing the mortgage gap (#1) matters more than any single number below._

1. **Mortgage Research Center** (#7647072) — Lead 60%, 3mo EPC $207. ❌ **AUTO-DECLINED Aug 8** (programmatic traffic/domain-age screen, consistent with CJ's "lower approval odds" flag). Reapply once GSC shows impressions; CJ lists the program's affiliate contact for a traffic-proof pitch. Mortgage slot now rides on **LendingTree (in review)** → NAF (FlexOffers reapply) as fallbacks.
2. **Simply Business** (#5808859) — $30/lead, EPC $1,570 — landlord insurance, fills result-investor's insurance slot.
3. **Avail** (#7785516) — $25/lead, EPC $143 — investor-tools (rental management), fills result-investor's later-priority slot.
4. **Choice Home Warranty** (#4593144) — $20/lead, EPC $64 — home-services, fills result-buyer's lower-priority slot.
5. **Experian** (#2591819) — $12–50/lead, EPC $85 — buyer credit-readiness, lower approval odds; adjacent to mortgage journey stage but not a core vertical.
6. **LendingTree** — available in dashboard; mortgage alternate/backup to MRC.
7. **UPack** (#4377991) — $50/sale, EPC $309 — moving, post-purchase; **defer until a home-services surface exists** (doesn't fit any current journey stage cleanly).
8. **LawDepot** (#4544498) — 25%/sale — lease + purchase documents; niche investor fit, low priority.
9. **TurboTax** — seasonal; landlord tax use case, low priority.
10. **PadSplit** (#7464091) — $100/sale — co-living investor niche; **defer**.

**Skip-list**: banking/deposit programs (BMO, Barclays, Axos, Valley, Ally — high EPC, zero topical fit to any journey stage), credit cards, credit repair (reputational risk), Aflac/NY Life/travel insurance (wrong products for this audience), furniture/games/misc (no journey fit at all).

---

## 6. Copy standard

**Rule**: a vendor label answers "what do I get if I click" in one plain sentence a distracted 12-year-old parses on first read. No brand-first labels (never lead with the vendor name as the headline). First-person where it reads naturally ("my" > "your" > passive, per the Aagaard first-person test cited in the playbook). Two lines only: `ctaLabel` (the action) + `description` (the one-line payoff/mechanism).

| Vendor | Vertical | `ctaLabel` | `description` |
|---|---|---|---|
| RentCast | investor-tools | Track this home's value and rent | Free alerts when a property's value or rent changes |
| DealCheck | investor-tools | Will this deal make money? | Free calculators for cash flow, profit, and what to offer |
| Ownwell | tax-appeal | Lower my property taxes | They appeal your assessment for you — you only pay if you save |
| MRC (Mortgage Research Center) | mortgage | Compare mortgage lenders | Match with lenders that fit this home and your budget |
| Simply Business | insurance (landlord) | Insure my rental property | Landlord insurance quotes from top insurers in minutes |
| Avail | investor-tools | Manage my rental for free | Free landlord software: leases, tenant screening, rent collection |
| Choice Home Warranty | home-services | Protect this home's systems | One plan covers repairs to appliances, AC, and plumbing |
| Allstate | insurance | Get a home insurance quote | See what it costs to insure this home |
| SmartFinancial | insurance | Compare home insurance quotes | Multiple insurers, one quote request |
| Insurify | insurance | Find cheaper home insurance | Compare quotes from top carriers in minutes |
| Kiavi | investor-tools (financing) | Finance this deal | Fast hard-money and rental loans for investors |
| Easy Street Capital | investor-tools (financing) | Get a loan quote for this deal | DSCR and fix-and-flip financing, no tax returns needed |
| Lima One Capital | investor-tools (financing) | Finance this investment property | Rental, bridge, and construction loans for investors |
| Baselane | investor-tools (banking) | Bank for my rental income | Free banking and bookkeeping built for landlords |
| HomeLight | agent-referral | Find a top local agent | Free matching with agents who know this market |
| LendingTree | mortgage | Compare mortgage offers | See rates from multiple lenders side by side |
| Steadily | insurance (landlord) | Insure my rental property | Landlord policies quoted online in minutes |

Existing CA vendors (unchanged, already shipped):

| Vendor | Vertical | `ctaLabel` | `description` |
|---|---|---|---|
| Ratehub | mortgage | Compare mortgage rates | See today's best mortgage rates from 50+ lenders |
| nesto | mortgage | Get pre-approved | Online mortgage pre-approval in minutes |
| Square One | insurance | Get a home insurance quote | Customizable coverage — $20 credit applied automatically |

**Rule of thumb when writing a new vendor's copy**: `ctaLabel` is a verb phrase naming the action the user takes ("Compare," "Get," "Find," "Track," "Insure," "Finance," "Protect," "Lower," "Manage," "Bank"). `description` names the mechanism or payoff in ≤12 words, no jargon, no vendor self-praise ("industry-leading," "award-winning" — banned). If a sentence needs the vendor's brand name to make sense, rewrite it — the brand name belongs in the small "[Vendor] →" link at the card's foot, never in the headline or description.
