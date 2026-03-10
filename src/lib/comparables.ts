/**
 * comparables.ts
 *
 * Matches sold listings to a subject listing by similarity.
 * Two-pass approach:
 *   Pass 1: Search-level scoring (sqft/beds/proximity/recency) — all 27 candidates
 *   Pass 2: Detail enrichment (yearBuilt/lot/description) — top 5 only
 *
 * Confidence tiers communicate data quality honestly.
 */

import { Listing, ComparableSale, ComparableResult } from "./types";
import { ZoocasaSoldRaw, fetchSoldDetail } from "./zoocasa";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_AGE_DAYS = 60;
const MAX_DISTANCE_KM = 15;
const GATE_MIN_CANDIDATES = 3;
const GATE_MIN_SCORE = 0.3;
const DETAIL_FETCH_COUNT = 5;
const FINAL_COMP_COUNT = 3;

// ---------------------------------------------------------------------------
// Property type normalization (cross-board)
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, string> = {
  "single family residence": "SFH",
  "single family": "SFH",
  "detached": "SFH",
  "condominium": "Condo",
  "apartment/condominium": "Condo",
  "apartment": "Condo",
  "townhouse": "Townhouse",
  "attached": "Townhouse",
  "semi detached (half duplex)": "Townhouse",
  "half duplex": "Townhouse",
  "semi detached": "Townhouse",
  "row / townhouse": "Townhouse",
  "manufactured home": "Other",
  "multi family": "Other",
};

export function normalizePropertyType(raw: string): string {
  return TYPE_MAP[raw.toLowerCase().trim()] || "Other";
}

// ---------------------------------------------------------------------------
// Haversine distance (km)
// ---------------------------------------------------------------------------

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Parse Zoocasa POINT string → {lng, lat}
// ---------------------------------------------------------------------------

export function parsePosition(point: string): { lng: number; lat: number } | null {
  const m = point.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
  if (!m) return null;
  return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
}

// ---------------------------------------------------------------------------
// Era bucket from yearBuilt string or description
// ---------------------------------------------------------------------------

const ERA_DESCRIPTION_PATTERNS: [RegExp, string][] = [
  [/\b(new construction|brand new|never lived|newly built|just completed)\b/i, "New build"],
  [/\b(character home|heritage|original charm|craftsman|victorian)\b/i, "Pre-war"],
  [/\b(mid[- ]century|1950s|1960s|bungalow charm)\b/i, "Mid-century"],
  [/\b(renovated|updated|modern updates|gut reno|fully renovated)\b/i, "Updated"],
];

export function classifyEra(yearBuilt: string | null, description: string | null): string | null {
  if (yearBuilt) {
    const year = parseInt(yearBuilt);
    if (!isNaN(year)) {
      if (year >= 2015) return "New build";
      if (year >= 1990) return "Established";
      if (year >= 1960) return "Mid-century";
      if (year >= 1940) return "Pre-war";
      return "Pre-war";
    }
  }

  if (description) {
    for (const [pat, bucket] of ERA_DESCRIPTION_PATTERNS) {
      if (pat.test(description)) return bucket;
    }
  }

  return null;
}

/**
 * Penalty multiplier when subject and comp eras diverge.
 * Returns 1.0 (no penalty) if either era is unknown.
 */
export function eraPenalty(subjectEra: string | null, compEra: string | null): number {
  if (!subjectEra || !compEra) return 1.0;
  if (subjectEra === compEra) return 1.0;

  const order = ["Pre-war", "Mid-century", "Established", "New build", "Updated"];
  const si = order.indexOf(subjectEra);
  const ci = order.indexOf(compEra);
  if (si === -1 || ci === -1) return 1.0;

  const gap = Math.abs(si - ci);
  if (gap <= 1) return 1.0;
  if (gap === 2) return 0.85;
  return 0.7; // 3+ steps apart
}

// ---------------------------------------------------------------------------
// Scoring curves
// ---------------------------------------------------------------------------

