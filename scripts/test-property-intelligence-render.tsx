/**
 * Render-shaped smoke test for the CA rental-journey exclusion fix.
 *
 * Static-renders the actual client components (no interactivity — just the
 * initial markup renderToStaticMarkup produces) to prove, at the DOM-shape
 * level rather than just the pure-status level, that:
 *   - An "unavailable" status from deriveCaRentalJourneyStatus makes
 *     AssessmentJourneyPanel render the withheld-report notice INSTEAD of
 *     CanadaRentalScreen — no rent input, no yield figures, no PartnerCta.
 *   - A "limited" residential-without-CMHC status still renders
 *     CanadaRentalScreen with its "No CMHC benchmark is mapped" copy.
 *
 * Run: node --import tsx scripts/test-property-intelligence-render.tsx
 */

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AssessmentJourneyFocus, AssessmentJourneyPanel } from "../src/components/assessment-journey";
import CanadaRentalScreen from "../src/components/canada-rental-screen";
import RentalOperatingScenario from "../src/components/rental-operating-scenario";
import UsAssessmentResult, {
  EquityTenureCard,
  RentalScreen as UsRentalScreen,
  usRegionalGeographyLabel,
  type UsFallbackResult,
  type UsOffMarketResult,
} from "../src/components/us-assessment-result";
import { deriveCaRentalJourneyStatus } from "../src/lib/property-intelligence/journey";
import { classifyProperty } from "../src/lib/property-intelligence/classification";
import { evaluatePropertyCapabilities } from "../src/lib/property-intelligence/capabilities";
import { resolveAssessmentSubject, type ResolveAssessmentSubjectInput } from "../src/lib/property-intelligence/subject";
import {
  availableEvidence,
  createPropertyEvidenceSnapshot,
  type EvidenceScope,
  type EvidenceSource,
} from "../src/lib/property-intelligence/evidence";
import type { EquityTenureSignal } from "../src/lib/pipeline/us-advantage";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function subject(overrides: Partial<ResolveAssessmentSubjectInput> = {}) {
  return resolveAssessmentSubject({
    rawInput: "10 Oak St, Victoria, BC, Canada",
    normalizedAddress: "10 Oak St, Victoria, BC",
    ...overrides,
  });
}

function evidence(types: Array<{ value: string; scope: EvidenceScope; source?: EvidenceSource }>) {
  const collectedAt = "2026-08-13T12:00:00.000Z";
  const base = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput: "10 Oak St, Victoria, BC, Canada",
    normalizedAddress: "10 Oak St, Victoria, BC",
    collectedAt,
  });
  const meta = (source: EvidenceSource, scope: EvidenceScope) => ({
    source,
    scope,
    ingestedAt: collectedAt,
    kind: "observed" as const,
    confidence: "high" as const,
  });
  return {
    ...base,
    propertyTypes: types.map((item) =>
      availableEvidence(item.value, meta(item.source ?? (item.scope === "listing" ? "zoocasa_detail" : "rentcast_property"), item.scope))
    ),
  };
}

console.log("\nRender-shaped smoke test for the CA rental-journey exclusion fix\n");

test("excluded class (vacant land): AssessmentJourneyPanel withholds the calculator, yield figures, and PartnerCta", () => {
  const resolved = subject({ propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Vacant Land" } });
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([{ value: "Vacant Land", scope: "provider_record" }]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: { addressRentEstimate: { available: true, scope: "parcel" } },
  });
  const status = deriveCaRentalJourneyStatus(capabilities, classification, { hasCmhcRent: false, hasRegionalContext: false });
  assert.equal(status.availability, "unavailable");

  const markup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="rental_investment"
      country="CA"
      subjectScope={resolved.scope}
      capabilities={capabilities}
      gateUnsupported
      goalStatusOverrides={{ rental_investment: status }}
      goalContent={{
        rental_investment: (
          <CanadaRentalScreen
            city="Victoria"
            province="BC"
            propertySlug="10-oak-st"
            listPrice={500_000}
            beds="0"
            baths="0"
            sqft=""
            regionalRent={null}
          />
        ),
      }}
    />
  );

  assert.doesNotMatch(markup, /canada-rent-scenario/, "rent-scenario input must not render for an excluded class");
  assert.doesNotMatch(markup, /Scenario gross yield/, "yield figures must not render for an excluded class");
  assert.doesNotMatch(markup, /Continue your rental analysis/, "PartnerCta heading (investor CTA) must not render for an excluded class");
  assert.match(markup, /Residential rental analysis/, "withheld-report notice must explain the exclusion");
  assert.match(markup, /vacant land/, "withheld-report notice must name the excluded class");
  assert.match(markup, /Report withheld for this focus/, "the amber withheld-report section must render in place of the calculator");
  assert.equal((markup.match(/<h1/g) ?? []).length, 0, "CA land keeps the generic withheld panel");
});

