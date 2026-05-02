/**
 * Regression test for production failures where Google Places labels an
 * address with the metro's central city name but the listing's actual
 * municipality is a sibling.
 *
 * Run: npx tsx scripts/test-metro-siblings.ts
 *
 * Each case is a real listing that previously 404'd in production with
 * the typed city. Asserts that findAndFetchDetail now resolves to the
 * correct municipality via the metro-siblings fan-out.
 */

import { findAndFetchDetail, ZoocasaNotFoundError } from "../src/lib/zoocasa";

interface Case {
  label: string;
  typedStreet: string;
  typedCity: string;          // What Google Places returned
  province: string;
  expectedMunicipality?: string;  // Where Zoocasa says the listing actually lives
  expectedSlugFragment?: string;  // Substring expected in the matched URL
}

const CASES: Case[] = [
  {
    label: "User report 2026-05-01: Google says Victoria, listing is Langford",
    typedStreet: "1227 Freshwater Crescent",
    typedCity: "Victoria",
    province: "bc",
    expectedMunicipality: "Langford",
    expectedSlugFragment: "/langford-bc-real-estate/",
  },
  {
    label: "User report 2026-05-01: typed city is correct, broken SSR fallback",
    typedStreet: "6280 Buchanan Street",
    typedCity: "Burnaby",
    province: "bc",
    expectedMunicipality: "Burnaby",
    expectedSlugFragment: "/burnaby-bc-real-estate/",
  },
];

async function main() {
  let pass = 0;
  let fail = 0;

  for (const c of CASES) {
    process.stdout.write(`\n--- ${c.label} ---\n`);
    process.stdout.write(`  typed:    "${c.typedStreet}, ${c.typedCity}, ${c.province.toUpperCase()}"\n`);
    process.stdout.write(`  expects:  ${c.expectedMunicipality || "any match"} (${c.expectedSlugFragment || "any URL"})\n`);

    try {
      const detail = await findAndFetchDetail(c.typedStreet, c.typedCity, c.province);
      const url = detail.raw.addressPath
        ? `https://www.zoocasa.com${detail.raw.addressPath}`
        : "(no addressPath)";
      const muni = detail.listing.city;
      const slugOk = !c.expectedSlugFragment || url.includes(c.expectedSlugFragment);
      const muniOk = !c.expectedMunicipality ||
        muni.toLowerCase() === c.expectedMunicipality.toLowerCase();
      const ok = slugOk && muniOk;

      process.stdout.write(`  resolved: ${detail.listing.address}, ${muni}\n`);
      process.stdout.write(`  url:      ${url}\n`);
      process.stdout.write(`  result:   ${ok ? "PASS" : "FAIL"}` +
        (!muniOk ? ` (expected municipality ${c.expectedMunicipality}, got ${muni})` : "") +
        (!slugOk ? ` (URL missing fragment ${c.expectedSlugFragment})` : "") +
        `\n`);
      ok ? pass++ : fail++;
    } catch (err) {
      const tag = err instanceof ZoocasaNotFoundError ? "not-found" : "error";
      process.stdout.write(`  result:   FAIL (${tag}: ${err instanceof Error ? err.message : err})\n`);
      fail++;
    }
  }

  process.stdout.write(`\n=== ${pass}/${CASES.length} pass, ${fail} fail ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
