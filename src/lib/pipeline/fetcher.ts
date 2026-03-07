/**
 * pipeline/fetcher.ts
 *
 * Two-call fetch strategy for the pipeline.
 *
 * WHY TWO CALLS?
 *   A single "Oldest first" sort misses one important motivated-seller category:
 *   properties priced conspicuously below their neighbors (financial pressure,
 *   estate situations, quick sale pricing). These often list at market and get
 *   relisted, so they appear fresh on DOM but cheap on price.
 *
 *   Call 1 — Oldest sort:  catches stale listings (genuine DOM pressure)
 *   Call 2 — Price ascending: catches underpriced listings (financial pressure)
 *
 *   Combined, deduplicated by MLS number, gives 20-40 candidates.
 *   The scorer then ranks by language — not by which call found them.
 *
 * PROXY:
 *   Uses SCRAPER_API_KEY if available (required in production on Vercel).
 *   Falls back to direct call for local dev.
 */

import { Listing } from "../types";
import { FilterProfile } from "./exclusions";
import { CityBounds } from "../data/city-bounds";

const REALTOR_API = "https://api2.realtor.ca/Listing.svc/PropertySearch_Post";

// ---------------------------------------------------------------------------
// Raw realtor.ca result shape (minimal — only fields we use)
// ---------------------------------------------------------------------------

interface RawListing {
  MlsNumber?: string;
  Property?: {
    Address?: { AddressText?: string };
    PriceUnformattedValue?: string;
    Price?: string;
    Type?: string;
  };
  Building?: {
    BathroomTotal?: string;
    Bedrooms?: string;
    SizeInterior?: string;
    ConstructedDate?: string;
    Type?: string;
  };
  Land?: { SizeTotal?: string };
  PublicRemarks?: string;
  InsertedDateUTC?: string;
  RelativeURLEn?: string;
  PostalCode?: string;
}

// ---------------------------------------------------------------------------
// DOM parser
// ---------------------------------------------------------------------------

function parseDom(insertedDateUTC?: string): number {
  if (!insertedDateUTC) return 0;
  // realtor.ca uses either ISO string OR .NET ticks (/Date(ticks)/)
  let ms: number;
  const ticksMatch = insertedDateUTC.match(/\/Date\((\d+)\)\//);
  if (ticksMatch) {
    // .NET ticks: milliseconds since Unix epoch
    ms = parseInt(ticksMatch[1]);
  } else {
    ms = new Date(insertedDateUTC).getTime();
  }
  if (isNaN(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function detectKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k.toLowerCase()));
}

function parsePrice(raw?: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9]/g, "");
  return cleaned ? parseInt(cleaned) : 0;
}

// ---------------------------------------------------------------------------
// Raw → Listing mapper
// ---------------------------------------------------------------------------

function mapListing(r: RawListing, city: string, province: string): Listing {
  const desc = (r.PublicRemarks ?? "").toLowerCase();
  const address = r.Property?.Address?.AddressText?.split(",")[0]?.trim() ?? "";

  // Price: prefer unformatted value, fall back to formatted string
  const price =
    parsePrice(r.Property?.PriceUnformattedValue) ||
    parsePrice(r.Property?.Price) ||
    0;

  // yearBuilt: store null if missing or zero
  const ybRaw = parseInt(r.Building?.ConstructedDate ?? "0");
  const yearBuilt = ybRaw > 0 ? String(ybRaw) : "";

  return {
    address,
    city,
    province,
    dom: parseDom(r.InsertedDateUTC),
    price,
    beds: r.Building?.Bedrooms ?? "0",
    baths: r.Building?.BathroomTotal ?? "0",
    sqft: r.Building?.SizeInterior?.replace(/[^0-9]/g, "") ?? "",
    yearBuilt,
    taxes: "",
    lotSize: r.Land?.SizeTotal ?? "",
    priceReduced: detectKeywords(desc, [
      "price reduced", "price reduction", "reduced!", "new price", "price improvement",
    ]),
    hasSuite: detectKeywords(desc, [
      "suite", "in-law", "inlaw", "secondary dwelling", "2 kitchen", "two kitchen",
    ]),
    estateKeywords: detectKeywords(desc, [
      "estate sale", "executor", "probate", "deceased", "must sell",
    ]),
    description: r.PublicRemarks ?? "",
    notes: "",
    cluster: "",
    url: r.RelativeURLEn ? `https://www.realtor.ca${r.RelativeURLEn}` : "",
    mlsNumber: r.MlsNumber,
  };
}