test("US excluded class: HUD regional context cannot reopen the rental screen or investor CTA", () => {
  const resolved = subject({
    rawInput: "100 Commerce St, Austin, TX",
    normalizedAddress: "100 Commerce St, Austin, TX",
    listing: { address: "100 Commerce St, Austin, TX", source: "rentcast_listing" },
    propertyRecord: { address: "100 Commerce St, Austin, TX", propertyType: "Retail Commercial" },
  });
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([{ value: "Retail Commercial", scope: "provider_record" }]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "building" },
      addressRentEstimate: { available: true, scope: "building" },
      regionalRentBenchmark: { available: true, scope: "regional", source: "hud_fmr" },
    },
  });

  const markup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="rental_investment"
      country="US"
      subjectScope={resolved.scope}
      capabilities={capabilities}
      gateUnsupported
    >
      <div data-us-rental-screen="true">HUD rental screen</div>
      <div>Continue your rental analysis</div>
    </AssessmentJourneyPanel>
  );

  assert.match(markup, /Report withheld for this focus/);
  assert.match(markup, /outside the verified residential scope/);
  assert.doesNotMatch(markup, /data-us-rental-screen/);
  assert.doesNotMatch(markup, /Continue your rental analysis/);
});

test("US resolved whole-apartment scope is withheld even when HUD regional context exists", () => {
  const resolved = subject({
    rawInput: "200 Main St, Seattle, WA",
    normalizedAddress: "200 Main St, Seattle, WA",
    listing: { address: "200 Main St, Seattle, WA", source: "rentcast_listing" },
    propertyRecord: { address: "200 Main St, Seattle, WA", propertyType: "Apartment" },
  });
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([
      { value: "Apartment Building", scope: "listing", source: "rentcast_listing" },
      { value: "Apartment", scope: "provider_record" },
    ]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "building" },
      addressRentEstimate: { available: true, scope: "unit" },
      regionalRentBenchmark: { available: true, scope: "regional", source: "hud_fmr" },
    },
  });

  assert.equal(capabilities.items.addressRentEstimate.reason, "unsupported_scope");
  const markup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="rental_investment"
      country="US"
      subjectScope={resolved.scope}
      capabilities={capabilities}
      gateUnsupported
      preserveContainedSubjectGapResult
    >
      <div data-us-whole-building-rental="true">Unsafe whole-building rental screen</div>
    </AssessmentJourneyPanel>
  );

  assert.match(markup, /Report withheld for this focus/);
  assert.match(markup, /does not match the resolved subject scope/);
  assert.doesNotMatch(markup, /data-us-whole-building-rental/);
});

test("clean residential without CMHC: CanadaRentalScreen renders with the no-benchmark copy", () => {
  const markup = renderToStaticMarkup(
    <CanadaRentalScreen
      city="Victoria"
      province="BC"
      propertySlug="402-123-main-st"
      listPrice={650_000}
      beds="2"
      baths="1"
      sqft="850"
      regionalRent={null}
    />
  );
  assert.match(markup, /No CMHC benchmark is mapped for this city yet/);
  assert.match(markup, /id="canada-rent-scenario"/, "the rent-scenario input must still render for a non-excluded class");
  assert.match(markup, /data-p5-operating-scenario="supplemental"/, "the operating scenario must remain supplemental and collapsed");
  assert.match(markup, /Blank means unknown, not zero/, "missing expenses must never be silently zero-filled");
  assert.doesNotMatch(markup, /<h1/, "the nested rental module must not repeat the result-level property identity");
});

