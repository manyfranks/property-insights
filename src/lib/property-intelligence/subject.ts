/**
 * P2 assessment-subject resolution.
 *
 * This module is intentionally pure: it receives evidence that the assess
 * pipeline has already fetched and never calls a provider. A listing, unit,
 * building, and parcel may all legitimately share an address, so candidates
 * remain separate and conflicts are reported instead of being flattened into
 * one overloaded property object.
 */

export type SubjectScope = "unit" | "building" | "parcel" | "listing" | "unknown";
export type SubjectSelection =
  | "explicit_input"
  | "listing_match"
  | "provider_match"
  | "user_confirmation"
  | "unresolved";
export type SubjectResolutionConfidence = "high" | "medium" | "low";
export type SubjectCandidateSource =
  | "user_input"
  | "google_places"
  | "zoocasa_listing"
  | "rentcast_listing"
  | "rentcast_property"
  | "assessment_record";
export type SubjectConflictKind = "unit_mismatch" | "address_mismatch" | "scope_mismatch";
export type SubjectClarificationReason =
  | "conflicting_units"
  | "listing_address_conflict"
  | "provider_address_conflict"
  | "unit_not_confirmed_by_property_record"
  | "unit_or_building_unspecified";

export interface SubjectCandidate {
  id: string;
  scope: SubjectScope;
  canonicalAddress: string;
  unit: string | null;
  source: SubjectCandidateSource;
  sourceRecordId: string | null;
  confidence: SubjectResolutionConfidence;
  relation: "requested" | "subject" | "containing_entity" | "context";
}

export interface SubjectConflict {
  kind: SubjectConflictKind;
  candidateIds: string[];
  detail: string;
}

export interface AssessmentSubject {
  schemaVersion: 1;
  scope: SubjectScope;
  canonicalAddress: string;
  unit: string | null;
  selectedBy: SubjectSelection;
  resolutionConfidence: SubjectResolutionConfidence;
  containingBuildingId?: string;
  containingParcelId?: string;
  requiresClarification: boolean;
  clarificationReason?: SubjectClarificationReason;
  candidates: SubjectCandidate[];
  conflicts: SubjectConflict[];
}

export interface SubjectListingEvidence {
  address: string;
  unit?: string | null;
  source: "zoocasa_listing" | "rentcast_listing";
  sourceRecordId?: string | null;
}

export interface SubjectPropertyRecordEvidence {
  address: string;
  unit?: string | null;
  propertyType?: string | null;
  sourceRecordId?: string | null;
}

export interface ResolveAssessmentSubjectInput {
  rawInput: string;
  normalizedAddress?: string | null;
  parsedUnit?: string | null;
  directListingUrl?: string | null;
  selectedPlaceId?: string | null;
  listing?: SubjectListingEvidence | null;
  propertyRecord?: SubjectPropertyRecordEvidence | null;
  assessment?: {
    found: boolean;
    sourceRecordId?: string | null;
    address?: string | null;
  } | null;
}

const BUILDING_SCOPE_HINT =
  /\b(multi[ -]?family|duplex|triplex|fourplex|quadruplex|apartment|condo(?:minium)?(?: building)?|mixed[ -]?use|commercial|office|retail|industrial)\b/i;

function normalizeUnit(unit: string | null | undefined): string | null {
  const normalized = unit
    ?.trim()
    .replace(/^(?:#|unit|suite|ste|apt|apartment)\s*/i, "")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase();
  return normalized || null;
}

/**
 * Extract common unit notations without mistaking Queens-style hyphenated
 * house numbers (for example `51-20 69th Pl`) for Canadian unit prefixes.
 */
export function extractUnitFromAddress(address: string): {
  unit: string | null;
  addressWithoutUnit: string;
} {
  const trimmed = address.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return { unit: null, addressWithoutUnit: trimmed };
  }

  const commaIndex = trimmed.indexOf(",");
  const street = commaIndex >= 0 ? trimmed.slice(0, commaIndex).trim() : trimmed;
  const tail = commaIndex >= 0 ? trimmed.slice(commaIndex) : "";

  const suffix = street.match(
    /(?:\s|,)+(?:#\s*|unit\s+|suite\s+|ste\s+|apt\.?\s+|apartment\s+)([a-z0-9-]+)\s*$/i
  );
  if (suffix?.index != null) {
    return {
      unit: normalizeUnit(suffix[1]),
      addressWithoutUnit: `${street.slice(0, suffix.index).trim()}${tail}`,
    };
  }

  // Canadian listing convention: `402-123 Main St`. The street-name token
  // after the civic number must begin with a letter; this deliberately does
  // not match `51-20 69th Pl`, where `69th` is the street name.
  const prefix = street.match(/^([a-z0-9]+)-(\d+[a-z]?)\s+([a-z].*)$/i);
  if (prefix) {
    return {
      unit: normalizeUnit(prefix[1]),
      addressWithoutUnit: `${prefix[2]} ${prefix[3]}${tail}`,
    };
  }

  return { unit: null, addressWithoutUnit: trimmed };
}

function normalizedStreetKey(address: string): string {
  const { addressWithoutUnit } = extractUnitFromAddress(address);
  return (addressWithoutUnit.split(",")[0] || addressWithoutUnit)
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bplace\b/g, "pl")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bcourt\b/g, "ct")
    .replace(/[^a-z0-9]/g, "");
}