function scoreSqft(subjectSqft: number, compSqft: number): number | null {
  if (!subjectSqft || !compSqft) return null;
  const diff = Math.abs(subjectSqft - compSqft) / subjectSqft;
  if (diff <= 0.10) return 1.0;
  if (diff <= 0.20) return 0.7;
  if (diff <= 0.30) return 0.4;
  return -1; // excluded
}

function scoreBedBath(
  subjectBeds: number, subjectBaths: number,
  compBeds: number, compBaths: number
): number {
  const bedDiff = Math.abs(subjectBeds - compBeds);
  const bathDiff = Math.abs(subjectBaths - compBaths);

  if (bedDiff > 2) return -1; // excluded

  let score = 1.0;
  if (bedDiff === 1) score *= 0.6;
  else if (bedDiff === 2) score *= 0.2;
  if (bathDiff === 1) score *= 0.8;
  else if (bathDiff >= 2) score *= 0.5;
  return score;
}

function scoreProximity(km: number): number {
  if (km < 1) return 1.0;
  if (km < 3) return 0.7;
  if (km < 5) return 0.5;
  if (km < 10) return 0.3;
  if (km < 15) return 0.15;
  return -1; // excluded
}

function scoreRecency(soldAt: string): number {
  const daysAgo = Math.floor((Date.now() - new Date(soldAt).getTime()) / 86_400_000);
  if (daysAgo < 0 || daysAgo > MAX_AGE_DAYS) return -1; // excluded
  if (daysAgo <= 14) return 1.0;
  if (daysAgo <= 30) return 0.8;
  if (daysAgo <= 45) return 0.5;
  return 0.3;
}

// ---------------------------------------------------------------------------
// Composite similarity score
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  raw: ZoocasaSoldRaw;
  position: { lng: number; lat: number };
  distanceKm: number;
  sqft: number | null;
  normalizedType: string;
  similarityScore: number;
  hasSqft: boolean;
}

function scoreCandidate(
  subject: { sqft: number; beds: number; baths: number; position: { lng: number; lat: number } },
  raw: ZoocasaSoldRaw,
  compPos: { lng: number; lat: number }
): ScoredCandidate | null {
  const compSqft = raw.square_footage?.gte || 0;
  const hasSqft = subject.sqft > 0 && compSqft > 0;

  // Hard filter: recency
  const recency = scoreRecency(raw.sold_at);
  if (recency < 0) return null;

  // Hard filter: proximity
  const dist = haversineKm(subject.position.lat, subject.position.lng, compPos.lat, compPos.lng);
  const prox = scoreProximity(dist);
  if (prox < 0) return null;

  // Score dimensions
  const sqftScore = hasSqft ? scoreSqft(subject.sqft, compSqft) : null;
  if (sqftScore !== null && sqftScore < 0) return null; // sqft exclusion (>30% diff)

  const compBeds = raw.bedrooms || 0;
  const compBaths = raw.bathrooms || 0;
  if (!compBeds && !compBaths) return null; // no bed/bath data at all

  const bbScore = scoreBedBath(subject.beds, subject.baths, compBeds, compBaths);
  if (bbScore < 0) return null; // bed exclusion (>±2)

  // Adaptive weights
  let similarity: number;
  if (sqftScore !== null) {
    // Full data: sqft available
    similarity = sqftScore * 0.35 + bbScore * 0.15 + prox * 0.30 + recency * 0.20;
  } else {
    // Fallback: no sqft
    similarity = bbScore * 0.35 + prox * 0.35 + recency * 0.30;
  }

  return {
    raw,
    position: compPos,
    distanceKm: dist,
    sqft: compSqft || null,
    normalizedType: normalizePropertyType(raw.property_type),
    similarityScore: similarity,
    hasSqft,
  };
}

// ---------------------------------------------------------------------------
// Main matching function
// ---------------------------------------------------------------------------

