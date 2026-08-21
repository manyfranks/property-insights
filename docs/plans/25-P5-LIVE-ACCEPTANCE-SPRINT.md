# 25 — P5 Live Acceptance Sprint

_Created 2026-08-21 after Sprint 25 security closure and PR 10 merge. This is
the executable production-acceptance record for the P4/P5 journey surface._

**Status: `[~]` production matrix remains open.** The 2026-08-21 run against
deployment `dpl_66UGWHJpbvgdZadk3bDtP6Bkx1Zp` produced four passes (CA-1,
CA-2, CA-3, US-1), three product failures with local corrections awaiting
deployment/replay (US-2, US-3, US-4), and one unresolved provider-coverage gap
(CA-4). None of those non-pass results is counted as accepted.

## Outcome and boundary

Prove that the implemented rental journey behaves honestly across the live
Canadian and US evidence paths, at desktop and narrow/mobile widths, without
scope substitution, unsupported residential modules, or an assessment refetch
when the user changes focus or edits a scenario.

Closing this sprint closes the **curated P4/P5 live-matrix gate**. It does not
close all of P5: private scenario persistence and the KPI/success readout remain
open until product demand justifies collecting more private assumptions and the
telemetry sample is large enough. The matrix gate, rather than full P5 phase
completion, is the documented prerequisite for synthetic-only Insurance A2.

## Preconditions

- Record the production deployment commit and verify it contains PR 10/Sprint
  25. A preview deployment is useful rehearsal but cannot close the gate.
- Use one signed-in test account. Start each case in a fresh browser tab and do
  not reuse an assessment result from another subject.
- Confirm enough RentCast capacity exists to run the four US cases. A
  quota-blocked or provider-error result is not evidence for listed,
  off-market, or clean provider-miss behavior.
- Select public test listings/properties only. Do not use a tester's home,
  unpublished address, owner record, or tenant information.
- Run the contract checks before live testing:

  ```bash
  npx tsx scripts/test-property-intelligence-p2.ts
  npx tsx scripts/test-property-intelligence-p4.ts
  npx tsx scripts/test-property-intelligence-p4b.ts
  npx tsx scripts/test-property-intelligence-p5.ts
  npx tsx scripts/test-property-intelligence-ca-exclusions.ts
  npx tsx scripts/test-property-intelligence-land-containment.tsx
  npx tsx scripts/test-property-intelligence-render.tsx
  npx tsx scripts/test-affiliate-cta-presentation.tsx
  ```

These fixtures are prerequisite contract evidence, not a substitute for the
live matrix.

## Required matrix

Use a different, deliberately selected subject for each row. An address cannot
stand in for two branches merely because the rendered result is ambiguous.

| ID | Required live subject | Expected branch and proof |
|---|---|---|
| CA-1 | Residential listing with mapped CMHC context | Rental view is `limited`; CMHC remains a regional benchmark and never seeds the property rent. User-entered rent and all scenario outputs are labeled assumptions. |
| CA-2 | Residential listing in a city without mapped CMHC context | User-rent scenario remains usable; the UI states that no benchmark is mapped and does not invent one. |
| CA-3 | Verified land/parcel listing | Residential offer narrative, rental calculator, insurance prefill/action, and incompatible partner CTAs are withheld. Land/listing-price context may remain. |
| CA-4 | Verified commercial or institutional listing/address, if the live provider can resolve one | Same residential exclusions as CA-3. If the current provider cannot produce this class, record it as a coverage gap, not a pass; retain automated fixture evidence and leave this row open. |
| US-1 | Active residential listing with address-level RentCast rent | Result is `listed`; asking price and modeled address rent retain separate provenance. The editable scenario changes assumptions only. Any eligible investor CTA is intent-matched and its FTC disclosure remains adjacent. |
| US-2 | Off-market residential property with verified identity, AVM, and address rent | Result is `off_market`; AVM and rent provenance remain distinct; no active-listing claim or offer appears. |
| US-3 | Completed property/listing lookup that legitimately falls back to county/regional context | Result is `regional_fallback`; county/regional values are labeled non-property-specific and no operating calculator or property-level rental claim appears. A quota-blocked lookup cannot satisfy this row. |
| US-4 | Multi-unit address with a deliberate unit/building evidence mismatch | Scope is clarified or the rental/value combination is withheld. No unit rent is combined with a building value, and no building evidence is presented as unit evidence. |