function candidateId(
  source: SubjectCandidateSource,
  scope: SubjectScope,
  address: string,
  unit: string | null,
  sourceRecordId?: string | null
): string {
  const identity = sourceRecordId || `${normalizedStreetKey(address)}:${unit || "none"}`;
  return `${source}:${scope}:${identity}`;
}

function candidate(args: Omit<SubjectCandidate, "id" | "unit"> & { unit?: string | null }): SubjectCandidate {
  const addressUnit = args.scope === "unit" || args.scope === "listing"
    ? extractUnitFromAddress(args.canonicalAddress).unit
    : null;
  const unit = normalizeUnit(args.unit) ?? addressUnit;
  return {
    ...args,
    id: candidateId(args.source, args.scope, args.canonicalAddress, unit, args.sourceRecordId),
    unit,
  };
}

function propertyRecordScope(record: SubjectPropertyRecordEvidence): SubjectScope {
  if (normalizeUnit(record.unit) || extractUnitFromAddress(record.address).unit) return "unit";
  if (record.propertyType && BUILDING_SCOPE_HINT.test(record.propertyType)) return "building";
  return "parcel";
}

function firstCandidate(candidates: SubjectCandidate[], source: SubjectCandidateSource): SubjectCandidate | undefined {
  return candidates.find((item) => item.source === source);
}

