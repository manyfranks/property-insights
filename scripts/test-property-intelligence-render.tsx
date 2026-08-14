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
import { AssessmentJourneyPanel } from "../src/components/assessment-journey";
import CanadaRentalScreen from "../src/components/canada-rental-screen";
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
            address="10 Oak St"
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
});

test("clean residential without CMHC: CanadaRentalScreen renders with the no-benchmark copy", () => {
  const markup = renderToStaticMarkup(
    <CanadaRentalScreen
      address="402-123 Main St"
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
});

console.log(`\n${passed}/${passed} render-shaped fixtures passed\n`);