test("Canadian rental screen preserves mapped CMHC evidence as regional context", () => {
  const markup = renderToStaticMarkup(
    <CanadaRentalScreen
      city="Vancouver"
      province="BC"
      propertySlug="123-main-st"
      listPrice={900_000}
      beds="2"
      baths="2"
      sqft="950"
      regionalRent={{ monthlyRent: 2_850, cmaName: "Vancouver", bedroomLabel: "2BR", vintage: 2025 }}
    />
  );
  assert.match(markup, /CMHC 2025 turnover rent/);
  assert.match(markup, /Regional apartment benchmark only—not expected rent/);
  assert.match(markup, /data-p5-operating-scenario="supplemental"/);
});

test("US operating scenario exposes editable modeled inputs inside the supplemental disclosure", () => {
  const markup = renderToStaticMarkup(
    <RentalOperatingScenario
      purchasePrice={600_000}
      monthlyRent={3_000}
      currency="USD"
      editableBasis={{
        priceSource: "Active listing asking price",
        rentSource: "Prefilled from RentCast rent AVM · modeled, not a signed lease",
      }}
    />
  );
  assert.match(markup, /data-p5-editable-scenario-basis="true"/);
  assert.match(markup, /value="600000"/);
  assert.match(markup, /value="3000"/);
  assert.match(markup, /modeled, not a signed lease/);
  assert.match(markup, /grid-cols-1 sm:grid-cols-3/, "scenario basis must collapse to one column at narrow widths");
});

test("US off-market scenario labels the value AVM separately from the modeled rent AVM", () => {
  const markup = renderToStaticMarkup(
    <UsRentalScreen
      model={{
        availability: "supported",
        addressRent: {
          value: 3_100, rangeLow: 2_900, rangeHigh: 3_300,
          label: "Address-level rent estimate",
          source: "RentCast rent AVM · modeled, not a signed lease",
        },
        regionalRent: null,
        yield: { grossYieldPct: 0.062, rentToPriceRatio: 0.00517, onePercentRuleMet: false },
      }}
      operatingBasis={{ purchasePrice: 600_000, monthlyRent: 3_100, rentBasis: "modeled_address_rent" }}
      priceSource="RentCast AVM modeled value"
    />
  );
  assert.match(markup, /RentCast AVM modeled value · editable assumption/);
  assert.match(markup, /Prefilled from RentCast rent AVM · modeled, not a signed lease/);
  assert.equal((markup.match(/data-p5-editable-scenario-basis/g) ?? []).length, 1);
});

test("US supported rental evidence composes the scenario while a regional fallback does not", () => {
  const supported = renderToStaticMarkup(
    <UsRentalScreen
      model={{
        availability: "supported",
        addressRent: { value: 3_000, label: "Address-level rent estimate", source: "RentCast rent AVM" },
        regionalRent: { value: 2_200, label: "Regional benchmark · 2BR", source: "HUD Fair Market Rent" },
        yield: { grossYieldPct: 0.06, rentToPriceRatio: 0.005, onePercentRuleMet: false },
      }}
      operatingBasis={{ purchasePrice: 600_000, monthlyRent: 3_000, rentBasis: "modeled_address_rent" }}
      priceSource="Active listing asking price"
    />
  );
  assert.match(supported, /data-p5-editable-scenario-basis="true"/);
  assert.match(supported, /Prefilled from RentCast rent AVM/);
  assert.match(supported, /HUD Fair Market Rent/);

  const fallback = renderToStaticMarkup(
    <UsRentalScreen
      model={{
        availability: "limited",
        addressRent: null,
        regionalRent: { value: 2_200, label: "Regional benchmark · 2BR", source: "HUD Fair Market Rent" },
        yield: null,
      }}
    />
  );
  assert.doesNotMatch(fallback, /data-p5-editable-scenario-basis/);
  assert.match(fallback, /HUD Fair Market Rent/);
});

test("US regional rent geography never duplicates county-equivalent suffixes", () => {
  assert.equal(usRegionalGeographyLabel("Salt Lake County"), "Salt Lake County");
  assert.equal(usRegionalGeographyLabel("District of Columbia"), "District of Columbia");
  assert.equal(usRegionalGeographyLabel("Orleans Parish"), "Orleans Parish");
  assert.equal(usRegionalGeographyLabel("Northwest Arctic Borough"), "Northwest Arctic Borough");
  assert.equal(usRegionalGeographyLabel("Bethel Census Area"), "Bethel Census Area");
  assert.equal(usRegionalGeographyLabel("Anchorage Municipality"), "Anchorage Municipality");
  assert.equal(usRegionalGeographyLabel("Cook"), "Cook County");
});