export function resolveAssessmentSubject(input: ResolveAssessmentSubjectInput): AssessmentSubject {
  const candidates: SubjectCandidate[] = [];
  const conflicts: SubjectConflict[] = [];
  const inputParsed = extractUnitFromAddress(input.rawInput);
  const explicitUnit = normalizeUnit(input.parsedUnit) ?? inputParsed.unit;
  const normalizedAddress = input.normalizedAddress?.trim() || inputParsed.addressWithoutUnit || input.rawInput.trim();
  const requestedAddress = input.directListingUrl ? normalizedAddress : inputParsed.addressWithoutUnit;

  candidates.push(
    candidate({
      scope: explicitUnit ? "unit" : input.directListingUrl ? "listing" : "unknown",
      canonicalAddress: requestedAddress,
      unit: explicitUnit,
      source: "user_input",
      sourceRecordId: null,
      confidence: explicitUnit || input.directListingUrl ? "high" : "low",
      relation: "requested",
    })
  );

  if (input.selectedPlaceId) {
    candidates.push(
      candidate({
        scope: "unknown",
        canonicalAddress: normalizedAddress,
        unit: explicitUnit,
        source: "google_places",
        sourceRecordId: input.selectedPlaceId,
        confidence: "high",
        relation: "context",
      })
    );
  }

  if (input.listing) {
    candidates.push(
      candidate({
        scope: "listing",
        canonicalAddress: input.listing.address,
        unit: input.listing.unit,
        source: input.listing.source,
        sourceRecordId: input.listing.sourceRecordId ?? null,
        confidence: "high",
        relation: "subject",
      })
    );
  }

  if (input.propertyRecord) {
    const scope = propertyRecordScope(input.propertyRecord);
    candidates.push(
      candidate({
        scope,
        canonicalAddress: input.propertyRecord.address,
        unit: input.propertyRecord.unit,
        source: "rentcast_property",
        sourceRecordId: input.propertyRecord.sourceRecordId ?? null,
        confidence: scope === "unit" ? "high" : "medium",
        relation: scope === "building" ? "containing_entity" : "context",
      })
    );
  }

  if (input.assessment?.found) {
    candidates.push(
      candidate({
        scope: "parcel",
        canonicalAddress: input.assessment.address?.trim() || normalizedAddress,
        unit: null,
        source: "assessment_record",
        sourceRecordId: input.assessment.sourceRecordId ?? null,
        confidence: "medium",
        relation: "containing_entity",
      })
    );
  }

  const inputCandidate = firstCandidate(candidates, "user_input")!;
  const listingCandidate = candidates.find(
    (item) => item.source === "zoocasa_listing" || item.source === "rentcast_listing"
  );
  const recordCandidate = firstCandidate(candidates, "rentcast_property");
  const parcelCandidate = firstCandidate(candidates, "assessment_record");

  if (explicitUnit && listingCandidate?.unit && explicitUnit !== listingCandidate.unit) {
    conflicts.push({
      kind: "unit_mismatch",
      candidateIds: [inputCandidate.id, listingCandidate.id],
      detail: `Input unit ${explicitUnit} does not match listing unit ${listingCandidate.unit}.`,
    });
  }
  if (listingCandidate?.unit && recordCandidate?.unit && listingCandidate.unit !== recordCandidate.unit) {
    conflicts.push({
      kind: "unit_mismatch",
      candidateIds: [listingCandidate.id, recordCandidate.id],
      detail: `Listing unit ${listingCandidate.unit} does not match property-record unit ${recordCandidate.unit}.`,
    });
  }
  if (
    listingCandidate &&
    recordCandidate &&
    normalizedStreetKey(listingCandidate.canonicalAddress) !== normalizedStreetKey(recordCandidate.canonicalAddress)
  ) {
    conflicts.push({
      kind: "address_mismatch",
      candidateIds: [listingCandidate.id, recordCandidate.id],
      detail: "The listing and property record resolve to different street addresses.",
    });
  }
  if (
    !input.directListingUrl &&
    listingCandidate &&
    normalizedStreetKey(inputCandidate.canonicalAddress) !== normalizedStreetKey(listingCandidate.canonicalAddress)
  ) {
    conflicts.push({
      kind: "address_mismatch",
      candidateIds: [inputCandidate.id, listingCandidate.id],
      detail: "The requested address and matched listing resolve to different street addresses.",
    });
  }
  if (
    !listingCandidate &&
    recordCandidate &&
    normalizedStreetKey(inputCandidate.canonicalAddress) !== normalizedStreetKey(recordCandidate.canonicalAddress)
  ) {
    conflicts.push({
      kind: "address_mismatch",
      candidateIds: [inputCandidate.id, recordCandidate.id],
      detail: "The requested address and property record resolve to different street addresses.",
    });
  }
  if (
    explicitUnit &&
    recordCandidate &&
    !recordCandidate.unit &&
    recordCandidate.scope === "building" &&
    listingCandidate?.unit !== explicitUnit
  ) {
    conflicts.push({
      kind: "scope_mismatch",
      candidateIds: [inputCandidate.id, recordCandidate.id],
      detail: "The input identifies a unit while the property record describes the containing building.",
    });
  }

  let selected = inputCandidate;
  let selectedBy: SubjectSelection = "unresolved";
  let resolutionConfidence: SubjectResolutionConfidence = "low";
  let requiresClarification = false;
  let clarificationReason: SubjectClarificationReason | undefined;

  const hasUnitConflict = conflicts.some((item) => item.kind === "unit_mismatch");
  const hasAddressConflict = conflicts.some((item) => item.kind === "address_mismatch");
  const hasScopeConflict = conflicts.some((item) => item.kind === "scope_mismatch");

  if (input.directListingUrl && listingCandidate) {
    selected = listingCandidate;
    selectedBy = "explicit_input";
    resolutionConfidence = hasUnitConflict || hasAddressConflict ? "medium" : "high";
  } else if (explicitUnit) {
    if (listingCandidate?.unit === explicitUnit) {
      selected = listingCandidate;
      selectedBy = "explicit_input";
      resolutionConfidence = hasAddressConflict ? "medium" : "high";
    } else {
      selected = inputCandidate;
      selectedBy = "explicit_input";
      resolutionConfidence = listingCandidate || hasScopeConflict ? "medium" : "high";
    }
  } else if (listingCandidate) {
    selected = listingCandidate;
    selectedBy = "listing_match";
    resolutionConfidence = hasAddressConflict ? "medium" : "high";
  } else if (recordCandidate) {
    selected = recordCandidate;
    selectedBy = "provider_match";
    resolutionConfidence = recordCandidate.confidence;
  } else if (parcelCandidate) {
    selected = parcelCandidate;
    selectedBy = "provider_match";
    resolutionConfidence = "medium";
  }

  if (hasUnitConflict) {
    requiresClarification = true;
    clarificationReason = "conflicting_units";
  } else if (hasAddressConflict) {
    requiresClarification = true;
    clarificationReason = listingCandidate ? "listing_address_conflict" : "provider_address_conflict";
  } else if (hasScopeConflict || (explicitUnit && listingCandidate && !listingCandidate.unit)) {
    requiresClarification = true;
    clarificationReason = "unit_not_confirmed_by_property_record";
  } else if (!explicitUnit && !listingCandidate && recordCandidate?.scope === "building") {
    requiresClarification = true;
    clarificationReason = "unit_or_building_unspecified";
  }

  return {
    schemaVersion: 1,
    scope: selected.scope,
    canonicalAddress: selected.canonicalAddress,
    unit: selected.unit,
    selectedBy,
    resolutionConfidence,
    ...(selected.scope === "unit" || selected.scope === "listing"
      ? { containingBuildingId: candidates.find((item) => item.scope === "building")?.id }
      : {}),
    ...(selected.scope !== "parcel" && parcelCandidate ? { containingParcelId: parcelCandidate.id } : {}),
    requiresClarification,
    ...(clarificationReason ? { clarificationReason } : {}),
    candidates,
    conflicts,
  };
}
