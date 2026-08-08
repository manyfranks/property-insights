import { Assessment } from "../types";
import { lookupBC, lookupBCSync } from "./bc";
import { lookupON, lookupONSync } from "./on";
import { lookupAB, lookupABSync } from "./ab";
import { lookupUS, lookupUSSync, isUSState } from "./us";
import { getStatCanMedian } from "../data/statcan-chsp";
import { AssessmentAdapter, AssessmentLookupInput } from "./types";

// ---------------------------------------------------------------------------
// Adapter registry — one entry per region code. Each province module keeps
// its own historical function signature (they differ from each other, a
// known footgun); the wrapper below is the only place that adapts them to
// the common AssessmentLookupInput/AssessmentAdapter shape. Room to add
// "US-NY", "US-TX", etc. here in a later phase without touching callers.
// ---------------------------------------------------------------------------

const bcAdapter: AssessmentAdapter = {
  lookup: (input) => lookupBC(input.address, input.city, input.unit),
  lookupSync: (input) => lookupBCSync(input.address, input.unit),
};

const onAdapter: AssessmentAdapter = {
  lookup: async (input) => lookupON(input.address, input.unit, input.city, input.taxes),
  lookupSync: (input) => lookupONSync(input.address, input.unit, input.city, input.taxes),
};

const abAdapter: AssessmentAdapter = {
  lookup: (input) => lookupAB(input.address, input.unit, input.city),
  lookupSync: (input) => lookupABSync(input.address, input.unit),
};

// One shared adapter for all 50 US states + DC — see isUSState() in ./us
// for why this is a dispatch check rather than 51 registry entries.
const usAdapter: AssessmentAdapter = {
  lookup: (input) => lookupUS(input.address, input.city, input.region),
  lookupSync: () => lookupUSSync(),
};

const ADAPTERS: Record<string, AssessmentAdapter> = {
  BC: bcAdapter,
  ON: onAdapter,
  AB: abAdapter,
};

/** Look up the adapter for a region code, routing every US state/DC code
 * to the shared US adapter without needing 51 registry entries. */
function resolveAdapter(region: string): AssessmentAdapter | undefined {
  if (isUSState(region)) return usAdapter;
  return ADAPTERS[region];
}

/**
 * Attach assessmentBasis/evidenceClass to a result based on its source,
 * without clobbering values an adapter already set explicitly.
 */
function withEvidence(result: Assessment | null): Assessment | null {
  if (!result) return null;

  let evidenceClass: Assessment["evidenceClass"];
  switch (result.source) {
    case "government":
    case "cache":
      evidenceClass = "observed";
      break;
    case "tax_reverse":
      evidenceClass = "derived";
      break;
    case "area_median":
      evidenceClass = "modeled";
      break;
    default:
      evidenceClass = undefined;
  }

  return {
    ...result,
    assessmentBasis: result.assessmentBasis ?? "market_value",
    evidenceClass: result.evidenceClass ?? evidenceClass,
  };
}

function areaMedianFallback(city?: string): Assessment | null {
  if (!city) return null;
  const median = getStatCanMedian(city);
  if (!median) return null;
  return {
    totalValue: median.medianAssessment,
    landValue: 0,
    buildingValue: 0,
    assessmentYear: median.year,
    found: true,
    source: "area_median",
  };
}

/**
 * Async lookup — tries the region's adapter first, then StatCan area median.
 * Use in API routes where async is fine.
 *
 * External signature is unchanged from the pre-refactor version so existing
 * call sites keep compiling as-is; internally this now routes through the
 * ADAPTERS registry.
 */
export async function lookupAssessment(
  address: string,
  province: string,
  city?: string,
  unit?: string,
  taxes?: string
): Promise<Assessment | null> {
  const input: AssessmentLookupInput = { address, city, unit, taxes, region: province };
  const adapter = resolveAdapter(province);

  const result = adapter ? await adapter.lookup(input) : null;
  if (result) return withEvidence(result);

  // Last resort: StatCan area median (city-level, not property-specific).
  // US-only: the US adapter already resolves to a county-level ACS median
  // itself, so a StatCan (Canada-only) fallback would never match and is
  // skipped rather than wastefully queried.
  if (isUSState(province)) return null;
  return withEvidence(areaMedianFallback(city));
}

/**
 * Sync cache-only lookup — for preloaded data path (server components, dashboard).
 * Falls back to StatCan area median if cache misses.
 *
 * External signature (note: unit before city, opposite of lookupAssessment)
 * is unchanged so existing call sites keep compiling as-is.
 */
export function lookupAssessmentSync(
  address: string,
  province: string,
  unit?: string,
  city?: string,
  taxes?: string
): Assessment | null {
  const input: AssessmentLookupInput = { address, city, unit, taxes, region: province };
  const adapter = resolveAdapter(province);

  const result = adapter ? adapter.lookupSync(input) : null;
  if (result) return withEvidence(result);

  if (isUSState(province)) return null;
  return withEvidence(areaMedianFallback(city));
}
