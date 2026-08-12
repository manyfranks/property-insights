import type { Assessment } from "../types";

export type EvidenceKind = "observed" | "modeled" | "inferred" | "user_supplied";
export type EvidenceConfidence = "high" | "medium" | "low" | "unknown";
export type EvidenceScope = "input" | "listing" | "provider_record" | "parcel" | "regional" | "unknown";

export type EvidenceUnavailableReason =
  | "not_provided"
  | "not_queried"
  | "field_missing"
  | "scope_unresolved"
  | "source_does_not_supply"
  | "quota_exhausted"
  | "provider_error";

export type EvidenceSource =
  | "user_input"
  | "address_parser"
  | "address_normalizer"
  | "google_places"
  | "zoocasa_search"
  | "zoocasa_detail"
  | "rentcast_listing"
  | "rentcast_property"
  | "rentcast_tax_assessment"
  | "bc_assessment"
  | "ab_assessment"
  | "on_assessment"
  | "mb_assessment"
  | "ca_assessment"
  | "us_county_assessor"
  | "rentcast_avm"
  | "area_median";

interface EvidenceBase {
  source: EvidenceSource;
  sourceRecordId?: string;
  observedAt?: string;
  ingestedAt: string;
  kind: EvidenceKind;
  confidence: EvidenceConfidence;
  scope: EvidenceScope;
}

export interface AvailableEvidence<T> extends EvidenceBase {
  availability: "available";
  value: T;
}

export interface UnavailableEvidence extends EvidenceBase {
  availability: "unavailable";
  value: null;
  reason: EvidenceUnavailableReason;
}

export type PropertyEvidence<T> = AvailableEvidence<T> | UnavailableEvidence;

export type EvidenceSurface =
  | "assess_on_demand"
  | "discover_seed"
  | "discover_enriched"
  | "canada_listing";

export interface PropertyEvidenceSnapshot {
  schemaVersion: 1;
  surface: EvidenceSurface;
  collectedAt: string;
  input: {
    rawInput: PropertyEvidence<string>;
    normalizedAddress: PropertyEvidence<string>;
    parsedUnit: PropertyEvidence<string>;
    directListingUrl: PropertyEvidence<string>;
    selectedPlaceId: PropertyEvidence<string>;
  };
  propertyTypes: PropertyEvidence<string>[];
  occupancy: PropertyEvidence<boolean>[];
  assessmentTotals: PropertyEvidence<number>[];
  landValues: PropertyEvidence<number>[];
  buildingValues: PropertyEvidence<number>[];
}

type EvidenceMeta = Omit<EvidenceBase, "ingestedAt"> & { ingestedAt?: string };

export function availableEvidence<T>(value: T, meta: EvidenceMeta): AvailableEvidence<T> {
  return {
    ...meta,
    ingestedAt: meta.ingestedAt ?? new Date().toISOString(),
    availability: "available",
    value,
  };
}

export function unavailableEvidence<T>(
  reason: EvidenceUnavailableReason,
  meta: EvidenceMeta
): PropertyEvidence<T> {
  return {
    ...meta,
    ingestedAt: meta.ingestedAt ?? new Date().toISOString(),
    availability: "unavailable",
    value: null,
    reason,
  };
}

function suppliedString(
  value: string | null | undefined,
  availableMeta: EvidenceMeta,
  unavailableMeta: EvidenceMeta,
  reason: EvidenceUnavailableReason = "not_provided"
): PropertyEvidence<string> {
  return value?.trim()
    ? availableEvidence(value, availableMeta)
    : unavailableEvidence(reason, unavailableMeta);
}

export function createPropertyEvidenceSnapshot(args: {
  surface: EvidenceSurface;
  rawInput?: string | null;
  normalizedAddress?: string | null;
  parsedUnit?: string | null;
  directListingUrl?: string | null;
  selectedPlaceId?: string | null;
  collectedAt?: string;
}): PropertyEvidenceSnapshot {
  const collectedAt = args.collectedAt ?? new Date().toISOString();
  const inputMeta = {
    ingestedAt: collectedAt,
    kind: "user_supplied" as const,
    confidence: "high" as const,
    scope: "input" as const,
  };

  return {
    schemaVersion: 1,
    surface: args.surface,
    collectedAt,
    input: {
      rawInput: suppliedString(
        args.rawInput,
        { ...inputMeta, source: "user_input" },
        { ...inputMeta, source: "user_input" }
      ),
      normalizedAddress: suppliedString(
        args.normalizedAddress,
        { ...inputMeta, source: "address_normalizer", kind: "observed" },
        { ...inputMeta, source: "address_normalizer", kind: "observed" }
      ),
      parsedUnit: suppliedString(
        args.parsedUnit,
        { ...inputMeta, source: "address_parser", kind: "observed" },
        { ...inputMeta, source: "address_parser", kind: "observed" }
      ),
      directListingUrl: suppliedString(
        args.directListingUrl,
        { ...inputMeta, source: "user_input" },
        { ...inputMeta, source: "user_input" }
      ),
      selectedPlaceId: suppliedString(
        args.selectedPlaceId,
        { ...inputMeta, source: "google_places", kind: "observed" },
        { ...inputMeta, source: "google_places", kind: "observed" }
      ),
    },
    propertyTypes: [],
    occupancy: [],
    assessmentTotals: [],
    landValues: [],
    buildingValues: [],
  };
}