CA-3 is mandatory. CA-4 remains mandatory for a full commercial/institutional
claim; provider non-coverage is a recorded blocker rather than permission to
infer the class. Do not broaden this sprint into a new provider integration.

**Proposed policy decision — not yet approved:** add `OUT_OF_COVERAGE` as a
fourth evidence verdict for CA-4 when a dated provider-corpus review finds no
defensible live subject. It would record the boundary without marking the row
`PASS`, authorizing commercial output, or closing P3/P5's commercial-analysis
gate. If approved, the current residential/land matrix could close after the
other seven rows pass; until then, CA-4 and the overall matrix remain open.

## Selected acceptance cohort

Candidate discovery and the first production run on 2026-08-21 used the
following public subjects. A local correction is not acceptance evidence until
its exact commit is deployed and the affected row is rerun.

| ID | Selected subject | 2026-08-21 production verdict / next action |
|---|---|---|
| CA-1 | `/property/2296-w-32nd-ave` (Vancouver, BC) | **PASS.** Fresh mapped-CMHC assessment kept the benchmark regional, the user scenario local, and the desktop/mobile hierarchy intact. |
| CA-2 | `/property/2820-cosgrove-cres` (Nanaimo, BC) | **PASS.** Unmapped-CMHC flow remained usable without inventing a benchmark; corrected intent copy, link treatment, insurance goal mapping, and responsive composition passed. |
| CA-3 | `/property/1827-main-st` (Coalmont, BC) | **PASS.** Verified land/parcel result withheld residential rental, offer, insurance, and partner actions at both viewports while retaining scoped land context. |
| CA-4 | _coverage gap — no defensible subject found_ | **NOT PASS.** The read-only scan of 2,325 Canadian records found no persisted commercial or institutional classification. Keep the fixtures and commercial-analysis gate open pending the proposed `OUT_OF_COVERAGE` decision. |
| US-1 | `/property/5507-burgundy-dr` (Austin, TX) | **PASS.** Completed listing/property lookups produced the listed branch; asking price, modeled address rent, regional evidence, scenario assumptions, investor CTA, and adjacent disclosure remained distinct. |
| US-2 | 112 Aldrich Rd (Peru, VT) | **FAIL on current production.** The off-market branch described AVM-derived change as seller equity/leverage. Local pipeline and presentation corrections recast it as recorded-sale-to-modeled-value evidence; deploy and rerun. |
| US-3 | Washington Monument (Washington, DC) | **FAIL on current production.** The clean identity-miss fallback correctly withheld property values but still rendered property-oriented partner actions. A local containment correction withholds those actions; deploy and rerun. |
| US-4 | 1716 Boylston Ave (Seattle, WA) | **FAIL on current production.** Unit/building ambiguity was contained, but the generic capability gate replaced the safe unresolved-subject identity and regional context. A local correction preserves the contained unresolved result without recombining evidence; deploy and rerun. |

### Production request and telemetry evidence

- Each fresh assessment produced exactly one `POST /api/assess`. Subsequent
  focus switches produced only owner-scoped `PATCH /api/assessment-state`
  requests; scenario edits produced no POST or assessment/provider refetch.
- US-1, US-2, US-3, and the warmed US-4 run each logged `cacheHits=4`,
  `liveCalls=0`, `quotaExhausted=false`, with both `propertyLookup` and
  `listingLookup` completed. The resulting branches were `listed`,
  `off_market`, `property_identity_not_found`/`regional_fallback`, and
  `off_market` with contained scope mismatch, respectively.