function fallbackResult(
  propertyDataUnavailableReason: UsFallbackResult["propertyDataUnavailableReason"]
): UsFallbackResult {
  const resolved = resolveAssessmentSubject({
    rawInput: "2 15th St NW, Washington, DC 20024",
    normalizedAddress: "2 15th St NW, Washington, DC 20024",
  });
  const classification = classifyProperty({ subject: resolved, evidence: evidence([]) });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: { countyMarketContext: true },
  });
  return {
    ok: true,
    country: "US",
    address: "2 15th St NW",
    city: "Washington",
    state: "DC",
    countyName: "District of Columbia",
    countyFips: "11001",
    assessment: {
      totalValue: 715_000,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: "2024",
      found: true,
      source: "area_median",
      evidenceClass: "modeled",
    },
    assessmentSubject: resolved,
    propertyClassification: classification,
    propertyCapabilities: capabilities,
    assessmentGoal: "rental_investment",
    assessmentId: null,
    marketPanel: null,
    emailSent: false,
    offerAvailable: false,
    offerUnavailableReason: "no_listing_data",
    propertyDataUnavailableReason,
  };
}

function confirmedExploreSubjectGapResult(): UsFallbackResult {
  const base = fallbackResult("property_identity_not_found");
  const available = (explanation: string) => ({
    available: true as const,
    reason: "available" as const,
    evidence: [],
    explanation,
  });
  return {
    ...base,
    address: "100 Broadway E, Seattle, WA",
    city: "Seattle",
    state: "WA",
    countyName: "King County",
    countyFips: "53033",
    assessmentSubject: {
      ...base.assessmentSubject,
      scope: "unknown",
      selectedBy: "user_confirmation",
      requiresClarification: false,
    },
    propertyCapabilities: {
      ...base.propertyCapabilities,
      // Represents capabilities computed for the pre-confirmation building.
      // The explicit explore-address confirmation deliberately changes the
      // subject to unknown without refetching or reusing those values.
      subjectScope: "building",
      items: {
        ...base.propertyCapabilities.items,
        addressSaleValuation: available("Whole-building value fixture"),
        addressRentEstimate: available("Single-unit rent fixture"),
        grossYieldScreen: available("Mismatched yield fixture"),
      },
    },
  };
}

test("confirmed US explore-address preserves its contained unresolved result and regional context", () => {
  const result = confirmedExploreSubjectGapResult();
  const safeChild = <UsAssessmentResult data={result} activeGoal="rental_investment" />;

  const genericMarkup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="rental_investment"
      country="US"
      subjectScope={result.assessmentSubject.scope}
      capabilities={result.propertyCapabilities}
      gateUnsupported
      focusPlacement="embedded"
    >
      {safeChild}
    </AssessmentJourneyPanel>
  );
  assert.doesNotMatch(genericMarkup, /<h1/, "pre-fix generic gating removes the safe result identity");

  const containedMarkup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="rental_investment"
      country="US"
      subjectScope={result.assessmentSubject.scope}
      capabilities={result.propertyCapabilities}
      gateUnsupported
      focusPlacement="embedded"
      preserveContainedSubjectGapResult
    >
      {safeChild}
    </AssessmentJourneyPanel>
  );

  assert.equal((containedMarkup.match(/<h1/g) ?? []).length, 1, "exactly one property identity remains");
  assert.match(containedMarkup, /100 Broadway E, Seattle, WA/);
  assert.match(containedMarkup, /Exact property required/);
  assert.match(containedMarkup, /Regional context only/);
  assert.match(containedMarkup, /withheld the returned value and rent/);
  assert.ok(
    containedMarkup.indexOf("<h1") < containedMarkup.indexOf('data-p4-journey-panel="true"'),
    "property identity must precede the supplemental focus control"
  );
  assert.ok(
    containedMarkup.indexOf('data-p4-journey-panel="true"') < containedMarkup.indexOf("Exact property required"),
    "focus control must precede the contained unresolved-subject explanation"
  );
  assert.doesNotMatch(containedMarkup, /data-p5-editable-scenario-basis/);
  assert.doesNotMatch(containedMarkup, /Gross rental yield|Recommended Offer|Estimated Offer/);
  assert.doesNotMatch(containedMarkup, /Continue your rental analysis|Act on this analysis|Sponsored/);
});

