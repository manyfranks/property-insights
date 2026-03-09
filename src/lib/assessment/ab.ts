import { Assessment } from "../types";
import { AB_ASSESSMENT_CACHE } from "../data/assessments";

// Street type abbreviations: our listings use mixed formats, SODA APIs use specific ones
const CALGARY_ABBREVS: [RegExp, string][] = [
  [/\bStreet\b/gi, "ST"],
  [/\bAvenue\b/gi, "AV"],
  [/\bDrive\b/gi, "DR"],
  [/\bPlace\b/gi, "PL"],
  [/\bCrescent\b/gi, "CR"],
  [/\bTerrace\b/gi, "TERR"],
  [/\bBoulevard\b/gi, "BV"],
  [/\bCourt\b/gi, "CT"],
  [/\bRoad\b/gi, "RD"],
  [/\bClose\b/gi, "CL"],
  [/\bCircle\b/gi, "CI"],
  [/\bGreen\b/gi, "GR"],
  [/\bGate\b/gi, "GA"],
  [/\bWay\b/gi, "WY"],
  [/\bTrail\b/gi, "TR"],
  [/\bLane\b/gi, "LA"],
  [/\bPoint\b/gi, "PT"],
  [/\bHeights\b/gi, "HT"],
  [/\bRise\b/gi, "RI"],
  [/\bGrove\b/gi, "GV"],
  [/\bCove\b/gi, "CV"],
  [/\bMews\b/gi, "ME"],
  [/\bLink\b/gi, "LK"],
  [/\bPark\b/gi, "PK"],
  [/\bHeath\b/gi, "HE"],
  [/\bView\b/gi, "VW"],
  [/\bSquare\b/gi, "SQ"],
  [/\bLanding\b/gi, "LD"],
  [/\bManor\b/gi, "MR"],
];

const EDMONTON_ABBREVS: [RegExp, string][] = [
  [/\bST\b/gi, "STREET"],
  [/\bAV\b/gi, "AVENUE"],
  [/\bDR\b/gi, "DRIVE"],
  [/\bPL\b/gi, "PLACE"],
  [/\bCR\b/gi, "CRESCENT"],
  [/\bBV\b/gi, "BOULEVARD"],
  [/\bRD\b/gi, "ROAD"],
  [/\bCL\b/gi, "CLOSE"],
  [/\bCRT\b/gi, "COURT"],
  [/\bCT\b/gi, "COURT"],
  [/\bTERR\b/gi, "TERRACE"],
  [/\bWY\b/gi, "WAY"],
  [/\bLA\b/gi, "LANE"],
  [/\bTR\b/gi, "TRAIL"],
  [/\bGR\b/gi, "GREEN"],
  [/\bGA\b/gi, "GATE"],
  [/\bPT\b/gi, "POINT"],
  [/\bHT\b/gi, "HEIGHTS"],
  [/\bRI\b/gi, "RISE"],
  [/\bGV\b/gi, "GROVE"],
  [/\bCV\b/gi, "COVE"],
];

/**
 * Sync cache-only lookup.
 */
export function lookupABSync(address: string, unit?: string): Assessment | null {
  const bare = address.replace(/^\d+[A-Z]?-/i, "");
  const cacheKeys = unit
    ? [address, `${unit}, ${bare}`, `#${unit} ${bare}`, bare]
    : [address, bare];
  for (const key of cacheKeys) {
    const cached = AB_ASSESSMENT_CACHE[key];
    if (cached) {
      return {
        totalValue: cached.total,
        landValue: cached.land,
        buildingValue: cached.building,
        assessmentYear: "2025",
        found: true,
      };
    }
  }
  return null;
}

/**
 * Async lookup — tries cache first, then live SODA/ArcGIS API.
 */
export async function lookupAB(address: string, unit?: string, city?: string): Promise<Assessment | null> {
  const cached = lookupABSync(address, unit);
  if (cached) return cached;

  // Lethbridge: no quadrant, uses ArcGIS
  if (city?.toLowerCase() === "lethbridge") {
    return lookupLethbridgeArcGIS(address, unit);
  }

  // Calgary/Edmonton: require NW/NE/SW/SE quadrant
  const quadrant = address.match(/\b(NW|NE|SW|SE)\b/i)?.[1]?.toUpperCase();
  if (!quadrant) return null;

  // Try Calgary first (most of our AB listings), then Edmonton
  const result = await lookupCalgarySODA(address, unit) ?? await lookupEdmontonSODA(address, unit);
  return result;
}

/**
 * Calgary SODA API — dataset 4bsw-nn7w
 * Address format: "3410 1 ST NW" (unit prefix if applicable: "108 150 LEBEL CR NW")
 */
