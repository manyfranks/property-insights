import { hasAnalyticsConsent } from "./consent";
import { isOptedOutRequest } from "./privacy";
import {
  ASSESSMENT_GOALS,
  ASSESSMENT_SUBJECT_CHOICES,
  JOURNEY_EVENT_TYPES,
  type JourneyEventType,
} from "./property-intelligence/journey";
import type { EventType } from "./db/user-events";

const MAX_DATA_SIZE = 1024;
const MAX_DATA_KEYS = 10;

const JOURNEY_KEYS: Record<JourneyEventType, ReadonlySet<string>> = {
  assessment_subject_clarification_shown: new Set(["country", "surface", "subjectScope", "reason"]),
  assessment_subject_selected: new Set(["country", "surface", "subjectScope", "selection"]),
  journey_selected: new Set(["goal", "surface", "selectionSource"]),
  journey_result_viewed: new Set(["country", "surface", "goal", "subjectScope", "capabilityStatus"]),
  journey_switched: new Set([
    "country",
    "surface",
    "previousGoal",
    "goal",
    "subjectScope",
    "capabilityStatus",
  ]),
};

const JOURNEY_VALUES: Record<string, ReadonlySet<string>> = {
  country: new Set(["US", "CA"]),
  surface: new Set(["assess_preflight", "assess_on_demand"]),
  goal: new Set(ASSESSMENT_GOALS),
  previousGoal: new Set(ASSESSMENT_GOALS),
  subjectScope: new Set(["unit", "building", "parcel", "listing", "unknown"]),
  capabilityStatus: new Set(["supported", "limited", "unavailable"]),
  selection: new Set(ASSESSMENT_SUBJECT_CHOICES),
  selectionSource: new Set(["explicit"]),
  reason: new Set([
    "conflicting_units",
    "listing_address_conflict",
    "provider_address_conflict",
    "unit_not_confirmed_by_property_record",
    "unit_or_building_unspecified",
    "unspecified",
  ]),
};

export function isJourneyEventType(type: EventType): type is JourneyEventType {
  return JOURNEY_EVENT_TYPES.includes(type as JourneyEventType);
}

export function shouldTrackConsentedEvent(
  req: Request,
  unsafeMetadata: Record<string, unknown> | undefined
): boolean {
  return !isOptedOutRequest(req) && hasAnalyticsConsent(unsafeMetadata);
}

/**
 * Generic payload sanitizer shared by every event-data validator in the
 * codebase: string/number/boolean values only, ≤MAX_DATA_KEYS keys, each
 * key ≤64 chars, each string value ≤256 chars, whole object ≤MAX_DATA_SIZE
 * bytes once serialized. No event-type-specific allowlisting here — that's
 * layered on top by callers that need it (see validateEventData's
 * journey-type branch below, and src/app/api/signal/route.ts's
 * SIGNAL_EVENT_TYPES allowlist, which gates *which* event types are
 * accepted before this function ever sees their `data`).
 *
 * `undefined`/`null` is treated as "no data supplied" and normalizes to
 * `{}` rather than being rejected — callers that require data for a given
 * type (e.g. journey events) must check that themselves before calling in.
 */
export function validateGenericEventData(
  raw: unknown
): Record<string, string | number | boolean> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const data = raw as Record<string, unknown>;
  const keys = Object.keys(data);
  if (keys.length > MAX_DATA_KEYS) return null;

  const clean: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 64) return null;
    const value = data[key];
    if (typeof value === "boolean" || typeof value === "number") {
      clean[key] = value;
    } else if (typeof value === "string" && value.length <= 256) {
      clean[key] = value;
    } else {
      return null;
    }
  }

  if (JSON.stringify(clean).length > MAX_DATA_SIZE) return null;
  return clean;
}

/** Validate, sanitize, and apply a strict allowlist to P4 journey payloads. */
export function validateEventData(
  type: EventType,
  raw: unknown
): Record<string, string | number | boolean> | null {
  if (raw === undefined || raw === null) return isJourneyEventType(type) ? null : {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const data = raw as Record<string, unknown>;
  const keys = Object.keys(data);
  if (keys.length > MAX_DATA_KEYS) return null;

  if (isJourneyEventType(type)) {
    const allowed = JOURNEY_KEYS[type];
    if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) return null;
    if (keys.some((key) => {
      const value = data[key];
      return typeof value !== "string" || !JOURNEY_VALUES[key]?.has(value);
    })) return null;
  }

  return validateGenericEventData(data);
}
