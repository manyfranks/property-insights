import { Assessment } from "../types";

// ---------------------------------------------------------------------------
// Manitoba (City of Winnipeg) assessment adapter — SODA "Assessment Parcels"
// dataset (data.winnipeg.ca, resource d4mq-wa44, ~145k rows, Canada Open
// Government Licence). No cache exists for MB yet (unlike BC/AB/ON), so this
// is a live-only adapter: lookupMBSync always returns null, lookupMB hits
// the SODA API directly. Scope is City of Winnipeg parcels only — Manitoba
// addresses outside Winnipeg will simply miss (same "best-effort, city-
// scoped dataset" shape as AB's Calgary/Edmonton/Lethbridge adapters, which
// don't cover the whole province either).
// ---------------------------------------------------------------------------

const WINNIPEG_DATASET = "winnipeg d4mq-wa44";
const WINNIPEG_RESOURCE_URL = "https://data.winnipeg.ca/resource/d4mq-wa44.json";

// SODA response shape assertion — mirrors ab.ts's SodaShapeError. Separates
// "no matching parcel" (data.length === 0, a normal outcome) from "found a
// record but total_assessed_value is missing/non-numeric" (real API drift).
// Thrown loudly (logged, then surfaced as this error type) so drift doesn't
// silently masquerade as "no result" — callers still catch it and degrade to
// null (see lookupMB's outer try/catch), but the [mb-soda-shape] log line is
// left behind for diagnosis.
export class MbSodaShapeError extends Error {
  constructor(context: string) {
    super(`[mb-soda-shape] ${WINNIPEG_DATASET}: record found but total_assessed_value missing/invalid (${context})`);
    this.name = "MbSodaShapeError";
  }
}

function extractTotalAssessedValue(record: Record<string, unknown>): number | null {
  const raw = record.total_assessed_value;
  if (raw === undefined || raw === null || raw === "") {
    console.error(`[mb-soda-shape] ${WINNIPEG_DATASET}: record has no total_assessed_value field — API shape may have changed. Keys present: [${Object.keys(record).join(", ")}]`);
    throw new MbSodaShapeError("field absent");
  }
  const value = Math.round(parseFloat(String(raw)));
  if (!Number.isFinite(value)) {
    console.error(`[mb-soda-shape] ${WINNIPEG_DATASET}: total_assessed_value="${raw}" did not parse to a finite number`);
    throw new MbSodaShapeError(`unparseable value "${raw}"`);
  }
  // total_assessed_value is the parcel-level sum across all classes on the
  // roll (assessed_value_1..5 for mixed residential/farm/commercial parcels)
  // — that's the right figure for an acquisition tool (whole-parcel taxable
  // value), not any single class component. A value <=0 is a legitimate (if
  // unusual) data point, not a shape violation — treat as "no usable
  // assessment" rather than an error, same as ab.ts.
  if (value <= 0) return null;
  return value;
}