// ---------------------------------------------------------------------------
// Single API call
// ---------------------------------------------------------------------------

async function fetchPage(
  bounds: CityBounds,
  profile: FilterProfile,
  sortBy: "6" | "1",   // "6" = Oldest first, "1" = Price ascending
  sortOrder: "A" | "D",
  page = 1
): Promise<RawListing[]> {
  const params: Record<string, string> = {
    ZoomLevel: "11",
    LatitudeMax: bounds.latMax.toString(),
    LatitudeMin: bounds.latMin.toString(),
    LongitudeMax: bounds.lngMax.toString(),
    LongitudeMin: bounds.lngMin.toString(),
    CurrentPage: page.toString(),
    RecordsPerPage: "24",       // 24 per page = enough candidates without over-fetching
    PropertySearchTypeId: "1",
    TransactionTypeId: "2",     // For Sale
    PropertyTypeGroupID: "1",   // Residential
    SortBy: sortBy,
    SortOrder: sortOrder,
  };

  // Price filter
  if (profile.priceMin !== null) params.PriceMin = profile.priceMin.toString();
  if (profile.priceMax !== null) params.PriceMax = profile.priceMax.toString();

  // Bed filter
  if (profile.minBeds !== null) params.BedRange = `${profile.minBeds}-0`;

  // Building type filter (House = 1)
  if (profile.buildingTypes.length === 1 && profile.buildingTypes[0] === "1") {
    params.BuildingTypeId = "1";
  }

  const body = new URLSearchParams(params).toString();
  const scraperKey = process.env.SCRAPER_API_KEY;

  let res: Response;

  if (scraperKey) {
    const target = encodeURIComponent(REALTOR_API);
    const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${target}`;
    res = await fetch(scraperUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } else {
    res = await fetch(REALTOR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.realtor.ca",
        Referer: "https://www.realtor.ca/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body,
    });
  }

  if (!res.ok) {
    throw new Error(`realtor.ca returned ${res.status} for sortBy=${sortBy}`);
  }

  const data = await res.json();
  return (data?.Results ?? []) as RawListing[];
}

// ---------------------------------------------------------------------------
// Two-call strategy
// ---------------------------------------------------------------------------

export interface FetchResult {
  listings: Listing[];
  /** How many were deduplicated between the two calls */
  internalDuplicates: number;
  /** MLS numbers returned from call 1 (oldest sort) */
  staleMlsNumbers: string[];
  /** MLS numbers returned from call 2 (price ascending) */
  cheapMlsNumbers: string[];
}

/**
 * Fetch candidates for a city using two complementary sorts.
 * Returns deduplicated listings across both calls.
 */
export async function fetchCandidates(
  city: string,
  province: string,
  bounds: CityBounds,
  profile: FilterProfile
): Promise<FetchResult> {
  const [staleRaw, cheapRaw] = await Promise.all([
    fetchPage(bounds, profile, "6", "A"),   // Oldest listed first
    fetchPage(bounds, profile, "1", "A"),   // Cheapest listed first
  ]);

  const staleListings = staleRaw.map((r) => mapListing(r, city, province));
  const cheapListings = cheapRaw.map((r) => mapListing(r, city, province));

  const staleMlsNumbers = staleListings
    .map((l) => l.mlsNumber)
    .filter(Boolean) as string[];

  const cheapMlsNumbers = cheapListings
    .map((l) => l.mlsNumber)
    .filter(Boolean) as string[];

  // Merge, dedup by MLS number (stale listings take priority in tie)
  const seen = new Set<string>();
  const merged: Listing[] = [];
  let dupes = 0;

  for (const l of [...staleListings, ...cheapListings]) {
    const mls = l.mlsNumber;
    if (mls && seen.has(mls)) {
      dupes++;
      continue;
    }
    if (mls) seen.add(mls);
    merged.push(l);
  }

  return {
    listings: merged,
    internalDuplicates: dupes,
    staleMlsNumbers,
    cheapMlsNumbers,
  };
}
