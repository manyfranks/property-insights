// Type-only imports — erased at compile time, so this doesn't create a
// runtime circular dependency even though both pipeline modules import
// Assessment/ScoreResult/Listing back from this file.
import type { UsAdvantageBundle } from "./pipeline/us-advantage";
import type { UsCompSupport } from "./pipeline/us-assess";
import type { NarrativeLintResult } from "./pipeline/narrative-lint";
import type { PropertyEvidenceSnapshot } from "./property-intelligence/evidence";

export interface PrecomputedOffer {
  anchor: number;
  anchor_tag: string;
  ratio: number;
  dom_adjusted: number;
  dom_mult: number;
  dom_tag: string;
  signal_adjusted: number;
  signal_tags: string[];
  final_offer: number;
  pct_of_list: number;
  savings: number;
  floor_applied: boolean;
}

export interface Listing {
  address: string;
  unit?: string;
  city: string;
  province: string;
  dom: number;
  price: number;
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  taxes: string;
  lotSize: string;
  priceReduced: boolean;
  hasSuite: boolean;
  estateKeywords: boolean;
  description: string;
  notes: string;
  cluster: string;
  url: string;
  mlsNumber?: string;
  // Pre-computed fields from LLM pipeline
  preScore?: number;
  preTier?: "HOT" | "WARM" | "WATCH";
  preSignals?: string[];
  preNarrative?: string;
  // LLM confidence (0-1) behind preNarrative — US listings only (see
  // src/lib/pipeline/us-narrative.ts); 0 or absent when the deterministic
  // fallback template was used instead of the LLM.
  preNarrativeConfidence?: number;
  preOffer?: PrecomputedOffer;
  preAssessment?: Assessment;
  assessmentNote?: string;
  preComparables?: ComparableResult;
  // US-only additions (src/lib/pipeline/us-enrich.ts) — the US Advantage
  // signal bundle and AVM-comp support, persisted at enrichment time so
  // /property/[slug] can render them from cache without recomputation.
  // No CA equivalent (CA doesn't have RentCast's tax/sale-history + AVM
  // data this bundle is built from — see us-advantage.ts's module doc).
  preUsAdvantage?: UsAdvantageBundle;
  preUsComparables?: UsCompSupport;
  // Anchor-plausibility verdict (src/lib/pipeline/us-assess.ts's
  // assessAnchorPlausibility) — persisted so /property/[slug] and the
  // narrative can render/explain a demoted assessment without recomputing
  // it. Set whenever a preAssessment exists; undefined otherwise (nothing
  // to evaluate) and for pre-existing cached listings from before this
  // field existed.
  preAnchorDecision?: AnchorPlausibility;
  // LOG-ONLY narrative QA baseline (src/lib/pipeline/narrative-lint.ts,
  // docs/plans/11-NARRATIVE-VOICE-GUIDE.md section 6) — number-tracing +
  // banned-word-stem counts for the persisted preNarrative, for monitoring
  // only. Never used to block/reject a narrative; undefined for listings
  // enriched before this field existed.
  preNarrativeLint?: NarrativeLintResult;
  // Lifecycle metadata
  source?: "cron" | "user";
  enrichedAt?: string;
  // US-only: relative-DOM signal (src/lib/pipeline/us-discover.ts's
  // scoreUSListing, baseline from src/lib/db/regional-econ.ts's
  // getCountyMedianDom). Persisted so /property/[slug] and the narrative
  // pipeline can explain the DOM band without recomputing it. Undefined for
  // CA listings (untouched this pass) and for US listings scored before
  // this field existed.
  preRelativeDom?: RelativeDom;
  // P1 property-intelligence envelope. Additive beside the legacy Listing
  // fields so existing buyer surfaces remain backward compatible while raw
  // provider evidence keeps its source, scope, freshness, and availability.
  propertyEvidence?: PropertyEvidenceSnapshot;
}

