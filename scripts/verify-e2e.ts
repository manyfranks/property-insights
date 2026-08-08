/**
 * scripts/verify-e2e.ts
 *
 * Phase 2e end-to-end verification, function-level (no HTTP/auth — Clerk
 * auth wraps the real /api/assess route, so this calls the exact same
 * library functions handleUSAssessment() in src/app/api/assess/route.ts
 * calls, in the same order, instead of going through the route/auth layer).
 *
 * IMPORTANT — route.ts is read-only for this change (see task constraints);
 * it still contains the root-cause bug this investigation found:
 *
 *   const hasUsableRentcastData = bundle && (bundle.record || bundle.avm);
 *
 * This ignores bundle.activeListing. When record+avm are both null (quota
 * exhaustion on a cache miss, or a genuine AVM gap for an unusual property)
 * but activeListing is a cache HIT from the US Discover sweep, the route
 * currently discards the perfectly good listing and falls back to the
 * county-median path — exactly the bug reported. The fix (not applied here,
 * route.ts is out of scope) is:
 *
 *   const hasUsableRentcastData = bundle && (bundle.record || bundle.avm || bundle.activeListing);
 *
 * This script proves two things separately, both required to confirm the
 * fix works once applied:
 *   (a) getUSProperty() for a reseeded address is cache-hit-only (zero live
 *       RentCast calls) — the TTL-alignment and cache-key fixes in
 *       rentcast.ts/us-discover.ts.
 *   (b) Feeding that bundle through the SAME listed-branch functions
 *       route.ts imports (buildUsListing, scoreV2, buildUsCompSupport,
 *       buildUsAdvantageBundle, applyEquitySignalToScore, offerModel)
 *       produces a full offer+signals result — i.e. once route.ts's
 *       one-line condition is fixed, this bundle DOES take the listed
 *       branch instead of falling through to county-median.
 *
 * Usage: npx tsx scripts/verify-e2e.ts "<address>" "<city>" "<state>" [...]
 */
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

async function verifyOne(address: string, city: string, state: string) {
  const { getUSProperty, getRentcastQuotaStatus } = await import("../src/lib/rentcast");
  const { buildUsListing, buildUsCompSupport, buildUsAssessment } = await import("../src/lib/pipeline/us-assess");
  const { buildUsAdvantageBundle, applyEquitySignalToScore, equitySignalLabel } = await import(
    "../src/lib/pipeline/us-advantage"
  );
  const { getSignals } = await import("../src/lib/signals");
  const { scoreV2 } = await import("../src/lib/scoring");
  const { offerModel, offerModelLanguage } = await import("../src/lib/offer-model");

  console.log(`\n${"=".repeat(70)}\nVerifying: ${address}, ${city}, ${state}\n${"=".repeat(70)}`);

  const quotaBefore = await getRentcastQuotaStatus();
  const bundle = await getUSProperty(address, city, state);
  const quotaAfter = await getRentcastQuotaStatus();

  console.log(
    `getUSProperty meta: cacheHits=${bundle.meta.cacheHits} liveCalls=${bundle.meta.liveCalls} ` +
      `quotaExhausted=${bundle.meta.quotaExhausted} errors=${JSON.stringify(bundle.meta.errors)}`
  );
  console.log(`Quota: before=${quotaBefore.used} after=${quotaAfter.used} (delta=${quotaAfter.used - quotaBefore.used})`);
  console.log(`activeListing present: ${!!bundle.activeListing}`);
  if (bundle.activeListing) {
    console.log(
      `  price=${bundle.activeListing.price} status=${bundle.activeListing.status} dom=${bundle.activeListing.daysOnMarket}`
    );
  }

  const zeroLiveCalls = bundle.meta.liveCalls === 0;
  console.log(`\nZERO live RentCast calls: ${zeroLiveCalls ? "PASS" : "FAIL"}`);

  if (!bundle.activeListing) {
    console.log("No active listing in bundle — cannot verify listed-branch assembly. STOP.");
    return { zeroLiveCalls, listedBranchOk: false };
  }

  // Replicate route.ts's listed-branch assembly (lines ~336-421) using the
  // exact same functions it imports — proves this bundle WOULD take the
  // listed branch once hasUsableRentcastData is fixed to include
  // bundle.activeListing.
  const listing = buildUsListing(bundle, city, state);
  const baseScore = scoreV2(listing);
  const comparables = buildUsCompSupport(bundle.avm, parseInt(listing.sqft) || 0);
  const assessment = buildUsAssessment(bundle.record, bundle.avm, state);

  const advantage = buildUsAdvantageBundle({
    record: bundle.record,
    askingPrice: listing.price || null,
    avmValue: bundle.avm?.value ?? null,
    taxAssessedValue: bundle.record?.taxAssessments?.[0]?.value ?? null,
    assessmentBasis: assessment?.assessmentBasis,
    compImpliedValue: comparables.impliedValue,
    monthlyRent: bundle.rent?.value ?? null,
    marketPanel: null,
  });

  const score = applyEquitySignalToScore(baseScore, advantage.equitySignal);
  const equityLabel = equitySignalLabel(advantage.equitySignal);
  const signals = equityLabel ? [...getSignals(listing), equityLabel] : getSignals(listing);
  const offer = assessment?.found ? offerModel(listing, assessment) : offerModelLanguage(listing);

  console.log(`\nListed-branch result:`);
  console.log(`  listing.price=${listing.price} listing.dom=${listing.dom}`);
  console.log(`  score.total=${score.tier} (${score.total})`);
  console.log(`  signals=${JSON.stringify(signals)}`);
  console.log(`  offer=${offer ? JSON.stringify({ finalOffer: offer.finalOffer, percentOfList: offer.percentOfList }) : "null"}`);

  const listedBranchOk = !!(listing.price > 0 && score.total >= 0 && signals && offer);
  console.log(`\nLISTED result assembled successfully: ${listedBranchOk ? "PASS" : "FAIL"}`);

  return { zeroLiveCalls, listedBranchOk, quotaDelta: quotaAfter.used - quotaBefore.used };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.length % 3 !== 0) {
    console.error('Usage: npx tsx scripts/verify-e2e.ts "<address>" "<city>" "<state>" [...]');
    process.exit(1);
  }
  const results: { address: string; zeroLiveCalls: boolean; listedBranchOk: boolean }[] = [];
  for (let i = 0; i < args.length; i += 3) {
    const [address, city, state] = [args[i], args[i + 1], args[i + 2]];
    const r = await verifyOne(address, city, state);
    results.push({ address, zeroLiveCalls: r.zeroLiveCalls, listedBranchOk: r.listedBranchOk });
  }
  console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
  for (const r of results) {
    console.log(`${r.address}: zeroLiveCalls=${r.zeroLiveCalls ? "PASS" : "FAIL"} listedBranchOk=${r.listedBranchOk ? "PASS" : "FAIL"}`);
  }
  const allPass = results.every((r) => r.zeroLiveCalls && r.listedBranchOk);
  console.log(`\nOVERALL: ${allPass ? "PASS" : "FAIL"}`);
}

main().catch((err) => {
  console.error("[verify-e2e] fatal:", err);
  process.exit(1);
});
