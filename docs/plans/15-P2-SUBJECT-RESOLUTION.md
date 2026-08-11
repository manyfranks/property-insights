# Property Intelligence P2 — Assessment-Subject Resolution

_Created 2026-08-11. Exit artifact for P2 in `13-PROPERTY-INTELLIGENCE-PHASEMAP.md`._

## Outcome

Every successful on-demand US and Canadian assessment now carries an additive `assessmentSubject` envelope. The resolver distinguishes the entity the user requested from already-fetched listing, property-record, building, and parcel evidence before P3 attempts classification.

P2 is shadow-only. It does not alter the buyer journey, visible modules, offer model, classification, CTAs, or goal state.

## Contract

The common envelope is implemented in `src/lib/property-intelligence/subject.ts`:

- `scope`: `unit | building | parcel | listing | unknown`
- `canonicalAddress` and normalized `unit`
- `selectedBy` and `resolutionConfidence`
- optional containing-building and containing-parcel candidate IDs
- `requiresClarification` plus a machine-readable reason
- the full candidate list and any conflicts

Candidates remain separate. A unit listing, containing-building property record, and parcel assessment can coexist without one record overwriting another.

## Deterministic precedence

1. A direct listing URL explicitly selects the matched listing.
2. An explicit unit in user input wins when no same-unit listing confirms it.
3. A listing with the same explicit unit is selected as the unit-specific listing.
4. An exact listing match wins over contextual property/parcel records.
5. Without a listing, an already-fetched provider record can resolve a unit, building, or parcel candidate.
6. A property-specific assessment can supply a parcel candidate; a regional median or AVM cannot.
7. Missing evidence remains `unknown`; it does not become residential, commercial, or government.

Conflicting units or addresses are emitted and require clarification. A multi-unit/building-shaped record without a unit requires clarification only when no listing already establishes the subject. Straightforward detached listings receive no new question.

## No-new-call proof

The resolver accepts plain evidence objects and imports no provider client. `scripts/test-property-intelligence-p2.ts` replaces `global.fetch` with a throwing counter for the entire fixture run.

Result: **23/23 fixtures passed; provider calls: 0**.

The live ingestion call graph is unchanged: subject resolution runs only after the existing RentCast/Zoocasa, geocoder, and assessment work has completed.

## Edge cases locked by fixtures

| Case | P2 result |
|---|---|
| Detached active listing | `listing`, high confidence, no clarification |
| Explicit unit + matching listing | unit-specific `listing`, high confidence |
| Multi-unit address without unit/listing | `building`, clarification required |
| Residential unit listing in mixed-use building | listing remains the subject; building retained as containing entity |
| Whole-building active listing | `listing` with no invented unit |
| Conflicting input/listing units | explicit input retained; conflict + clarification |
| Provider address differs from input | provider candidate retained; conflict + clarification |
| Direct Zoocasa URL | explicit listing selection |
| `#402`, `Unit 402`, `Suite 402`, `Apt. 402`, `402-123 Main St` | normalized to unit `402` |
| Queens `51-20 69th Pl` | civic number preserved; never parsed as unit `51` |
| Clean provider miss | `unknown`, neutral degradation |

## API integration

- US listed, off-market, and regional-fallback success responses include `assessmentSubject`.
- US listed responses also attach it to the returned `listing`.
- The US result root exposes nonvisual `data-assessment-subject-*` attributes for production regression checks; they do not change rendered content or routing.
- Canadian on-demand responses include it and persist it on the enriched listing before the KV write.
- Existing response fields remain unchanged, so current consumers ignore the additive envelope safely.

Representative Queens result after canonical provider resolution:

```json
{
  "scope": "listing",
  "canonicalAddress": "5120 69th Pl, Woodside, NY 11377",
  "unit": null,
  "selectedBy": "listing_match",
  "resolutionConfidence": "high",
  "requiresClarification": false
}
```

## Validation record

| Check | Result |
|---|---|
| P2 resolver fixtures | **PASS — 23/23; zero provider calls** |
| P1 evidence fixtures | **PASS — 12/12** |
| P0 fallback fixtures | **PASS — 14/14** |
| Pipeline guard | **PASS — 16/16** |
| RentCast canonical-address fixture | **PASS — 7/7** |
| County-live regression | **PASS — 31/31** |
| Canadian unit/adapters smoke | **PASS — 13/13** |
| Existing property-page integration | **PASS — 20/20; RentCast quota 50 → 50** |
| TypeScript | **PASS** |
| Touched-file lint | **PASS** |
| Full lint baseline | **UNCHANGED — 26 errors, 20 warnings in untouched files** |
| Production build | **PASS** |
| Production response | **PASS — `b683df8`; Queens fixture resolved `listing` / `listing_match` / high confidence / no clarification** |

The same production run retained the pre-P2 buyer result: active $999,000 listing, $969,000 recommended offer, live county market-value label, and no county-median fallback.

## Boundary for P3

P3 may consume the resolved scope to produce confidence-tagged classification and module capabilities in shadow mode. It may not change a user goal, auto-switch a journey, personalize from occupancy evidence, or treat containing-building use as the unit's use.