// ---------------------------------------------------------------------------
// Relative DOM (US-only — src/lib/pipeline/us-discover.ts's scoreUSListing).
// A listing's own days-on-market divided by its county's realtor.com/FRED
// median DOM for the same (or nearest) calendar month, instead of scoreV2's
// fixed nationwide brackets (45/60/75/90/100/120/150 days) — DOM norms vary
// hugely by metro (Miami routinely runs 80+ days median; Austin's cooled
// off from its pandemic-era sub-30-day norm), so a fixed bracket flags an
// unremarkable Miami listing as "stale" while missing a genuinely slow
// Austin one. See scoreUSListing's doc comment for the band thresholds and
// the luxury-listing price guard.
// ---------------------------------------------------------------------------

export type RelativeDomBand = "normal" | "extended" | "stale" | "distressed";

export interface RelativeDom {
  /** listing.dom / baselineDays. Null when baseline is "fallback_absolute"
   * (county not covered by FRED's MEDDAYONMAR series — nothing to divide
   * by). */
  relativeDom: number | null;
  band: RelativeDomBand;
  /** "same_month" / "latest" mirror getCountyMedianDom's baseline field
   * (seasonality-correct vs. most-recent-available). "fallback_absolute"
   * means no FRED median_dom data exists for the county at all, and the
   * band was assigned by scoreV2's original fixed DOM brackets instead. */
  baseline: "same_month" | "latest" | "fallback_absolute";
  /** The county median DOM (days) the ratio was computed against. Null
   * under "fallback_absolute". */
  baselineDays: number | null;
}

export interface Assessment {
  totalValue: number;
  landValue: number;
  buildingValue: number;
  // P1 availability marker for the legacy land/building numeric fields.
  // Older adapters use 0 as a missing-value sentinel, so consumers of the
  // evidence envelope must not infer availability from the number alone.
  componentAvailability?: "available" | "unavailable";
  assessmentYear: string;
  found: boolean;
  // "avm" = a RentCast automated valuation model estimate, used as the US
  // assessment anchor when the tax-assessed value is missing or stale (see
  // src/lib/pipeline/us-assess.ts's buildUsAssessment).
  source?: "government" | "tax_reverse" | "area_median" | "cache" | "avm";
  // US states vary in how they compute assessed value (some assess below
  // market, some use acquisition-value schemes like California's Prop 13);
  // Canadian provinces are assumed market_value. Optional — unset for
  // existing CA results until backfilled.
  assessmentBasis?: "market_value" | "assessed_ratio" | "acquisition_value";
  // How trustworthy the value is: observed (govt record/cache hit) >
  // derived (computed from another observed field, e.g. tax reverse-
  // engineering) > modeled (statistical estimate, e.g. area median) >
  // proxy (rough stand-in) > missing (no assessment at all).
  evidenceClass?: "observed" | "derived" | "modeled" | "proxy" | "missing";
  // US-only: true when this Assessment was built from a LIVE per-request
  // county-assessor lookup (src/lib/assessment/us-county's
  // lookupCountyLive(), wired into src/lib/pipeline/us-assess.ts's
  // buildUsAssessment) rather than RentCast's `taxAssessments` field.
  // Both cases set source:"government"/evidenceClass:"observed" — this
  // flag is the only signal that distinguishes a real-time county-scraper
  // hit (per docs/plans/10-RENTCAST-DATA-QUALITY.md, the trustworthy case)
  // from RentCast's own tax-assessed figure (audit-documented as the
  // weakest field: 59% coverage, and measurably wrong for Phoenix
  // specifically). Undefined/false for every pre-existing Assessment
  // (RentCast-tax-sourced, AVM, area-median, or any CA adapter) — UI source
  // labels use it to render "(live)" only when true.
  liveCountySource?: boolean;
}

// ---------------------------------------------------------------------------
// Anchor plausibility (US-only — see src/lib/pipeline/us-assess.ts's
// assessAnchorPlausibility). Guards against feeding offer-model.ts an
// assessed value that's decoupled from market reality (agricultural
// exemptions, assessment caps, partial-parcel valuations, or a flatly
// aspirational asking price) as though it were a trustworthy anchor.
// ---------------------------------------------------------------------------

/** "anchor" = the tax-assessed value is plausible and should drive the
 * offer model as usual. "context_only" = the assessed value is still shown
 * (transparency), but demoted out of the offer-anchoring role. */
export type AnchorVerdict = "anchor" | "context_only";

/** Enumerated, narrative-ready reasons an assessed value got demoted (or,
 * for "asking_outlier", why the ASKING price is the one flagged instead). */
