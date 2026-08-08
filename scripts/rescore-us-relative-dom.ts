/**
 * scripts/rescore-us-relative-dom.ts
 *
 * Re-scores the 144 already-seeded US Discover listings (Austin/TX,
 * Miami/FL, Phoenix/AZ — all source:"cron") so they pick up the
 * relative-DOM signal (src/lib/pipeline/us-discover.ts's scoreUSListing,
 * baseline from scripts/ingest-us-dom.ts's freshly-ingested regional_econ
 * rows) WITHOUT a fresh RentCast fetch. refreshUSDiscover() /
 * fetchUSCityListings() both call RentCast (discoverActiveListingsByCity) —
 * off limits here (zero-RentCast-calls constraint) — so this reads the
 * listings already in KV, recomputes each city's baselines (cityMedianPpsf,
 * countyMedian, domBaseline — Postgres reads only) the exact same way
 * fetchUSCityListings does (reusing computeCityMedianPpsf + scoreUSListing,
 * not a reimplementation), and rewrites ONLY the score-derived fields:
 * preScore, preTier, preSignals, preRelativeDom. Everything else on each
 * listing (preNarrative, preOffer, preAssessment, preUsAdvantage, ...) is
 * left untouched.
 *
 * Prints the DOM-band distribution across the 144 listings BEFORE and
 * AFTER, per the verification brief — the fixed-bracket baseline (all
 * "fallback_absolute" pre-migration) vs. the new relative bands.
 *
 * Usage: npx tsx scripts/rescore-us-relative-dom.ts
 */
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

async function main() {
  const { getAllListings, writeAllListings } = await import("../src/lib/kv/listings");
  const { scoreUSListing, computeCityMedianPpsf } = await import("../src/lib/pipeline/us-discover");
  const { getAcsCountyMedian, getCountyMedianDom } = await import("../src/lib/db/regional-econ");
  const { US_DISCOVER_CITIES } = await import("../src/lib/data/city-metadata");
  type Listing = import("../src/lib/types").Listing;
  type RelativeDomBand = import("../src/lib/types").RelativeDomBand;

  const all = await getAllListings();
  console.log(`Total listings in KV: ${all.length}`);

  const bandCounts = (listings: Listing[]): Record<string, number> => {
    const counts: Record<string, number> = { normal: 0, extended: 0, stale: 0, distressed: 0, "(none)": 0 };
    for (const l of listings) {
      const band = l.preRelativeDom?.band ?? "(none)";
      counts[band] = (counts[band] ?? 0) + 1;
    }
    return counts;
  };

  const usListings = all.filter((l) => US_DISCOVER_CITIES.some((c) => l.city === c.name && l.province === c.state && l.source === "cron"));
  console.log(`US Discover cron-sourced listings: ${usListings.length}`);
  console.log("BEFORE band distribution:", bandCounts(usListings));

  // Tier distribution before, for the "quota unchanged" sanity narrative
  // (not the RentCast quota — the HOT/WARM/WATCH tier mix).
  const tierCounts = (listings: Listing[]): Record<string, number> => {
    const counts: Record<string, number> = { HOT: 0, WARM: 0, WATCH: 0 };
    for (const l of listings) counts[l.preTier ?? "WATCH"] = (counts[l.preTier ?? "WATCH"] ?? 0) + 1;
    return counts;
  };
  console.log("BEFORE tier distribution:", tierCounts(usListings));

  const updatedById = new Map<string, Listing>();
  const currentMonth = new Date().getMonth() + 1;

  for (const cfg of US_DISCOVER_CITIES) {
    const cityListings = all.filter((l) => l.city === cfg.name && l.province === cfg.state && l.source === "cron");
    if (cityListings.length === 0) {
      console.log(`\n${cfg.name}, ${cfg.state}: 0 listings, skipping`);
      continue;
    }

    const cityMedianPpsf = computeCityMedianPpsf(cityListings);
    const countyMedian = await getAcsCountyMedian(cfg.countyFips);
    const domBaseline = await getCountyMedianDom(cfg.countyFips, currentMonth);

    console.log(
      `\n${cfg.name}, ${cfg.state} (${cfg.countyFips}): ${cityListings.length} listings | cityMedianPpsf=${cityMedianPpsf?.toFixed(0) ?? "n/a"} | countyMedianValue=${countyMedian?.value ?? "n/a"} | domBaseline=${domBaseline ? `${domBaseline.days}d (${domBaseline.baseline}, ${domBaseline.year}-${String(domBaseline.month).padStart(2, "0")})` : "NONE (fallback_absolute)"}`
    );

    for (const listing of cityListings) {
      const result = scoreUSListing(listing, cityMedianPpsf, countyMedian?.value ?? null, domBaseline);
      const key = `${listing.address}|${listing.city}|${listing.province}`;
      updatedById.set(key, {
        ...listing,
        preScore: result.total,
        preTier: result.tier,
        preSignals: result.signals,
        preRelativeDom: result.relativeDom,
      });
    }
  }

  console.log(`\nRescored ${updatedById.size} listings.`);

  const merged: Listing[] = all.map((l) => {
    const key = `${l.address}|${l.city}|${l.province}`;
    return updatedById.get(key) ?? l;
  });

  const afterUs = merged.filter((l) => US_DISCOVER_CITIES.some((c) => l.city === c.name && l.province === c.state && l.source === "cron"));
  console.log("\nAFTER band distribution:", bandCounts(afterUs));
  console.log("AFTER tier distribution:", tierCounts(afterUs));

  // Per-band DOM/relativeDom detail sample for the "Austin severity drops"
  // check the task brief predicts.
  for (const cfg of US_DISCOVER_CITIES) {
    const cityAfter = afterUs.filter((l) => l.city === cfg.name && l.province === cfg.state);
    const distressed = cityAfter.filter((l) => l.preRelativeDom?.band === "distressed");
    const stale = cityAfter.filter((l) => l.preRelativeDom?.band === "stale");
    console.log(`\n${cfg.name}, ${cfg.state}: ${cityAfter.length} listings — distressed=${distressed.length}, stale=${stale.length}`);
    for (const l of [...distressed, ...stale].slice(0, 5)) {
      console.log(
        `  ${l.address}: dom=${l.dom} relativeDom=${l.preRelativeDom?.relativeDom?.toFixed(2)} band=${l.preRelativeDom?.band} baseline=${l.preRelativeDom?.baselineDays}d(${l.preRelativeDom?.baseline})`
      );
    }
  }

  const { written } = await writeAllListings(merged);
  const roundTrip = await getAllListings();
  if (!Array.isArray(roundTrip) || roundTrip.length !== written || roundTrip.length !== all.length) {
    throw new Error(
      `round-trip verification FAILED: expected ${all.length} (unchanged count), wrote ${written}, read back ${
        Array.isArray(roundTrip) ? roundTrip.length : typeof roundTrip
      }`
    );
  }
  console.log(`\nWrite OK — round-trip verified: ${roundTrip.length} listings in KV (unchanged from ${all.length} before).`);

  const verifyUs = roundTrip.filter((l) => US_DISCOVER_CITIES.some((c) => l.city === c.name && l.province === c.state && l.source === "cron"));
  const withRelDom = verifyUs.filter((l) => l.preRelativeDom).length;
  console.log(`US Discover listings with preRelativeDom set post-write: ${withRelDom}/${verifyUs.length}`);
}

main().catch((err) => {
  console.error("[rescore-us-relative-dom] fatal:", err);
  process.exit(1);
});