test("US identity fallback preserves county disclosure but withholds every property-oriented action", () => {
  const markup = renderToStaticMarkup(
    <UsAssessmentResult
      data={fallbackResult("property_identity_not_found")}
      activeGoal="rental_investment"
    />
  );

  assert.match(markup, /Property identity could not be confirmed/);
  assert.match(markup, /Property-oriented actions are withheld until an exact property identity is confirmed/);
  assert.match(markup, /data-property-actions-withheld="identity_not_confirmed"/);
  assert.match(markup, /County Median Home Value/);
  assert.match(markup, /not property-specific/);
  assert.doesNotMatch(markup, /Track this home(?:&apos;|&#x27;|')s value and rent/);
  assert.doesNotMatch(markup, /Act on this analysis/);
  assert.doesNotMatch(markup, /Continue your rental analysis/);
});

test("US transient provider fallback retains existing partner-action composition", () => {
  const markup = renderToStaticMarkup(
    <UsAssessmentResult
      data={fallbackResult("provider_error")}
      activeGoal="rental_investment"
    />
  );

  assert.match(markup, /Property and listing lookup is temporarily unavailable/);
  assert.match(markup, /Act on this analysis/);
  assert.match(markup, /Track this home(?:&apos;|&#x27;|')s value and rent/);
});

test("P6A buyer routing preserves the P0 transient fallback explanation", () => {
  const markup = renderToStaticMarkup(
    <UsAssessmentResult
      data={fallbackResult("provider_error")}
      activeGoal="buy_home"
    />
  );

  assert.match(markup, /Property and listing lookup is temporarily unavailable/);
  assert.match(markup, /County Median Home Value/);
  assert.doesNotMatch(markup, /Residential buyer analysis withheld/);
});

function neutralAvmHistorySignal(): EquityTenureSignal {
  return {
    tier: "recorded_value_history",
    label: "Recorded Value History",
    holdYears: 18.2,
    lastSaleDate: "2008-06-01",
    lastSalePrice: 290_000,
    currentValueEstimate: 614_000,
    currentValueKind: "avm_estimate",
    impliedAppreciationPct: 1.117,
    hpiImpliedValue: 750_000,
    hpiCorroboration: "below_hpi_trend",
    motivationStrength: "none",
    scorePoints: 0,
    narrative: "The last recorded sale was 18.2yr ago at $290,000. RentCast's modeled value estimate is $614,000, a +112% change from that recorded sale. This recorded-sale-to-modeled-value comparison does not identify or infer a current seller, negotiation leverage, mortgage balance, equity, distress, or intent.",
  };
}

let supportedOffMarketFixture: UsOffMarketResult | null = null;

test("off-market value history never presents modeled AVM change as seller leverage", () => {
  const signal = neutralAvmHistorySignal();
  const offMarket = renderToStaticMarkup(<EquityTenureCard equitySignal={signal} variant="off_market" />);
  const listed = renderToStaticMarkup(<EquityTenureCard equitySignal={signal} />);

  assert.match(offMarket, /Recorded Sale &amp; Modeled Value/);
  assert.match(offMarket, /Recorded Value History/);
  assert.match(offMarket, /Modeled change/);
  assert.doesNotMatch(offMarket, /Seller Equity|room to negotiate/);
  assert.match(offMarket, /not a statement about ownership, equity, or willingness to transact/);
  assert.doesNotMatch(listed, /Seller Equity &amp; Tenure/, "AVM provenance is a defensive off-market discriminator");
});

test("complete US off-market result keeps AVM history neutral across the production composition", () => {
  const resolved = subject({
    rawInput: "112 Aldrich Rd, Peru, VT",
    normalizedAddress: "112 Aldrich Rd, Peru, VT",
    propertyRecord: { address: "112 Aldrich Rd, Peru, VT", propertyType: "Single Family" },
  });
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([{ value: "Single Family", scope: "provider_record" }]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "parcel" },
      addressRentEstimate: { available: true, scope: "parcel" },
      activeListing: false,
      countyMarketContext: true,
      insurancePrefillCore: true,
    },
  });
  const result: UsOffMarketResult = {
    ok: true,
    country: "US",
    address: "112 Aldrich Rd, Peru, VT",
    city: "Peru",
    state: "VT",
    countyName: "Bennington County",
    countyFips: "50003",
    assessment: {
      totalValue: 193_200,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: "2025",
      found: true,
      source: "government",
      evidenceClass: "observed",
    },
    assessmentSubject: resolved,
    propertyClassification: classification,
    propertyCapabilities: capabilities,
    assessmentGoal: "buy_home",
    assessmentId: null,
    marketPanel: null,
    emailSent: false,
    offerAvailable: false,
    offerUnavailableReason: "not_listed",
    offerUnavailableMessage: "No active listing matched the resolved property.",
    avm: { value: 614_000, rangeLow: 580_000, rangeHigh: 650_000 },
    rent: { value: 3_420, rangeLow: 3_100, rangeHigh: 3_700 },
    equitySignal: neutralAvmHistorySignal(),
    triangulation: {
      anchors: [{ label: "RentCast AVM", value: 614_000, kind: "avm" }],
      excludedAnchors: [],
      triangulatedValue: 614_000,
      spreadPct: null,
      confidence: "insufficient",
      agreementNote: "Only one valuation anchor available for this address — no triangulation possible.",
    },
    investorYield: null,
    riskMomentum: {
      momentum: "unknown",
      hpiTrend5y: null,
      vacancyRate: null,
      vacancyElevated: false,
      topPerils: [],
      note: "No notable risk or momentum signals from county data for this area.",
    },
    overAssessment: {
      triggered: false,
      taxAssessedValue: null,
      marketReference: 614_000,
      deltaPct: null,
      note: null,
    },
  };
  supportedOffMarketFixture = result;
  const markup = renderToStaticMarkup(<UsAssessmentResult data={result} activeGoal="buy_home" />);

  assert.match(markup, /data-p6a-buyer-contract="capability"/);
  assert.match(markup, /data-p6a-buyer-availability="supported"/);
  assert.doesNotMatch(markup, /data-p6a-buyer-notice/);
  assert.match(markup, /Recorded Sale &amp; Modeled Value/);
  assert.match(markup, /RentCast(?:&apos;|&#x27;|')s modeled value estimate/);
  assert.match(markup, /No active listing matched the resolved property/);
  assert.match(markup, /County tax assessment/);
  assert.match(markup, /\$193,200/);
  assert.match(markup, /RentCast AVM Estimate/);
  assert.match(markup, /Modeled range: \$580,000 – \$650,000/);
  assert.ok(
    markup.indexOf("2025 county tax assessment") < markup.indexOf("Modeled range: $580,000"),
    "the AVM range must live with the RentCast AVM card, not the county assessment hero"
  );
  assert.doesNotMatch(markup, /Seller Equity|Loss-Sale Distress|Long-Tenure Equity|room to negotiate/);
  assert.doesNotMatch(markup, /seller under financial pressure|structural distress/);
});

test("US regional-only buyer result cannot leak property valuation or rent cards", () => {
  assert.ok(supportedOffMarketFixture, "supported off-market fixture must run first");
  const capabilities = evaluatePropertyCapabilities({
    subject: supportedOffMarketFixture.assessmentSubject,
    classification: supportedOffMarketFixture.propertyClassification,
    facts: { countyMarketContext: true },
  });
  const result: UsOffMarketResult = {
    ...supportedOffMarketFixture,
    propertyCapabilities: capabilities,
  };
  const markup = renderToStaticMarkup(<UsAssessmentResult data={result} activeGoal="buy_home" />);

  assert.match(markup, /data-p6a-buyer-availability="limited"/);
  assert.match(markup, /Property-specific buyer analysis is limited/);
  assert.match(markup, /regional context only/i);
  assert.doesNotMatch(markup, /\$193,200|RentCast AVM Estimate|Estimated Monthly Rent/);
  assert.doesNotMatch(markup, /Recorded Sale &amp; Modeled Value|Valuation triangulation|Act on this analysis|Sponsored/);
});

test("US commercial evidence withholds the legacy residential buyer composition", () => {
  assert.ok(supportedOffMarketFixture, "supported off-market fixture must run first");
  const unresolved = subject({
    rawInput: "100 Commerce St, Austin, TX",
    normalizedAddress: "100 Commerce St, Austin, TX",
    propertyRecord: { address: "100 Commerce St, Austin, TX", propertyType: "Retail Commercial" },
  });
  const resolved = {
    ...unresolved,
    selectedBy: "user_confirmation" as const,
    resolutionConfidence: "high" as const,
    requiresClarification: false,
    clarificationReason: undefined,
  };
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([{ value: "Retail Commercial", scope: "provider_record" }]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "building" },
      addressRentEstimate: { available: true, scope: "building" },
      activeListing: false,
      countyMarketContext: true,
      insurancePrefillCore: true,
    },
  });
  const result: UsOffMarketResult = {
    ...supportedOffMarketFixture,
    address: "100 Commerce St, Austin, TX",
    city: "Austin",
    state: "TX",
    countyName: "Travis County",
    countyFips: "48453",
    assessmentSubject: resolved,
    propertyClassification: classification,
    propertyCapabilities: capabilities,
  };
  const markup = renderToStaticMarkup(<UsAssessmentResult data={result} activeGoal="buy_home" />);

  assert.match(markup, /data-p6a-buyer-availability="limited"/);
  assert.match(markup, /data-p6a-buyer-withheld="true"/);
  assert.match(markup, /Residential buyer analysis withheld/);
  assert.match(markup, /outside the verified residential scope/);
  assert.doesNotMatch(markup, /RentCast AVM Estimate|Estimated Monthly Rent/);
  assert.doesNotMatch(markup, /Recorded Sale &amp; Modeled Value|Investor Yield|Recommended Offer/);
  assert.doesNotMatch(markup, /Act on this analysis|Sponsored/);
});