export type AnchorDemotionReason =
  | "possible_exemption_or_cap"
  | "extreme_delta"
  | "basis_mismatch"
  | "asking_outlier";

export interface AnchorPlausibility {
  verdict: AnchorVerdict;
  /** assessedValue / askingPrice. Null when there was no asking price or
   * assessed value to compare (nothing to evaluate). */
  ratio: number | null;
  /** Null when verdict is "anchor" and nothing noteworthy triggered the
   * check (the ordinary in-band case). Non-null on both "context_only" AND
   * the "asking_outlier" flavor of "anchor" (assessed stays trustworthy,
   * but the finding is still worth surfacing). */
  reason: AnchorDemotionReason | null;
  /** What the offer model actually anchors on given this verdict. */
  anchorSource: "tax_assessed" | "avm" | "language";
  confidence: "high" | "medium" | "low";
  /** One-line, render-safe explanation — used directly by the UI caveat
   * and fed to the narrative prompt so it can explain the anchor choice. */
  note: string;
}

export interface ListingHistory {
  found: boolean;
  source: "zoocasa" | "housesigma" | "link_only";
  relistCount?: number;
  cumulativeDom?: number;
  priceChanges?: {
    date: string;
    oldPrice: number;
    newPrice: number;
    changePercent: number;
  }[];
  originalListPrice?: number;
  currentListPrice?: number;
  totalPriceReduction?: number;
  totalReductionPercent?: number;
  comparables?: {
    address: string;
    soldPrice: number;
    soldDate: string;
    beds: number;
    sqft: number;
    distanceKm: number;
  }[];
  zoocasaUrl?: string;
  houseSigmaUrl?: string;
}

export interface ScoreResult {
  total: number;
  tier: "HOT" | "WARM" | "WATCH";
  breakdown: Record<string, number>;
}

export interface OfferResult {
  anchor: number;
  anchorTag: string;
  anchorType: "assessment" | "language";
  listToAssessedRatio: number;
  domAdjusted: number;
  domMultiplier: number;
  domTag: string;
  signalAdjusted: number;
  signalTags: string[];
  finalOffer: number;
  percentOfList: number;
  savings: number;
  inTargetRange: boolean;
}

// ---------------------------------------------------------------------------
// Sold comparables
// ---------------------------------------------------------------------------

export interface ComparableSale {
  // === ALWAYS AVAILABLE (search-level) ===
  address: string;
  city: string;
  province: string;
  soldPrice: number;
  listPrice: number;
  soldAt: string;
  soldToListRatio: number;
  bedrooms: number;
  bathrooms: number;
  propertyType: string; // normalized: "SFH" | "Condo" | "Townhouse" | "Other"
  position: { lng: number; lat: number };
  distanceKm: number;
  postalCode: string;
  mls: string;

  // === SOMETIMES AVAILABLE (search-level, market-dependent) ===
  sqft: number | null;
  neighbourhood: string | null;
  unit: string | null;
  maintenanceFee: number | null;

  // === DETAIL-ENRICHED (only if detail fetch triggered) ===
  enriched: boolean;
  yearBuilt: string | null;
  lotSize: string | null;
  taxes: number | null;
  eraBucket: string | null; // "New build" | "Established" | "Mid-century" | "Pre-war" | null
  descriptionExcerpt: string | null;

  // === SCORING ===
  similarityScore: number;
  matchTier: "strong" | "moderate" | "weak";
}

export interface ComparableResult {
  comparables: ComparableSale[];
  confidence: "high" | "medium" | "low" | "none";
  poolSize: number;
  matchedCount: number;
  medianSoldToList: number | null;
  medianPricePerSqft: number | null;
  impliedValue: number | null;
  dataGaps: string[];
  marketNote: string;
  compValidation?: "confirmed" | "aggressive" | "conservative";
}

export interface AnalysisResult {
  listing: Listing;
  assessment: Assessment | null;
  history: ListingHistory | null;
  score: ScoreResult;
  offer: OfferResult | null;
  signals: string[];
}

export interface DiscoverRequest {
  city: string;
  province: string;
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  propertyType?: string;
  sortBy?: "score" | "dom" | "price";
  limit?: number;
}
