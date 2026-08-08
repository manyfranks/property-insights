/**
 * POST /api/assess
 *
 * On-demand property assessment.
 *
 * Canadian addresses: finds the listing on Zoocasa, enriches it (scoring +
 * offer model + LLM), saves to KV, and emails the result to the user. The
 * response is `{ ok, slug, address, city, emailSent }` — the frontend
 * redirects to /property/[slug] to render the full analysis.
 *
 * US addresses: RentCast (src/lib/rentcast.ts) plays Zoocasa's role — see
 * handleUSAssessment(). Rendered inline by the caller (no slug, no
 * redirect; there's no KV-persisted listing to send a /property/[slug] page
 * to). Three response shapes, all `{ ok, country: "US", address, city,
 * state, countyName, countyFips, assessment, marketPanel, ... }` plus:
 *   - Listed (RentCast has an active listing): `offerAvailable: true,
 *     listing, score, signals, offer, comparables`, plus the US Advantage
 *     layer (src/lib/pipeline/us-advantage.ts — signals with no CA
 *     equivalent): `equitySignal, triangulation, investorYield,
 *     riskMomentum, overAssessment`.
 *   - Off-market (RentCast has property/AVM data, no active listing):
 *     `offerAvailable: false, offerUnavailableReason: "not_listed", avm,
 *     rent`, plus the same US Advantage fields (AVM value stands in for
 *     asking price).
 *   - Fallback (RentCast quota exhausted / API down / no record at all):
 *     `offerAvailable: false, offerUnavailableReason: "no_listing_data"` —
 *     the original county-median-only shape, unchanged (no RentCast record
 *     means no basis for the US Advantage layer either).
 *
 * Auth required (Clerk).
 * maxDuration: 60s (assessment lookup + LLM call).
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { findAndFetchDetail, fetchDetailByUrl, parseZoocasaUrl, ZoocasaNotFoundError } from "@/lib/zoocasa";
import { enrichListing } from "@/lib/pipeline/enrich";
import { upsertListing } from "@/lib/kv/listings";
import { trackEvent } from "@/lib/db/user-events";
import { sendAssessmentEmail } from "@/lib/email";
import { assessLimiter } from "@/lib/rate-limit";
import { isPro } from "@/lib/billing";
import { slugify } from "@/lib/utils";
import { geocodeUSAddress } from "@/lib/geo/census-geocoder";
import { lookupAssessment } from "@/lib/assessment";
import { getCountyMarketPanel } from "@/lib/db/regional-econ";
import { getUSProperty } from "@/lib/rentcast";
import { buildUsAssessment, buildUsListing, buildUsCompSupport } from "@/lib/pipeline/us-assess";
import { buildUsAdvantageBundle, applyEquitySignalToScore, equitySignalLabel } from "@/lib/pipeline/us-advantage";
import { generateUsNarrative, deterministicUsNarrative } from "@/lib/pipeline/us-narrative";
import { getSignals } from "@/lib/signals";
import { scoreV2 } from "@/lib/scoring";
import { offerModel, offerModelLanguage } from "@/lib/offer-model";

const RATE_LIMIT_RESPONSE = (resetMs: number) =>
  NextResponse.json(
    { error: "Daily assessment limit reached (15/day). Resets in 24 hours.", code: "RATE_LIMIT" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
  );

export const maxDuration = 60;

// Region mapping: full names + common abbreviations → region codes.
// Canadian provinces map to lowercase 2-letter codes (unchanged from the
// original PROVINCE_MAP — Zoocasa's search API expects these lowercase).
// US states/DC map to UPPERCASE USPS codes, which doubles as the CA/US
// discriminator below (no Canadian code is ever uppercase 2 letters).
const REGION_MAP: Record<string, string> = {
  // Canada
  "british columbia": "bc",
  bc: "bc",
  alberta: "ab",
  ab: "ab",
  ontario: "on",
  on: "on",
  quebec: "qc",
  qc: "qc",
  manitoba: "mb",
  mb: "mb",
  saskatchewan: "sk",
  sk: "sk",
  "nova scotia": "ns",
  ns: "ns",
  "new brunswick": "nb",
  nb: "nb",
  "prince edward island": "pe",
  pe: "pe",
  pei: "pe",
  "newfoundland and labrador": "nl",
  nl: "nl",

  // United States — 50 states + DC (US support lands in a later phase;
  // for now these just let parseAddress recognize the address so the
  // route can return a clear "not yet" response instead of failing to
  // parse at all).
  alabama: "AL", al: "AL",
  alaska: "AK", ak: "AK",
  arizona: "AZ", az: "AZ",
  arkansas: "AR", ar: "AR",
  california: "CA", ca: "CA",
  colorado: "CO", co: "CO",
  connecticut: "CT", ct: "CT",
  delaware: "DE", de: "DE",
  florida: "FL", fl: "FL",
  georgia: "GA", ga: "GA",
  hawaii: "HI", hi: "HI",
  idaho: "ID", id: "ID",
  illinois: "IL", il: "IL",
  indiana: "IN", in: "IN",
  iowa: "IA", ia: "IA",
  kansas: "KS", ks: "KS",
  kentucky: "KY", ky: "KY",
  louisiana: "LA", la: "LA",
  maine: "ME", me: "ME",
  maryland: "MD", md: "MD",
  massachusetts: "MA", ma: "MA",
  michigan: "MI", mi: "MI",
  minnesota: "MN", mn: "MN",
  mississippi: "MS", ms: "MS",
  missouri: "MO", mo: "MO",
  montana: "MT", mt: "MT",
  nebraska: "NE", ne: "NE",
  nevada: "NV", nv: "NV",
  "new hampshire": "NH", nh: "NH",
  "new jersey": "NJ", nj: "NJ",
  "new mexico": "NM", nm: "NM",
  "new york": "NY", ny: "NY",
  "north carolina": "NC", nc: "NC",
  "north dakota": "ND", nd: "ND",
  ohio: "OH", oh: "OH",
  oklahoma: "OK", ok: "OK",
  oregon: "OR", or: "OR",
  pennsylvania: "PA", pa: "PA",
  "rhode island": "RI", ri: "RI",
  "south carolina": "SC", sc: "SC",
  "south dakota": "SD", sd: "SD",
  tennessee: "TN", tn: "TN",
  texas: "TX", tx: "TX",
  utah: "UT", ut: "UT",
  vermont: "VT", vt: "VT",
  virginia: "VA", va: "VA",
  washington: "WA", wa: "WA",
  "west virginia": "WV", wv: "WV",
  wisconsin: "WI", wi: "WI",
  wyoming: "WY", wy: "WY",
  "district of columbia": "DC", dc: "DC",
};

/**
 * Parse a Google Places address into street, city, region, country.
 * Expected formats:
 *   "123 Main St, Vancouver, BC V5K 1A1, Canada"
 *   "123 Main St, Vancouver, BC, Canada"
 *   "123 Main St, Vancouver, British Columbia, Canada"
 *   "123 Main St, Austin, TX 78701, USA"
 *   "123 Main St, Austin, TX"
 */
