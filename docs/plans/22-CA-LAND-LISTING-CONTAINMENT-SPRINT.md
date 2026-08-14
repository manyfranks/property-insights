# 22 — Canadian Listing-Only Land Containment Sprint

_Created 2026-08-14 after production acceptance exposed a listing-scope land
gap. This sprint blocks broader P5 live testing._

## Outcome

A resolved land listing must not enter residential rental, residential offer,
insurance-prefill, or residential partner paths merely because the available
type evidence is listing-scoped rather than assessor/provider-record-scoped.
The property detail page keeps its useful verified facts, makes the existing
result primary, and offers goal switching only as a supplemental
per-assessment control.

This sprint makes no new provider calls, does not infer zoning entitlement,
does not add a permanent persona profile, and does not create commercial or
land underwriting.

## Production evidence

| Listing | Verified evidence | Current capability error | Current visible issue |
|---|---|---|---|
| `2496-rosstown-rd` | Zoocasa `Land`; deterministic `listingScope: parcel`; BC 2026 total/land `$410,000`, improvement `$0` | Rental is `missing_field`; residential offer remains available instead of excluded | Four equally prominent journey choices precede the offer; rental remains selectable; mortgage/pre-approval/home-insurance CTAs render |
| `1827-main-st` | Zoocasa `Land`; deterministic `listingScope: parcel`; industrial land in listing text; no assessment split | Rental is `missing_field`; residential offer remains available instead of excluded | Same journey/CTA mismatch; language-only `$96,000` offer and narrative infer seller identity, inventory pressure, and need to sell without supporting evidence |

The reduced fact/comparable surfaces are otherwise expected: neither record
has residential home facts or comparable-sale evidence, and `1827-main-st`
has no cached government assessment. Missing evidence should produce a smaller
report, not invented replacement claims.

## Root cause

`classifyListingScope()` correctly converts high-confidence listing `Land`
evidence to deterministic `listingScope: parcel`. Scope discipline also
correctly prevents listing evidence from being rewritten as assessor-backed
`parcelUse`. However, `residentialExclusion()` selects `parcelUse` for a parcel
subject and never considers the deterministic listing-subject decision. It
therefore sees `unknown`, allowing `offerAnalysis` and leaving rent/insurance
with generic missing-field reasons.

The page-level `PropertyJourneyHandoff` and buyer `PartnerCta` are also rendered
without capability input, so even a correct exclusion cannot currently alter
their visibility or placement.

## Build order

### 1. Lock the two real evidence shapes

- Add recorded, minimized fixtures for both production records.
- Preserve evidence scopes: Zoocasa type remains `listing`; BC assessment
  values remain `parcel`; missing assessment remains explicit.
- Prove the fixtures make zero provider calls.

### 2. Close the capability gap

- Treat deterministic `listingScope: parcel` as sufficient to exclude
  residential address-rent, gross-yield, residential-offer, and
  insurance-prefill modules for the resolved listing subject.
- Do not promote listing evidence into `parcelUse`; the exclusion should cite
  listing-scope evidence and retain its provenance.
- Update Canadian journey copy so the unavailable reason names a land listing
  when that is the verified subject evidence.
- Preserve `landImprovementAnalysis` when a valid parcel split exists.

### 3. Make focus switching supplemental

- Move `PropertyJourneyHandoff` below the offer/price-context hero.
- Replace the always-expanded four-card block with a compact collapsed control,
  e.g. **Change assessment focus** / **View another perspective**.
- On expansion, explain that the choice applies to this assessment only. Do
  not describe the user as a permanent persona and do not write a profile
  default.
- Show unsupported goals as unavailable with a short reason or omit them when
  the reason is already obvious; never style Rental as the primary action.
- Keep the current result and selected focus visible without a refetch.

### 4. Gate page-level partner actions

- Residential mortgage, pre-approval, landlord/rental, and home-insurance CTAs
  require a compatible residential capability.