- Canada still has no exact server-side initial provider-call count. Each CA
  run had one browser assessment POST and zero action refetches; no stronger
  internal-call claim is made.
- The 30-day consented report recorded clarification shown for building `2`
  and unit `1`, with selections unit `1` and unknown `2`. Rental result views
  were listing limited `4`, supported `4`, unavailable `4`; unit unavailable
  `1`; unknown limited `2`, unavailable `2`; and parcel supported `1`
  (possibly stale). The switch sample included buy-home/listing/supported `3`.
  This sample proves telemetry is flowing but remains too small for KPI closure.

## Evidence record

Create one row per matrix ID in the closure PR or linked restricted test record.
Every field below is required; use `n/a` only with a reason.

| Field | Required value |
|---|---|
| Case ID | Matrix ID above |
| Run identity | UTC timestamp, tester initials, production deployment commit |
| Subject locator | Public `/property/[slug]` URL where available; otherwise keep the full `/assess` URL in the restricted test record and use a redacted case label in the repository |
| Input provenance | Public Zoocasa/RentCast/Discover/Zillow test-listing reference used to select the case; never owner or tenant data |
| Country/geo | Country, province/state, and city/county needed to identify the adapter/benchmark branch |
| Assessment path | `listed`, `off_market`, `regional_fallback`, or Canadian listing path; include provider lookup outcome when shown |
| Resolved subject | `scope`, `selectedBy`, `resolutionConfidence`, `requiresClarification`, and confirmed unit/listing/building/parcel choice without recording a unit identifier |
| Classification evidence | Relevant parcel/listing/unit class, confidence, and source; record `unknown` rather than interpreting it |
| Capability result | Rental/gross-yield/offer/insurance availability plus exact capability reason enum(s) |
| Evidence sources | Address-level rent/value source, regional benchmark source, observed/modeled/user-supplied kind, and visible freshness/year |
| Expected modules | Modules and partner actions that must render |
| Expected exclusions | Modules, claims, and partner actions that must be withheld |
| Provider evidence | US initial `cacheHits`, `liveCalls`, `quotaExhausted`, `propertyLookup`, `listingLookup`, result variant, and `propertyDataUnavailableReason` where returned, using the correlated `[assess] rentcast done` log and assessment response; CA provider path/outcome from the correlated assessment log |
| No-refetch evidence | `/api/assess` request count before actions and after all actions; allowed `/api/assessment-state` PATCH count; unexpected network requests |
| Interaction outputs | Initial gross result, completed seven-expense NOI/cap-rate result, and optional financing result where the calculator is allowed; otherwise `withheld as expected` |
| Responsive result | Desktop viewport/result, narrow viewport/result, horizontal overflow, focus placement, duplicate identity, and console/page errors |
| Privacy result | No address/unit/owner/occupancy/provider payload in journey telemetry; no claim that assumptions are saved |
| Artifacts | Screenshot IDs, redacted server-log excerpt, and browser-network export or screen recording location |
| Verdict | `PASS`, `FAIL`, or `BLOCKED`, with defect/link and rerun timestamp when applicable |

Do not put a raw address query string, assessment ID, unit identifier, user ID,
email, owner/occupancy value, full server log, or browser HAR containing cookies
in a public repository document. Screenshots must omit browser/account chrome and
unrelated personal data.

## Provider-call and no-refetch measurement

The initial assessment is allowed to fetch providers. View switching and
scenario editing are not.

1. Open browser developer tools before starting. Enable **Preserve log**, clear
   the Network panel, and filter for
   `api/assess|api/assessment-state|api/track`.
