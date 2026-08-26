/**
 * pipeline/us-discover.ts
 *
 * US Discover — cached, scored, browsable US listings by metro. The US
 * analogue of the CA cron pipeline (src/app/api/pipeline/refresh/route.ts),
 * but shaped around a hard constraint the CA side doesn't have: RentCast's
 * included allowance is 50 successful requests/month (see
 * src/lib/rentcast.ts's module doc),
 * where the CA side's Zoocasa searches are free. So instead of "search
 * every city, detail-fetch every new listing" (the CA pattern), this module
 * spends exactly ONE RentCast request per city per refresh —
 * discoverActiveListingsByCity() (already city-wide, already cached +
 * quota-guarded in rentcast.ts) — and never fans out to per-listing
 * /properties or /avm/value calls. A 30-listing city batch run through
 * those per-listing would burn the entire monthly quota refreshing one
 * city once.
 *
 * METRO LIST + CADENCE (the two scaling knobs)
 * The ACTIVE metro set (getActiveUSDiscoverCities() in city-metadata.ts) is
 * a KV-persisted, growable list seeded from US_DISCOVER_CITIES — see that
 * file's "US Metro Fill Queue" section (Part 4, 2026-08-09) for the ~60
 * metro queue and the quota-headroom-driven "activate one per cycle" slow
 * fill implemented in refreshUSDiscover() below. Refresh cadence is gated
 * by env var US_DISCOVER_REFRESH_DAYS (default 3): a city refreshed within
 * that window is skipped on the next cron tick (last-refresh timestamps
 * live in KV via getMetaValue/setMetaValue, see kv/listings.ts). Spending
 * is additionally reserve-gated per city (US_DISCOVER_QUOTA_RESERVE,
 * default 10 — see quotaReserve() below) so a cron sweep can never consume
 * the last N requests of the month; those are reserved for on-demand
 * /assess lookups hitting the same quota counter.
 * Foundation tier ($74/mo, higher request cap) → US_DISCOVER_REFRESH_DAYS=1
 * (daily); the fill queue then actives across the full ~60 metros within
 * about a week purely from headroom being routinely available — no code
 * change needed, see refreshUSDiscover()'s pacing math.
 *
 * SCORING WITHOUT DESCRIPTIONS
 * See buildUsListing()'s doc comment in us-assess.ts: RentCast search
 * results carry no MLS remarks, so every text-keyword signal in scoreV2
 * (motivated seller, estate sale, "priced to sell", etc.) structurally
 * can't fire for a US listing — that's an honest gap, not a bug, and this
 * module doesn't paper over it with fabricated text. What DOES carry over
 * unchanged from scoreV2: priceReduced (derived structurally from
 * RentCast's price-history event log, not text) and building-age scoring.
 * scoreV2's DOM bracket does NOT carry over unchanged — see "RELATIVE DOM"
 * below. On top of that base, this module adds structural signals scoreV2
 * has no inputs for, all derived from data already in hand (zero extra
 * RentCast requests, Postgres reads only):
 *   - Relative DOM: listing DOM vs. the COUNTY's own realtor.com/FRED
 *     median DOM for the month (regional_econ, this ingest) — replaces
 *     scoreV2's fixed nationwide DOM bracket one-for-one. See
 *     scoreUSListing's "Relative DOM" doc comment below for the full
 *     rationale and band thresholds.
 *   - County-median discount: listing price vs. the county's ACS median
 *     home value (regional_econ, Phase 2 ingest) — a coarse "priced well
 *     under the local market" flag.
 *   - Price/sqft outlier: listing $/sqft vs. the median $/sqft of the same
 *     city batch just fetched — computed in-process from the one API
 *     response, not a second request.
 * County-median discount and price/sqft outlier are additive on top of the
 * total; relative DOM REPLACES scoreV2's own DOM component (same max
 * weight, not stacked). Tier thresholds are scoreV2's own 45/33 cutoffs, so
 * a US listing's HOT/WARM/WATCH tier means the same thing a CA listing's
 * tier means.
 */

import { discoverActiveListingsByCity, getRentcastQuotaStatus, DiscoveredListing } from "../rentcast";
import { buildUsListingDedupKey } from "./dedup";
import { buildUsListing } from "./us-assess";
import { enrichUSCityListings } from "./us-enrich";
import { scoreV2 } from "../scoring";
import { getAcsCountyMedian, getCountyMedianDom, CountyMedianDom } from "../db/regional-econ";
import { readListingsStore, writeAllListings, getMetaValue, setMetaValue } from "../kv/listings";
import { USDiscoverCityConfig, getActiveUSDiscoverCities, activateNextQueuedMetro } from "../data/city-metadata";
import { Listing, ScoreResult, RelativeDom, RelativeDomBand } from "../types";

