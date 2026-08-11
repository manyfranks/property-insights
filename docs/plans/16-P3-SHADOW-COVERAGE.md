# Property Intelligence P3 — Shadow Classification and Capability Coverage

_Created 2026-08-11. Review artifact for P3 in `13-PROPERTY-INTELLIGENCE-PHASEMAP.md`._

## Outcome

P3 now emits two independent, additive artifacts after P2 resolves the assessment subject:

- `PropertyClassification` describes scoped evidence with deterministic, inferred, conflicting, or unknown states, confidence, provenance, and debugging explanations.
- `PropertyCapabilities` decides whether nine product modules are supportable and explains every unavailable decision.

Both artifacts run in shadow mode. They do not suppress or add visible modules, change the buyer journey, select a goal, route a CTA, or persist inferred user intent. Occupancy is classified for review but is deliberately absent from capability inputs.

## Implemented contracts

Classification dimensions:

| Dimension | Values |
|---|---|
| Parcel use | residential, commercial, mixed-use, institutional, land, unknown |
| Building form | detached, attached, low-rise multi-unit, apartment, mixed-use, other, unknown |
| Unit use | residential, commercial, other, unknown |
| Listing scope | unit, whole building, parcel, unknown |
| Occupancy signal | owner-occupied, non-owner-occupied, conflicting, unknown |
| Tags | short-hold resale pattern, suite signal, high land-to-improvement ratio, recent build |

Capability decisions cover address sale valuation, address rent estimate, regional rent benchmark, offer analysis, gross-yield screen, land/improvement analysis, county market/risk context, whole-building commercial analysis, and insurance prefill. Reasons are limited to `available`, `missing_field`, `unsupported_scope`, `provider_exclusion`, `regional_proxy_only`, and `conflicting_evidence`.

## Scope rules locked in code

1. A residential unit listing inside a mixed-use building remains residential at unit scope. The containing building does not overwrite the unit.
2. Parcel/building values cannot power unit-level modules.
3. Regional values remain regional proxies and cannot become address valuations or address rents.
4. A subject conflict or required clarification withholds consequential address-level modules.
5. Known land, institutional, commercial, and whole-building mixed-use subjects are excluded from the residential models.
6. Whole-building commercial analysis is always provider-excluded because the current stack has no NOI, lease-roll, or building-specific cap-rate evidence.
7. Insurance prefill checks only subject scope, residential support, and core property facts. It never reads occupancy.
8. `non-owner-occupied` is not labeled rental or investment intent; short hold and high land ratio remain signals, not claims of a flip or teardown.

## Runtime coverage by ingestion surface

This matrix reports what the deployed code path can evaluate when the optional source fields are actually returned. It is not an address-level coverage percentage.

| Geo / surface | Classification evidence | Address sale | Address rent | Regional rent | Land split | Market/risk | Important limitation |
|---|---|---|---|---|---|---|---|
| US on-demand, active listing | RentCast listing + property record | Conditional RentCast AVM | Conditional RentCast rent AVM | HUD/ACS county | Conditional RentCast tax split | County panel + FEMA | Best-supported surface; optional fields still vary by address |
| US on-demand, off market | RentCast property record | Conditional RentCast AVM | Conditional RentCast rent AVM | HUD/ACS county | Conditional RentCast tax split | County panel + FEMA | Offer unavailable because there is no active listing |
| US regional fallback | Unknown property class | Regional proxy only when area median exists | Unavailable | HUD/ACS county | Unavailable | County panel + FEMA | A geocode/county match never becomes property classification |
| US Discover seed | Listing type only | Unavailable | Unavailable | Page-level county context | Unavailable | Page-level county context | `/properties` is not queried, so occupancy, record type, and tax split are structurally absent |
| US Discover enriched | Listing + selected records | Conditional AVM | Unavailable by design | Page-level county context | Conditional record tax split | Page-level county context | Only the quota-gated top-N subset is enriched; do not generalize to the seed corpus |
| Canada on-demand listing | Zoocasa listing type/subtype | Unavailable (asking price is not a valuation) | Unavailable | Conditional bedroom-matched CMHC CMA read | Conditional verified assessment split | Unavailable in current CA assessment result | Regional rent is never presented as expected address rent |

## Geo/adapter coverage boundaries