function parseAddress(raw: string): {
  street: string;
  city: string;
  region: string;
  country: "CA" | "US";
} | null {
  // Remove trailing country suffix (Canada or USA, in the forms Google
  // Places tends to emit)
  const cleaned = raw
    .replace(/,?\s*(Canada|USA|U\.S\.A\.|United States(?: of America)?)\s*$/i, "")
    .trim();
  const parts = cleaned.split(",").map((p) => p.trim());

  if (parts.length < 3) return null;

  const street = parts[0];
  const city = parts[1];

  // Region is in the third part, possibly with a postal/ZIP code attached
  const regionPart = parts[2]
    .replace(/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i, "") // Strip CA postal code (A1A 1A1)
    .replace(/\b\d{5}(-\d{4})?\b/, "") // Strip US ZIP / ZIP+4
    .trim()
    .toLowerCase();

  const region = REGION_MAP[regionPart];
  if (!region) return null;

  const country: "CA" | "US" = /^[A-Z]{2}$/.test(region) ? "US" : "CA";

  return { street, city, region, country };
}

/**
 * US assessment flow. Geocodes the address, then asks RentCast for a
 * property record + AVM value + rent estimate + active-listing lookup
 * (src/lib/rentcast.ts's getUSProperty — cached and quota-guarded against
 * the free-tier 50/month cap). Three outcomes:
 *
 *   1. RentCast has an active listing → run the SAME scoring/offer pipeline
 *      Canada uses (getSignals, scoreV2, offerModel) against a
 *      Listing-shaped mapping of the RentCast data, plus AVM-derived comp
 *      support. offerAvailable: true, same shape of fields as the CA
 *      pipeline produces, with the county marketPanel attached as
 *      enrichment.
 *   2. RentCast has property/AVM data but no active listing → off-market
 *      variant: AVM value + assessed value + rent + county panel,
 *      offerAvailable: false ("not_listed" — there's no asking price or
 *      DOM to model an offer against, not a data failure).
 *   3. RentCast quota exhausted, API error, or genuinely no record for this
 *      address → falls back to the original county-median-only path
 *      (unchanged from the pre-RentCast implementation): never fails the
 *      user's request over a RentCast problem.
 *
 * Auth + rate limiting mirror the Canadian path (see POST): the daily cap
 * is pre-checked by the caller before this runs, and consumed here once the
 * address is confirmed real (geocode match), the same checkpoint the CA
 * path uses ("listing confirmed on Zoocasa").
 */
