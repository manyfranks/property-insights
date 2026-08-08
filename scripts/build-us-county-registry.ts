/**
 * Builds src/lib/data/us-counties.json — a static registry of every US
 * county (+ county-equivalent) that has regional_econ data, derived from
 * DISTINCT geo_fips/geo_name rows (geo_level='county').
 *
 * Source of truth for county names: the census_acs rows. Every one of the
 * 50 states + DC has full ACS coverage (verified: the only geo_fips present
 * in fema/fhfa but absent from census_acs are US territories — American
 * Samoa, Guam, N. Mariana Islands, US Virgin Islands — which this script
 * intentionally excludes since they're outside the 50-state + DC map below).
 * census_acs's geo_name is also the only source that carries the full
 * descriptive form ("Autauga County, Alabama") — fema/fhfa only have the
 * abbreviated "Autauga, AL" form, which is why we don't want it as a name
 * source, only as a lookup toward the state map.
 *
 * Run: npx tsx scripts/build-us-county-registry.ts [--commit]
 *   (dry run by default: fetches + prints stats, does not write the JSON
 *   file; pass --commit to actually write src/lib/data/us-counties.json —
 *   mirrors the ingest scripts' dry-run/--commit convention even though
 *   this script only ever reads from the DB, never writes to it, because
 *   overwriting a committed data file deserves the same explicit opt-in.)
 */
import { writeFileSync } from "fs";
import path from "path";
import { loadEnvLocal } from "./lib/ingest-shared";

loadEnvLocal();

import { neon } from "@neondatabase/serverless";

const COMMIT = process.argv.includes("--commit");

// ---------------------------------------------------------------------------
// State FIPS -> USPS + full name. 50 states + DC (51 entries). US territories
// (AS/GU/MP/PR/VI — state FIPS 60/66/69/72/78) are deliberately NOT mapped
// here, so any county row under those prefixes is skipped below.
// ---------------------------------------------------------------------------
const STATE_FIPS: Record<string, { usps: string; name: string }> = {
  "01": { usps: "AL", name: "Alabama" },
  "02": { usps: "AK", name: "Alaska" },
  "04": { usps: "AZ", name: "Arizona" },
  "05": { usps: "AR", name: "Arkansas" },
  "06": { usps: "CA", name: "California" },
  "08": { usps: "CO", name: "Colorado" },
  "09": { usps: "CT", name: "Connecticut" },
  "10": { usps: "DE", name: "Delaware" },
  "11": { usps: "DC", name: "District of Columbia" },
  "12": { usps: "FL", name: "Florida" },
  "13": { usps: "GA", name: "Georgia" },
  "15": { usps: "HI", name: "Hawaii" },
  "16": { usps: "ID", name: "Idaho" },
  "17": { usps: "IL", name: "Illinois" },
  "18": { usps: "IN", name: "Indiana" },
  "19": { usps: "IA", name: "Iowa" },
  "20": { usps: "KS", name: "Kansas" },
  "21": { usps: "KY", name: "Kentucky" },
  "22": { usps: "LA", name: "Louisiana" },
  "23": { usps: "ME", name: "Maine" },
  "24": { usps: "MD", name: "Maryland" },
  "25": { usps: "MA", name: "Massachusetts" },
  "26": { usps: "MI", name: "Michigan" },
  "27": { usps: "MN", name: "Minnesota" },
  "28": { usps: "MS", name: "Mississippi" },
  "29": { usps: "MO", name: "Missouri" },
  "30": { usps: "MT", name: "Montana" },
  "31": { usps: "NE", name: "Nebraska" },
  "32": { usps: "NV", name: "Nevada" },
  "33": { usps: "NH", name: "New Hampshire" },
  "34": { usps: "NJ", name: "New Jersey" },
  "35": { usps: "NM", name: "New Mexico" },
  "36": { usps: "NY", name: "New York" },
  "37": { usps: "NC", name: "North Carolina" },
  "38": { usps: "ND", name: "North Dakota" },
  "39": { usps: "OH", name: "Ohio" },
  "40": { usps: "OK", name: "Oklahoma" },
  "41": { usps: "OR", name: "Oregon" },
  "42": { usps: "PA", name: "Pennsylvania" },
  "44": { usps: "RI", name: "Rhode Island" },
  "45": { usps: "SC", name: "South Carolina" },
  "46": { usps: "SD", name: "South Dakota" },
  "47": { usps: "TN", name: "Tennessee" },
  "48": { usps: "TX", name: "Texas" },
  "49": { usps: "UT", name: "Utah" },
  "50": { usps: "VT", name: "Vermont" },
  "51": { usps: "VA", name: "Virginia" },
  "53": { usps: "WA", name: "Washington" },
  "54": { usps: "WV", name: "West Virginia" },
  "55": { usps: "WI", name: "Wisconsin" },
  "56": { usps: "WY", name: "Wyoming" },
};