- Land/non-residential pages may retain neutral source links. Do not substitute
  an unapproved land-finance or commercial partner.
- Apply the gate to the base property page as well as journey-selected content.

### 5. Contain land offer and narrative claims

- A land listing with observed assessment evidence may show **Land price
  context**: list price, assessed total/land value, year, and ratio. It must not
  call the residential model's output a recommended home offer.
- A land listing without assessment or comparable evidence shows list price
  and verified listing facts only; suppress the language-only offer number.
- Remove seller identity, inventory-pressure, motivation, entitlement, and
  likely-rezoning claims unless a displayed evidence item directly supports
  them. Listing marketing language may be quoted or summarized as seller
  claims, never converted to verified facts.
- Do not display zero bedrooms/bathrooms as residential facts for land; use a
  land-relevant fact layout only where source fields exist.

## Acceptance matrix — run after implementation

| Case | Required result |
|---|---|
| `2496-rosstown-rd` — residential-zoned vacant lot with BC split | Land listing recognized; land price context retained; rental and residential CTAs withheld; supplemental focus control below hero |
| `1827-main-st` — industrial land, no assessment/comps | No rental screen, residential CTAs, language-only offer, or inferred seller motivation; verified listing/zoning claims remain clearly attributed |
| Canadian residential, no CMHC (`2820-cosgrove-cres`) | Existing user-entered rent scenario remains available; no regression |
| Canadian residential with CMHC | Scenario remains available; CMHC remains regional and never becomes expected address rent |
| Mixed-use building, explicit residential unit | Unit journey remains possible only with unit-matched evidence; containing use does not auto-switch the goal |
| Whole mixed-use/commercial/institutional subject | Residential rent, offer, insurance, and partner modules unavailable with class-appropriate copy |
| Legacy Discover record without capabilities | Existing report remains neutral; no new property-use claim or residential CTA is introduced from missing evidence |
| Supported US residential rental | Address rent, HUD benchmark, gross screen, and investor CTA remain unchanged |

## Exit gate

- [x] Both production records pass recorded capability and render fixtures
  (`10/10`, zero provider calls).
- [x] No property-level residential module or CTA renders for verified land.
- [x] No land listing is presented with an unsupported recommended offer or
  seller-motivation narrative.
- [x] The base-property handoff is visually supplemental below the primary
  hero and remains assessment-level state.
- [x] Residential CA and US regression fixtures pass.
- [x] TypeScript, touched-file lint, pipeline guard (`16/16`), and production
  build pass.
- [ ] Curated production acceptance passes before broader live testing resumes.

## 2026-08-14 implementation evidence

- All property-intelligence suites pass: 130 assertions across P0-P5, CA
  exclusions, render containment, and the new recorded land fixtures; all
  fixture suites report zero provider calls where instrumented.
- Local browser replay against the real stored records:
  - `2496-rosstown-rd`: assessment-backed **Land price context** renders;
    residential CTAs, residential facts, recommended offer, motivation, and
    rental link are absent. Only Explore remains linked in the expanded focus
    control.
  - `1827-main-st`: list price and listing facts render; no assessment value,
    computed offer, residential CTA, or motivation output is substituted.
    Zoning/rezoning text is labeled seller-provided and not independently
    verified.
  - `2820-cosgrove-cres`: recommended offer, residential facts/CTAs, and the
    Canadian rental handoff remain available, confirming the residential
    control did not inherit the land exclusion.
- The only local console error is the known Clerk production-domain rejection
  on `localhost`; it does not alter the server-rendered page evidence above.

## Post-deploy correction

Production replay found that the result-side `AssessmentJourneyPanel` still
wrapped the entire report and rendered its own expanded focus selector before
the address and offer. Sprint 22 correctly moved the base-property handoff,
but its exit evidence overstated the result-view change. Sprint 23 owns and
corrects that separate composition defect; this note preserves the distinction
instead of rewriting the original acceptance record.
