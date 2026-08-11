/**
 * Anonymous operational telemetry for P3 shadow acceptance.
 *
 * This stream is intentionally separate from user_events/user_profiles. It
 * stores no user ID, address, unit, place ID, occupancy value, goal, CTA, or
 * evidence payload. It exists only to measure classifier/capability behavior
 * by coarse geography and ingestion surface before P4 can consume it.
 */

import { dbAvailable, sql } from "@/lib/db";
import type { PropertyCapabilities } from "@/lib/property-intelligence/capabilities";
import type { PropertyClassification } from "@/lib/property-intelligence/classification";
import type { AssessmentSubject } from "@/lib/property-intelligence/subject";

export type PropertyIntelligenceEventType = "classification_result" | "capability_missing";

export interface PropertyIntelligenceEvent {
  eventType: PropertyIntelligenceEventType;
  country: "US" | "CA";
  region: string;
  surface: "assess_on_demand" | "discover_seed" | "discover_enriched" | "canada_listing";
  resultVariant: "listed" | "off_market" | "regional_fallback" | "discover";
  subjectScope: AssessmentSubject["scope"];
  subjectConfidence: AssessmentSubject["resolutionConfidence"];
  requiresClarification: boolean;
  classification: Record<string, string>;
  capabilities: Record<string, string>;
}

export interface PropertyIntelligenceObservation {
  country: "US" | "CA";
  region: string;
  surface: PropertyIntelligenceEvent["surface"];
  resultVariant: PropertyIntelligenceEvent["resultVariant"];
  subject: AssessmentSubject;
  classification: PropertyClassification;
  capabilities: PropertyCapabilities;
}

const FORBIDDEN_TELEMETRY_KEYS = new Set([
  "address",
  "unit",
  "userid",
  "user_id",
  "placeid",
  "place_id",
  "occupancy",
  "goal",
  "journey",
  "intent",
]);

function classificationSummary(
  classification: PropertyClassification
): Record<string, string> {
  return {
    overallConfidence: classification.overallConfidence,
    parcelUse: classification.parcelUse.value,
    parcelUseState: classification.parcelUse.state,
    parcelUseConfidence: classification.parcelUse.confidence,
    buildingForm: classification.buildingForm.value,
    buildingFormState: classification.buildingForm.state,
    buildingFormConfidence: classification.buildingForm.confidence,
    unitUse: classification.unitUse.value,
    unitUseState: classification.unitUse.state,
    unitUseConfidence: classification.unitUse.confidence,
    listingScope: classification.listingScope.value,
    listingScopeState: classification.listingScope.state,
    listingScopeConfidence: classification.listingScope.confidence,
    tags: classification.tags.map((tag) => tag.name).sort().join("|") || "none",
  };
}

function capabilitySummary(
  capabilities: PropertyCapabilities,
  unavailableOnly = false
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(capabilities.items)
      .filter(([, item]) => !unavailableOnly || !item.available)
      .map(([name, item]) => [name, item.reason])
  );
}

function assertPrivacySafe(event: PropertyIntelligenceEvent): void {
  const serializedKeys = Object.keys(event)
    .concat(Object.keys(event.classification), Object.keys(event.capabilities))
    .map((key) => key.toLowerCase());
  for (const key of serializedKeys) {
    if (FORBIDDEN_TELEMETRY_KEYS.has(key)) {
      throw new Error(`Property-intelligence telemetry contains forbidden key: ${key}`);
    }
  }
}

export function buildPropertyIntelligenceEvents(
  observation: PropertyIntelligenceObservation
): PropertyIntelligenceEvent[] {
  const base = {
    country: observation.country,
    region: observation.region.trim().toUpperCase().slice(0, 8),
    surface: observation.surface,
    resultVariant: observation.resultVariant,
    subjectScope: observation.subject.scope,
    subjectConfidence: observation.subject.resolutionConfidence,
    requiresClarification: observation.subject.requiresClarification,
    classification: classificationSummary(observation.classification),
  };
  const events: PropertyIntelligenceEvent[] = [
    {
      ...base,
      eventType: "classification_result",
      capabilities: capabilitySummary(observation.capabilities),
    },
  ];
  const missing = capabilitySummary(observation.capabilities, true);
  if (Object.keys(missing).length > 0) {
    events.push({
      ...base,
      eventType: "capability_missing",
      capabilities: missing,
    });
  }
  events.forEach(assertPrivacySafe);
  return events;
}

export async function recordPropertyIntelligenceShadow(
  observation: PropertyIntelligenceObservation
): Promise<void> {
  if (!dbAvailable()) return;
  const db = sql();
  const events = buildPropertyIntelligenceEvents(observation);
  await Promise.all(events.map((event) => db`
    INSERT INTO property_intelligence_events (
      event_type,
      country,
      region,
      surface,
      result_variant,
      subject_scope,
      subject_confidence,
      requires_clarification,
      classification,
      capabilities
    ) VALUES (
      ${event.eventType},
      ${event.country},
      ${event.region},
      ${event.surface},
      ${event.resultVariant},
      ${event.subjectScope},
      ${event.subjectConfidence},
      ${event.requiresClarification},
      ${JSON.stringify(event.classification)},
      ${JSON.stringify(event.capabilities)}
    )
  `));
  await db`
    DELETE FROM property_intelligence_events
    WHERE created_at < NOW() - INTERVAL '90 days'
  `;
}