export async function matchComparables(
  listing: Listing,
  soldPool: ZoocasaSoldRaw[],
  options?: { skipDetailEnrichment?: boolean }
): Promise<ComparableResult> {
  const subjectSqft = parseInt(listing.sqft) || 0;
  const subjectBeds = parseInt(listing.beds) || 0;
  const subjectBaths = parseInt(listing.baths) || 0;
  const subjectType = guessSubjectType(listing);
  const subjectEra = classifyEra(listing.yearBuilt || null, listing.description || null);

  // Parse subject position — prefer listing coordinates if available,
  // otherwise use centroid of sold pool as rough approximation.
  let subjectPos: { lng: number; lat: number } | null = null;

  // Check if listing has position data (from Zoocasa detail fetch)
  const listingAny = listing as unknown as Record<string, unknown>;
  if (listingAny.position && typeof listingAny.position === "object") {
    const pos = listingAny.position as { coordinates?: [number, number] };
    if (pos.coordinates) {
      subjectPos = { lng: pos.coordinates[0], lat: pos.coordinates[1] };
    }
  }

  // Fallback: use centroid of sold listings with matching postal prefix
  if (!subjectPos) {
    // Postal codes share first 3 chars within a local area (FSA)
    const postalPrefix = listingAny.postalCode
      ? String(listingAny.postalCode).slice(0, 3).toUpperCase()
      : null;

    const matchingPositions: { lng: number; lat: number }[] = [];
    for (const s of soldPool) {
      const pos = parsePosition(s.position);
      if (!pos) continue;
      if (postalPrefix && s.postal_code?.toUpperCase().startsWith(postalPrefix)) {
        matchingPositions.push(pos);
      }
    }

    if (matchingPositions.length > 0) {
      // Centroid of postal-matched sold listings
      subjectPos = {
        lng: matchingPositions.reduce((s, p) => s + p.lng, 0) / matchingPositions.length,
        lat: matchingPositions.reduce((s, p) => s + p.lat, 0) / matchingPositions.length,
      };
    } else {
      // Last resort: centroid of all sold listings
      const allPositions: { lng: number; lat: number }[] = [];
      for (const s of soldPool) {
        const pos = parsePosition(s.position);
        if (pos) allPositions.push(pos);
      }
      if (allPositions.length > 0) {
        subjectPos = {
          lng: allPositions.reduce((s, p) => s + p.lng, 0) / allPositions.length,
          lat: allPositions.reduce((s, p) => s + p.lat, 0) / allPositions.length,
        };
      }
    }
  }

  if (!subjectPos) {
    return emptyResult(soldPool.length, ["No position data available for distance calculation"]);
  }

  const subject = { sqft: subjectSqft, beds: subjectBeds, baths: subjectBaths, position: subjectPos };

  // --- Pass 1: Search-level scoring ---
  const candidates: ScoredCandidate[] = [];
  let hasSqftData = false;

  for (const raw of soldPool) {
    // Hard filter: property type
    if (normalizePropertyType(raw.property_type) !== subjectType) continue;

    // Parse position
    const pos = parsePosition(raw.position);
    if (!pos) continue;

    const scored = scoreCandidate(subject, raw, pos);
    if (!scored) continue;
    if (scored.hasSqft) hasSqftData = true;

    candidates.push(scored);
  }

  // --- Gate check ---
  const aboveGate = candidates.filter((c) => c.similarityScore >= GATE_MIN_SCORE);
  if (aboveGate.length < GATE_MIN_CANDIDATES) {
    const gaps = buildDataGaps(soldPool, candidates, hasSqftData, subjectSqft);
    gaps.push(`Only ${aboveGate.length} candidates above similarity threshold (need ${GATE_MIN_CANDIDATES})`);
    return emptyResult(soldPool.length, gaps, candidates.length);
  }

  // Sort by similarity descending
  aboveGate.sort((a, b) => b.similarityScore - a.similarityScore);
  const topCandidates = aboveGate.slice(0, DETAIL_FETCH_COUNT);

  // --- Pass 2: Detail enrichment ---
  let enrichedComps: ComparableSale[];

  if (options?.skipDetailEnrichment) {
    enrichedComps = topCandidates.map((c) => candidateToComparable(c, listing));
  } else {
    enrichedComps = await enrichTopCandidates(topCandidates, listing, subjectEra);
  }

  // Re-sort after enrichment (era penalty may have changed scores)
  enrichedComps.sort((a, b) => b.similarityScore - a.similarityScore);
  const finalComps = enrichedComps.slice(0, FINAL_COMP_COUNT);

  // --- Compute aggregates ---
  const dataGaps = buildDataGaps(soldPool, candidates, hasSqftData, subjectSqft);
  return buildResult(finalComps, soldPool.length, aboveGate.length, subjectSqft, dataGaps);
}