// ---------------------------------------------------------------------------
// Slug helpers — conservative: normalize accented characters to ASCII
// (Doña Ana -> dona-ana), strip periods/apostrophes entirely rather than
// hyphenating them (St. Louis city -> st-louis-city, not st--louis-city),
// then collapse everything else non-alphanumeric to single hyphens.
// ---------------------------------------------------------------------------
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (ñ -> n, etc.)
    .replace(/['’.]/g, "") // strip apostrophes (straight + curly) and periods
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

interface CountyEntry {
  fips: string; // "US-48453"
  county: string; // "Travis County" — real name, not slugified
  state: string; // USPS, e.g. "TX"
  stateName: string; // "Texas"
  stateSlug: string; // "texas"
  countySlug: string; // "travis-county"
}

async function main() {
  console.log(`build-us-county-registry${COMMIT ? "" : " [DRY RUN — no file written]"}`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — required (this script only reads, --commit only gates the write).");
  const sql = neon(url);

  const rows = (await sql`
    SELECT DISTINCT geo_fips, geo_name
    FROM regional_econ
    WHERE geo_level = 'county' AND source = 'census_acs'
    ORDER BY geo_fips
  `) as { geo_fips: string; geo_name: string }[];

  console.log(`county rows from regional_econ (census_acs): ${rows.length.toLocaleString()}`);

  const entries: CountyEntry[] = [];
  const skippedTerritories: string[] = [];
  const slugSeen = new Map<string, string>(); // "stateSlug/countySlug" -> fips, for collision detection

  for (const { geo_fips, geo_name } of rows) {
    // geo_fips format: "US-SSCCC"
    const stateFips = geo_fips.slice(3, 5);
    const state = STATE_FIPS[stateFips];
    if (!state) {
      skippedTerritories.push(geo_fips);
      continue;
    }

    // geo_name format: "<County Name>, <Full State Name>" — split on the
    // LAST comma (a couple of county names historically could theoretically
    // contain a comma; none currently do, but this is defensive either way).
    const lastComma = geo_name.lastIndexOf(",");
    const countyName = (lastComma >= 0 ? geo_name.slice(0, lastComma) : geo_name).trim();

    const stateSlug = slugify(state.name);
    let countySlug = slugify(countyName);

    const key = `${stateSlug}/${countySlug}`;
    if (slugSeen.has(key)) {
      // Collision safety net (not expected given census_acs naming, but
      // disambiguate rather than silently drop a county if it happens).
      const suffix = geo_fips.slice(-3);
      console.warn(`  slug collision: ${key} (${geo_fips} vs ${slugSeen.get(key)}) — disambiguating with -${suffix}`);
      countySlug = `${countySlug}-${suffix}`;
    }
    slugSeen.set(`${stateSlug}/${countySlug}`, geo_fips);

    entries.push({
      fips: geo_fips,
      county: countyName,
      state: state.usps,
      stateName: state.name,
      stateSlug,
      countySlug,
    });
  }

  console.log(`counties mapped: ${entries.length.toLocaleString()}`);
  console.log(`territory rows skipped (no 50-state+DC mapping): ${skippedTerritories.length.toLocaleString()}`);
  if (skippedTerritories.length > 0) {
    console.log(`  e.g. ${skippedTerritories.slice(0, 5).join(", ")}`);
  }

  const statesRepresented = new Set(entries.map((e) => e.stateSlug)).size;
  console.log(`states represented: ${statesRepresented}`);

  console.log("\nSpot-check edge cases:");
  for (const needle of ["Doña Ana", "St. Louis city", "LaSalle Parish", "District of Columbia"]) {
    const hit = entries.find((e) => e.county.includes(needle));
    console.log(`  ${needle.padEnd(24)} -> ${hit ? `${hit.county} => ${hit.stateSlug}/${hit.countySlug}` : "(not found)"}`);
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would write ${entries.length.toLocaleString()} counties to src/lib/data/us-counties.json. Pass --commit to write.`);
    return;
  }

  const outPath = path.resolve(process.cwd(), "src/lib/data/us-counties.json");
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");
  console.log(`\nWrote ${entries.length.toLocaleString()} counties to ${outPath}`);
}

main().catch((e) => {
  console.error("build-us-county-registry failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
