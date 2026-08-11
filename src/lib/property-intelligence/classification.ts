import type {
  AvailableEvidence,
  PropertyEvidenceSnapshot,
} from "./evidence";
import type { AssessmentSubject } from "./subject";

export type ClassificationState = "deterministic" | "inferred" | "conflicting" | "unknown";
export type ClassificationConfidence = "high" | "medium" | "low";

export type ParcelUse = "residential" | "commercial" | "mixed-use" | "institutional" | "land" | "unknown";
export type BuildingForm =
  | "detached"
  | "attached"
  | "low-rise multi-unit"
  | "apartment"
  | "mixed-use"
  | "other"
  | "unknown";
export type UnitUse = "residential" | "commercial" | "other" | "unknown";
export type ListingScope = "unit" | "whole building" | "parcel" | "unknown";
export type OccupancySignal =
  | "owner-occupied"
  | "non-owner-occupied"
  | "conflicting"
  | "unknown";
export type PropertyTagName =
  | "short-hold resale pattern"
  | "suite signal"
  | "high land-to-improvement ratio"
  | "recent build";
export type ClassificationDimensionScope = "parcel" | "building" | "unit" | "listing" | "provider_record";

export interface ClassificationEvidenceRef {
  source: string;
  scope: string;
  kind: string;
  value: string | number | boolean;
  sourceRecordId?: string;
}

export interface ClassifiedValue<T extends string> {
  value: T;
  scope: ClassificationDimensionScope;
  state: ClassificationState;
  confidence: ClassificationConfidence;
  evidence: ClassificationEvidenceRef[];
  explanation: string;
}

export interface PropertyClassificationTag {
  name: PropertyTagName;
  state: "deterministic" | "inferred";
  confidence: ClassificationConfidence;
  evidence: ClassificationEvidenceRef[];
  explanation: string;
}

export interface PropertyClassification {
  schemaVersion: 1;
  shadowMode: true;
  subjectScope: AssessmentSubject["scope"];
  overallConfidence: ClassificationConfidence;
  parcelUse: ClassifiedValue<ParcelUse>;
  buildingForm: ClassifiedValue<BuildingForm>;
  unitUse: ClassifiedValue<UnitUse>;
  listingScope: ClassifiedValue<ListingScope>;
  occupancySignal: ClassifiedValue<OccupancySignal>;
  tags: PropertyClassificationTag[];
}

export interface PropertyClassificationFacts {
  activeListing?: boolean;
  lastSaleDate?: string | null;
  hasSuite?: boolean;
  yearBuilt?: number | string | null;
  /** Fixed by fixtures/replays so time-based tags remain reproducible. */
  asOfDate?: string | Date;
}

interface MappedValue<T extends string> {
  value: T;
  confidence: ClassificationConfidence;
  explanation: string;
}

type AvailableStringEvidence = AvailableEvidence<string>;

function availableStrings(items: PropertyEvidenceSnapshot["propertyTypes"]): AvailableStringEvidence[] {
  return items.filter((item): item is AvailableStringEvidence => item.availability === "available");
}

function ref(item: AvailableEvidence<string | number | boolean>): ClassificationEvidenceRef {
  return {
    source: item.source,
    scope: item.scope,
    kind: item.kind,
    value: item.value,
    ...(item.sourceRecordId ? { sourceRecordId: item.sourceRecordId } : {}),
  };
}

function unknown<T extends string>(
  value: T,
  scope: ClassificationDimensionScope,
  explanation: string
): ClassifiedValue<T> {
  return { value, scope, state: "unknown", confidence: "low", evidence: [], explanation };
}

function classifyMapped<T extends string>(
  evidence: AvailableStringEvidence[],
  mapper: (value: string) => MappedValue<T> | null,
  unknownValue: T,
  scope: ClassificationDimensionScope,
  dimension: string
): ClassifiedValue<T> {
  const mapped = evidence.flatMap((item) => {
    const result = mapper(item.value);
    return result ? [{ item, result }] : [];
  });
  if (mapped.length === 0) {
    return unknown(unknownValue, scope, `No scoped property-type evidence establishes ${dimension}.`);
  }

  const distinct = [...new Set(mapped.map(({ result }) => result.value))];
  if (distinct.length > 1) {
    return {
      value: unknownValue,
      scope,
      state: "conflicting",
      confidence: "low",
      evidence: mapped.map(({ item }) => ref(item)),
      explanation: `Conflicting evidence maps to multiple ${dimension} values: ${distinct.join(", ")}.`,
    };
  }

  const confidence = mapped.every(({ result }) => result.confidence === "high") ? "high" : "medium";
  return {
    value: distinct[0],
    scope,
    state: confidence === "high" ? "deterministic" : "inferred",
    confidence,
    evidence: mapped.map(({ item }) => ref(item)),
    explanation: mapped.map(({ result }) => result.explanation).join(" "),
  };
}