export function mergePropertyEvidence(
  base: PropertyEvidenceSnapshot,
  addition: PropertyEvidenceSnapshot,
  surface: EvidenceSurface = base.surface
): PropertyEvidenceSnapshot {
  return {
    ...base,
    surface,
    input: {
      rawInput: addition.input.rawInput.availability === "available" ? addition.input.rawInput : base.input.rawInput,
      normalizedAddress:
        addition.input.normalizedAddress.availability === "available"
          ? addition.input.normalizedAddress
          : base.input.normalizedAddress,
      parsedUnit:
        addition.input.parsedUnit.availability === "available" ? addition.input.parsedUnit : base.input.parsedUnit,
      directListingUrl:
        addition.input.directListingUrl.availability === "available"
          ? addition.input.directListingUrl
          : base.input.directListingUrl,
      selectedPlaceId:
        addition.input.selectedPlaceId.availability === "available"
          ? addition.input.selectedPlaceId
          : base.input.selectedPlaceId,
    },
    propertyTypes: [...base.propertyTypes, ...addition.propertyTypes],
    occupancy: [...base.occupancy, ...addition.occupancy],
    assessmentTotals: [...base.assessmentTotals, ...addition.assessmentTotals],
    landValues: [...base.landValues, ...addition.landValues],
    buildingValues: [...base.buildingValues, ...addition.buildingValues],
  };
}

export function addZoocasaEvidence(
  snapshot: PropertyEvidenceSnapshot,
  args: {
    stage: "search" | "detail";
    propertyType?: string | null;
    propertySubType?: string | null;
    sourceRecordId?: string;
  }
): PropertyEvidenceSnapshot {
  const source: EvidenceSource = args.stage === "search" ? "zoocasa_search" : "zoocasa_detail";
  const meta: EvidenceMeta = {
    source,
    sourceRecordId: args.sourceRecordId,
    ingestedAt: snapshot.collectedAt,
    kind: "observed",
    confidence: "high",
    scope: "listing",
  };
  const values = [args.propertyType, args.propertySubType].filter(
    (value): value is string => !!value?.trim()
  );

  return {
    ...snapshot,
    propertyTypes: [
      ...snapshot.propertyTypes,
      ...(values.length > 0
        ? values.map((value) => availableEvidence(value, meta))
        : [unavailableEvidence<string>("field_missing", meta)]),
    ],
    occupancy: [
      ...snapshot.occupancy,
      unavailableEvidence<boolean>("source_does_not_supply", meta),
    ],
  };
}

interface RentCastEvidenceRecord {
  propertyType: string | null;
  ownerOccupied: boolean | null;
  taxAssessments: Array<{
    year: number;
    value: number | null;
    land: number | null;
    improvements: number | null;
  }>;
}

interface RentCastEvidenceListing {
  propertyType: string | null;
  mlsNumber: string | null;
}

