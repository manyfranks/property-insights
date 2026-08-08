/**
 * pipeline/us-enrich.ts
 *
 * Enriches sparse US Discover listings (score/tier/signals only, from
 * us-discover.ts's city-wide /listings/sale sweep — see fetchUSCityListings)
 * with the same assessment/offer/narrative depth the on-demand /assess flow
 * produces for a single address (src/app/api/assess/route.ts's
 * handleUSAssessment), so /property/[slug] has something real to render
 * instead of the permanent "Generating analysis" placeholder that showed up
 * for every cron-sourced US listing (see analyze.ts's analyzeListingAsync:
 * a listing with preSignals but no preOffer/preNarrative takes the
 * "hasPre" fast path and never gets a narrative).
 *
 * BUDGET-AWARE BY DESIGN: RentCast's free tier is 45 requests/month total
 * (shared with on-demand /assess lookups and the Discover sweep itself —
 * see rentcast.ts's module doc). Fully enriching every listing a city
 * search returns (up to 50, see us-discover.ts's TOP_N_PER_CITY) would burn
 * the entire monthly quota on one city. So this module only enriches the
 * top US_ENRICH_TOP_N listings per city (by preScore, already computed) —
 * default 3, meaning ~2 requests/listing (record + AVM via
 * getUSPropertyLite; rent is skipped entirely, see rentcast.ts's doc on
 * that function) × 3 = ~6 requests per city refresh. On RentCast's
 * Foundation tier (1,000 req/mo) set US_ENRICH_TOP_N=50 to enrich every
 * stored listing — no code change needed here, only the env var.
 *
 * Quota exhaustion mid-run degrades gracefully: enrichUSCityListings()
 * checks the quota counter before each listing and stops (not throws) the
 * moment it's exhausted, leaving the remaining candidates sparse rather
 * than failing the whole batch.
 */

import type { Listing } from "../types";
import type { USDiscoverCityConfig } from "../data/city-metadata";
import type { CountyMarketPanel } from "../db/regional-econ";
import { getCountyMarketPanel } from "../db/regional-econ";
import { getUSPropertyLite, getRentcastQuotaStatus } from "../rentcast";
import { buildUsAssessment, buildUsCompSupport } from "./us-assess";
import { buildUsAdvantageBundle, applyEquitySignalToScore, equitySignalLabel } from "./us-advantage";
import { generateUsNarrative, deterministicUsNarrative } from "./us-narrative";
import { getSignals } from "../signals";
import { scoreV2 } from "../scoring";
import { offerModel, offerModelLanguage } from "../offer-model";
import { offerToPrecomputed } from "./enrich";
import { fmt } from "../utils";

/** Default 3 (free tier — see module doc). Foundation tier ($74/mo, 1,000
 * req/mo) => set to 50 to enrich every listing a city search returns. */