test("supported result renders address and primary offer before a collapsed focus control", () => {
  const resolved = subject({
    listing: { address: "10 Oak St, Victoria, BC", source: "zoocasa_listing" },
    propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Single Family" },
  });
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([
      { value: "Single Family", scope: "listing" },
      { value: "Single Family", scope: "provider_record" },
    ]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "building" },
      activeListing: true,
      offerComputed: true,
      insurancePrefillCore: true,
    },
  });
  const markup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="buy_home"
      country="CA"
      subjectScope={resolved.scope}
      capabilities={capabilities}
      gateUnsupported
      lead={<><h1>10 Oak St</h1><div>Recommended Offer</div></>}
    >
      <div>The Signal</div>
    </AssessmentJourneyPanel>
  );

  assert.ok(markup.indexOf("10 Oak St") < markup.indexOf("Recommended Offer"));
  assert.ok(markup.indexOf("Recommended Offer") < markup.indexOf("data-p4-journey-panel"));
  assert.ok(markup.indexOf("data-p4-journey-panel") < markup.indexOf("The Signal"));
  assert.match(markup, /<details[^>]*class=/);
  assert.doesNotMatch(markup, /<details[^>]* open/);
  assert.match(markup, /Buying a home/);
  assert.match(markup, /Change/);
});