// RentCast /listings/sale page size for a single city-wide call. One
// request regardless of this value (RentCast bills per request, not per
// record) — set high enough that a metro's whole active-listing pool
// (rarely >200 for a mid-size city search) comes back in one page.
const LISTINGS_PER_CITY = 200;

// How many of those (post-scoring) actually get stored/shown per city.
// RentCast's raw response is the whole active pool for the metro — mostly
// unremarkable listings, same as any MLS search. Storing all 200 would
// flood Discover/dashboard with WATCH-tier noise and bloat the sitemap with
// low-value /property pages. Mirrors the CA cron pipeline's own "top N"
// stage (see city-run.ts's Stage 6 / the refresh route's CityConfig.target,
// which is 25 for CA cities) — same curation principle, applied after
// scoring instead of before, since unlike CA's two-query oldest+cheapest
// fetch, this is one unfiltered city-wide page.
const TOP_N_PER_CITY = 50;

function refreshIntervalDays(): number {
  const n = Number(process.env.US_DISCOVER_REFRESH_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

// ---------------------------------------------------------------------------
// Quota-aware scheduling (Part 2c/2d of the 2026-08-09 incident response).
//
// PROBLEM PROVEN LIVE ON 2026-08-09: RentCast quota was already at 45/45
// before this cron's US phase ran. Every discoverActiveListingsByCity()
// call was therefore quota-blocked (cachedRentcastCall in rentcast.ts
// increments-then-decrements back on a blocked call — net zero cost — and
// never reaches its cacheSet, which is exactly why the
// `rentcast:discover:{city}:{state}:200` sweep-result cache came back
// empty for all 3 configured metros afterward). The OLD code still called
// setLastRefresh() unconditionally after any non-throwing attempt — so a
// cron tick that fetched literally nothing still stamped every metro as
// "just refreshed," poisoning the cadence gate for the next
// US_DISCOVER_REFRESH_DAYS even though zero real work happened. That
// compounds an outage: once quota resets, metros don't actually re-sweep
// for days because of a false stamp left by the exhausted run.
//
// FIX: reserve a headroom buffer BEFORE attempting each city's fetch — if
// spending isn't safe, skip the fetch entirely (never call
// fetchUSCityListings, never touch quota, never stamp last-refresh) so the
// city is still "due" the moment real headroom returns. The reserve also
// protects real users: cron sweeps must never consume the last N requests
// of the month — those belong to on-demand /assess lookups hitting the
// same shared quota counter (see rentcast.ts's module doc).
// ---------------------------------------------------------------------------
function quotaReserve(): number {
  const n = Number(process.env.US_DISCOVER_QUOTA_RESERVE);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

// Rough worst-case cost of fully refreshing one metro: 1 discover call +
// up to usEnrichTopN() (default 3) enrichment candidates, each up to ~2
// requests on a cache miss (getUSPropertyLite — record + AVM; see
// us-enrich.ts's module doc: "~2 requests/listing"). 1 + 3*2 = 7. Used only
// to decide whether there's enough headroom to safely ACTIVATE a brand new
// metro this cycle (Part 4) — refreshing an already-active metro is
// separately guarded per-city by the reserve check above regardless of
// this estimate, so an under-estimate here just means a slightly less
// conservative activation, never a quota overrun.
const ESTIMATED_SWEEP_COST = 7;

// Per-address `rentcast:listing:*` cache TTL for sweep-primed entries — see
// discoverActiveListingsByCity()'s `listingTtlSeconds` param doc in
// rentcast.ts. Refresh cadence + 1 day buffer so a sweep-primed entry never
// expires before the next sweep is due to replace it (a user assessing a
// seeded listing on day 2-3 of a 3-day cycle must still get a cache HIT,
// not a live re-fetch of data the last sweep already answered for free).
function listingCacheTtlSeconds(): number {
  return (refreshIntervalDays() + 1) * 24 * 60 * 60;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const LAST_REFRESH_PREFIX = "us-discover:last-refresh:";

async function getLastRefresh(slug: string): Promise<number | null> {
  const raw = await getMetaValue(`${LAST_REFRESH_PREFIX}${slug}`);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function setLastRefresh(slug: string): Promise<void> {
  await setMetaValue(`${LAST_REFRESH_PREFIX}${slug}`, String(Date.now()));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface USScoreResult extends ScoreResult {
  signals: string[];
  relativeDom: RelativeDom;
}

// ---------------------------------------------------------------------------
// Relative DOM — replaces scoreV2's fixed nationwide DOM brackets (45/60/75/
// 90/100/120/150 days, calibrated for Victoria BC) with a county-relative
// signal for US listings: a listing's own DOM divided by its county's
// realtor.com/FRED median DOM for the same calendar month (getCountyMedianDom
// in db/regional-econ.ts — same_month baseline preferred for seasonality,
// see that function's doc comment). DOM norms vary enormously by metro (a
// 70-day-on-market Miami listing is unremarkable; a 70-day Austin listing in
// a market that clears in ~50 is a real signal) — a fixed nationwide
// bracket structurally can't tell those apart.
//
// LUXURY-POOL NOISE GUARD: above-median-price listings (price > 2x the
// county's ACS median home value) get a widened "extended" band — luxury
// inventory sits on market longer than the broader county median as a
// simple function of a thinner buyer pool, not seller motivation, so the
// ordinary 1.5x stale threshold would false-positive on unremarkable luxury
// listings. Distressed stays at the same >2.5x threshold either way —
// genuinely stale luxury inventory (agents relisting, price fatigue) is
// still worth flagging at the same severity.
// ---------------------------------------------------------------------------

function relativeDomBand(relativeDom: number, absDom: number, isAboveMedianPrice: boolean): RelativeDomBand {
  if (isAboveMedianPrice) {
    if (relativeDom <= 1.0) return "normal";
    if (relativeDom <= 2.0) return "extended";
    if (relativeDom <= 2.5) return "stale";
    return absDom >= 90 ? "distressed" : "stale";
  }
  if (relativeDom <= 1.0) return "normal";
  if (relativeDom <= 1.5) return "extended";
  if (relativeDom <= 2.5) return "stale";
  return absDom >= 90 ? "distressed" : "stale";
}

/** County not covered by FRED's MEDDAYONMAR series (see
 * scripts/ingest-us-dom.ts's hit-rate report — not universal, though 100%
 * of TOP_METRO_FIPS + Discover's 3 metros hit). Approximates the same 4
 * bands from scoreV2's OWN already-established absolute cutoffs — its
 * dom>=90 signal threshold and its dom>=150 top scoring bracket — so a
 * fallback county's persisted band stays roughly legible against a
 * relative-baseline county's, instead of inventing new unrelated cutoffs. */
function fallbackAbsoluteDomBand(absDom: number): RelativeDomBand {
  if (absDom < 45) return "normal";
  if (absDom < 90) return "extended";
  if (absDom < 150) return "stale";
  return "distressed";
}

// Point values for the relative-band DOM contribution, replacing scoreV2's
// absolute domPts (which ranges 2-30 across its 8 brackets, top bracket 30
// at dom>=150) one-for-one in the score total. Roughly matches scoreV2's
// own scale — distressed (28) sits just under its top bracket (30), extended
// (8) sits near its dom 45-59 bracket (5) / dom 75-89 bracket (16)
// midpoint — while collapsing 8 absolute brackets down to the 4 bands this
// signal actually distinguishes.
const RELATIVE_DOM_BAND_POINTS: Record<RelativeDomBand, number> = {
  normal: 0,
  extended: 8,
  stale: 18,
  distressed: 28,
};

/** Batch-level $/sqft median for a set of listings — same computation
 * fetchUSCityListings runs on a freshly-fetched RentCast batch, factored
 * out so a rescoring pass (e.g. scripts/rescore-us-relative-dom.ts, run
 * after this signal shipped, against listings already in KV with no new
 * RentCast call) can reproduce the identical baseline instead of
 * duplicating the logic. */
export function computeCityMedianPpsf(listings: Listing[]): number | null {
  const ppsfSamples = listings
    .filter((l) => l.price > 0 && (parseInt(l.sqft) || 0) > 0)
    .map((l) => l.price / (parseInt(l.sqft) || 1));
  return ppsfSamples.length >= 3 ? median(ppsfSamples) : null;
}

export function scoreUSListing(
  listing: Listing,
  cityMedianPpsf: number | null,
  countyMedianValue: number | null,
  domBaseline: CountyMedianDom | null
): USScoreResult {
  const base = scoreV2(listing);
  let total = base.total;
  const breakdown = { ...base.breakdown };
  const signals: string[] = [];

  // scoreV2 always sets breakdown["DOM"] to its absolute-bracket points —
  // that's the component this signal replaces (not adds on top of) for US
  // listings with a FRED baseline, so the total keeps the same max weight
  // scoreV2 gave DOM rather than double-counting it.
  const absoluteDomPts = base.breakdown["DOM"] ?? 0;

  const isAboveMedianPrice = countyMedianValue != null && countyMedianValue > 0 && listing.price > 2 * countyMedianValue;

  let relativeDom: RelativeDom;
  if (domBaseline && domBaseline.days > 0) {
    const ratio = listing.dom / domBaseline.days;
    const band = relativeDomBand(ratio, listing.dom, isAboveMedianPrice);
    relativeDom = { relativeDom: ratio, band, baseline: domBaseline.baseline, baselineDays: domBaseline.days };

    const bandPts = RELATIVE_DOM_BAND_POINTS[band];
    total = total - absoluteDomPts + bandPts;
    breakdown["DOM"] = bandPts;

    if (band === "stale" || band === "distressed") {
      const pct = Math.round(ratio * 100);
      signals.push(`${listing.dom} days on market — ${pct}% of county's typical ${domBaseline.days}d (${band})`);
    }
  } else {
    // No FRED baseline for this county — keep scoreV2's original absolute
    // DOM contribution untouched (breakdown/total already reflect it via
    // `base`), just record the coarse fallback band for consistency.
    relativeDom = { relativeDom: null, band: fallbackAbsoluteDomBand(listing.dom), baseline: "fallback_absolute", baselineDays: null };
    if (listing.dom >= 90) signals.push(`${listing.dom} days on market`);
  }

  if (listing.priceReduced) signals.push("Price reduced");

  if (countyMedianValue && listing.price > 0) {
    const ratio = listing.price / countyMedianValue;
    const pctBelow = Math.round((1 - ratio) * 100);
    if (ratio <= 0.8) {
      total += 10;
      breakdown["Below County Median"] = 10;
      signals.push(`${pctBelow}% below county median value`);
    } else if (ratio <= 0.9) {
      total += 5;
      breakdown["Below County Median"] = 5;
      signals.push(`${pctBelow}% below county median value`);
    }
  }

  const sqft = parseInt(listing.sqft) || 0;
  if (cityMedianPpsf && listing.price > 0 && sqft > 0) {
    const ppsf = listing.price / sqft;
    const ratio = ppsf / cityMedianPpsf;
    const pctBelow = Math.round((1 - ratio) * 100);
    if (ratio <= 0.8) {
      total += 8;
      breakdown["Price/Sqft Outlier"] = 8;
      signals.push(`$/sqft ${pctBelow}% below metro median`);
    } else if (ratio <= 0.9) {
      total += 4;
      breakdown["Price/Sqft Outlier"] = 4;
      signals.push(`$/sqft ${pctBelow}% below metro median`);
    }
  }

  total = Math.min(Math.max(total, 0), 100);
  const tier: ScoreResult["tier"] = total >= 45 ? "HOT" : total >= 33 ? "WARM" : "WATCH";
  return { total, tier, breakdown, signals, relativeDom };
}

// ---------------------------------------------------------------------------
// Freshness gate — drop sweep-artifact results before they're scored/stored
//
// PHASE 1d FINDING (scripts/diag-staleness.ts, run against the 564
// rentcast:listing:* cache entries accumulated across the 3 seeded metros):
// DOM/listedDate age for the high-DOM tail (147/564, 26%) is SMOOTHLY
// distributed from ~280 to ~420 days — no anomalous spike concentrated at
// exactly 365 days that would indicate a systemic "1-year placeholder"
// data-quality artifact in RentCast's feed. Cross-checked against the
// flagship repro case (12400 Cedar St, Austin — DOM 330, TWO distinct
// history events including a real $14.95M -> $9.9M price cut dated
// 2025-09-12) confirms these are genuinely long-on-market real MLS records,
// not artifacts — exactly the "motivated seller" demographic this product
// targets. So this gate deliberately does NOT blanket-drop on DOM or age.
//
// What it DOES drop — a narrow, specific placeholder signature: listedDate
// within 1 day of exactly 365 days old AND exactly one price-history entry
// whose own date equals that listedDate (RentCast has no distinguishable
// "before" state — the single history point IS the computed listedDate,
// consistent with a feed defaulting to "today minus 1 year" when the true
// first-listed date is unknown, not an authentic multi-event MLS history).
// Every genuine long-tenure listing sampled in Phase 1d carried >= 2
// distinct history events with independent dates, so this signature is
// deliberately narrow rather than a broad "old + quiet" filter — a broad
// filter would have caught 12400 Cedar St itself (no price event in the
// last 180 days either) and thrown away the exact listing this whole
// investigation is about.
//
// status != "Active" is already excluded upstream: mapActiveListing() in
// rentcast.ts returns null for any non-Active raw record before a result
// ever becomes a DiscoveredListing, so there's no separate status check
// needed here.
function isLikelyPlaceholderArtifact(l: DiscoveredListing): boolean {
  if (!l.listedDate) return false;
  const ageDays = (Date.now() - new Date(l.listedDate).getTime()) / 86_400_000;
  const isAnniversaryAge = Math.abs(ageDays - 365) <= 1;
  if (!isAnniversaryAge) return false;
  if (l.priceHistory.length !== 1) return false;
  return l.priceHistory[0].date.slice(0, 10) === l.listedDate.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Per-city fetch
// ---------------------------------------------------------------------------

export interface USDiscoverFetchResult {
  listings: Listing[];
  fetchedCount: number;
  /** Sweep-artifact results dropped by isLikelyPlaceholderArtifact() before
   * scoring/storage — see that function's doc comment. */
  droppedArtifacts: number;
}

/**
 * One quota-guarded RentCast /listings/sale call for `cfg.name, cfg.state`
 * (via discoverActiveListingsByCity — already city-wide, already cached +
 * quota-guarded, see rentcast.ts's module doc). Primes the per-address
 * listing cache with a TTL matching this pipeline's own refresh cadence
 * (listingCacheTtlSeconds(), not RentCast's default 24h — see that
 * function's doc comment) so a seeded listing is a guaranteed cache hit for
 * on-demand /assess lookups until the next sweep. Filters out sweep
 * artifacts (isLikelyPlaceholderArtifact()) before mapping. Maps each
 * surviving result through buildUsListing() (src/lib/pipeline/us-assess.ts)
 * — the SAME mapper the per-address /assess flow uses, reused here rather
 * than duplicated — then scores it. Returns [] (not a throw) on a
 * quota-blocked or empty response, matching discoverActiveListingsByCity's
 * own degrade-gracefully contract.
 */
export async function fetchUSCityListings(
  cfg: USDiscoverCityConfig,
  keyOpts?: { apiKeyOverride: string; quotaNamespace: string }
): Promise<USDiscoverFetchResult> {
  const discovered: DiscoveredListing[] = await discoverActiveListingsByCity(
    cfg.name,
    cfg.state,
    LISTINGS_PER_CITY,
    listingCacheTtlSeconds(),
    keyOpts
  );

  if (discovered.length === 0) return { listings: [], fetchedCount: 0, droppedArtifacts: 0 };

  const filtered = discovered.filter((d) => !isLikelyPlaceholderArtifact(d));
  const droppedArtifacts = discovered.length - filtered.length;

  // Map to Listing shape via the shared us-assess mapper. This is a city
  // search result, not a per-address bundle, so record/avm/rent are null —
  // buildUsListing already treats a missing `record` as an honest
  // empty/undefined field (see its doc comment), not an error.
  const mapped: Listing[] = filtered.map((d) =>
    buildUsListing(
      { record: null, avm: null, rent: null, activeListing: d, meta: { quotaExhausted: false, cacheHits: 0, liveCalls: 0, errors: [] } },
      cfg.name,
      cfg.state,
      {
        surface: "discover_seed",
        normalizedAddress: d.formattedAddress ?? d.addressLine1,
        recordQueried: false,
        listingQueried: true,
      }
    )
  );

  // Batch-level $/sqft median — computed in-process from this same
  // response, zero extra requests.
  const cityMedianPpsf = computeCityMedianPpsf(mapped);

  // County ACS median home value (regional_econ, Phase 2 ingest) — a
  // Postgres read, not a RentCast call, so it costs zero quota.
  const countyMedian = await getAcsCountyMedian(cfg.countyFips);

  // County median DOM (realtor.com via FRED, scripts/ingest-us-dom.ts) —
  // also a Postgres read, zero quota. Fetched ONCE per city (like
  // countyMedian above), not per listing — every listing in a city batch
  // shares the same county, so the baseline is identical for all of them.
  // Current calendar month, not the listing's own listedDate: the question
  // this signal answers is "how does this listing's DOM compare to what's
  // typical right now", so getCountyMedianDom's same-month-last-year
  // preference should anchor on today's month.
  const currentMonth = new Date().getMonth() + 1;
  const domBaseline = await getCountyMedianDom(cfg.countyFips, currentMonth);

  const now = new Date().toISOString();
  const scored: Listing[] = mapped.map((listing) => {
    const result = scoreUSListing(listing, cityMedianPpsf, countyMedian?.value ?? null, domBaseline);
    return {
      ...listing,
      preScore: result.total,
      preTier: result.tier,
      preSignals: result.signals,
      preRelativeDom: result.relativeDom,
      source: "cron",
      enrichedAt: now,
    };
  });

  // Top-N by score — see TOP_N_PER_CITY's doc comment above.
  scored.sort((a, b) => (b.preScore ?? 0) - (a.preScore ?? 0));
  const top = scored.slice(0, TOP_N_PER_CITY);

  return { listings: top, fetchedCount: discovered.length, droppedArtifacts };
}

// ---------------------------------------------------------------------------
// Full refresh across all configured metros
// ---------------------------------------------------------------------------

export interface USDiscoverCityRunResult {
  city: string;
  state: string;
  slug: string;
  skipped: boolean;
  skipReason?: string;
  fetched: number;
  scored: number;
  // Sweep artifacts dropped by the freshness gate (isLikelyPlaceholderArtifact
  // in fetchUSCityListings above) — 0 when the city was skipped.
  droppedArtifacts?: number;
  // Top-N enrichment stats (see enrichUSCityListings in us-enrich.ts) —
  // undefined when the city was skipped (no fetch, nothing to enrich).
  enrichAttempted?: number;
  enrichSucceeded?: number;
  enrichQuotaStoppedEarly?: boolean;
}

export interface USDiscoverRefreshResult {
  cities: USDiscoverCityRunResult[];
  totalListings: number;
  quotaAfter: Awaited<ReturnType<typeof getRentcastQuotaStatus>>;
  /** Slow-fill (Part 4): the metro newly activated this cycle, if quota
   * headroom allowed one — null on a cycle that only refreshed existing
   * active metros (or where the queue is already exhausted). */
  activatedMetro?: { city: string; state: string; slug: string } | null;
}

/**
 * Fetch+score+enrich ONE metro (1 RentCast discover call + up to
 * usEnrichTopN() enrichment calls) and stamp its last-refresh timestamp.
 * Shared by both the "refresh a due active metro" loop and the "sweep a
 * newly-activated metro" step below — same work either way, the only
 * difference is which list the caller drew `cfg` from. Last-refresh is
 * ONLY stamped here, i.e. only on an attempt that actually ran (the
 * caller is responsible for the quota-reserve gate BEFORE calling this —
 * see refreshUSDiscover's 2026-08-09 incident comment above
 * quotaReserve()).
 */
async function sweepOneMetro(cfg: USDiscoverCityConfig): Promise<{
  result: USDiscoverCityRunResult;
  newListings: Listing[];
}> {
  try {
    const { listings, fetchedCount, droppedArtifacts } = await fetchUSCityListings(cfg);

    // Enrich the top-N scored listings (default 3 — see
    // usEnrichTopN()'s doc comment in us-enrich.ts) within this same run,
    // before writing to KV. Quota-guarded internally — degrades to
    // "leave sparse" rather than throwing if the monthly cap is hit
    // partway through.
    let enrichedListings = listings;
    let enrichAttempted = 0;
    let enrichSucceeded = 0;
    let enrichQuotaStoppedEarly = false;
    if (listings.length > 0) {
      const enrichResult = await enrichUSCityListings(listings, cfg);
      enrichedListings = enrichResult.listings;
      enrichAttempted = enrichResult.attempted;
      enrichSucceeded = enrichResult.succeeded;
      enrichQuotaStoppedEarly = enrichResult.quotaStoppedEarly;
    }

    await setLastRefresh(cfg.slug);

    return {
      result: {
        city: cfg.name,
        state: cfg.state,
        slug: cfg.slug,
        skipped: false,
        fetched: fetchedCount,
        scored: enrichedListings.length,
        droppedArtifacts,
        enrichAttempted,
        enrichSucceeded,
        enrichQuotaStoppedEarly,
      },
      newListings: enrichedListings,
    };
  } catch (err) {
    return {
      result: {
        city: cfg.name,
        state: cfg.state,
        slug: cfg.slug,
        skipped: false,
        skipReason: `error: ${err instanceof Error ? err.message : String(err)}`,
        fetched: 0,
        scored: 0,
      },
      newListings: [],
    };
  }
}

/**
 * Iterate the current active metro set (getActiveUSDiscoverCities() —
 * KV-persisted, growable via the slow-fill queue, seeded from
 * US_DISCOVER_CITIES on first read; see city-metadata.ts's Part 4 doc),
 * skip any city refreshed within US_DISCOVER_REFRESH_DAYS OR whose refresh
 * would breach the quota reserve (US_DISCOVER_QUOTA_RESERVE, see
 * quotaReserve() above — a reserve-skipped city is NOT stamped, so it
 * stays "due" until real headroom returns), fetch+score+enrich the rest
 * (sweepOneMetro), merge into the shared KV listings store (the SAME
 * listings:all key CA listings live in — see kv/listings.ts's doc comment;
 * US listings carry province = USPS state code, distinguished from CA
 * province codes via isUSState() in assessment/us.ts).
 *
 * SLOW FILL (Part 4): after refreshing the active set, if there's still
 * headroom beyond the reserve PLUS one more sweep's estimated cost
 * (ESTIMATED_SWEEP_COST), activate exactly one new metro from
 * US_METRO_FILL_QUEUE and sweep it immediately — "one per cycle" growth.
 * INCLUDED-ALLOWANCE PACING MATH (50 req/mo, reserve 10 → ~40 spendable/mo): 3
 * active metros refreshed every 3 days costs ~30 discover calls/mo alone
 * (enrichment is separately quota-guarded per listing and just degrades
 * sparse under pressure rather than failing) — on a typical month that
 * leaves single-digit headroom for activation, so expect roughly one new
 * metro every 1-3 months on the free tier once 3-4 metros are active,
 * accelerating only if actual on-demand /assess traffic stays low that
 * month. FOUNDATION TIER (1,000 req/mo, same reserve ratio) has ~950
 * spendable/mo — refreshing even the full ~60-metro queue daily
 * (60 * ~1 discover call/day = ~60/day = ~1,800/mo) exceeds that, so
 * US_DISCOVER_REFRESH_DAYS should move to a higher cadence too (e.g. 3-4
 * days keeps ~60 metros under budget: 60 * ~10 refreshes/mo ≈ 600 discover
 * calls + enrichment); either way activation itself is headroom-driven and
 * needs zero code change — it naturally happens every cycle instead of
 * every few months once the monthly budget stops being the binding
 * constraint. Both tiers: this function's logic is identical, only the env
 * vars (RENTCAST_MONTHLY_QUOTA, US_DISCOVER_QUOTA_RESERVE,
 * US_DISCOVER_REFRESH_DAYS) change.
 */
export async function refreshUSDiscover(): Promise<USDiscoverRefreshResult> {
  const results: USDiscoverCityRunResult[] = [];
  const intervalMs = refreshIntervalDays() * 24 * 60 * 60 * 1000;
  const allNew: Listing[] = [];
  const reserve = quotaReserve();

  // -------------------------------------------------------------------------
  // [pipeline-guard] Pre-flight: can this run read the store it is going to
  // overwrite? Everything below ends in one merge-write of
  // `[...kept, ...deduped]`, where `kept` is every stored row this sweep did
  // NOT re-fetch — the ~2,300 CA rows included. So the read that produces
  // `kept` is the single point where a transient KV failure turns this cron
  // into a mass deletion of listings it never even looked at.
  //
  // This used to go through getAllListings(), which flattens an unreadable
  // store to `[]` and reports the degradation only through the process-global
  // getListingsStoreHealth() stamp — mutable state a concurrent request on
  // the same warm lambda can overwrite between the read and the check. Same
  // reasoning as src/app/api/pipeline/refresh/route.ts's Phase 2 abort, which
  // is where this pattern is written up in full: readListingsStore() returns
  // the store's real state on the stack, with no dev-seed path and no shared
  // mutable stamp, so it cannot lose the distinction.
  //
  // writeAllListings()'s floor guard would very probably catch the resulting
  // payload (a ~60-row US batch against a ~2,300-row store is far under its
  // 40% ratio) — but that is a backstop catching a bug, and by the time it
  // fires this run has already spent its RentCast quota, which is 50
  // successful requests for the entire MONTH, on a payload that gets thrown
  // away. So the check runs here, before the first sweep, and it throws:
  // this executes inside a cron whose log is the only place a human ever
  // sees it, and the caller (pipeline/refresh/route.ts) already catches and
  // records a US-discover failure without letting it undo the CA run.
  // -------------------------------------------------------------------------
  const preflight = await readListingsStore();
  if (preflight.status === "unavailable") {
    throw new Error(
      `[pipeline-guard] US Discover aborted before any RentCast spend: the listings store is unreadable ` +
        `(${preflight.reason}). This run's write merges new US rows onto every stored row it did not ` +
        `re-fetch, so building that payload from a store it cannot read would drop the entire CA set too.`
    );
  }

  const activeCities = await getActiveUSDiscoverCities();

  for (const cfg of activeCities) {
    const lastRefresh = await getLastRefresh(cfg.slug);
    if (lastRefresh && Date.now() - lastRefresh < intervalMs) {
      const ageDays = Math.round((Date.now() - lastRefresh) / 86_400_000);
      results.push({
        city: cfg.name,
        state: cfg.state,
        slug: cfg.slug,
        skipped: true,
        skipReason: `refreshed ${ageDays}d ago (< ${refreshIntervalDays()}d interval)`,
        fetched: 0,
        scored: 0,
      });
      continue;
    }

    // Quota-reserve gate — see the 2026-08-09 incident comment above
    // quotaReserve(). Checked fresh before EVERY city (not once at the top
    // of the loop) since enrichment from an earlier city in this same run
    // can consume headroom the later cities need to see.
    const quotaBeforeCity = await getRentcastQuotaStatus();
    const headroomBeforeCity = quotaBeforeCity.limit - quotaBeforeCity.used;
    if (headroomBeforeCity <= reserve) {
      console.log(
        `[us-discover] ${cfg.name}, ${cfg.state}: skipped — quota reserve guard ` +
          `(${headroomBeforeCity} left, reserve ${reserve}); listings preserved, not re-stamped`
      );
      results.push({
        city: cfg.name,
        state: cfg.state,
        slug: cfg.slug,
        skipped: true,
        skipReason: `quota reserve guard (${headroomBeforeCity} left, reserve ${reserve})`,
        fetched: 0,
        scored: 0,
      });
      continue;
    }

    const { result, newListings } = await sweepOneMetro(cfg);
    results.push(result);
    allNew.push(...newListings);
  }

  // Slow fill (Part 4) — one new metro per cycle, only if headroom clears
  // the reserve AND one more sweep's estimated cost.
  let activatedMetro: USDiscoverRefreshResult["activatedMetro"] = null;
  const quotaAfterActive = await getRentcastQuotaStatus();
  const headroomAfterActive = quotaAfterActive.limit - quotaAfterActive.used;
  if (headroomAfterActive > reserve + ESTIMATED_SWEEP_COST) {
    const next = await activateNextQueuedMetro();
    if (next) {
      console.log(`[us-discover] activating new metro: ${next.name}, ${next.state} (headroom ${headroomAfterActive})`);
      const { result, newListings } = await sweepOneMetro(next);
      results.push(result);
      allNew.push(...newListings);
      activatedMetro = { city: next.name, state: next.state, slug: next.slug };
    }
  } else {
    console.log(
      `[us-discover] slow-fill: no activation this cycle (headroom ${headroomAfterActive}, ` +
        `need > reserve(${reserve}) + sweep-cost(${ESTIMATED_SWEEP_COST}))`
    );
  }

  if (allNew.length > 0) {
    // Re-read rather than reusing the pre-flight snapshot: the sweeps above
    // can take minutes, and this is the array that will be written back over
    // the store, so it has to reflect the store as it is now. Same typed read
    // and same refusal — the pre-flight above saves the quota, this one is
    // what actually protects the write.
    const storeRead = await readListingsStore();
    if (storeRead.status === "unavailable") {
      throw new Error(
        `[pipeline-guard] US Discover merge-write aborted: the listings store became unreadable ` +
          `(${storeRead.reason}) after ${allNew.length} new listing(s) were fetched. Writing now would ` +
          `replace every stored listing with just this run's US rows. The fetched rows are dropped; the ` +
          `next cycle re-fetches them (last-refresh was stamped per city, so budget the re-sweep).`
      );
    }
    const existing = storeRead.status === "ok" ? storeRead.listings : [];
    // Normalized keys collapse abbreviation variants ("Tx Hwy"/"Texas Hwy")
    // and dedupe the new batch against itself (city sweeps can return the
    // same property twice under different address spellings).
    const seen = new Set<string>();
    const deduped = allNew.filter((l) => {
      const key = buildUsListingDedupKey(l.address, l.city, l.province);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const kept = existing.filter((l) => !seen.has(buildUsListingDedupKey(l.address, l.city, l.province)));
    const writeResult = await writeAllListings([...kept, ...deduped]);
    if (writeResult.refused) {
      console.error(`[pipeline-guard] US Discover merge-write refused: ${writeResult.refusedReason}`);
    }
  }

  const quotaAfter = await getRentcastQuotaStatus();
  return {
    cities: results,
    totalListings: allNew.length,
    quotaAfter,
    activatedMetro,
  };
}