2. Submit the subject once. Record exactly one completed `POST /api/assess`.
   Correlate its UTC time with the server assessment log. For US cases, copy the
   redacted `cacheHits`, `liveCalls`, `quotaExhausted`, `propertyLookup`,
   `listingLookup`, and address-resolution values. Record the response's result
   variant and `propertyDataUnavailableReason`, where present, to distinguish a
   completed miss from quota/error fallback. The browser request count alone
   does not prove the number of internal provider calls.
3. After the result settles, note the `/api/assess` count. Change focus away
   from Rental and back, expand the operating scenario, edit price/rent where
   available, complete all seven operating assumptions, enable financing, and
   edit all three financing assumptions.
4. Note the request counts again. The delta for `POST /api/assess` must be
   **zero**. An authenticated focus switch may issue an owner-scoped
   `PATCH /api/assessment-state`; scenario edits currently issue no persistence
   request. Neither action may navigate to or reload a property/assessment
   fetch.
5. For a Canadian property-result redirect, count the original assessment POST,
   not normal Next.js document/RSC reads. Record unexpected requests separately.

A non-zero `/api/assess` delta is a failure even when provider cache hits make
it free. A quota-counter snapshot is useful corroboration but is not the primary
method: concurrent production traffic can change it, and cache hits can mask a
regression. If server logs cannot be correlated, mark provider-call evidence
`BLOCKED`; do not report an inferred internal call count.

### Current observability limits

- Sprint 26 logs the US bundle's existing `propertyLookup` and `listingLookup`
  outcomes alongside aggregate cache/live-call counts. Combined with the
  response's result variant and `propertyDataUnavailableReason`, this supports
  an honest clean-miss versus quota/error record without exposing property data.
- The Canadian path has no uniform aggregate provider-call counter. The browser
  can prove that interactions do not re-enter `/api/assess`, but it cannot count
  the initial server-side Zoocasa/detail/sold-pool calls.

The Canadian limit does not prevent a zero-refetch verdict. It does prevent an
honest claim of exact initial per-provider calls for every geo. If exact initial
Canadian call counts remain a closure requirement, add privacy-safe server
observability before signing the matrix; never infer a count from browser
traffic.

## Desktop and narrow/mobile protocol

Run every row at both `1280 x 900` (or wider) and `390 x 844`. Reuse the already
loaded result by resizing or device emulation so the viewport check itself does
not submit another assessment.

At each width verify:

- one property identity/address heading, with no duplicated nested identity;
- primary property value/offer context precedes the collapsed **Assessment
  focus** control, which precedes the journey-specific module;
- **Optional operating scenario** is collapsed initially and visually
  supplemental, not the primary action;
- evidence source/status badges and disclosures remain adjacent to their values;
- inputs, results, disclosures, and focus choices do not clip, overlap, or cause
  horizontal page overflow; controls remain operable by keyboard and touch;
- unavailable modules do not leave orphaned headings, empty cards, or partner
  actions; and
- the browser console has no application exception and every assessment/state
  request has the expected status. Extension warnings and blocked analytics
  must be identified separately and cannot conceal an application error.

## Pass/fail rules

A row passes only when all required evidence fields are complete and both
viewports pass. The following are zero-tolerance failures:

- a unit, listing, building, or parcel value is applied to another subject;
- classification changes the user's selected goal automatically;
- a regional benchmark is labeled or used as address-level expected rent;
- a property fact is sourced from a user-editable scenario value;
- a calculator, offer narrative, insurance action, or partner CTA renders while
  its capability is unavailable or the property class is excluded;
- an investor CTA is routed from classification/occupancy rather than the
  explicit journey, or its FTC disclosure is not adjacent;
- county fallback is presented as a completed property valuation/rent lookup;
- changing focus or assumptions creates another `/api/assess` request;
- the UI says assumptions are saved before Slice B exists; or
- an application exception, broken request, duplicate identity, clipped
  disclosure, or horizontal overflow prevents interpreting the result.