// ---------------------------------------------------------------------------
// Detail enrichment for top candidates
// ---------------------------------------------------------------------------

async function enrichTopCandidates(
  candidates: ScoredCandidate[],
  listing: Listing,
  subjectEra: string | null
): Promise<ComparableSale[]> {
  const city = listing.city;
  const province = listing.province;

  // Extract slug from each candidate
  const detailPromises = candidates.map(async (c): Promise<ComparableSale> => {
    const comp = candidateToComparable(c, listing);

    // Prefer URL path slug (e.g. "3124-jacklin-rd") over raw.slug
    // which includes city-province suffix ("3124-jacklin-rd-langford-bc")
    const slug = c.raw.address_url_absolute_path?.split("/").pop()
      || c.raw.listing_url_absolute_path?.split("/").pop()
      || c.raw.slug?.replace(/-[a-z]+-[a-z]{2}$/, ""); // strip city-province suffix

    if (!slug) return comp;

    try {
      const detail = await fetchSoldDetail(slug, city, province);
      if (!detail) return comp;

      comp.enriched = true;
      comp.yearBuilt = detail.yearBuilt;
      comp.lotSize = detail.lotSize;
      comp.taxes = detail.taxes;
      comp.descriptionExcerpt = detail.description;
      comp.eraBucket = classifyEra(detail.yearBuilt, detail.description);

      // Apply era penalty
      const penalty = eraPenalty(subjectEra, comp.eraBucket);
      if (penalty < 1.0) {
        comp.similarityScore *= penalty;
        comp.matchTier = comp.similarityScore >= 0.6 ? "strong"
          : comp.similarityScore >= 0.4 ? "moderate" : "weak";
      }
    } catch {
      // Detail fetch failed — keep search-level data
    }

    return comp;
  });

  return Promise.all(detailPromises);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidateToComparable(c: ScoredCandidate, listing: Listing): ComparableSale {
  const addr = c.raw.address?.split(",")[0]?.trim() || c.raw.address;
  return {
    address: addr,
    city: c.raw.sub_division || listing.city,
    province: c.raw.province || listing.province,
    soldPrice: c.raw.sold_price,
    listPrice: c.raw.price,
    soldAt: c.raw.sold_at,
    soldToListRatio: c.raw.price > 0 ? c.raw.sold_price / c.raw.price : 0,
    bedrooms: c.raw.bedrooms,
    bathrooms: c.raw.bathrooms,
    propertyType: c.normalizedType,
    position: c.position,
    distanceKm: Math.round(c.distanceKm * 10) / 10,
    postalCode: c.raw.postal_code || "",
    mls: c.raw.mls || "",
    sqft: c.sqft,
    neighbourhood: c.raw.neighbourhood || null,
    unit: c.raw.unit || null,
    maintenanceFee: c.raw.maintenance || null,
    enriched: false,
    yearBuilt: null,
    lotSize: null,
    taxes: null,
    eraBucket: null,
    descriptionExcerpt: null,
    similarityScore: Math.round(c.similarityScore * 1000) / 1000,
    matchTier: c.similarityScore >= 0.6 ? "strong"
      : c.similarityScore >= 0.4 ? "moderate" : "weak",
  };
}

function guessSubjectType(listing: Listing): string {
  // Infer from listing fields — our Listing type doesn't carry property_type directly
  const desc = (listing.description + " " + listing.notes).toLowerCase();
  if (listing.unit) return "Condo";
  if (desc.includes("townhouse") || desc.includes("townhome")) return "Townhouse";
  if (desc.includes("condo") || desc.includes("apartment")) return "Condo";
  // Default to SFH for houses
  return "SFH";
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildDataGaps(
  pool: ZoocasaSoldRaw[],
  candidates: ScoredCandidate[],
  hasSqftData: boolean,
  subjectSqft: number
): string[] {
  const gaps: string[] = [];

  if (!subjectSqft) gaps.push("Subject sqft not reported");
  if (!hasSqftData && candidates.length > 0) {
    gaps.push("Comp sqft not reported in this market");
  }

  const dates = pool
    .map((l) => l.sold_at)
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  if (dates.length > 1) {
    const span = Math.floor((Math.max(...dates) - Math.min(...dates)) / 86_400_000);
    if (span < 14) gaps.push(`Narrow date window (${span} days of sold data)`);
  }

  if (pool.length < 10) gaps.push(`Small sold pool (${pool.length} listings)`);

  // Check if enrichment data was expected but missing
  const enrichedCount = candidates.filter((c) => c.raw.square_footage?.gte && c.raw.square_footage.gte > 0).length;
  if (candidates.length > 0 && enrichedCount === 0) {
    gaps.push("No sqft data in sold pool — using bed/bath matching");
  }

  return gaps;
}

function buildResult(
  comps: ComparableSale[],
  poolSize: number,
  matchedCount: number,
  subjectSqft: number,
  dataGaps: string[]
): ComparableResult {
  if (!comps.length) {
    return emptyResult(poolSize, dataGaps, matchedCount);
  }

  const ratios = comps.map((c) => c.soldToListRatio).filter((r) => r > 0);
  const medianSoldToList = ratios.length ? Math.round(median(ratios) * 1000) / 1000 : null;

  const ppsf = comps
    .filter((c) => c.sqft && c.sqft > 0)
    .map((c) => c.soldPrice / c.sqft!);
  const medianPricePerSqft = ppsf.length ? Math.round(median(ppsf)) : null;

  const impliedValue = medianPricePerSqft && subjectSqft > 0
    ? Math.round((medianPricePerSqft * subjectSqft) / 1000) * 1000
    : null;

  // Determine confidence
  const medianSimilarity = median(comps.map((c) => c.similarityScore));
  const hasSqft = comps.some((c) => c.sqft && c.sqft > 0);
  let confidence: ComparableResult["confidence"];

  if (comps.length >= 3 && hasSqft && medianSimilarity >= 0.6) {
    confidence = "high";
  } else if (comps.length >= 3 && medianSimilarity >= 0.4) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // Build market note
  let marketNote: string;
  if (confidence === "high") {
    marketNote = `${comps.length} comparable sales within 60 days. `;
    marketNote += medianSoldToList
      ? `Median sold at ${(medianSoldToList * 100).toFixed(1)}% of list.`
      : "";
    if (impliedValue) marketNote += ` Comparable-implied value: $${impliedValue.toLocaleString()}.`;
  } else if (confidence === "medium") {
    marketNote = `${comps.length} similar recent sales (bed/bath match, no sqft). `;
    marketNote += medianSoldToList
      ? `Median sold at ${(medianSoldToList * 100).toFixed(1)}% of list.`
      : "";
  } else {
    marketNote = `Limited comparable data (${comps.length} match${comps.length !== 1 ? "es" : ""}).`;
    if (dataGaps.length) marketNote += ` ${dataGaps[0]}.`;
  }

  // Add enrichment gaps
  const enrichedCount = comps.filter((c) => c.enriched).length;
  if (enrichedCount === 0 && comps.length > 0) {
    dataGaps.push("Build date not available (search-level data only)");
  }
  const avgDist = comps.reduce((s, c) => s + c.distanceKm, 0) / comps.length;
  if (avgDist > 8) {
    dataGaps.push(`Comps geographically spread (${avgDist.toFixed(1)}km avg)`);
  }

  return {
    comparables: comps,
    confidence,
    poolSize,
    matchedCount,
    medianSoldToList,
    medianPricePerSqft,
    impliedValue,
    dataGaps,
    marketNote,
  };
}

function emptyResult(poolSize: number, dataGaps: string[], matchedCount = 0): ComparableResult {
  return {
    comparables: [],
    confidence: "none",
    poolSize,
    matchedCount,
    medianSoldToList: null,
    medianPricePerSqft: null,
    impliedValue: null,
    dataGaps,
    marketNote: "Insufficient comparable data for this listing.",
  };
}