| Geography / adapter | P3 classification contribution | P3 capability contribution | Shadow expectation |
|---|---|---|---|
| Maricopa AZ, Miami-Dade FL, Cook IL, King WA, NYC five boroughs | No normalized class/use contribution from the county adapter today | Property-specific assessment context; county market/risk comes from the regional panel | RentCast remains the classification source; a county hit alone cannot establish residential use |
| Travis TX | No live county call; no retained use class | Batch-only assessment path plus normal RentCast/regional paths | Live assess must not trigger the bulk adapter |
| BC | Zoocasa listing class; assessment does not establish parcel use | Land/improvement only when the adapter explicitly marks a complete split; CMHC in mapped CMAs | Unit subjects cannot consume parcel split |
| AB | Zoocasa listing class | Total assessment only; CMHC Calgary/Edmonton | Calgary's internal residential query constraint is not retained as class evidence |
| ON | Zoocasa listing class | Cached/tax-derived total only; CMHC Toronto/Hamilton/Ottawa | 2016/tax-derived values are not current sale valuations |
| MB | Zoocasa listing class | Winnipeg total only; CMHC Winnipeg | Mixed-class parcel total cannot establish residential use |
| Other Canadian provinces/cities | Zoocasa listing fields when found | No normalized assessment; CMHC only if city mapping exists | Missing capability remains explicit |

## Fixture coverage

`scripts/test-property-intelligence-p3.ts` currently locks 14 cases:

| Category | Expected shadow result |
|---|---|
| US detached active listing | Residential/detached/whole-building; address sale, rent, offer, yield, and insurance supported when facts exist |
| Queens canonical-address regression | Hyphenated civic number remains a whole-home listing; residential class preserved |
| Residential condo in mixed-use building | Residential unit remains supported; parcel stays mixed-use; parcel split rejected for the unit |
| Apartment building without unit | Clarification takes precedence; consequential modules withheld |
| Explicit whole-apartment-building listing | Whole building is preserved; unit use remains unknown; single-home valuation/offer modules are scope-excluded |
| Vacant land | High-confidence land; residential rent/insurance excluded |
| Government/institutional | High-confidence institutional; residential modules excluded |
| Commercial building | Commercial classification retained; unresolved unit/building scope safely takes precedence |
| Conflicting provider types | Explicit conflict and low overall confidence; modules withheld |
| Regional fallback | Regional values remain proxies; address capability stays unavailable |
| Canadian condo | Unit residential; CMHC regional rent available; address rent and parcel split unavailable |
| Canadian detached | Detached listing form; verified split supports land analysis |
| Discover seed | Listing form may classify; assess-only capabilities remain missing |
| Occupancy invariance | Owner-occupied and non-owner-occupied inputs produce byte-equivalent capability output |

Result: **14/14 passed; provider calls: 0**. The suite also asserts that serialized output contains no goal, journey, or investment-intent field.

## Review watchlist for Matt

P3 remains **in progress** until these false-positive categories are reviewed against live examples:

- Apartment/condo labels that describe a unit versus an entire apartment building.
- Mixed-use property records paired with residential or commercial unit listings.
- Generic `commercial` records where P2 correctly asks unit-versus-building before routing.
- Assessor strings containing words such as `exempt`, `utility`, or `land` in a context that does not actually establish current parcel use.
- `multi-family` labels, which are only medium-confidence low-rise building-form evidence.
- High land ratio and suite language, which must remain tentative signals.

No single aggregate accuracy score will approve P3. Review is by subject scope, evidence surface, and category.

## Validation record

| Check | Result |
|---|---|
| P3 classification/capability fixtures | **PASS — 14/14; zero provider calls** |
| P2 subject fixtures | **PASS — 23/23; zero provider calls** |
| P1 evidence fixtures | **PASS — 12/12** |
| P0 fallback fixtures | **PASS — 14/14** |
| Pipeline guard | **PASS — 16/16; no live RentCast call** |
| TypeScript | **PASS** |
| Touched-file lint | **PASS** |
| Production build | **PASS — 337 routes/pages generated** |
| Full lint baseline | **UNCHANGED — 26 errors, 20 warnings in untouched files** |
| 20-random integration / quota before-after | **PASS — 20/20, seed `20260811`, RentCast quota `50 → 50`** |
| Production shadow response | _Pending deployment_ |

## Remaining P3 gates

- Matt reviews live/fixture false positives and agrees on category-specific launch bars.
- Counsel/privacy direction is recorded before occupancy can affect visible content, CTA routing, suggestions, or persistent profiling.
- Live assessment responses are sampled across US listed/off-market/fallback and Canadian unit/whole-building cases.
- P4 may consume capabilities only after this review; P3 itself remains incapable of selecting a user goal.