Expected `limited`/`unavailable` states, an absent CMHC mapping, and an honest
provider miss are not failures when they match the row's expected branch. A
quota block, provider outage, unverified subject, or missing log correlation is
`BLOCKED`, not `PASS`, unless that condition is the branch deliberately under
test.

## Privacy and telemetry constraints

- Do not test occupancy-driven suggestions or routing. `ownerOccupied` remains
  counsel-gated and must not affect visible content or CTAs.
- Journey analytics may contain only explicit goal, country, on-demand surface,
  coarse subject scope, selection type, and capability status. They must not
  contain address, slug, unit, place ID, owner/occupancy, scenario inputs,
  property values, or provider evidence. Inspect the `POST /api/track` request
  payload during the run and record a redacted field-name check; do not export
  cookies or the full browser archive.
- Scenario fields remain component-local. Do not claim restore/save behavior and
  do not use private persistence as a workaround during this sprint.
- The aggregate telemetry check is read-only and contains no subject locator:

  ```bash
  npx tsx scripts/report-property-journeys.ts 30
  ```

The report confirms the consented event path is alive; its current small sample
does not close the separate KPI gate.

## Closure sequence

1. Record the deployment commit and pre-run fixture results.
2. Run CA-1 through CA-4, desktop and narrow/mobile. Fix and rerun failures
   before spending US provider capacity.
3. Run US-1 through US-4 once each, capturing the correlated provider log and
   no-refetch network evidence.
4. Rerun the seven contract checks and TypeScript after any correction. Deploy
   the exact corrected commit, then rerun every affected live row; local or
   preview evidence cannot replace production evidence.
5. Run the read-only 30-day journey report and record it as a baseline, not a
   launch-success claim.
6. Close this sprint only when every required row is `PASS`. Update the P4
   curated-acceptance item and the live-acceptance portions of P5 in the
   phasemap, attach the evidence record, and leave P5 persistence/KPI items open.
7. Once the live matrix is closed, Insurance A2 may begin under its existing
   synthetic-only boundary. P5 persistence and P6 remain deferred pending the
   separate usage/privacy decision.

## Closure record

- Production deployment: `dpl_66UGWHJpbvgdZadk3bDtP6Bkx1Zp` (tested
  2026-08-21); local US-2/US-3/US-4 corrections are not included and require a
  new deployment plus affected-row replay.
- Evidence record: _partial production record above; no assessment IDs, raw
  address-query URLs, user identifiers, or private payloads retained._
- Pre/post fixture results: _pre-deployment verification passed on 2026-08-21:
  153/153 property-intelligence assertions, 139/139 US-advantage assertions,
  and the affiliate-presentation regression, all with zero provider calls;
  TypeScript, targeted ESLint, insurance guards, journey-matrix check, the
  production build, and Playwright (14 passed, 1 intentionally skipped) passed._
- CA rows: _CA-1, CA-2, and CA-3 PASS on production. CA-4 remains a provider/data
  coverage gap and is not PASS; the `OUT_OF_COVERAGE` policy proposal remains
  pending._
- US rows: _US-1 PASS. US-2, US-3, and US-4 FAIL on the tested production
  deployment; local corrections await deployment and row-specific replay._
- No-refetch result: _PASS for the interactions exercised: one initial
  `/api/assess` POST per fresh assessment, zero additional assessment POSTs for
  focus switching, and zero POST/refetch for scenario edits._
- 30-day telemetry readout: _clarification shown building 2 / unit 1; selected
  unit 1 / unknown 2; rental listing views limited 4 / supported 4 /
  unavailable 4, unit unavailable 1, unknown limited 2 / unavailable 2, parcel
  supported 1 (possibly stale); buy-home/listing/supported switches 3. Sample is
  too small for KPI closure._
- Final decision/date: _OPEN on 2026-08-21. Four rows pass, three require
  corrected-production replay, and CA-4 requires an explicit coverage-policy
  decision. The matrix gate is not closed._
