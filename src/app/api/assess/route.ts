/**
 * POST /api/assess
 *
 * On-demand property assessment.
 *
 * Canadian addresses: finds the listing on Zoocasa, enriches it (scoring +
 * offer model + LLM), saves to KV, and emails the result to the user. The
 * response is `{ ok, slug, address, city, assessmentSubject, emailSent }` — the frontend
 * redirects to /property/[slug] to render the full analysis.
 *
 * US addresses: RentCast (src/lib/rentcast.ts) plays Zoocasa's role — see
 * handleUSAssessment(). Rendered inline by the caller (no slug, no
 * redirect; there's no KV-persisted listing to send a /property/[slug] page
 * to). Three response shapes, all `{ ok, country: "US", address, city,
 * state, countyName, countyFips, assessment, assessmentSubject,
 * marketPanel, ... }` plus:
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
 *     `offerAvailable: false, offerUnavailableReason: "no_listing_data",
 *     propertyDataUnavailableReason` — the original county-median-only
 *     presentation, plus a machine-readable reason for the degradation (no
 *     RentCast record means no basis for the US Advantage layer either).
 *
 * `assessmentSubject` is the additive P2 shadow envelope. P3 adds
 * `propertyClassification` and `propertyCapabilities` beside it. All three
 * are computed from already-fetched evidence, never change the selected
 * journey, and never trigger a new external-provider call. The CA P3 path
 * may read the already-ingested CMHC table for a regional-rent capability.
 *
 * Auth required (Clerk).
 * maxDuration: 60s (assessment lookup + LLM call).
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { after, NextResponse } from "next/server";
import { findAndFetchDetail, fetchDetailByUrl, parseZoocasaUrl, ZoocasaNotFoundError } from "@/lib/zoocasa";
import { enrichListing } from "@/lib/pipeline/enrich";
import { upsertListing } from "@/lib/kv/listings";
import { trackEvent } from "@/lib/db/user-events";
import { recordPropertyIntelligenceShadow } from "@/lib/db/property-intelligence-events";
import { sendAssessmentEmail } from "@/lib/email";
import { assessLimiter } from "@/lib/rate-limit";
import { isPro } from "@/lib/billing";
import { slugify } from "@/lib/utils";
import { geocodeUSAddress } from "@/lib/geo/census-geocoder";
import { lookupAssessment } from "@/lib/assessment";
import { getCmaFipsForCity, getCmaRent, getCountyMarketPanel } from "@/lib/db/regional-econ";
import { getUSProperty } from "@/lib/rentcast";
import { lookupCountyLive } from "@/lib/assessment/us-county";
import {
  buildUsAssessment,
  buildUsListing,
  buildUsCompSupport,
  assessAnchorPlausibility,
} from "@/lib/pipeline/us-assess";
import { buildUsAdvantageBundle, applyEquitySignalToScore, equitySignalLabel } from "@/lib/pipeline/us-advantage";
import { generateUsNarrative, deterministicUsNarrative } from "@/lib/pipeline/us-narrative";
import { lintUsNarrative, logNarrativeLint } from "@/lib/pipeline/narrative-lint";
import { getSignals } from "@/lib/signals";
import { scoreV2 } from "@/lib/scoring";
import { offerModel, offerModelLanguage } from "@/lib/offer-model";
import { decideUsAssessmentDataPath } from "@/lib/property-intelligence/p0-fallback";
import {
  extractUnitFromAddress,
  resolveAssessmentSubject,
  type AssessmentSubject,
} from "@/lib/property-intelligence/subject";
import {
  addAssessmentEvidence,
  addRentCastEvidence,
  createPropertyEvidenceSnapshot,
  mergePropertyEvidence,
  type AvailableEvidence,
  type PropertyEvidenceSnapshot,
} from "@/lib/property-intelligence/evidence";
import {
  classifyProperty,
  type PropertyClassification,
  type PropertyClassificationFacts,
} from "@/lib/property-intelligence/classification";
import {
  evaluatePropertyCapabilities,
  type CapabilityEvidenceFact,
  type CapabilityScope,
  type PropertyCapabilities,
  type PropertyCapabilityFacts,
} from "@/lib/property-intelligence/capabilities";
import type { USPropertyBundle } from "@/lib/rentcast";
import type { Assessment } from "@/lib/types";
import { parseAssessmentGoal, type AssessmentGoal } from "@/lib/property-intelligence/journey";
import {
  createUserAssessmentState,
  type AssessmentResultVariant,
} from "@/lib/db/user-assessments";

const RATE_LIMIT_RESPONSE = (resetMs: number) =>
  NextResponse.json(
    { error: "Daily assessment limit reached (15/day). Resets in 24 hours.", code: "RATE_LIMIT" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
  );

export const maxDuration = 60;

function shadowSubjectScope(
  subject: AssessmentSubject,
  classification: PropertyClassification
): CapabilityScope {
  if (subject.unit || classification.listingScope.value === "unit") return "unit";
  if (classification.listingScope.value === "whole building" || subject.scope === "building") return "building";
  if (classification.listingScope.value === "parcel" || subject.scope === "parcel") return "parcel";
  return "unknown";
}

function hasLandImprovementSplit(evidence: PropertyEvidenceSnapshot): boolean {
  const lands = evidence.landValues.filter(
    (item): item is AvailableEvidence<number> => item.availability === "available"
  );
  const buildings = evidence.buildingValues.filter(
    (item): item is AvailableEvidence<number> => item.availability === "available"
  );
  return lands.some((land) =>
    buildings.some(
      (building) =>
        building.source === land.source &&
        building.sourceRecordId === land.sourceRecordId
    )
  );
}

function buildPropertyIntelligenceShadow(args: {
  subject: AssessmentSubject;
  evidence: PropertyEvidenceSnapshot;
  classificationFacts?: PropertyClassificationFacts;
  saleValue?: { available: boolean; source: string; regionalOnly?: boolean };
  rentEstimate?: { available: boolean; source: string };
  regionalRent?: { available: boolean; source: string };
  activeListing?: boolean;
  offerComputed?: boolean;
  countyMarketContext?: boolean;
  countyRiskContext?: boolean;
  insurancePrefillCore?: boolean;
}) {
  const propertyClassification = classifyProperty({
    subject: args.subject,
    evidence: args.evidence,
    facts: args.classificationFacts,
  });
  const scope = shadowSubjectScope(args.subject, propertyClassification);
  const scopedFact = (
    fact: { available: boolean; source: string } | undefined,
    factScope: CapabilityScope = scope
  ): CapabilityEvidenceFact | undefined => fact
    ? { available: fact.available, source: fact.source, scope: factScope }
    : undefined;
  const capabilityFacts: PropertyCapabilityFacts = {
    addressSaleValue: args.saleValue
      ? scopedFact(args.saleValue, args.saleValue.regionalOnly ? "regional" : scope)
      : undefined,
    addressRentEstimate: scopedFact(args.rentEstimate),
    regionalRentBenchmark: scopedFact(args.regionalRent, "regional"),
    activeListing: args.activeListing,
    offerComputed: args.offerComputed,
    landImprovementSplit: {
      available: hasLandImprovementSplit(args.evidence),
      source: "property_evidence",
      scope: scope === "building" ? "building" : "parcel",
    },
    countyMarketContext: args.countyMarketContext,
    countyRiskContext: args.countyRiskContext,
    insurancePrefillCore: args.insurancePrefillCore,
  };
  const propertyCapabilities = evaluatePropertyCapabilities({
    subject: args.subject,
    classification: propertyClassification,
    facts: capabilityFacts,
  });
  return { propertyClassification, propertyCapabilities };
}

function observePropertyIntelligenceShadow(args: {
  country: "US" | "CA";
  region: string;
  surface: "assess_on_demand" | "canada_listing";
  resultVariant: "listed" | "off_market" | "regional_fallback";
  subject: AssessmentSubject;
  classification: PropertyClassification;
  capabilities: PropertyCapabilities;
  log: (step: string, extra?: string) => void;
}): void {
  args.log(
    "property intelligence shadow",
    `class=${args.classification.parcelUse.value} scope=${args.classification.listingScope.value} ` +
      `confidence=${args.classification.overallConfidence} offer=${args.capabilities.items.offerAnalysis.reason} ` +
      `rent=${args.capabilities.items.addressRentEstimate.reason}`
  );
  after(async () => {
    try {
      await recordPropertyIntelligenceShadow({
        country: args.country,
        region: args.region,
        surface: args.surface,
        resultVariant: args.resultVariant,
        subject: args.subject,
        classification: args.classification,
        capabilities: args.capabilities,
      });
    } catch (err) {
      args.log("property intelligence telemetry error", err instanceof Error ? err.message : String(err));
    }
  });
}

async function persistPrivateAssessmentState(args: {
  enabled: boolean;
  userId: string;
  country: "US" | "CA";
  resultVariant: AssessmentResultVariant;
  resultRef?: string | null;
  assessmentGoal: AssessmentGoal | null;
  subject: AssessmentSubject;
  log: (step: string, extra?: string) => void;
}): Promise<string | null> {
  if (!args.enabled) return null;
  try {
    const saved = await createUserAssessmentState({
      userId: args.userId,
      country: args.country,
      resultVariant: args.resultVariant,
      resultRef: args.resultRef,
      assessmentGoal: args.assessmentGoal,
      subject: args.subject,
    });
    args.log("private assessment state", saved ? saved.id : "database unavailable");
    return saved?.id ?? null;
  } catch (error) {
    args.log("private assessment state error", error instanceof Error ? error.message : String(error));
    return null;
  }
}

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
  postalCode?: string;
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

  // Preserve the postal/ZIP before removing it from the region token. It is
  // part of the provider identity query even though it is not needed to map
  // the state/province code.
  const postalCode =
    parts[2].match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ??
    parts[2].match(/\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i)?.[0]?.toUpperCase();

  // Region is in the third part, possibly with a postal/ZIP code attached
  const regionPart = parts[2]
    .replace(/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i, "") // Strip CA postal code (A1A 1A1)
    .replace(/\b\d{5}(-\d{4})?\b/, "") // Strip US ZIP / ZIP+4
    .trim()
    .toLowerCase();

  const region = REGION_MAP[regionPart];
  if (!region) return null;

  const country: "CA" | "US" = /^[A-Z]{2}$/.test(region) ? "US" : "CA";

  return { street, city, region, country, postalCode };
}

function buildUsAssessmentSubject(args: {
  rawInput: string;
  normalizedAddress: string;
  selectedPlaceId?: string;
  bundle: USPropertyBundle | null;
  assessment: Assessment | null;
}): AssessmentSubject {
  const listing = args.bundle?.activeListing;
  const record = args.bundle?.record;
  const listingAddress =
    listing?.formattedAddress || listing?.addressLine1 || args.bundle?.meta.canonicalAddress || null;
  const recordAddress =
    record?.formattedAddress || record?.addressLine1 || args.bundle?.meta.canonicalAddress || null;
  const listingUnit = listingAddress ? extractUnitFromAddress(listingAddress).unit : null;
  const recordUnit = recordAddress ? extractUnitFromAddress(recordAddress).unit : null;
  const hasParcelAssessment =
    !!args.assessment?.found &&
    args.assessment.source !== "area_median" &&
    args.assessment.source !== "avm";

  return resolveAssessmentSubject({
    rawInput: args.rawInput,
    normalizedAddress: args.bundle?.meta.canonicalAddress || args.normalizedAddress,
    parsedUnit: extractUnitFromAddress(args.rawInput).unit,
    selectedPlaceId: args.selectedPlaceId,
    listing: listing && listingAddress
      ? {
          address: listingAddress,
          unit: listingUnit,
          source: "rentcast_listing",
          sourceRecordId: listing.mlsNumber,
        }
      : null,
    propertyRecord: record && recordAddress
      ? {
          address: recordAddress,
          unit: recordUnit,
          propertyType: record.propertyType,
        }
      : null,
    assessment: hasParcelAssessment
      ? {
          found: true,
          sourceRecordId: args.assessment!.assessmentYear,
          address: recordAddress || args.bundle?.meta.canonicalAddress || args.normalizedAddress,
        }
      : null,
  });
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
  postalCode,
  rawInput,
  selectedPlaceId,
  assessmentGoal,
  journeyStateEnabled,
  log,
}: {
  userId: string;
  limiter: ReturnType<typeof assessLimiter>;
  pro: boolean;
  street: string;
  city: string;
  region: string;
  postalCode?: string;
  rawInput: string;
  selectedPlaceId?: string;
  assessmentGoal: AssessmentGoal | null;
  journeyStateEnabled: boolean;
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
  // Bare 5-digit FIPS (no "US-" prefix) — the format
  // src/lib/assessment/us-county/index.ts's registry keys on, matching
  // ${geo.stateFips}${geo.countyFips} directly.
  const bareCountyFips = `${geo.stateFips}${geo.countyFips}`;

  // County-live lookup runs IN PARALLEL with the RentCast bundle fetch (not
  // after it) so a fast county API (Maricopa/Miami-Dade, both live-verified
  // well under their hard timeouts — see us-county/index.ts) adds ~zero
  // wall-clock latency to this request. Non-live-capable counties (Travis)
  // and addresses outside any registered county both resolve to null near-
  // instantly (lookupCountyLive short-circuits before any network call) —
  // never blocks. Any failure/timeout degrades to null, which
  // buildUsAssessment() below treats identically to "no live county data
  // available," falling back to RentCast's taxAssessments exactly as before
  // this change (log prefix `[county-live]`, see that module for detail).
  const [bundle, marketPanel, countyLive] = await Promise.all([
    getUSProperty(street, city, geo.stateUsps, postalCode).catch((err) => {
      log("rentcast error", err instanceof Error ? err.message : String(err));
      return null;
    }),
    // Neon-unreachable must degrade (panel absent), never 500 the request —
    // this is the fallback tier's own fallback (RUNBOOK gap #1).
    getCountyMarketPanel(countyFips).catch((err) => {
      log("market panel error", err instanceof Error ? err.message : String(err));
      return null;
    }),
    lookupCountyLive(bareCountyFips, street, city).catch((err) => {
      log("county-live error", err instanceof Error ? err.message : String(err));
      return null;
    }),
  ]);

  log(
    "county-live done",
    countyLive
      ? `assessedValue=${countyLive.assessedValue}${countyLive.marketValue ? ` marketValue=${countyLive.marketValue}` : ""}`
      : "no live county data (not registered, not liveCapable, no match, or timed out)"
  );

  log(
    "rentcast done",
    bundle
      ? `record=${!!bundle.record} avm=${!!bundle.avm} rent=${!!bundle.rent} listing=${!!bundle.activeListing} ` +
        `cacheHits=${bundle.meta.cacheHits} liveCalls=${bundle.meta.liveCalls} quotaExhausted=${bundle.meta.quotaExhausted}` +
        ` resolution=${bundle.meta.addressResolution ?? "unknown"}` +
        (bundle.meta.canonicalAddress ? ` canonical=${bundle.meta.canonicalAddress}` : "") +
        (bundle.meta.errors.length ? ` errors=${bundle.meta.errors.join("; ")}` : "")
      : "call failed"
  );

  // Decide only from the already-fetched bundle. P0 deliberately adds no
  // provider retry or resolution call. activeListing counts as usable on its
  // own because Discover sweeps prime only the per-address listing cache.
  const dataPath = decideUsAssessmentDataPath(bundle);

  // Fallback path — quota exhausted, RentCast API down, or genuinely no
  // record for this address. Preserve an already-fetched property-specific
  // county result when one exists; only fall back to the regional ACS median
  // when both provider and county property evidence are absent.
  if (!bundle || dataPath.kind === "regional_fallback") {
    const propertyDataUnavailableReason =
      dataPath.kind === "regional_fallback" ? dataPath.reason : "provider_error";
    const assessment =
      buildUsAssessment(null, null, geo.stateUsps, countyLive) ??
      (await lookupAssessment(street, region, city));
    const propertyEvidence = addAssessmentEvidence(
      addRentCastEvidence(
        createPropertyEvidenceSnapshot({
          surface: "assess_on_demand",
          rawInput,
          normalizedAddress: geo.matchedAddress,
          parsedUnit: extractUnitFromAddress(rawInput).unit,
          selectedPlaceId,
        }),
        {
          record: bundle?.record ?? null,
          listing: bundle?.activeListing ?? null,
          recordQueried: true,
          listingQueried: true,
          unavailableReason:
            propertyDataUnavailableReason === "provider_quota_exhausted"
              ? "quota_exhausted"
              : propertyDataUnavailableReason === "provider_error"
                ? "provider_error"
                : "field_missing",
        }
      ),
      assessment,
      geo.stateUsps
    );
    const assessmentSubject = buildUsAssessmentSubject({
      rawInput,
      normalizedAddress: geo.matchedAddress,
      selectedPlaceId,
      bundle,
      assessment,
    });
    const regionalRentAvailable = !!marketPanel && [
      marketPanel.medianGrossRent,
      marketPanel.fmrStudio,
      marketPanel.fmr1br,
      marketPanel.fmr2br,
      marketPanel.fmr3br,
      marketPanel.fmr4br,
    ].some((value) => value != null);
    const { propertyClassification, propertyCapabilities } = buildPropertyIntelligenceShadow({
      subject: assessmentSubject,
      evidence: propertyEvidence,
      saleValue: assessment?.source === "area_median"
        ? { available: true, source: "area_median", regionalOnly: true }
        : undefined,
      regionalRent: { available: regionalRentAvailable, source: "county_market_panel" },
      countyMarketContext: !!marketPanel,
      countyRiskContext: !!marketPanel && (
        marketPanel.femaRiskScore != null ||
        marketPanel.femaEalScore != null ||
        Object.keys(marketPanel.femaHazardScores).length > 0
      ),
      insurancePrefillCore: false,
    });
    observePropertyIntelligenceShadow({
      country: "US",
      region: geo.stateUsps,
      surface: "assess_on_demand",
      resultVariant: "regional_fallback",
      subject: assessmentSubject,
      classification: propertyClassification,
      capabilities: propertyCapabilities,
      log,
    });
    log(
      "us data done (fallback)",
      `reason=${propertyDataUnavailableReason} assessment_found=${assessment?.found ?? false} panel=${marketPanel ? "yes" : "no"}`
    );

    trackEvent(userId, "assessment_request", {
      address: geo.matchedAddress,
      city,
      state: geo.stateUsps,
      country: "US",
    }).catch(() => {}); // fire and forget

    log("done (US, fallback)", geo.matchedAddress);

    const assessmentId = await persistPrivateAssessmentState({
      enabled: journeyStateEnabled,
      userId,
      country: "US",
      resultVariant: "regional_fallback",
      assessmentGoal,
      subject: assessmentSubject,
      log,
    });

    return NextResponse.json({
      ok: true,
      country: "US" as const,
      address: geo.matchedAddress,
      city,
      state: geo.stateUsps,
      countyName: geo.countyName,
      countyFips,
      assessment,
      assessmentSubject,
      propertyEvidence,
      propertyClassification,
      propertyCapabilities,
      assessmentGoal,
      assessmentId,
      marketPanel,
      offerAvailable: false,
      offerUnavailableReason: "no_listing_data",
      propertyDataUnavailableReason,
      emailSent: false,
    });
  }

  const assessment = buildUsAssessment(bundle.record, bundle.avm, geo.stateUsps, countyLive);

  trackEvent(userId, "assessment_request", {
    address: geo.matchedAddress,
    city,
    state: geo.stateUsps,
    country: "US",
  }).catch(() => {}); // fire and forget

  // Listed variant — same pipeline as Canada.
  if (bundle.activeListing) {
    const mappedListing = buildUsListing(bundle, city, geo.stateUsps, {
      surface: "assess_on_demand",
      rawInput,
      normalizedAddress: geo.matchedAddress,
      parsedUnit: extractUnitFromAddress(rawInput).unit,
      selectedPlaceId,
      recordQueried: true,
      listingQueried: true,
    });
    const listing = {
      ...mappedListing,
      propertyEvidence: addAssessmentEvidence(
        mappedListing.propertyEvidence!,
        assessment,
        geo.stateUsps
      ),
    };
    const assessmentSubject = buildUsAssessmentSubject({
      rawInput,
      normalizedAddress: geo.matchedAddress,
      selectedPlaceId,
      bundle,
      assessment,
    });
    listing.assessmentSubject = assessmentSubject;
    const baseScore = scoreV2(listing);
    const comparables = buildUsCompSupport(bundle.avm, parseInt(listing.sqft) || 0);

    // Anchor plausibility gate (src/lib/pipeline/us-assess.ts) — runs BEFORE
    // offer-model.ts to decide whether the assessed value is even a sane
    // thing to anchor on for this listing (agricultural exemptions,
    // assessment caps, partial-parcel records, or a flatly aspirational
    // asking price all produce a real assessed value that offer-model.ts's
    // ratio-vs-asking banding was never tuned to handle — see that
    // function's module doc for the flagship 12400 Cedar St, Austin case).
    // This gate treats a county-live-sourced assessed value with exactly
    // the same suspicion as a RentCast-tax-sourced one (docs/plans/
    // 10-RENTCAST-DATA-QUALITY.md found primary county sources wrong by
    // 50-59x too — Maricopa specifically) — "it came from the government"
    // is not itself a plausibility pass.
    //
    // marketValueHint: only meaningful when buildUsAssessment() anchored on
    // the county's CAPPED assessedValue (assessmentBasis "assessed_ratio")
    // while ALSO holding a separate marketValue figure for the same parcel.
    // As of the Cook/King/NYC counties added 2026-08-09, this is common —
    // not "rare in practice" as originally noted here — since those
    // adapters (and Maricopa/Miami-Dade) report assessmentBasis
    // "assessed_ratio" even when their own marketValue is what
    // buildUsAssessment ends up anchoring on (see
    // assessmentBasisFromCountyLive's doc comment in us-assess.ts: a
    // capped county's marketValue is still just that same county's own
    // figure, not independent corroboration of it). The `assessment.
    // totalValue !== countyLive?.marketValue` guard below specifically
    // excludes that already-anchored-on-marketValue case: passing the SAME
    // number in as both `assessedValue` and `marketValueHint` would make
    // assessAnchorPlausibility's corroboration note claim "the capped
    // assessed figure runs lower" when here it's identical — only pass the
    // hint when it's a genuinely different, second figure (i.e.
    // buildUsAssessment anchored on the capped assessedValue instead).
    // RentCast's tax-assessment record has no separate market-value figure
    // at all, so this is always null when the assessment came from
    // RentCast instead of a live county lookup.
    const marketValueHint =
      assessment?.liveCountySource &&
      assessment.assessmentBasis === "assessed_ratio" &&
      countyLive?.marketValue &&
      assessment.totalValue !== countyLive.marketValue
        ? countyLive.marketValue
        : null;
    const anchorDecision = assessment?.found
      ? assessAnchorPlausibility({
          assessedValue: assessment.totalValue,
          assessmentBasis: assessment.assessmentBasis,
          askingPrice: listing.price || null,
          avmValue: bundle.avm?.value ?? null,
          marketValueHint,
        })
      : undefined;
    const taxAssessedDemoted = anchorDecision?.verdict === "context_only";

    // US Advantage layer (src/lib/pipeline/us-advantage.ts) — equity/tenure,
    // valuation triangulation, investor yield, risk/momentum, and
    // over-assessment, all computed from data already fetched above (zero
    // extra RentCast calls). The equity signal's score bump is applied here,
    // outside scoring.ts, so CA's scoreV2 weights are untouched.
    const advantageAssessmentValue =
      assessment?.source === "government"
        ? assessment.totalValue
        : bundle.record?.taxAssessments?.[0]?.value ?? null;
    const advantage = buildUsAdvantageBundle({
      record: bundle.record,
      askingPrice: listing.price || null,
      avmValue: bundle.avm?.value ?? null,
      taxAssessedValue: advantageAssessmentValue,
      assessmentAnchorLabel:
        assessment?.liveCountyValueKind === "market_value"
          ? "County assessor market value"
          : "Tax-assessed value",
      taxAssessmentEligible: assessment?.liveCountyValueKind !== "market_value",
      assessmentBasis: assessment?.assessmentBasis,
      compImpliedValue: comparables.impliedValue,
      monthlyRent: bundle.rent?.value ?? null,
      marketPanel,
      taxAssessedDemoted,
    });

    const score = applyEquitySignalToScore(baseScore, advantage.equitySignal);
    const equityLabel = equitySignalLabel(advantage.equitySignal);
    const signals = equityLabel ? [...getSignals(listing), equityLabel] : getSignals(listing);

    // Re-anchoring on demotion: prefer RentCast's AVM (the best independent
    // market read available) when the gate found one credible; otherwise
    // fall back to the DOM/language-based model, same as "no assessment at
    // all." The AVM value is fed through offerModel() itself (not a bespoke
    // formula) via a synthetic Assessment — this reuses the exact same
    // trusted ratio-banding logic, just anchored on a modeled market value
    // instead of a decoupled tax-assessed one.
    let offer;
    if (assessment?.found) {
      if (!taxAssessedDemoted) {
        offer = offerModel(listing, assessment);
      } else if (anchorDecision?.anchorSource === "avm" && bundle.avm?.value) {
        offer = offerModel(listing, {
          ...assessment,
          totalValue: bundle.avm.value,
          source: "avm",
          evidenceClass: "modeled",
          assessmentBasis: "market_value",
        });
      } else {
        offer = offerModelLanguage(listing);
      }
    } else {
      offer = offerModelLanguage(listing);
    }

    // THE SIGNAL — LLM narrative (US analogue of the CA pipeline's
    // analyzeAndNarrate/enrichListing; see src/lib/pipeline/us-narrative.ts
    // for why the US prompt differs). Time-boxed internally (~12s) so a
    // slow/hung OpenRouter call can't eat into this route's 60s
    // maxDuration; falls back to the deterministic template on any
    // failure/timeout so "THE SIGNAL" never renders empty. Off-market
    // properties don't get this — no listing story to tell there.
    const narrativeContext = { listing, assessment, offer, signals, comparables, advantage, marketPanel, anchorDecision };
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

    // LOG-ONLY narrative QA (src/lib/pipeline/narrative-lint.ts, voice guide
    // section 6) — never blocks or retries this response; this route has no
    // KV-persisted listing to attach the result to (see module doc), so it
    // just logs for monitoring.
    logNarrativeLint(`${geo.matchedAddress}, ${city}`, lintUsNarrative(narrative, narrativeContext));

    const regionalRentAvailable = !!marketPanel && [
      marketPanel.medianGrossRent,
      marketPanel.fmrStudio,
      marketPanel.fmr1br,
      marketPanel.fmr2br,
      marketPanel.fmr3br,
      marketPanel.fmr4br,
    ].some((value) => value != null);
    const { propertyClassification, propertyCapabilities } = buildPropertyIntelligenceShadow({
      subject: assessmentSubject,
      evidence: listing.propertyEvidence,
      classificationFacts: {
        activeListing: true,
        lastSaleDate: bundle.record?.lastSaleDate,
        hasSuite: listing.hasSuite,
        yearBuilt: bundle.record?.yearBuilt ?? listing.yearBuilt,
      },
      saleValue: { available: !!bundle.avm, source: "rentcast_avm" },
      rentEstimate: { available: !!bundle.rent, source: "rentcast_rent" },
      regionalRent: { available: regionalRentAvailable, source: "county_market_panel" },
      activeListing: true,
      offerComputed: !!offer,
      countyMarketContext: !!marketPanel,
      countyRiskContext: !!marketPanel && (
        marketPanel.femaRiskScore != null ||
        marketPanel.femaEalScore != null ||
        Object.keys(marketPanel.femaHazardScores).length > 0
      ),
      insurancePrefillCore: !!(
        bundle.record?.propertyType &&
        bundle.record.yearBuilt &&
        bundle.record.squareFootage &&
        (bundle.record.formattedAddress || bundle.record.addressLine1)
      ),
    });
    listing.propertyClassification = propertyClassification;
    listing.propertyCapabilities = propertyCapabilities;
    observePropertyIntelligenceShadow({
      country: "US",
      region: geo.stateUsps,
      surface: "assess_on_demand",
      resultVariant: "listed",
      subject: assessmentSubject,
      classification: propertyClassification,
      capabilities: propertyCapabilities,
      log,
    });

    log(
      "done (US, listed)",
      `${geo.matchedAddress} tier=${score.tier} offer=${offer?.finalOffer} anchor=${assessment?.source} ` +
        `equity=${advantage.equitySignal?.tier ?? "none"} triangulation=${advantage.triangulation.confidence} ` +
        `narrative=${narrative.length}chars`
    );

    const assessmentId = await persistPrivateAssessmentState({
      enabled: journeyStateEnabled,
      userId,
      country: "US",
      resultVariant: "listed",
      assessmentGoal,
      subject: assessmentSubject,
      log,
    });

    return NextResponse.json({
      ok: true,
      country: "US" as const,
      address: geo.matchedAddress,
      city,
      state: geo.stateUsps,
      countyName: geo.countyName,
      countyFips,
      assessment,
      assessmentSubject,
      propertyClassification,
      propertyCapabilities,
      assessmentGoal,
      assessmentId,
      anchorDecision: anchorDecision ?? null,
      marketPanel,
      offerAvailable: true as const,
      listing,
      propertyEvidence: listing.propertyEvidence,
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
  const propertyEvidence = addAssessmentEvidence(
    addRentCastEvidence(
      createPropertyEvidenceSnapshot({
        surface: "assess_on_demand",
        rawInput,
        normalizedAddress: geo.matchedAddress,
        parsedUnit: extractUnitFromAddress(rawInput).unit,
        selectedPlaceId,
      }),
      {
        record: bundle.record,
        listing: bundle.activeListing,
        recordQueried: true,
        listingQueried: true,
        unavailableReason: bundle.meta.quotaExhausted ? "quota_exhausted" : "field_missing",
      }
    ),
    assessment,
    geo.stateUsps
  );
  const assessmentSubject = buildUsAssessmentSubject({
    rawInput,
    normalizedAddress: geo.matchedAddress,
    selectedPlaceId,
    bundle,
    assessment,
  });
  const advantageAssessmentValue =
    assessment?.source === "government"
      ? assessment.totalValue
      : bundle.record?.taxAssessments?.[0]?.value ?? null;
  const advantage = buildUsAdvantageBundle({
    record: bundle.record,
    askingPrice: null,
    avmValue: bundle.avm?.value ?? null,
    taxAssessedValue: advantageAssessmentValue,
    assessmentAnchorLabel:
      assessment?.liveCountyValueKind === "market_value"
        ? "County assessor market value"
        : "Tax-assessed value",
    taxAssessmentEligible: assessment?.liveCountyValueKind !== "market_value",
    assessmentBasis: assessment?.assessmentBasis,
    compImpliedValue: offMarketComparables.impliedValue,
    monthlyRent: bundle.rent?.value ?? null,
    marketPanel,
  });
  const regionalRentAvailable = !!marketPanel && [
    marketPanel.medianGrossRent,
    marketPanel.fmrStudio,
    marketPanel.fmr1br,
    marketPanel.fmr2br,
    marketPanel.fmr3br,
    marketPanel.fmr4br,
  ].some((value) => value != null);
  const { propertyClassification, propertyCapabilities } = buildPropertyIntelligenceShadow({
    subject: assessmentSubject,
    evidence: propertyEvidence,
    classificationFacts: {
      activeListing: false,
      lastSaleDate: bundle.record?.lastSaleDate,
      yearBuilt: bundle.record?.yearBuilt,
    },
    saleValue: { available: !!bundle.avm, source: "rentcast_avm" },
    rentEstimate: { available: !!bundle.rent, source: "rentcast_rent" },
    regionalRent: { available: regionalRentAvailable, source: "county_market_panel" },
    activeListing: false,
    offerComputed: false,
    countyMarketContext: !!marketPanel,
    countyRiskContext: !!marketPanel && (
      marketPanel.femaRiskScore != null ||
      marketPanel.femaEalScore != null ||
      Object.keys(marketPanel.femaHazardScores).length > 0
    ),
    insurancePrefillCore: !!(
      bundle.record?.propertyType &&
      bundle.record.yearBuilt &&
      bundle.record.squareFootage &&
      (bundle.record.formattedAddress || bundle.record.addressLine1)
    ),
  });
  observePropertyIntelligenceShadow({
    country: "US",
    region: geo.stateUsps,
    surface: "assess_on_demand",
    resultVariant: "off_market",
    subject: assessmentSubject,
    classification: propertyClassification,
    capabilities: propertyCapabilities,
    log,
  });

  log(
    "done (US, off-market)",
    `${geo.matchedAddress} assessed=${assessment?.totalValue} avm=${bundle.avm?.value} rent=${bundle.rent?.value} ` +
      `equity=${advantage.equitySignal?.tier ?? "none"} triangulation=${advantage.triangulation.confidence}`
  );

  const assessmentId = await persistPrivateAssessmentState({
    enabled: journeyStateEnabled,
    userId,
    country: "US",
    resultVariant: "off_market",
    assessmentGoal,
    subject: assessmentSubject,
    log,
  });

  return NextResponse.json({
    ok: true,
    country: "US" as const,
    address: geo.matchedAddress,
    city,
    state: geo.stateUsps,
    countyName: geo.countyName,
    countyFips,
    assessment,
    assessmentSubject,
    propertyEvidence,
    propertyClassification,
    propertyCapabilities,
    assessmentGoal,
    assessmentId,
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

  const submittedAddress = typeof body.address === "string" ? body.address : "";
  const rawAddress = submittedAddress.trim();
  const selectedPlaceId = typeof body.placeId === "string" ? body.placeId.trim() || undefined : undefined;
  const assessmentGoal = parseAssessmentGoal(body.assessmentGoal);
  if (body.assessmentGoal != null && !assessmentGoal) {
    return NextResponse.json({ error: "Invalid assessment goal" }, { status: 400 });
  }
  const journeyStateEnabled = body.journeyState === true;
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

    const { street, city, region, country, postalCode } = parsed;
    log("parsed", `${street} | ${city} | ${region} (${country})`);

    if (country === "US") {
      return handleUSAssessment({
        userId,
        limiter,
        pro,
        street,
        city,
        region,
        postalCode,
        rawInput: submittedAddress,
        selectedPlaceId,
        assessmentGoal,
        journeyStateEnabled,
        log,
      });
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
  const assessmentInputEvidence = createPropertyEvidenceSnapshot({
    surface: "assess_on_demand",
    rawInput: submittedAddress,
    normalizedAddress: listing.address,
    parsedUnit: listing.unit,
    directListingUrl: isZoocasaUrl ? rawAddress : undefined,
    selectedPlaceId,
  });
  listing.propertyEvidence = listing.propertyEvidence
    ? mergePropertyEvidence(listing.propertyEvidence, assessmentInputEvidence, "assess_on_demand")
    : assessmentInputEvidence;

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

  const assessmentSubject = resolveAssessmentSubject({
    rawInput: submittedAddress,
    normalizedAddress: enriched.address,
    parsedUnit: enriched.unit,
    directListingUrl: isZoocasaUrl ? rawAddress : null,
    selectedPlaceId,
    listing: {
      address: enriched.address,
      unit: enriched.unit,
      source: "zoocasa_listing",
      sourceRecordId: enriched.mlsNumber,
    },
    assessment:
      enriched.preAssessment?.found &&
      enriched.preAssessment.source !== "area_median" &&
      enriched.preAssessment.source !== "avm"
        ? {
            found: true,
            sourceRecordId: enriched.preAssessment.assessmentYear,
            address: enriched.address,
          }
        : null,
  });
  enriched.assessmentSubject = assessmentSubject;

  // P3 shadow capability check. This reads the already-ingested CMHC table;
  // it is not a provider call and degrades to "missing" on any DB failure.
  const cma = getCmaFipsForCity(enriched.city);
  const cmaRent = cma
    ? await getCmaRent(cma.fips, parseInt(enriched.beds) || 0).catch((err) => {
        log("cmhc shadow lookup error", err instanceof Error ? err.message : String(err));
        return null;
      })
    : null;
  const { propertyClassification, propertyCapabilities } = buildPropertyIntelligenceShadow({
    subject: assessmentSubject,
    evidence: enriched.propertyEvidence!,
    classificationFacts: {
      activeListing: true,
      hasSuite: enriched.hasSuite,
      yearBuilt: enriched.yearBuilt,
    },
    regionalRent: { available: !!cmaRent, source: "cmhc_cma_rent" },
    activeListing: true,
    offerComputed: !!enriched.preOffer,
    countyMarketContext: false,
    countyRiskContext: false,
    insurancePrefillCore: !!(
      enriched.address &&
      enriched.yearBuilt &&
      parseInt(enriched.sqft) > 0 &&
      enriched.propertyEvidence?.propertyTypes.some((item) => item.availability === "available")
    ),
  });
  enriched.propertyClassification = propertyClassification;
  enriched.propertyCapabilities = propertyCapabilities;
  observePropertyIntelligenceShadow({
    country: "CA",
    region: enriched.province,
    surface: "canada_listing",
    resultVariant: "listed",
    subject: assessmentSubject,
    classification: propertyClassification,
    capabilities: propertyCapabilities,
    log,
  });

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

  const assessmentId = await persistPrivateAssessmentState({
    enabled: journeyStateEnabled,
    userId,
    country: "CA",
    resultVariant: "listed",
    resultRef: slug,
    assessmentGoal,
    subject: assessmentSubject,
    log,
  });

  log("done", slug);
  return NextResponse.json({
    ok: true,
    slug,
    address: enriched.address,
    city: enriched.city,
    assessmentSubject,
    propertyClassification,
    propertyCapabilities,
    assessmentGoal,
    assessmentId,
    emailSent,
  });
}