export function addRentCastEvidence(
  snapshot: PropertyEvidenceSnapshot,
  args: {
    record: RentCastEvidenceRecord | null;
    listing: RentCastEvidenceListing | null;
    recordQueried: boolean;
    listingQueried: boolean;
    unavailableReason?: EvidenceUnavailableReason;
  }
): PropertyEvidenceSnapshot {
  const fallbackReason = args.unavailableReason ?? "field_missing";
  const listingMeta: EvidenceMeta = {
    source: "rentcast_listing",
    sourceRecordId: args.listing?.mlsNumber ?? undefined,
    ingestedAt: snapshot.collectedAt,
    kind: "observed",
    confidence: "high",
    scope: "listing",
  };
  const recordMeta: EvidenceMeta = {
    source: "rentcast_property",
    ingestedAt: snapshot.collectedAt,
    kind: "observed",
    confidence: "high",
    scope: "provider_record",
  };
  const missingRecordReason = args.recordQueried ? fallbackReason : "not_queried";
  const missingListingReason = args.listingQueried ? fallbackReason : "not_queried";
  const latestTax = args.record?.taxAssessments[0];
  const taxMeta: EvidenceMeta = {
    source: "rentcast_tax_assessment",
    sourceRecordId: latestTax ? String(latestTax.year) : undefined,
    observedAt: latestTax ? String(latestTax.year) : undefined,
    ingestedAt: snapshot.collectedAt,
    kind: "observed",
    confidence: "medium",
    scope: "parcel",
  };

  const propertyTypes: PropertyEvidence<string>[] = [];
  if (args.listing?.propertyType) {
    propertyTypes.push(availableEvidence(args.listing.propertyType, listingMeta));
  } else {
    propertyTypes.push(unavailableEvidence(missingListingReason, listingMeta));
  }
  if (args.record?.propertyType) {
    propertyTypes.push(availableEvidence(args.record.propertyType, recordMeta));
  } else {
    propertyTypes.push(unavailableEvidence(missingRecordReason, recordMeta));
  }

  return {
    ...snapshot,
    propertyTypes: [...snapshot.propertyTypes, ...propertyTypes],
    occupancy: [
      ...snapshot.occupancy,
      args.record?.ownerOccupied != null
        ? availableEvidence(args.record.ownerOccupied, recordMeta)
        : unavailableEvidence(missingRecordReason, recordMeta),
    ],
    assessmentTotals: [
      ...snapshot.assessmentTotals,
      latestTax?.value != null
        ? availableEvidence(latestTax.value, taxMeta)
        : unavailableEvidence(missingRecordReason, taxMeta),
    ],
    landValues: [
      ...snapshot.landValues,
      latestTax?.land != null
        ? availableEvidence(latestTax.land, taxMeta)
        : unavailableEvidence(missingRecordReason, taxMeta),
    ],
    buildingValues: [
      ...snapshot.buildingValues,
      latestTax?.improvements != null
        ? availableEvidence(latestTax.improvements, taxMeta)
        : unavailableEvidence(missingRecordReason, taxMeta),
    ],
  };
}

function assessmentSource(province: string, assessment: Assessment): EvidenceSource {
  if (assessment.source === "area_median") return "area_median";
  if (assessment.source === "avm") return "rentcast_avm";
  if (assessment.liveCountySource) return "us_county_assessor";
  if (
    assessment.source === "government" &&
    !["BC", "AB", "ON", "MB", "QC", "SK", "NS", "NB", "PE", "NL"].includes(province.toUpperCase())
  ) {
    return "rentcast_tax_assessment";
  }
  switch (province.toUpperCase()) {
    case "BC": return "bc_assessment";
    case "AB": return "ab_assessment";
    case "ON": return "on_assessment";
    case "MB": return "mb_assessment";
    default: return "ca_assessment";
  }
}

export function addAssessmentEvidence(
  snapshot: PropertyEvidenceSnapshot,
  assessment: Assessment | null,
  province: string
): PropertyEvidenceSnapshot {
  const source = assessment ? assessmentSource(province, assessment) : "ca_assessment";
  const isRegional = assessment?.source === "area_median";
  const kind: EvidenceKind =
    assessment?.evidenceClass === "modeled" || isRegional
      ? "modeled"
      : assessment?.evidenceClass === "derived" || assessment?.source === "tax_reverse"
        ? "inferred"
        : "observed";
  const meta: EvidenceMeta = {
    source,
    sourceRecordId: assessment?.assessmentYear,
    observedAt: assessment?.assessmentYear,
    ingestedAt: snapshot.collectedAt,
    kind,
    confidence: assessment?.found ? (isRegional ? "low" : "medium") : "unknown",
    scope: isRegional ? "regional" : "parcel",
  };
  const legacyBcSplitLooksComplete = !!assessment?.found &&
    province.toUpperCase() === "BC" &&
    assessment.landValue + assessment.buildingValue === assessment.totalValue &&
    (assessment.landValue > 0 || assessment.buildingValue > 0);
  const componentsSupplied = !!assessment?.found &&
    !isRegional &&
    (assessment.componentAvailability === "available" ||
      (assessment.componentAvailability == null && legacyBcSplitLooksComplete));

  return {
    ...snapshot,
    assessmentTotals: [
      ...snapshot.assessmentTotals,
      assessment?.found
        ? availableEvidence(assessment.totalValue, meta)
        : unavailableEvidence("field_missing", meta),
    ],
    landValues: [
      ...snapshot.landValues,
      componentsSupplied
        ? availableEvidence(assessment!.landValue, meta)
        : unavailableEvidence("source_does_not_supply", meta),
    ],
    buildingValues: [
      ...snapshot.buildingValues,
      componentsSupplied
        ? availableEvidence(assessment!.buildingValue, meta)
        : unavailableEvidence("source_does_not_supply", meta),
    ],
  };
}
