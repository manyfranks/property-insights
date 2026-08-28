# P6A — Buyer Convergence

_Implementation record created 2026-08-28. This sprint is intentionally limited to the existing buyer journey; Owner / Manager remains a separate P6B product decision._

## Decision

Buyer result composition now consumes the resolved assessment subject, scoped property classification, and capability envelope. Those contracts decide whether the existing offer, valuation, acquisition, partner-action, insurance-prefill, and regional-context modules may render.

This is composition, not a new classifier. It makes no provider calls, does not infer intent from occupancy, does not change the selected goal, and does not add commercial, insurance-underwriting, or Owner / Manager scope.

## Surface contract

| Surface/evidence state | Buyer behavior |
|---|---|
| On-demand US or CA assessment with a capability envelope | Capability-driven composition |
| Supported residential listing | Existing offer, score, narrative, valuation, email path, partner actions, and insurance behavior retained |
| Supported off-market residential property | Property valuation context remains; no offer or acquisition/motivation analysis is invented |
| Residential unit in a mixed-use container | Unit analysis remains available and explicitly says building/parcel evidence is not substituted |
| Verified land, commercial, institutional, or unsupported whole-apartment-building subject | Residential offer, motivation, partner, and insurance modules are withheld; seller/listing and supported regional facts may remain |
| Regional-only evidence | Regional context only; supplied property values and rent cards cannot leak through the result composition |
| Provider error, quota block, clean miss, or bundle failure | Existing P0 neutral fallback remains authoritative; missing evidence is not relabeled as a verified property-class exclusion |
| Discover record without a capability envelope | Explicit `legacy` contract retains the current buyer page until Discover has universal enrichment |

The rendered contract is observable through `data-p6a-buyer-contract` (`capability` or `legacy`) and `data-p6a-buyer-availability` (`supported`, `limited`, or `unavailable`). The earlier `data-p5-active-composition` marker remains unchanged for compatibility with P5 tests and instrumentation.

## Module mapping

| Module | Required composition decision |
|---|---|
| Recommended/estimated offer and offer cascade | `offerAnalysis.available` for the resolved subject |
| Score, acquisition narrative, seller-motivation and equity/tenure analysis | Supported offer analysis; these do not survive as standalone property claims |
| Property facts, assessment, AVM/comparables, triangulation | Address sale valuation matching the resolved subject, or a supported offer whose value evidence matches it |
| Partner actions | Supported offer or address valuation, with no hard subject/class exclusion |
| Insurance prefill | `insurancePrefill.available`; it is not derived from the generic partner-action decision |
| County/CMA market and risk context | `countyMarketRiskContext.available`, always labeled regional |

## P0 parity review

| P0 fixture | P6A disposition | Parity/change explanation |
|---|---|---|
| Detached residential listing | Full supported buyer composition | Existing output retained |
| Explicit residential unit listing | Full supported buyer composition at unit scope | Existing output retained; containing building cannot replace unit |
| Multi-unit building without unit | Clarification/containment precedes composition | Intentional P2/P3 safety improvement; no unit values are substituted |
| Mixed-use building, residential unit | Supported with scope-context notice | Existing residential unit path retained with an added boundary explanation |
| Vacant-land record | Residential buyer composition withheld | Intentional P3 exclusion; dedicated CA land context remains intact |
| Government/institutional clean miss | Neutral regional fallback | Unknown remains unknown; no class claim is invented |
| Generic clean miss | Neutral regional fallback | Existing P0 degradation retained |
| Provider quota exhausted | Neutral regional fallback | Existing P0 degradation retained; no retry or provider call |
| Provider error | Neutral regional fallback | Existing P0 degradation retained |
| Bundle failure | Neutral regional fallback | Existing P0 degradation retained |
| Rent-only bundle | Regional fallback | Rent alone cannot open buyer valuation or offer modules |
| AVM without property identity | Unresolved-subject containment | Existing P0 value withholding retained |
| Record with listing lookup blocked | Neutral provider/quota fallback | A skipped lookup cannot become an off-market claim |

## Verification

- `scripts/test-property-intelligence-p6a.tsx`: buyer contract fixtures for supported listed/off-market, regional-only, legacy Discover, three excluded classes, whole-apartment scope, mixed-use residential unit, and occupancy non-use. Zero provider calls.
- `scripts/test-property-intelligence-render.tsx`: production-shaped supported, regional-only, commercial-withheld, P0 fallback, result-hierarchy, and P5 regression coverage.
- The complete P0–P6A Property Intelligence suite, TypeScript, touched-file lint, and production build are release gates.

Pre-commit verification on 2026-08-28:

- **PASS — 170/170** combined P0–P6A property-intelligence fixtures; P6A 10/10 and render-shaped fixtures 19/19, with zero provider calls in the new contract suite.
- **PASS** `npx tsc --noEmit` and touched-file ESLint.
- **PASS** full `npm run build`, including insurance copy/domain/auth checks and the journey matrix.
- **PASS** local cached browser replay: `2820-cosgrove-cres` is `capability/supported`, preserves the offer, signal, buyer CTA and collapsed supplemental focus control; 390 px has no horizontal overflow. `1827-main-st` is `capability/unavailable`, preserves land price context, and exposes no residential offer, rental, partner, insurance, or duplicate withheld panel.
- **PENDING** preview/production US listed and off-market replay plus final deployed CA smoke.

## Live acceptance matrix

The implementation may land behind normal deploy review, but P6A is not marked accepted until the following production replays pass without a provider refetch caused by focus switching:

| Case | Required evidence |
|---|---|
| US supported listed residential | Existing offer/score/narrative, CTA, insurance and email behavior remain; capability/supported marker present |
| US supported off-market residential | Value/AVM provenance remains distinct; no offer or seller-motivation claim |
| CA supported residential | Existing buyer result remains; capability/supported marker present |
| CA verified land | Dedicated land context remains; no residential offer, rental, partner, or insurance module |
| Hard-excluded commercial/institutional | Residential buyer composition withheld; listing/regional facts only. May close with a recorded fixture if no curated live provider-supported subject exists |
| Mixed-use residential unit | Unit result remains supported and the containing-building scope notice is present. May close with a recorded fixture until a curated live unit is available |
| Provider failure/clean miss | P0 fallback copy and regional labeling remain; no false property-class claim |
| Mobile hierarchy | At 390 px: identity/primary result, one collapsed focus control, then any supplemental journey output; no overflow |

## Retention and next boundary

US Discover remains on its explicit legacy buyer composition because seeded listings do not have the assess-flow property record/capability envelope. This is a documented retention decision, not silent fallback behavior. Retirement requires a separate universal Discover-enrichment design with a provider-cost model.

P6B is Owner / Manager V1 selection. It must begin with a product decision about the smallest coherent promise and observed demand; P6A does not authorize implementing it by reusing buyer or rental-acquisition copy.
