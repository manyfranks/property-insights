export interface Listing {
  address: string;
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
}

export interface Assessment {
  totalValue: number;
  landValue: number;
  buildingValue: number;
  assessmentYear: string;
  found: boolean;
}

export interface ListingHistory {
  found: boolean;
  source: "housesigma" | "link_only";
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
  houseSigmaUrl: string;
}

export interface ScoreResult {
  total: number;
  tier: "HOT" | "WARM" | "WATCH";
  breakdown: Record<string, number>;
}

export interface OfferResult {
  anchor: number;
  anchorTag: string;
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
