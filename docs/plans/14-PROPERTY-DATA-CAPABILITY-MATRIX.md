# Property Data Capability Matrix

_Created 2026-08-11 from the live ingestion and mapper code. This is a source-capability audit, not a promise that a field is present for every address. P1 preserves evidence; P2 resolves subject scope; P3 decides classification and module capabilities._

## Legend and reading rules

- **A** — address/listing/provider-record evidence may be available.
- **R** — regional evidence only; never a property-level fact.
- **I** — the source exposes a useful internal field or constraint, but the normalized adapter does not yet retain it.
- **—** — the current path does not supply the capability.
- **Conditional** means both source coverage and the specific response must be checked. A provider endpoint being called is not evidence that its optional field was returned.
- `ownerOccupied=false` is occupancy evidence only. It is not proof of a rental, investor ownership, vacancy, or user intent, and remains outside visible personalization pending privacy review.
- Unit, listing, building, provider record, and parcel are not treated as interchangeable. The scope column describes the source record, not the user-selected assessment subject; P2 performs that resolution.

## Surface-level capability matrix

| Geo / ingestion surface | Source-record scope | Property type | Occupancy | Unit count | Land / building split | Address rent | Regional rent | Sales / listing history | Tax / assessment | Hazards | Important limits |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **US on-demand assessment** | Listing + provider record + parcel candidate; unresolved until P2 | **A** RentCast listing and `/properties` raw values | **A** RentCast `/properties`, conditional | — | **A** RentCast latest tax-assessment `land` / `improvements`, conditional | **A** RentCast long-term rent AVM, conditional | **R** HUD FMR + ACS county rent | **A** active-listing price history; property last sale + sale history | **A** RentCast tax assessment/tax bill; live county value where supported | **R** FEMA county scores only | Up to four separately cached/quota-guarded RentCast calls. Missing record, quota, or provider error degrades to regional context. No MLS remarks. Non-residential commercial analysis is unsupported. |
| **US Discover seed** | Active sale listing only | **A** RentCast `/listings/sale` raw value | — (`/properties` not queried) | — | — | — | **R** county panel where page loads it | **A** current listing and listing price history only | — | **R** county panel only | City sweep evidence must not inherit on-demand capabilities. Seed corpus has no property record, owner occupancy, address rent, or tax split by construction. |
| **US Discover enriched** | Seed listing + per-address provider record candidate | **A** listing plus `/properties`, conditional | **A** `/properties`, conditional | — | **A** RentCast tax split, conditional | — (`getUSPropertyLite` intentionally skips rent) | **R** HUD/ACS county context | **A** listing history + property sale history | **A** RentCast tax record / AVM fallback | **R** FEMA county scores | Default enrichment is top 3 listings/city and quota-gated. It cannot be used to describe the whole seeded corpus. |
| **US regional fallback** | County only | — | — | — | — | — | **R** HUD FMR + ACS | — | **R** ACS county median home value, modeled and non-property-specific | **R** FEMA | A successful Census geocode is not property classification. `property_record_not_found`, provider quota, and provider error remain explicit. |
| **Canada Zoocasa search listing** | Active listing | **A** raw `property_type` | — | — | — | — | **R** CMHC CMA where city is mapped | **A** current listing; search facts | Listing-advertised annual taxes, conditional | — | Search shape is sparse; source value is retained verbatim, not normalized into a class yet. |
| **Canada Zoocasa detail listing** | Active listing, sometimes explicit unit | **A** raw `type` + `propertySubType` | — | — | — | — | **R** CMHC CMA where mapped | **A** listing history + comparable sold-pool path | Listing-advertised taxes, conditional | — | Type/subtype can conflict or describe listing scope rather than parcel use. P2/P3 must keep those distinctions. |
| **BC assessment** | Assessment record / parcel or strata candidate | — | — | — | **A**, only when the adapter marks a complete supplied split | — | **R** CMHC for mapped Victoria/Vancouver-area cities | — | **A** total and assessment year | — | Older cache entries contain real splits; some later total-only rows use legacy zero sentinels. P1 now emits those components as unavailable rather than zero evidence. Unit ambiguity remains. |
| **AB assessment** | Municipal assessment record | **I** Calgary results are constrained to `assessment_class='RE'`; not retained as evidence | — | — | — | — | **R** CMHC for Calgary/Edmonton | — | **A** total only (Calgary, Edmonton, Lethbridge; plus cache) | — | Live adapters return total only. Coverage is city-scoped, not province-wide. Do not generalize Calgary's `RE` constraint to Edmonton/Lethbridge. |
| **ON assessment** | Cached/tax-derived assessment candidate | — | — | — | — | — | **R** CMHC for Toronto/Hamilton/Ottawa | — | **A** cached 2016 total or tax-reversed estimate | — | MPAC values are frozen at 2016 in this path. Tax reversal is inferred, not observed. Cache land/building values are documented total-only legacy fields. |
| **MB assessment** | Winnipeg parcel | **I** source contains mixed class components, but mapper retains only parcel total | — | — | — | — | **R** CMHC Winnipeg | — | **A** Winnipeg total only | — | Winnipeg only. `total_assessed_value` sums all classes; it must not be read as residential classification. |
| **Other CA provinces / cities** | Zoocasa listing when found | **A** Zoocasa type fields, conditional | — | — | — | — | — unless added to CMA mapping | **A** listing history, conditional | — beyond listing-advertised taxes | — | No live property-assessment adapter. Unsupported assessment fields stay unavailable. |

## Canadian regional rent coverage

