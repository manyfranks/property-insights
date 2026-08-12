import assert from "node:assert/strict";
import {
  isAssessmentStateId,
  normalizePrivateResultRef,
  normalizePrivateSubjectUnit,
} from "../src/lib/db/user-assessments";
import { shouldTrackConsentedEvent, validateEventData } from "../src/lib/tracking-validation";

const cases: Array<[string, () => void]> = [
  ["private assessment IDs accept UUIDs and reject arbitrary locators", () => {
    assert.equal(isAssessmentStateId("87c18c8a-1234-4abc-8def-1234567890ab"), true);
    assert.equal(isAssessmentStateId("4042-w-20th-ave"), false);
  }],
  ["private unit normalization is bounded and never becomes a URL slug", () => {
    assert.equal(normalizePrivateSubjectUnit("Apt 402"), "402");
    assert.equal(normalizePrivateSubjectUnit(" suite PH-01 "), "PH-01");
    assert.throws(() => normalizePrivateSubjectUnit("***"), /invalid/i);
  }],
  ["shared result references accept only bounded slugs", () => {
    assert.equal(normalizePrivateResultRef("4042-w-20th-ave"), "4042-w-20th-ave");
    assert.throws(() => normalizePrivateResultRef("https://example.com/property"), /invalid/i);
    assert.throws(() => normalizePrivateResultRef("../../private"), /invalid/i);
  }],
  ["journey event allowlists reject address, unit, place ID, slug, and occupancy", () => {
    const forbidden = ["address", "unit", "placeId", "slug", "occupancy"];
    for (const key of forbidden) {
      assert.equal(validateEventData("journey_selected", {
        goal: "buy_home",
        surface: "assess_preflight",
        selectionSource: "explicit",
        [key]: "secret",
      }), null, key);
    }
  }],
  ["journey event schemas reject disguised identifiers and missing fields", () => {
    assert.equal(validateEventData("journey_selected", {
      goal: "51-20 69th Pl",
      surface: "assess_preflight",
      selectionSource: "explicit",
    }), null);
    assert.equal(validateEventData("journey_selected", {
      goal: "buy_home",
      surface: "assess_preflight",
    }), null);
    assert.equal(validateEventData("journey_selected", null), null);
  }],
  ["valid journey payloads retain only the documented coarse fields", () => {
    assert.deepEqual(validateEventData("journey_result_viewed", {
      country: "US",
      surface: "assess_on_demand",
      goal: "rental_investment",
      subjectScope: "listing",
      capabilityStatus: "supported",
    }), {
      country: "US",
      surface: "assess_on_demand",
      goal: "rental_investment",
      subjectScope: "listing",
      capabilityStatus: "supported",
    });
  }],
  ["Sec-GPC suppresses consented event tracking", () => {
    const req = new Request("https://propertyinsights.xyz/api/track", {
      headers: { "Sec-GPC": "1" },
    });
    assert.equal(shouldTrackConsentedEvent(req, {
      consent: { analytics: true, partnerSharing: false, updatedAt: new Date().toISOString(), version: 1 },
    }), false);
  }],
  ["Do-Not-Sell cookie suppresses consented event tracking", () => {
    const req = new Request("https://propertyinsights.xyz/api/track", {
      headers: { cookie: "theme=light; pi_dns=1" },
    });
    assert.equal(shouldTrackConsentedEvent(req, {
      consent: { analytics: true, partnerSharing: false, updatedAt: new Date().toISOString(), version: 1 },
    }), false);
  }],
  ["missing or withdrawn analytics consent suppresses tracking", () => {
    const req = new Request("https://propertyinsights.xyz/api/track");
    assert.equal(shouldTrackConsentedEvent(req, undefined), false);
    assert.equal(shouldTrackConsentedEvent(req, {
      consent: { analytics: false, partnerSharing: false, updatedAt: new Date().toISOString(), version: 1 },
    }), false);
  }],
  ["analytics consent permits tracking only without an opt-out signal", () => {
    const req = new Request("https://propertyinsights.xyz/api/track");
    assert.equal(shouldTrackConsentedEvent(req, {
      consent: { analytics: true, partnerSharing: false, updatedAt: new Date().toISOString(), version: 1 },
    }), true);
  }],
];

console.log("\nP4 Sprint B persistence and privacy fixtures\n");
let failures = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}
if (failures > 0) process.exit(1);
console.log(`\n${cases.length}/${cases.length} P4 Sprint B fixtures passed\n`);
