import { Listing } from "./types";
import { CityBounds } from "./data/city-bounds";
import { getAllListings } from "./kv/listings";

const API_URL = "https://api2.realtor.ca/Listing.svc/PropertySearch_Post";

interface RealtorCaResult {
  Id: string;
  MlsNumber: string;
  Property: {
    Address: { AddressText: string };
    PriceUnformattedValue?: string;
    Price?: string;
    Type?: string;
    OwnershipType?: string;
    Parking?: Array<{ Name: string }>;
    Photo?: Array<{ SequenceId: string; HighResPath: string }>;
  };
  Building: {
    BathroomTotal?: string;
    Bedrooms?: string;
    SizeInterior?: string;
    Type?: string;
    StoriesTotal?: string;
    ConstructedDate?: string;
  };
  Land?: {
    SizeTotal?: string;
  };
  PostalCode?: string;
  PublicRemarks?: string;
  InsertedDateUTC?: string;
  RelativeURLEn?: string;
}

function parseDom(insertedDate?: string): number {
  if (!insertedDate) return 0;
  const listed = new Date(insertedDate);
  const now = new Date();
  return Math.floor((now.getTime() - listed.getTime()) / (1000 * 60 * 60 * 24));
}

function detectEstateKeywords(text: string): boolean {
  const kw = ["estate sale", "estate", "executor", "probate", "deceased", "must sell", "as-is", "as is"];
  return kw.some((k) => text.includes(k));
}

function detectSuite(text: string): boolean {
  const kw = ["suite", "in-law", "inlaw", "secondary dwelling", "two kitchen", "2 kitchen"];
  return kw.some((k) => text.includes(k));
}

function detectPriceReduced(text: string): boolean {
  const kw = ["price reduced", "price reduction", "reduced!", "new price", "price improvement"];
  return kw.some((k) => text.includes(k));
}

function parseRealtorResult(r: RealtorCaResult, city: string, province: string): Listing {
  const desc = (r.PublicRemarks || "").toLowerCase();
  const address = r.Property?.Address?.AddressText?.split(",")[0]?.trim() || "";
  const price = parseInt(r.Property?.PriceUnformattedValue || "0") || 0;

  return {
    address,
    city,
    province,
    dom: parseDom(r.InsertedDateUTC),
    price,
    beds: r.Building?.Bedrooms || "0",
    baths: r.Building?.BathroomTotal || "0",
    sqft: r.Building?.SizeInterior?.replace(/[^0-9]/g, "") || "",
    yearBuilt: r.Building?.ConstructedDate || "",
    taxes: "",
    lotSize: r.Land?.SizeTotal || "",
    priceReduced: detectPriceReduced(desc),
    hasSuite: detectSuite(desc),
    estateKeywords: detectEstateKeywords(desc),
    description: r.PublicRemarks || "",
    notes: "",
    cluster: "",
    url: r.RelativeURLEn ? `https://www.realtor.ca${r.RelativeURLEn}` : "",
    mlsNumber: r.MlsNumber,
  };
}

export async function searchListings(
  city: string,
  province: string,
  bounds: CityBounds,
  options?: {
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<Listing[]> {
  const params = new URLSearchParams({
    ZoomLevel: "11",
    LatitudeMax: bounds.latMax.toString(),
    LatitudeMin: bounds.latMin.toString(),
    LongitudeMax: bounds.lngMax.toString(),
    LongitudeMin: bounds.lngMin.toString(),
    CurrentPage: "1",
    RecordsPerPage: (options?.limit || 50).toString(),
    PropertySearchTypeId: "1",
    TransactionTypeId: "2",
    PropertyTypeGroupID: "1",
    SortBy: "6",
    SortOrder: "D",
    ...(options?.minPrice && { PriceMin: options.minPrice.toString() }),
    ...(options?.maxPrice && { PriceMax: options.maxPrice.toString() }),
    ...(options?.minBeds && { BedRange: `${options.minBeds}-0` }),
  });

  const scraperApiKey = process.env.SCRAPER_API_KEY;

  let res: Response;

  if (scraperApiKey) {
    // Proxy through ScraperAPI to avoid Cloudflare blocking
    const targetUrl = encodeURIComponent(API_URL);
    const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${targetUrl}`;

    res = await fetch(scraperUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: options?.signal,
    });
  } else {
    // Direct call (works locally, may be blocked in production)
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.realtor.ca",
        Referer: "https://www.realtor.ca/",
      },
      body: params.toString(),
      signal: options?.signal,
    });
  }

  if (!res.ok) {
    throw new Error(`realtor.ca API returned ${res.status}`);
  }

  const data = await res.json();
  const results: RealtorCaResult[] = data.Results || [];
  return results.map((r) => parseRealtorResult(r, city, province));
}

export async function searchListingsWithFallback(
  city: string,
  province: string,
  bounds: CityBounds,
  options?: {
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    limit?: number;
  }
): Promise<{ listings: Listing[]; source: "live" | "cached" }> {
  // 1. Check for cached listings first — return immediately if available
  const allListings = await getAllListings();
  const cached = allListings.filter(
    (l) => l.city.toLowerCase() === city.toLowerCase() && l.province === province
  );
  if (cached.length > 0) {
    return { listings: cached, source: "cached" };
  }

  // 2. No cached data — try live API with a 10s timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const listings = await searchListings(city, province, bounds, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (listings.length > 0) {
      return { listings, source: "live" };
    }
  } catch {
    // Live fetch failed or timed out
  }

  return { listings: [], source: "cached" };
}