async function handleUSAssessment({
  userId,
  limiter,
  pro,
  street,
  city,
  region,
  log,
}: {
  userId: string;
  limiter: ReturnType<typeof assessLimiter>;
  pro: boolean;
  street: string;
  city: string;
  region: string;
  log: (step: string, extra?: string) => void;
}) {
  log("us region", `${street} | ${city} | ${region}`);

  let geo;
  try {
    geo = await geocodeUSAddress(`${street}, ${city}, ${region}`);
  } catch (err) {
    log("geocode error", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "Failed to look up this address. Please try again." },
      { status: 502 }
    );
  }

  if (!geo) {
    log("geocode no match");
    return NextResponse.json(
      {
        error:
          "We couldn't locate this address. Please check the spelling and use a full " +
          "street address (e.g., 123 Main St, Austin, TX).",
      },
      { status: 404 }
    );
  }

  log("geocode ok", `${geo.countyName}, ${geo.stateUsps}`);

  // Address confirmed real — consume a slot from the daily cap now (mirrors
  // the CA path consuming only after Zoocasa confirms the listing exists).
  // Pro users bypass the cap entirely.
  if (limiter && !pro) {
    const result = await limiter.limit(userId);
    if (!result.success) {
      return RATE_LIMIT_RESPONSE(result.reset - Date.now());
    }
  }

  const countyFips = `US-${geo.stateFips}${geo.countyFips}`;

  const [bundle, marketPanel] = await Promise.all([
    getUSProperty(street, city, geo.stateUsps).catch((err) => {
      log("rentcast error", err instanceof Error ? err.message : String(err));
      return null;
    }),
    getCountyMarketPanel(countyFips),
  ]);

  log(
    "rentcast done",
    bundle
      ? `record=${!!bundle.record} avm=${!!bundle.avm} rent=${!!bundle.rent} listing=${!!bundle.activeListing} ` +
        `cacheHits=${bundle.meta.cacheHits} liveCalls=${bundle.meta.liveCalls} quotaExhausted=${bundle.meta.quotaExhausted}` +
        (bundle.meta.errors.length ? ` errors=${bundle.meta.errors.join("; ")}` : "")
      : "call failed"
  );

  const hasUsableRentcastData = bundle && (bundle.record || bundle.avm);

  // Fallback path — quota exhausted, RentCast API down, or genuinely no
  // record for this address. Identical to the original county-median-only
  // behavior.
  if (!hasUsableRentcastData) {
    const assessment = await lookupAssessment(street, region, city);
    log(
      "us data done (fallback)",
      `assessment_found=${assessment?.found ?? false} panel=${marketPanel ? "yes" : "no"}`
    );

    trackEvent(userId, "assessment_request", {
      address: geo.matchedAddress,
      city,
      state: geo.stateUsps,
      country: "US",
    }).catch(() => {}); // fire and forget

    log("done (US, fallback)", geo.matchedAddress);

    return NextResponse.json({
      ok: true,
      country: "US" as const,
      address: geo.matchedAddress,
      city,
      state: geo.stateUsps,
      countyName: geo.countyName,
      countyFips,
      assessment,
      marketPanel,
      offerAvailable: false,
      offerUnavailableReason: "no_listing_data",
      emailSent: false,
    });
  }

  const assessment = buildUsAssessment(bundle.record, bundle.avm, geo.stateUsps);

  trackEvent(userId, "assessment_request", {
    address: geo.matchedAddress,
    city,
    state: geo.stateUsps,
    country: "US",
  }).catch(() => {}); // fire and forget

  // Listed variant — same pipeline as Canada.
  if (bundle.activeListing) {
    const listing = buildUsListing(bundle, city, geo.stateUsps);
    const baseScore = scoreV2(listing);
    const comparables = buildUsCompSupport(bundle.avm, parseInt(listing.sqft) || 0);

    // US Advantage layer (src/lib/pipeline/us-advantage.ts) — equity/tenure,
    // valuation triangulation, investor yield, risk/momentum, and
    // over-assessment, all computed from data already fetched above (zero
    // extra RentCast calls). The equity signal's score bump is applied here,
    // outside scoring.ts, so CA's scoreV2 weights are untouched.
    const advantage = buildUsAdvantageBundle({
      record: bundle.record,
      askingPrice: listing.price || null,
      avmValue: bundle.avm?.value ?? null,
      taxAssessedValue: bundle.record?.taxAssessments?.[0]?.value ?? null,
      assessmentBasis: assessment?.assessmentBasis,
      compImpliedValue: comparables.impliedValue,
      monthlyRent: bundle.rent?.value ?? null,
      marketPanel,
    });

    const score = applyEquitySignalToScore(baseScore, advantage.equitySignal);
    const equityLabel = equitySignalLabel(advantage.equitySignal);
    const signals = equityLabel ? [...getSignals(listing), equityLabel] : getSignals(listing);

    const offer = assessment?.found ? offerModel(listing, assessment) : offerModelLanguage(listing);

    // THE SIGNAL — LLM narrative (US analogue of the CA pipeline's
    // analyzeAndNarrate/enrichListing; see src/lib/pipeline/us-narrative.ts
    // for why the US prompt differs). Time-boxed internally (~12s) so a
    // slow/hung OpenRouter call can't eat into this route's 60s
    // maxDuration; falls back to the deterministic template on any
    // failure/timeout so "THE SIGNAL" never renders empty. Off-market
    // properties don't get this — no listing story to tell there.
    const narrativeContext = { listing, assessment, offer, signals, comparables, advantage, marketPanel };
    let narrative: string;
    let narrativeSignals: string[] = [];
    let narrativeConfidence = 0;
    try {
      const llmResult = await generateUsNarrative(narrativeContext);
      if (llmResult.narrative) {
        narrative = llmResult.narrative;
        narrativeSignals = llmResult.signals;
        narrativeConfidence = llmResult.confidence;
      } else {
        narrative = deterministicUsNarrative(narrativeContext);
      }
    } catch (err) {
      log("narrative error", err instanceof Error ? err.message : String(err));
      narrative = deterministicUsNarrative(narrativeContext);
    }

    log(
      "done (US, listed)",
      `${geo.matchedAddress} tier=${score.tier} offer=${offer?.finalOffer} anchor=${assessment?.source} ` +
        `equity=${advantage.equitySignal?.tier ?? "none"} triangulation=${advantage.triangulation.confidence} ` +
        `narrative=${narrative.length}chars`
    );

    return NextResponse.json({
      ok: true,
      country: "US" as const,
      address: geo.matchedAddress,
      city,
      state: geo.stateUsps,
      countyName: geo.countyName,
      countyFips,
      assessment,
      marketPanel,
      offerAvailable: true as const,
      listing,
      score,
      signals,
      offer,
      comparables,
      equitySignal: advantage.equitySignal,
      triangulation: advantage.triangulation,
      investorYield: advantage.investorYield,
      riskMomentum: advantage.riskMomentum,
      overAssessment: advantage.overAssessment,
      narrative,
      narrativeSignals,
      narrativeConfidence,
      emailSent: false,
    });
  }

  // Off-market variant — RentCast has data on the property, but it isn't
  // currently listed for sale. No asking price or DOM to anchor an offer
  // model against; surface AVM/assessed/rent instead. Still worth the full
  // US Advantage layer — an off-market property can still show equity/
  // tenure, triangulation, yield, and risk/momentum using the AVM value as
  // the market reference (currentValueKind: "avm_estimate").
  const offMarketComparables = buildUsCompSupport(bundle.avm, bundle.record?.squareFootage ?? 0);
  const advantage = buildUsAdvantageBundle({
    record: bundle.record,
    askingPrice: null,
    avmValue: bundle.avm?.value ?? null,
    taxAssessedValue: bundle.record?.taxAssessments?.[0]?.value ?? null,
    assessmentBasis: assessment?.assessmentBasis,
    compImpliedValue: offMarketComparables.impliedValue,
    monthlyRent: bundle.rent?.value ?? null,
    marketPanel,
  });

  log(
    "done (US, off-market)",
    `${geo.matchedAddress} assessed=${assessment?.totalValue} avm=${bundle.avm?.value} rent=${bundle.rent?.value} ` +
      `equity=${advantage.equitySignal?.tier ?? "none"} triangulation=${advantage.triangulation.confidence}`
  );

  return NextResponse.json({
    ok: true,
    country: "US" as const,
    address: geo.matchedAddress,
    city,
    state: geo.stateUsps,
    countyName: geo.countyName,
    countyFips,
    assessment,
    avm: bundle.avm
      ? { value: bundle.avm.value, rangeLow: bundle.avm.rangeLow, rangeHigh: bundle.avm.rangeHigh }
      : null,
    rent: bundle.rent
      ? { value: bundle.rent.value, rangeLow: bundle.rent.rangeLow, rangeHigh: bundle.rent.rangeHigh }
      : null,
    marketPanel,
    offerAvailable: false as const,
    offerUnavailableReason: "not_listed",
    offerUnavailableMessage: "This property is not currently listed for sale.",
    equitySignal: advantage.equitySignal,
    triangulation: advantage.triangulation,
    investorYield: advantage.investorYield,
    riskMomentum: advantage.riskMomentum,
    overAssessment: advantage.overAssessment,
    emailSent: false,
  });
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const log = (step: string, extra?: string) =>
    console.log(`[assess] ${step} (${Date.now() - t0}ms)${extra ? " — " + extra : ""}`);

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to request an assessment" }, { status: 401 });
  }

  // Pro users bypass the daily assessment cap entirely.
  const pro = await isPro(userId);

  // Daily cap pre-check (no consume) — blocks spam without charging the user.
  // The slot is consumed below, after Zoocasa confirms the listing is real,
  // so failed lookups (bad address, listing not found) don't count.
  const limiter = assessLimiter();
  if (limiter && !pro) {
    const { remaining, reset } = await limiter.getRemaining(userId);
    if (remaining <= 0) {
      return RATE_LIMIT_RESPONSE(reset - Date.now());
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawAddress = typeof body.address === "string" ? body.address.trim() : "";
  log("start", rawAddress);

  // Length check + reject control characters and obvious injection patterns
  if (!rawAddress || rawAddress.length > 500 || /[\x00-\x1f<>{}]/.test(rawAddress)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  // Check if input is a Zoocasa URL
  const isZoocasaUrl = parseZoocasaUrl(rawAddress);

  let detail;

  if (isZoocasaUrl) {
    // Direct URL fetch — bypass address parsing entirely
    log("url detected", `zoocasa → ${isZoocasaUrl.city}, ${isZoocasaUrl.province}`);
    try {
      detail = await fetchDetailByUrl(rawAddress);
      log("zoocasa ok", detail.listing.address);
    } catch (err) {
      log("zoocasa error", err instanceof Error ? err.message : String(err));
      if (err instanceof ZoocasaNotFoundError) {
        return NextResponse.json(
          { error: "This listing wasn't found on Zoocasa. It may no longer be active." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to load this listing. Please try again." },
        { status: 502 }
      );
    }
  } else {
    // Standard address parsing flow
    const parsed = parseAddress(rawAddress);
    if (!parsed) {
      log("parse failed");
      return NextResponse.json(
        {
          error:
            "Could not parse address. Please use a full Canadian or US address " +
            "(e.g., 123 Main St, Vancouver, BC or 123 Main St, Austin, TX) or paste a Zoocasa listing URL.",
        },
        { status: 400 }
      );
    }

    const { street, city, region, country } = parsed;
    log("parsed", `${street} | ${city} | ${region} (${country})`);

    if (country === "US") {
      return handleUSAssessment({ userId, limiter, pro, street, city, region, log });
    }

    try {
      detail = await findAndFetchDetail(street, city, region);
      log("zoocasa ok", `${detail.listing.address}${detail.listing.unit ? " unit=" + detail.listing.unit : ""}`);
    } catch (err) {
      log("zoocasa error", err instanceof Error ? err.message : String(err));
      if (err instanceof ZoocasaNotFoundError) {
        return NextResponse.json(
          {
            error:
              "We couldn't find this property in Zoocasa's active listings. " +
              "If you have the Zoocasa listing URL, paste it here for an exact match.",
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to look up this property. Please try again." },
        { status: 502 }
      );
    }
  }

  // Lookup succeeded — now consume a slot from the daily cap. Race with the
  // pre-check is acceptable: the cap is per-user-per-day, not a security gate.
  // Pro users bypass the cap entirely.
  if (limiter && !pro) {
    const result = await limiter.limit(userId);
    if (!result.success) {
      return RATE_LIMIT_RESPONSE(result.reset - Date.now());
    }
  }

  const listing = detail.listing;

  // Fetch sold pool for comparables
  let soldPool: import("@/lib/zoocasa").ZoocasaSoldRaw[] = [];
  try {
    log("sold pool fetch");
    const { fetchSoldListings } = await import("@/lib/zoocasa");
    soldPool = await fetchSoldListings(listing.city, listing.province);
    log("sold pool done", `${soldPool.length} listings`);
  } catch (err) {
    log("sold pool failed", err instanceof Error ? err.message : String(err));
  }

  // Enrich with scoring, offer model, comparables, and LLM narrative
  // Always use LLM for on-demand user requests (even WATCH tier)
  log("enrich start");
  const enriched = await enrichListing(listing, { forceLlm: true, soldPool });
  log("enrich done", `tier=${enriched.preTier} score=${enriched.preScore} offer=${enriched.preOffer?.final_offer}`);

  // Tag source and enrichment time
  enriched.source = "user";
  enriched.enrichedAt = new Date().toISOString();

  // Save to KV
  log("kv write");
  await upsertListing(enriched);
  log("kv done");

  const slug = slugify(enriched.address);

  // Get user email from Clerk and send assessment
  let emailSent = false;
  try {
    log("email start");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.emailAddresses?.[0]?.emailAddress;

    if (email && enriched.preNarrative) {
      const result = await sendAssessmentEmail(email, {
        listing: enriched,
        tier: enriched.preTier || "WATCH",
        score: enriched.preScore || 0,
        narrative: enriched.preNarrative,
        finalOffer: enriched.preOffer?.final_offer,
        savings: enriched.preOffer?.savings,
        percentOfList: enriched.preOffer?.pct_of_list,
      });
      emailSent = result.success;
      log("email done", emailSent ? "sent" : "not sent");
    } else {
      log("email skip", `email=${!!email} narrative=${!!enriched.preNarrative}`);
    }
  } catch (err) {
    log("email error", err instanceof Error ? err.message : String(err));
  }

  // Track assessment request (strongest intent signal)
  trackEvent(userId, "assessment_request", {
    address: enriched.address,
    city: enriched.city,
    price: enriched.price,
    slug,
  }).catch(() => {}); // fire and forget

  log("done", slug);
  return NextResponse.json({
    ok: true,
    slug,
    address: enriched.address,
    city: enriched.city,
    emailSent,
  });
}