CMHC Rental Market Survey turnover rent is a **CMA-level benchmark**, bedroom-matched where possible. The current city mapping covers:

| CMA | Listing cities currently mapped |
|---|---|
| Victoria | Victoria, Saanich, Langford |
| Vancouver | Vancouver, Surrey |
| Calgary | Calgary |
| Edmonton | Edmonton |
| Toronto | Toronto |
| Hamilton | Hamilton |
| Ottawa–Gatineau | Ottawa |
| Winnipeg | Winnipeg |

It supports a regional landlord benchmark, not expected rent for the entered address. No current Canadian ingestion path supplies an address-level rent AVM.

## US county-adapter inventory

The common `CountyAssessorResult` currently retains assessed value, optional market value, year built, lot size, assessment year, source, and assessment basis. It does **not** retain raw class/use codes or land/improvement dollar components. The inventory below records what is actually visible inside each adapter before that common return boundary.

| Adapter | Live request path | Values retained now | Class/use evidence seen internally | Safe next normalization | Do not infer |
|---|---|---|---|---|---|
| Maricopa, AZ | Yes | LPV assessed value, FCV market value, year built, lot size | None in current query | None without adding a verified source field | Residential use, occupancy, or unit count from a unique address hit |
| Miami-Dade, FL | Yes | assessed value, just value, year built, lot size | `CONDO_FLAG` is read during folio resolution but discarded | Preserve raw condo flag as a **scope hint** only | Condo flag does not prove the requested unit, residential use, or investment use |
| Travis, TX | No live request; batch/bulk only | assessed/appraised/market value, year built, lot size | Situs unit is used for matching; no use class retained | Preserve exact matched situs unit during P2 if sourced from the already-built bundle | Whole-building scope or residential use; the 4.9 GB export cannot be called from P2/live assessment |
| Cook, IL | Yes | assessed value; class-2 market value is derived; year built, lot size | Raw `class` is fetched and used internally | Preserve raw class. Normalize only verified `2xx → Cook class-2 residential`; leave all other codes raw/unknown pending a complete code table | All non-2xx as commercial, or a unit/building scope from PIN alone |
| King, WA | Yes | taxable total, appraised total, lot size | Raw land/improvement dollar columns are read, then collapsed to totals | Preserve tax/appraised land and improvement components with parcel provenance | Building form/use; multiple rows are ambiguity, not a type |
| NYC (5 boroughs) | Yes | taxable assessed total, market total, year built, land area | Current query does not retain tax/building class despite the source dataset describing tax classes | None until the query and adapter contract explicitly retain the raw code | Residential/commercial class from borough/address or valuation ratio |

Cross-adapter normalization is intentionally narrow. Cook class, Miami condo flag, Calgary's residential query constraint, and Winnipeg's mixed-class total are different concepts and must not be collapsed into one `propertyType` field.

## Evidence contract shipped in P1

`PropertyEvidenceSnapshot` is additive on `Listing` and returned at the top level of US assessment results. It records:

- schema version and ingestion surface;
- exact raw assessment input, normalized address, parsed unit, direct listing URL, and selected Google Place ID when supplied;
- property-type observations as separate provider values rather than one winner;
- occupancy evidence without owner identity, mailing address, or an investment-intent field;
- assessment total, land, and building evidence with source, record year, evidence kind, confidence, scope, ingestion date, and explicit unavailability reason.

Legacy `Listing` and `Assessment` numeric fields remain in place for backward compatibility. New intelligence work must read the evidence envelope when availability/provenance matters; a legacy zero is not proof that a component is zero.

## Product implications for sequencing

1. **Investor/landlord is the strongest first new journey after subject resolution and capability routing.** US on-demand has conditional address rent plus regional benchmarks; Canada has regional CMHC benchmarks but no address rent, so its initial yield view must be benchmark-labeled or unavailable.
2. **Discover cannot drive occupancy- or rent-personalized output from its seed tier.** Most stored listings lack those calls by construction, and top-N enrichment is not representative.
3. **Land/improvement analysis is narrower than the original concept suggested.** It is viable for verified BC splits and conditional RentCast tax splits; county adapters currently collapse useful King components, and AB/ON/MB do not supply the split to the normalized path.
4. **Commercial is still a data-expansion program.** Provider type strings can create an unsupported/fail-safe classification later, but the repo has no commercial income, lease, NOI, cap-rate, zoning, entitlement, or permit evidence.
5. **Insurance remains distribution/context, not underwriting.** FEMA data is county-level. Nothing in the current pipeline establishes property-level flood zone, replacement cost, roof/system condition, occupancy/use confirmation, claims, or coverage eligibility.

## Code audit anchors

- `src/lib/property-intelligence/evidence.ts` — P1 contract and mapper helpers
- `src/lib/zoocasa.ts` — search/detail raw type fields and listing mappers
- `src/lib/rentcast.ts` — normalized property, listing, assessment, occupancy, rent, and sale-history fields
- `src/lib/pipeline/us-discover.ts` — listing-only seed sweep
- `src/lib/pipeline/us-enrich.ts` — top-N record/AVM enrichment with rent deliberately skipped
- `src/app/api/assess/route.ts` — on-demand four-part RentCast bundle and county/regional fallback
- `src/lib/assessment/{bc,ab,on,mb}.ts` — Canadian assessment availability
- `src/lib/assessment/us-county/*.ts` — county adapter inventory
- `src/lib/db/regional-econ.ts` — HUD, ACS, FEMA, FHFA, CMHC, and StatCan regional evidence
