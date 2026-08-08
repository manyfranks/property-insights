/**
 * scripts/enrich-us-from-assessors.ts
 *
 * Phase 5 open-data-assessor pattern (docs/plans/08-EXECUTION-PHASEMAP.md)
 * applied to the cached US Discover listings (Austin/Miami/Phoenix, seeded
 * in KV by src/lib/pipeline/us-discover.ts). Enriches assessedValue/
 * marketValue/yearBuilt/lotSize from FREE county open-data sources — see
 * src/lib/assessment/us-county/{maricopa,miami-dade,travis}.ts for the
 * per-county adapters and their source-verification doc comments — at
 * zero RentCast quota cost and no per-request limit.
 *
 * SCOPE: all three metros are feasible. Phoenix (Maricopa) and Miami
 * (Miami-Dade) use live, address-indexed county GIS endpoints. Austin
 * (Travis) has no free live per-address API (confirmed dead end — see
 * travis.ts's doc comment) but TCAD publishes its full certified appraisal
 * roll as a free bulk-download ZIP; travis.ts downloads and indexes that
 * once per process (expect the first Austin lookup in a run to take
 * minutes, not milliseconds — see travis.ts's module doc) rather than
 * calling out per address.
 *
 * CONCURRENCY / ADDITIVE-ONLY CONTRACT: another in-flight change enriches
 * the same KV listings from RentCast (yearBuilt/taxes/lotSize/
 * preAssessment). This script NEVER overwrites a field that already has a
 * value — see applyResult() below, which re-reads the listing fresh from
 * KV immediately before every write and only fills fields that are still
 * empty at that moment, minimizing (not eliminating — KV has no
 * compare-and-swap here) the race window against concurrent writers.
 *
 * USAGE:
 *   npx tsx scripts/enrich-us-from-assessors.ts            # dry run (default)
 *   npx tsx scripts/enrich-us-from-assessors.ts --commit   # write to KV
 */

import { loadEnvLocal, sleep, COMMIT } from "./lib/ingest-shared";
loadEnvLocal();

import { getAllListings, upsertListing } from "../src/lib/kv/listings";
import { resolveCountyAdapter } from "../src/lib/assessment/us-county";
import { CountyAssessorResult } from "../src/lib/assessment/us-county/types";
import { assessmentBasisForState } from "../src/lib/rentcast";
import { US_DISCOVER_CITIES } from "../src/lib/data/city-metadata";
import { Listing } from "../src/lib/types";

// Polite rate limit against free public county/state GIS services — no
// documented quota (unlike RentCast), but these are shared government
// infrastructure, not commercial APIs built for high QPS.
const RATE_LIMIT_MS_MIN = 250;
const RATE_LIMIT_MS_JITTER = 250;

function jitteredDelay(): Promise<void> {
  return sleep(RATE_LIMIT_MS_MIN + Math.random() * RATE_LIMIT_MS_JITTER);
}

interface CityStats {
  city: string;
  state: string;
  adapterName: string;
  feasible: boolean;
  cached: number;
  alreadyEnriched: number;
  attempted: number;
  matched: number;
  fieldsPopulated: { yearBuilt: number; lotSize: number; taxes: number; assessment: number };
  examples: { address: string; result: CountyAssessorResult }[];
}

/**
 * Re-reads the listing fresh from KV, applies only the fields that are
 * still empty (additive-only — see module doc), and writes back via
 * upsertListing (only when COMMIT is set; dry runs compute the same "would
 * apply" decision without writing). Matches on address+city+province,
 * the same key upsertListing() itself uses internally.
 */
async function applyResult(
  address: string,
  city: string,
  province: string,
  result: CountyAssessorResult
): Promise<{ applied: boolean; fields: string[] }> {
  const all = await getAllListings();
  const idx = all.findIndex((l) => l.address === address && l.city === city && l.province === province);
  if (idx < 0) return { applied: false, fields: [] };

  const current = all[idx];
  const merged: Listing = { ...current };
  const fields: string[] = [];

  if (!current.yearBuilt && result.yearBuilt) {
    merged.yearBuilt = String(result.yearBuilt);
    fields.push("yearBuilt");
  }
  if (!current.lotSize && result.lotSize) {
    merged.lotSize = String(result.lotSize);
    fields.push("lotSize");
  }
  if (!current.taxes && result.annualTaxes) {
    merged.taxes = String(Math.round(result.annualTaxes));
    fields.push("taxes");
  }
  if (!current.preAssessment) {
    merged.preAssessment = {
      totalValue: result.assessedValue,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: result.assessmentYear,
      found: true,
      source: "government",
      evidenceClass: "observed",
      assessmentBasis: assessmentBasisForState(province),
    };
    merged.assessmentNote = `${result.assessmentYear}: $${result.assessedValue.toLocaleString()} assessed${
      result.marketValue ? ` ($${result.marketValue.toLocaleString()} market)` : ""
    } — county assessor`;
    fields.push("preAssessment");
  }

  if (fields.length === 0) return { applied: false, fields: [] };
  if (COMMIT) await upsertListing(merged);
  return { applied: true, fields };
}