function mapParcelUse(raw: string): MappedValue<Exclude<ParcelUse, "unknown">> | null {
  const value = raw.toLowerCase();
  if (
    /\b(vacant(?: land| lot)?|residential lot|commercial lot|land only|raw land|acreage|agricultur)/.test(value) ||
    /^(land|lot)$/.test(value.trim())
  ) {
    return { value: "land", confidence: "high", explanation: `“${raw}” explicitly indicates land use.` };
  }
  if (/\b(mixed[ -]?use|residential.*commercial|commercial.*residential)/.test(value)) {
    return { value: "mixed-use", confidence: "high", explanation: `“${raw}” explicitly indicates mixed use.` };
  }
  if (/\b(government|municipal|institutional|school|hospital|religious|church|utility|exempt)/.test(value)) {
    return { value: "institutional", confidence: "high", explanation: `“${raw}” indicates institutional use.` };
  }
  if (/\b(commercial|office|retail|industrial|warehouse|hotel|motel)/.test(value)) {
    return { value: "commercial", confidence: "high", explanation: `“${raw}” indicates non-residential commercial use.` };
  }
  if (/\b(residential|single[ -]?family|detached|town(?:house|home)|condo(?:minium)?|apartment|multi[ -]?family|duplex|triplex|fourplex|quadruplex|row house)/.test(value)) {
    return { value: "residential", confidence: "high", explanation: `“${raw}” indicates residential use.` };
  }
  return null;
}

function mapBuildingForm(raw: string): MappedValue<Exclude<BuildingForm, "unknown">> | null {
  const value = raw.toLowerCase();
  if (/\bmixed[ -]?use/.test(value)) {
    return { value: "mixed-use", confidence: "high", explanation: `“${raw}” explicitly describes a mixed-use building.` };
  }
  if (/\b(single[ -]?family|detached|bungalow)/.test(value)) {
    return { value: "detached", confidence: "high", explanation: `“${raw}” describes detached form.` };
  }
  if (/\b(town(?:house|home)|row house|semi[ -]?detached)/.test(value)) {
    return { value: "attached", confidence: "high", explanation: `“${raw}” describes attached form.` };
  }
  if (/\b(duplex|triplex|fourplex|quadruplex|low[ -]?rise|multi[ -]?family)/.test(value)) {
    return { value: "low-rise multi-unit", confidence: "medium", explanation: `“${raw}” suggests low-rise multi-unit form.` };
  }
  if (/\b(apartment|condo(?:minium)?)/.test(value)) {
    return { value: "apartment", confidence: "medium", explanation: `“${raw}” suggests apartment/condominium form but does not prove building height.` };
  }
  if (/\b(commercial|office|retail|industrial|warehouse|hotel|institutional|government|school|hospital)/.test(value)) {
    return { value: "other", confidence: "medium", explanation: `“${raw}” establishes a non-residential form outside the residential form taxonomy.` };
  }
  return null;
}

function mapUnitUse(raw: string): MappedValue<Exclude<UnitUse, "unknown">> | null {
  const parcel = mapParcelUse(raw);
  if (!parcel) return null;
  if (parcel.value === "residential") {
    return { value: "residential", confidence: "high", explanation: `Listing evidence “${raw}” identifies residential unit use.` };
  }
  if (parcel.value === "commercial") {
    return { value: "commercial", confidence: "high", explanation: `Listing evidence “${raw}” identifies commercial unit use.` };
  }
  if (parcel.value === "institutional" || parcel.value === "land") {
    return { value: "other", confidence: "medium", explanation: `Listing evidence “${raw}” is not a residential or commercial unit.` };
  }
  return null;
}