function escapeSoql(value: string): string {
  return value.replace(/'/g, "''");
}

// Winnipeg's Assessment Parcels dataset spells street types out in full
// ("AVENUE", "STREET", "DRIVE"...) — same convention as Edmonton's SODA
// dataset. Keyed as exact-token lookups (not whole-string regex replace)
// because Winnipeg has real street *names* that start with "ST" ("ST MARY'S
// ROAD", "ST ANNE'S ROAD") — a blind `\bST\b -> STREET` replace like
// Edmonton's would corrupt those. Only the final address token (the type
// suffix) gets expanded.
const STREET_TYPE_ABBREVS: Record<string, string> = {
  ST: "STREET",
  AVE: "AVENUE",
  AV: "AVENUE",
  DR: "DRIVE",
  RD: "ROAD",
  CRES: "CRESCENT",
  CR: "CRESCENT",
  BLVD: "BOULEVARD",
  BV: "BOULEVARD",
  PL: "PLACE",
  WY: "WAY",
  CV: "COVE",
  HWY: "HIGHWAY",
  LN: "LANE",
  CRT: "COURT",
  CT: "COURT",
  TR: "TRAIL",
  TRL: "TRAIL",
  GA: "GATE",
  CL: "CLOSE",
  PT: "POINT",
};

// Dataset stores directionals as a single letter in street_direction
// (N/S/E/W only — confirmed via live probe, no full-word directions present).
const DIRECTION_MAP: Record<string, string> = {
  N: "N", NORTH: "N",
  S: "S", SOUTH: "S",
  E: "E", EAST: "E",
  W: "W", WEST: "W",
};

interface ParsedWinnipegAddress {
  houseNumber: string;
  streetName: string;
  streetType: string;
  direction: string | null;
  unit: string | null;
}

/**
 * Parse+normalize a free-form address into the pieces the SODA dataset
 * indexes on. Handles unit prefixes ("5-123 Main St", "#5 123 Main St")
 * and trailing directionals ("6 Riverside Drive E").
 */
function normalizeWinnipegAddress(address: string, unitParam?: string): ParsedWinnipegAddress | null {
  let cleaned = address.trim().toUpperCase().replace(/^UNIT\s+/, "").replace(/^#/, "");
  cleaned = cleaned.replace(/,\s*/g, " ").replace(/\s+/g, " ").trim();

  let unit: string | null = unitParam ? unitParam.toUpperCase() : null;

  // Dash-prefixed unit: "5-123 MAIN ST" -> unit=5, rest="123 MAIN ST"
  const dashUnitMatch = cleaned.match(/^(\d+[A-Z]?)-(\d+.*)$/);
  if (dashUnitMatch) {
    if (!unit) unit = dashUnitMatch[1];
    cleaned = dashUnitMatch[2];
  }

  const parts = cleaned.match(/^(\d+[A-Z]?)\s+(.+)$/);
  if (!parts) return null;

  const houseNumber = parts[1];
  const tokens = parts[2].split(" ").filter(Boolean);
  if (tokens.length < 1) return null;

  let direction: string | null = null;
  if (tokens.length > 1 && DIRECTION_MAP[tokens[tokens.length - 1]]) {
    direction = DIRECTION_MAP[tokens.pop()!];
  }

  let streetType = tokens.pop() || "";
  streetType = STREET_TYPE_ABBREVS[streetType] || streetType;

  const streetName = tokens.join(" ");
  if (!streetName) return null;

  return { houseNumber, streetName, streetType, direction, unit };
}

async function queryWinnipeg(where: string): Promise<Assessment | null> {
  const url = new URL(WINNIPEG_RESOURCE_URL);
  url.searchParams.set("$where", where);
  url.searchParams.set("$limit", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data)) {
    console.error(`[mb-soda-shape] ${WINNIPEG_DATASET}: response was not an array — got ${typeof data}. API shape may have changed.`);
    throw new MbSodaShapeError(`response type ${typeof data}`);
  }
  if (!data.length) return null;

  const value = extractTotalAssessedValue(data[0]);
  if (value === null) return null;

  return {
    totalValue: value,
    landValue: 0,
    buildingValue: 0,
    assessmentYear: String(data[0].current_assessment_year ?? "2027"),
    found: true,
    source: "government" as const,
  };
}

/**
 * Sync cache-only lookup — no MB cache exists yet (unlike BC/AB/ON), so this
 * always returns null. Mirrors how the registry expects lookupSync to
 * degrade gracefully (index.ts falls through to the StatCan area-median
 * fallback when the adapter's sync path misses).
 */
export function lookupMBSync(_address: string, _unit?: string): Assessment | null {
  return null;
}

/**
 * Async lookup — live SODA query only (no cache to check first).
 *
 * Strategy: prefer full_address prefix matching (most specific — includes
 * unit, house number, street name, type, and direction in one indexed
 * field), falling back to street_number + street_name if the type/format
 * guess doesn't line up with the dataset's record.
 */
export async function lookupMB(address: string, unit?: string, _city?: string): Promise<Assessment | null> {
  try {
    const parsed = normalizeWinnipegAddress(address, unit);
    if (!parsed) return null;
    const { houseNumber, streetName, streetType, direction, unit: parsedUnit } = parsed;

    const basePrefix = `${houseNumber} ${streetName} ${streetType}`;

    // 1. Full_address prefix match, unit included when we have one.
    if (parsedUnit) {
      const withUnit = `${parsedUnit}-${basePrefix}`;
      const result = await queryWinnipeg(
        `starts_with(upper(full_address), upper('${escapeSoql(withUnit)}'))`
      );
      if (result) return result;
    }

    // 2. Full_address prefix match without unit (covers no-unit addresses,
    //    and unit mismatches where the roll doesn't carry a unit_number).
    const result = await queryWinnipeg(
      `starts_with(upper(full_address), upper('${escapeSoql(basePrefix)}'))`
    );
    if (result) return result;

    // 3. Fallback: exact street_number + street_name match (handles cases
    //    where our street-type guess doesn't match the dataset's spelling).
    let nameWhere = `street_number='${escapeSoql(houseNumber)}' AND upper(street_name)=upper('${escapeSoql(streetName)}')`;
    if (direction) nameWhere += ` AND upper(street_direction)='${direction}'`;
    const nameResult = await queryWinnipeg(nameWhere);
    if (nameResult) return nameResult;

    return null;
  } catch {
    return null;
  }
}