async function enrichCity(cfg: { name: string; state: string }): Promise<CityStats> {
  const adapter = resolveCountyAdapter(cfg.name, cfg.state);
  const all = await getAllListings();
  const cityListings = all.filter((l) => l.city === cfg.name && l.province === cfg.state);

  const stat: CityStats = {
    city: cfg.name,
    state: cfg.state,
    adapterName: adapter?.name ?? "(no adapter registered)",
    feasible: !!adapter?.feasible,
    cached: cityListings.length,
    alreadyEnriched: 0,
    attempted: 0,
    matched: 0,
    fieldsPopulated: { yearBuilt: 0, lotSize: 0, taxes: 0, assessment: 0 },
    examples: [],
  };

  if (!adapter || !adapter.feasible) {
    console.log(
      `\n[${cfg.name}, ${cfg.state}] SKIPPED — ${stat.adapterName} (see src/lib/assessment/us-county/travis.ts doc comment)`
    );
    return stat;
  }

  console.log(`\n[${cfg.name}, ${cfg.state}] ${cityListings.length} cached listings — adapter: ${adapter.name}`);

  for (const listing of cityListings) {
    const alreadyFull = !!listing.yearBuilt && !!listing.lotSize && !!listing.preAssessment;
    if (alreadyFull) {
      stat.alreadyEnriched++;
      continue;
    }

    stat.attempted++;
    let result: CountyAssessorResult | null = null;
    try {
      result = await adapter.lookupByAddress(listing.address, listing.city);
    } catch (err) {
      console.error(`  [enrich-us] lookup threw for "${listing.address}": ${err instanceof Error ? err.message : String(err)}`);
    }

    if (result) {
      stat.matched++;
      const { applied, fields } = await applyResult(listing.address, listing.city, listing.province, result);
      if (applied) {
        for (const f of fields) {
          if (f === "preAssessment") stat.fieldsPopulated.assessment++;
          else stat.fieldsPopulated[f as "yearBuilt" | "lotSize" | "taxes"]++;
        }
        if (stat.examples.length < 2) stat.examples.push({ address: listing.address, result });
      }
    }

    await jitteredDelay();
  }

  return stat;
}

function printTable(stats: CityStats[]) {
  console.log(`\n${COMMIT ? "COMMITTED" : "DRY RUN (pass --commit to write)"} — results table\n`);
  const header = ["City", "Attempted", "Matched", "Match %", "yearBuilt", "lotSize", "taxes", "assessment"];
  const rows = stats.map((s) => [
    `${s.city}, ${s.state}${s.feasible ? "" : " (skipped)"}`,
    String(s.attempted),
    String(s.matched),
    s.attempted > 0 ? `${((s.matched / s.attempted) * 100).toFixed(1)}%` : "—",
    String(s.fieldsPopulated.yearBuilt),
    String(s.fieldsPopulated.lotSize),
    String(s.fieldsPopulated.taxes),
    String(s.fieldsPopulated.assessment),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(fmt(r));

  console.log(
    `\nNote: "taxes" (annual dollar tax amount) is not published by either free source used here — only\n` +
      `assessed/taxable VALUE, which would need the local millage rate to convert to a dollar bill (not in\n` +
      `either dataset). Left unset rather than estimated. See CountyAssessorResult.annualTaxes's doc comment\n` +
      `in src/lib/assessment/us-county/types.ts.`
  );

  console.log("\nExamples:");
  for (const s of stats) {
    for (const ex of s.examples) {
      console.log(
        `  [${s.city}] ${ex.address} -> assessedValue=$${ex.result.assessedValue.toLocaleString()}` +
          `${ex.result.marketValue ? ` marketValue=$${ex.result.marketValue.toLocaleString()}` : ""}` +
          `${ex.result.yearBuilt ? ` yearBuilt=${ex.result.yearBuilt}` : ""}` +
          `${ex.result.lotSize ? ` lotSize=${ex.result.lotSize}sqft` : ""}` +
          ` (${ex.result.assessmentYear})`
      );
    }
  }

  const totalAlreadyEnriched = stats.reduce((sum, s) => sum + s.alreadyEnriched, 0);
  if (totalAlreadyEnriched > 0) {
    console.log(
      `\n${totalAlreadyEnriched} cached listing(s) already had yearBuilt+lotSize+preAssessment populated ` +
        `(likely from the concurrent RentCast enrichment pass) and were skipped without an API call.`
    );
  }
}

/** Optional `--cities=austin,miami` filter (matches US_DISCOVER_CITIES'
 * `slug`) — lets a targeted re-run (e.g. after fixing one county's adapter)
 * skip the other metros' live API calls entirely instead of just running
 * them again for no reason. Omit for the original all-cities behavior. */
function citiesFilter(): Set<string> | null {
  const arg = process.argv.find((a) => a.startsWith("--cities="));
  if (!arg) return null;
  return new Set(arg.slice("--cities=".length).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

async function main() {
  const filter = citiesFilter();
  const cities = filter ? US_DISCOVER_CITIES.filter((c) => filter.has(c.slug)) : US_DISCOVER_CITIES;
  const stats: CityStats[] = [];
  for (const cfg of cities) {
    stats.push(await enrichCity(cfg));
  }
  printTable(stats);
}

main().catch((err) => {
  console.error("[enrich-us] fatal:", err);
  process.exit(1);
});