function classifyListingScope(
  subject: AssessmentSubject,
  listingEvidence: AvailableStringEvidence[]
): ClassifiedValue<ListingScope> {
  const hasListing = subject.candidates.some((item) => item.scope === "listing");
  if (!hasListing) return unknown("unknown", "listing", "No listing candidate exists for the resolved subject.");
  if (subject.unit) {
    return {
      value: "unit",
      scope: "listing",
      state: "deterministic",
      confidence: "high",
      evidence: [{ source: "assessment_subject", scope: subject.scope, kind: "observed", value: subject.unit }],
      explanation: `The resolved listing carries explicit unit ${subject.unit}.`,
    };
  }

  const mapped = listingEvidence.map((item) => ({ item, use: mapParcelUse(item.value), form: mapBuildingForm(item.value) }));
  const land = mapped.find(({ use }) => use?.value === "land");
  if (land) {
    return {
      value: "parcel",
      scope: "listing",
      state: "deterministic",
      confidence: "high",
      evidence: [ref(land.item)],
      explanation: "The listing explicitly describes land rather than a building or unit.",
    };
  }
  const wholeBuilding = mapped.filter(({ form, use }) =>
    form?.value === "detached" ||
    form?.value === "low-rise multi-unit" ||
    form?.value === "mixed-use" ||
    use?.value === "commercial" ||
    use?.value === "institutional"
  );
  const explicitApartmentBuilding = mapped.filter(({ item }) =>
    /\b(?:apartment|condo(?:minium)?)[ -]?building\b|\bbuilding[ -]?(?:apartment|condo(?:minium)?)\b/i.test(item.value)
  );
  wholeBuilding.push(...explicitApartmentBuilding.filter(({ item }) =>
    !wholeBuilding.some((candidate) => candidate.item === item)
  ));
  if (wholeBuilding.length > 0) {
    const highConfidence = wholeBuilding.every(({ item, form }) =>
      form?.confidence === "high" || explicitApartmentBuilding.some((candidate) => candidate.item === item)
    );
    return {
      value: "whole building",
      scope: "listing",
      state: highConfidence ? "deterministic" : "inferred",
      confidence: highConfidence ? "high" : "medium",
      evidence: wholeBuilding.map(({ item }) => ref(item)),
      explanation: "The no-unit listing evidence describes a whole-building subject.",
    };
  }
  return unknown("unknown", "listing", "A no-unit listing exists, but its evidence does not distinguish a unit from a whole building.");
}

function classifyOccupancy(evidence: PropertyEvidenceSnapshot): ClassifiedValue<OccupancySignal> {
  const available = evidence.occupancy.filter(
    (item): item is AvailableEvidence<boolean> => item.availability === "available"
  );
  if (available.length === 0) {
    return unknown("unknown", "provider_record", "No occupancy evidence is available. Occupancy is never inferred from user intent.");
  }
  const values = new Set(available.map((item) => item.value));
  if (values.size > 1) {
    return {
      value: "conflicting",
      scope: "provider_record",
      state: "conflicting",
      confidence: "low",
      evidence: available.map((item) => ref(item)),
      explanation: "Available occupancy observations disagree.",
    };
  }
  const ownerOccupied = available[0].value;
  return {
    value: ownerOccupied ? "owner-occupied" : "non-owner-occupied",
    scope: "provider_record",
    state: "deterministic",
    confidence: "high",
    evidence: available.map((item) => ref(item)),
    explanation: ownerOccupied
      ? "The provider record marks the property owner-occupied. This does not establish user intent."
      : "The provider record marks the property non-owner-occupied. This is not proof that it is a rental.",
  };
}