test("embedded result placement renders exactly one focus control between the primary result and persona module", () => {
  const resolved = subject({
    propertyRecord: { address: "10 Oak St, Victoria, BC", propertyType: "Single Family" },
  });
  const classification = classifyProperty({
    subject: resolved,
    evidence: evidence([{ value: "Single Family", scope: "provider_record" }]),
  });
  const capabilities = evaluatePropertyCapabilities({
    subject: resolved,
    classification,
    facts: {
      addressSaleValue: { available: true, scope: "building" },
      activeListing: true,
      offerComputed: true,
    },
  });
  const markup = renderToStaticMarkup(
    <AssessmentJourneyPanel
      enabled
      initialGoal="buy_home"
      country="CA"
      subjectScope={resolved.scope}
      capabilities={capabilities}
      gateUnsupported
      focusPlacement="embedded"
    >
      <h1>10 Oak St</h1>
      <div>Recommended Offer</div>
      <AssessmentJourneyFocus />
      <div>Persona module</div>
    </AssessmentJourneyPanel>
  );

  assert.equal((markup.match(/data-p4-journey-panel/g) ?? []).length, 1);
  assert.ok(markup.indexOf("10 Oak St") < markup.indexOf("Recommended Offer"));
  assert.ok(markup.indexOf("Recommended Offer") < markup.indexOf("data-p4-journey-panel"));
  assert.ok(markup.indexOf("data-p4-journey-panel") < markup.indexOf("Persona module"));
});

console.log(`\n${passed}/${passed} render-shaped fixtures passed\n`);
