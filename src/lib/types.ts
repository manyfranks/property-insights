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
  preOffer?: PrecomputedOffer;
  preAssessment?: Assessment;
  assessmentNote?: string;
  preComparables?: ComparableResult;
  // Lifecycle metadata
  source?: "cron" | "user";
  enrichedAt?: string;
}

export interface Assessment {
  totalValue: number;
  landValue: number;
  buildingValue: number;
  assessmentYear: string;
  found: boolean;
  source?: "government" | "tax_reverse" | "area_median" | "cache";
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