export function usEnrichTopN(): number {
  const n = Number(process.env.US_ENRICH_TOP_N);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export interface EnrichUSListingResult {
  listing: Listing;
  enriched: boolean;
  reason?: "quota_exhausted" | "no_record" | "error";
  recordFound: boolean;
  assessedValue: number | null;
  narrativeChars: number;
}

/**
 * Enrich a single US Discover listing: getUSPropertyLite() (record + AVM,
 * 2 requests on a cache miss) → buildUsAssessment → buildUsCompSupport →
 * buildUsAdvantageBundle (the 5-signal US Advantage layer, zero extra
 * requests — pure functions over data already fetched) → scoreV2 +
 * applyEquitySignalToScore → offerModel/offerModelLanguage →
 * generateUsNarrative (LLM, ~12s internal timeout, falls back to
 * deterministicUsNarrative on any failure/timeout/missing key). Every step
 * mirrors route.ts's handleUSAssessment listed-branch 1:1 — the difference
 * is this result gets PERSISTED onto the Listing (preNarrative etc.)
 * instead of returned inline to a single request.
 *
 * Returns `{ enriched: false, reason: ... }` (never throws) on a RentCast
 * error, a quota-exhausted response with nothing usable, or an address
 * RentCast has no record/AVM for at all (e.g. new construction, a condo
 * unit RentCast hasn't indexed) — callers should leave the listing as-is
 * (sparse) in that case, not treat it as a failed run.
 */
export async function enrichUSListing(
  listing: Listing,
  marketPanel: CountyMarketPanel | null
): Promise<EnrichUSListingResult> {
  const t0 = Date.now();
  const log = (step: string, extra?: string) =>
    console.log(`  [us-enrich] ${step} (${Date.now() - t0}ms)${extra ? " — " + extra : ""}`);

  const empty = (reason: EnrichUSListingResult["reason"], recordFound = false): EnrichUSListingResult => ({
    listing,
    enriched: false,
    reason,
    recordFound,
    assessedValue: null,
    narrativeChars: 0,
  });

  let bundle;
  try {
    bundle = await getUSPropertyLite(listing.address, listing.city, listing.province);
  } catch (err) {
    log("rentcast error", err instanceof Error ? err.message : String(err));
    return empty("error");
  }

  if (!bundle.record && !bundle.avm) {
    log(bundle.meta.quotaExhausted ? "quota exhausted, no data" : "no record or avm returned");
    return empty(bundle.meta.quotaExhausted ? "quota_exhausted" : "no_record");
  }

  const assessment = buildUsAssessment(bundle.record, bundle.avm, listing.province);

  // Merge fresher property-record fields into the listing — the bare
  // /listings/sale sweep that seeded this listing (fetchUSCityListings)
  // doesn't carry yearBuilt/lotSize/taxes at all (see buildUsListing's
  // "record: null" call there); the full /properties record does.
  const yearBuilt = bundle.record?.yearBuilt != null ? String(bundle.record.yearBuilt) : listing.yearBuilt;
  const lotSize = bundle.record?.lotSize != null ? String(bundle.record.lotSize) : listing.lotSize;
  const sqft = bundle.record?.squareFootage != null ? String(bundle.record.squareFootage) : listing.sqft;
  const latestTax = bundle.record?.propertyTaxes?.[0]?.total ?? bundle.record?.taxAssessments?.[0]?.value ?? null;
  const taxes = latestTax != null ? String(Math.round(latestTax)) : listing.taxes;

  const baseListing: Listing = { ...listing, yearBuilt, lotSize, sqft, taxes };

  const comparables = buildUsCompSupport(bundle.avm, parseInt(sqft) || 0);

  // No rent estimate — getUSPropertyLite() skips that call to save quota
  // (see its doc comment), so the investor-yield signal degrades to null
  // here exactly the way it does for any address RentCast has no rent
  // model for. Everything else in the bundle is unaffected.
  const advantage = buildUsAdvantageBundle({
    record: bundle.record,
    askingPrice: baseListing.price || null,
    avmValue: bundle.avm?.value ?? null,
    taxAssessedValue: bundle.record?.taxAssessments?.[0]?.value ?? null,
    assessmentBasis: assessment?.assessmentBasis,
    compImpliedValue: comparables.impliedValue,
    monthlyRent: null,
    marketPanel,
  });

  const baseScore = scoreV2(baseListing);
  const score = applyEquitySignalToScore(baseScore, advantage.equitySignal);
  const equityLabel = equitySignalLabel(advantage.equitySignal);
  const structuralSignals = getSignals(baseListing);
  const signals = equityLabel ? [...structuralSignals, equityLabel] : structuralSignals;

  const offer = assessment?.found ? offerModel(baseListing, assessment) : offerModelLanguage(baseListing);

  const narrativeContext = { listing: baseListing, assessment, offer, signals, comparables, advantage, marketPanel };
  let narrative: string;
  let narrativeConfidence = 0;
  try {
    const llmResult = await generateUsNarrative(narrativeContext);
    if (llmResult.narrative) {
      narrative = llmResult.narrative;
      narrativeConfidence = llmResult.confidence;
    } else {
      narrative = deterministicUsNarrative(narrativeContext);
    }
  } catch (err) {
    log("narrative error", err instanceof Error ? err.message : String(err));
    narrative = deterministicUsNarrative(narrativeContext);
  }

  const enrichedListing: Listing = {
    ...baseListing,
    preScore: score.total,
    preTier: score.tier,
    preSignals: signals,
    preNarrative: narrative,
    preNarrativeConfidence: narrativeConfidence,
    preOffer: offer ? offerToPrecomputed(offer) : undefined,
    preAssessment: assessment?.found ? assessment : undefined,
    preUsAdvantage: advantage,
    preUsComparables: comparables,
    assessmentNote: assessment?.found
      ? `${assessment.assessmentYear}: ${fmt(assessment.totalValue)}${
          assessment.source === "avm" ? " (RentCast AVM estimate)" : ""
        }`
      : undefined,
    source: baseListing.source ?? "cron",
    enrichedAt: new Date().toISOString(),
  };

  log(
    "done",
    `tier=${score.tier} assessed=${assessment?.totalValue ?? "n/a"} offer=${offer?.finalOffer ?? "n/a"} narrative=${narrative.length}chars`
  );

  return {
    listing: enrichedListing,
    enriched: true,
    recordFound: !!bundle.record,
    assessedValue: assessment?.totalValue ?? null,
    narrativeChars: narrative.length,
  };
}

export interface EnrichUSCityListingsResult {
  /** Full input array, same order — top-N candidates replaced with their
   * enriched versions, everything else untouched. */
  listings: Listing[];
  attempted: number;
  succeeded: number;
  quotaStoppedEarly: boolean;
  details: EnrichUSListingResult[];
}

/**
 * Enrich the top `opts.top` (default usEnrichTopN()) listings in `listings`
 * by preScore, for one city. Takes the city's already-scored Listing[] and
 * its USDiscoverCityConfig (for state + countyFips — the RentCast county
 * market panel needs the latter, zero extra RentCast requests since it's a
 * Postgres read via getCountyMarketPanel) rather than re-reading from KV,
 * so it slots directly into refreshUSDiscover()'s in-memory per-city
 * pipeline (see us-discover.ts) without a redundant KV round trip.
 *
 * Quota-guarded per listing (not just once at the top): checks
 * getRentcastQuotaStatus() before each candidate and stops the loop the
 * moment the monthly cap is hit, so a run that goes quota-exhausted midway
 * through a city's top-N still enriches whatever it could afford and
 * leaves the rest sparse — never throws, never fails the caller's request.
 */
export async function enrichUSCityListings(
  listings: Listing[],
  cfg: USDiscoverCityConfig,
  opts?: { top?: number }
): Promise<EnrichUSCityListingsResult> {
  const topN = opts?.top ?? usEnrichTopN();
  if (topN <= 0 || listings.length === 0) {
    return { listings, attempted: 0, succeeded: 0, quotaStoppedEarly: false, details: [] };
  }

  const sorted = [...listings].sort((a, b) => (b.preScore ?? 0) - (a.preScore ?? 0));
  const candidates = sorted.slice(0, topN);

  const marketPanel = await getCountyMarketPanel(cfg.countyFips).catch(() => null);

  const details: EnrichUSListingResult[] = [];
  const enrichedByAddress = new Map<string, Listing>();
  let attempted = 0;
  let quotaStoppedEarly = false;

  for (const listing of candidates) {
    const quota = await getRentcastQuotaStatus();
    if (quota.exhausted) {
      quotaStoppedEarly = true;
      break;
    }

    attempted++;
    const result = await enrichUSListing(listing, marketPanel);
    details.push(result);
    if (result.enriched) enrichedByAddress.set(result.listing.address, result.listing);
    if (result.reason === "quota_exhausted") {
      quotaStoppedEarly = true;
      break;
    }
  }

  const merged = listings.map((l) => enrichedByAddress.get(l.address) ?? l);

  return {
    listings: merged,
    attempted,
    succeeded: enrichedByAddress.size,
    quotaStoppedEarly,
    details,
  };
}