async function lookupCalgarySODA(address: string, _unit?: string): Promise<Assessment | null> {
  try {
    // Normalize: strip unit prefix (dash or #), apply Calgary abbreviations, uppercase
    // "106-150 LEBEL CR NW" → "150 LEBEL CR NW"
    let normalized = address.replace(/^\d+[A-Z]?-/i, "").replace(/^#/, "").trim().toUpperCase();
    for (const [pat, repl] of CALGARY_ABBREVS) {
      normalized = normalized.replace(pat, repl);
    }
    // Remove comma-space format: "108, 150 Lebel" -> "108 150 LEBEL"
    normalized = normalized.replace(/,\s*/g, " ");

    // Extract house number + street name for starts_with prefix.
    // "149 MITCHELL RD NW" → houseAndStreet = "149 MITCHELL"
    // starts_with is indexed (~600ms) vs exact match (~17s, always times out).
    const parts = normalized.match(/^(\d+)\s+([A-Z]+)/);
    if (!parts) return null;
    const prefix = `${parts[1]} ${parts[2]}`;

    const where = `starts_with(address, '${prefix}') AND assessment_class='RE'`;
    const result = await queryCalgary(where);
    if (result) return result;

    return null;
  } catch {
    return null;
  }
}

async function queryCalgary(where: string): Promise<Assessment | null> {
  const url = new URL("https://data.calgary.ca/resource/4bsw-nn7w.json");
  url.searchParams.set("$where", where);
  url.searchParams.set("$limit", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data?.length) return null;

  const value = Math.round(parseFloat(data[0].assessed_value));
  if (!value || value <= 0) return null;

  return {
    totalValue: value,
    landValue: 0,
    buildingValue: 0,
    assessmentYear: data[0].roll_year || "2026",
    found: true,
  };
}

/**
 * Edmonton SODA API — dataset q7d6-ambg
 * Uses separate house_number + street_name fields, optional suite field.
 * Street names use full words: "109 STREET NW" not "109 ST NW"
 */
async function lookupEdmontonSODA(address: string, unit?: string): Promise<Assessment | null> {
  try {
    // Parse address: "#1801 9939 109 ST NW" or "1801-9939 109 ST NW" -> suite=1801, house=9939, street="109 STREET NW"
    // Strip dash-prefix unit: "106-9939 109 ST NW" → "9939 109 ST NW"
    let cleaned = address.replace(/^\d+[A-Z]?-/i, "").replace(/^#/, "").trim().toUpperCase();

    // Extract suite/unit: prefer explicit unit param, fall back to address prefix extraction
    let suite: string | null = unit?.toUpperCase() || null;
    const unitMatch = cleaned.match(/^(\d+[A-Z]?)\s+(\d+\s+.+)$/);
    if (unitMatch) {
      if (!suite) suite = unitMatch[1];
      cleaned = unitMatch[2];
    }

    // Split into house number and street name
    const parts = cleaned.match(/^(\d+)\s+(.+)$/);
    if (!parts) return null;

    const houseNumber = parts[1];
    let streetName = parts[2];

    // Expand abbreviations for Edmonton format
    for (const [pat, repl] of EDMONTON_ABBREVS) {
      streetName = streetName.replace(pat, repl);
    }

    // Try exact match first
    const exact = await queryEdmonton(houseNumber, streetName, suite);
    if (exact) return exact;

    // Fuzzy fallback: try without suite
    if (suite) {
      const noSuite = await queryEdmonton(houseNumber, streetName, null);
      if (noSuite) return noSuite;
    }

    return null;
  } catch {
    return null;
  }
}

async function queryEdmonton(
  houseNumber: string,
  streetName: string,
  suite: string | null
): Promise<Assessment | null> {
  const url = new URL("https://data.edmonton.ca/resource/q7d6-ambg.json");
  let where = `house_number='${houseNumber}' AND street_name='${streetName}'`;
  if (suite) {
    where += ` AND suite='${suite}'`;
  }
  url.searchParams.set("$where", where);
  url.searchParams.set("$limit", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data?.length) return null;

  const value = parseInt(data[0].assessed_value, 10);
  if (!value || value <= 0) return null;

  return {
    totalValue: value,
    landValue: 0,
    buildingValue: 0,
    assessmentYear: "2026",
    found: true,
  };
}

/**
 * Lethbridge ArcGIS Feature Service — PropertyInfo MapServer
 * No auth required. Returns CurrGrossAssess field.
 */
async function lookupLethbridgeArcGIS(
  address: string,
  _unit?: string
): Promise<Assessment | null> {
  try {
    // Strip unit prefix and normalize
    const bare = address.replace(/^\d+[A-Z]?-/i, "").trim().toUpperCase();
    // Extract house number + street for LIKE query
    const parts = bare.match(/^(\d+)\s+(.+)$/);
    if (!parts) return null;

    const searchAddr = `${parts[1]} ${parts[2]}`;
    const baseUrl = "https://gis.lethbridge.ca/gispublic/rest/services/PropertyInfo/PropertyInfo/MapServer/0/query";
    const url = new URL(baseUrl);
    url.searchParams.set("where", `Address LIKE '%${searchAddr}%'`);
    url.searchParams.set("outFields", "CurrGrossAssess,Address");
    url.searchParams.set("resultRecordCount", "1");
    url.searchParams.set("f", "json");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const features = data.features;
    if (!features?.length) return null;

    const value = features[0].attributes?.CurrGrossAssess;
    if (!value || value <= 0) return null;

    return {
      totalValue: Math.round(value),
      landValue: 0,
      buildingValue: 0,
      assessmentYear: "2026",
      found: true,
    };
  } catch {
    return null;
  }
}