function detectTags(
  evidence: PropertyEvidenceSnapshot,
  facts: PropertyClassificationFacts
): PropertyClassificationTag[] {
  const tags: PropertyClassificationTag[] = [];
  const asOf = facts.asOfDate ? new Date(facts.asOfDate) : new Date();
  const asOfTime = asOf.getTime();
  const asOfYear = Number.isFinite(asOfTime) ? asOf.getFullYear() : new Date().getFullYear();
  const yearBuilt = Number(facts.yearBuilt);
  if (Number.isFinite(yearBuilt) && yearBuilt >= asOfYear - 3) {
    tags.push({
      name: "recent build",
      state: "deterministic",
      confidence: "high",
      evidence: [{ source: "listing_or_property_record", scope: "subject", kind: "observed", value: yearBuilt }],
      explanation: `Year built ${yearBuilt} falls within the last three years.`,
    });
  }
  if (facts.hasSuite) {
    tags.push({
      name: "suite signal",
      state: "inferred",
      confidence: "medium",
      evidence: [{ source: "listing_text_signal", scope: "listing", kind: "inferred", value: true }],
      explanation: "Listing language contains a suite-related signal; legality and occupancy are not established.",
    });
  }
  if (facts.activeListing && facts.lastSaleDate) {
    const soldAt = new Date(facts.lastSaleDate);
    const holdYears = (asOfTime - soldAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (Number.isFinite(holdYears) && holdYears >= 0 && holdYears < 2) {
      tags.push({
        name: "short-hold resale pattern",
        state: "inferred",
        confidence: "medium",
        evidence: [{ source: "sale_history", scope: "provider_record", kind: "observed", value: facts.lastSaleDate }],
        explanation: `The property returned to the market after roughly ${holdYears.toFixed(1)} years; this is not proof of a flip.`,
      });
    }
  }

  const lands = evidence.landValues.filter(
    (item): item is AvailableEvidence<number> => item.availability === "available"
  );
  const buildings = evidence.buildingValues.filter(
    (item): item is AvailableEvidence<number> => item.availability === "available"
  );
  for (const land of lands) {
    const building = buildings.find((item) =>
      item.source === land.source && item.sourceRecordId === land.sourceRecordId
    );
    if (!building || land.value + building.value <= 0) continue;
    const ratio = land.value / (land.value + building.value);
    if (ratio >= 0.75) {
      tags.push({
        name: "high land-to-improvement ratio",
        state: "inferred",
        confidence: "medium",
        evidence: [ref(land), ref(building)],
        explanation: `Land is ${(ratio * 100).toFixed(0)}% of the supplied land-plus-improvement value; this is a teardown/land-play signal, not proof.`,
      });
      break;
    }
  }
  return tags;
}

function overallConfidence(fields: Array<ClassifiedValue<string>>): ClassificationConfidence {
  if (fields.some((field) => field.state === "conflicting")) return "low";
  if (fields.some((field) => field.confidence === "high" && field.state !== "unknown")) return "high";
  if (fields.some((field) => field.confidence === "medium" && field.state !== "unknown")) return "medium";
  return "low";
}

export function classifyProperty(args: {
  subject: AssessmentSubject;
  evidence: PropertyEvidenceSnapshot;
  facts?: PropertyClassificationFacts;
}): PropertyClassification {
  const propertyTypes = availableStrings(args.evidence.propertyTypes);
  const parcelEvidence = propertyTypes.filter((item) => item.scope === "provider_record" || item.scope === "parcel");
  // A unit listing describes the unit, not necessarily its containing
  // building. Keep those evidence scopes separate so "residential condo"
  // beside a "mixed-use" property record is not treated as a contradiction.
  const buildingEvidence = propertyTypes.filter((item) =>
    item.scope === "provider_record" || (!args.subject.unit && item.scope === "listing")
  );
  const listingEvidence = propertyTypes.filter((item) => item.scope === "listing");
  const unitEvidence = args.subject.unit ? listingEvidence : [];

  const parcelUse = classifyMapped(parcelEvidence, mapParcelUse, "unknown", "parcel", "parcel use");
  const buildingForm = classifyMapped(buildingEvidence, mapBuildingForm, "unknown", "building", "building form");
  const unitUse = args.subject.unit
    ? classifyMapped(unitEvidence, mapUnitUse, "unknown", "unit", "unit use")
    : unknown<UnitUse>("unknown", "unit", "The resolved subject does not identify a unit.");
  const listingScope = classifyListingScope(args.subject, listingEvidence);
  const occupancySignal = classifyOccupancy(args.evidence);

  return {
    schemaVersion: 1,
    shadowMode: true,
    subjectScope: args.subject.scope,
    overallConfidence: overallConfidence([parcelUse, buildingForm, unitUse, listingScope]),
    parcelUse,
    buildingForm,
    unitUse,
    listingScope,
    occupancySignal,
    tags: detectTags(args.evidence, args.facts ?? {}),
  };
}
