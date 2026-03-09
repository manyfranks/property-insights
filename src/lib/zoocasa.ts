/**
 * zoocasa.ts
 *
 * Fetcher for Zoocasa listing data. Replaces both realtor-ca.ts (search/detail)
 * and housesigma.ts (history/price tracking).
 *
 * Zoocasa is a Next.js app with server-rendered pages. All listing data is
 * embedded in a <script id="__NEXT_DATA__"> tag as JSON, making extraction
 * reliable without needing a headless browser.
 *
 * Data shapes differ between search (snake_case) and detail (camelCase).
 */

import { Listing, ListingHistory } from "./types";

// ---------------------------------------------------------------------------
// Types — Zoocasa raw data shapes
// ---------------------------------------------------------------------------

/** Search results use snake_case field names */
interface ZoocasaSearchResult {
  id: number;
  mls?: string;
  slug?: string;
  address: string;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  square_footage?: { gt?: number; gte?: number; lt?: number; lte?: number };
  created_at?: string;
  sub_division?: string;
  province?: string;
  postal_code?: string;
  property_type?: string;
  address_url_absolute_path?: string;
  listing_url_absolute_path?: string;
  position?: string; // "POINT(lng lat)"
}

/** Detail pages use camelCase field names */
interface ZoocasaDetailResult {
  id: number;
  mlsNum?: string;
  addressSlug?: string;
  addressPath?: string;
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: { max?: number; min?: number };
  addedAt?: string;
  expiredAt?: string;
  soldAt?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  streetNumber?: string;
  streetName?: string;
  taxes?: number;
  misc?: {
    approxAge?: string;
    acreage?: number | string;
    [key: string]: unknown;
  };
  localeData?: {
    en?: {
      description?: string;
      [key: string]: unknown;
    };
  };
  history?: ZoocasaHistoryEntry[];
  neighbourhoodName?: string;
  basement?: string;
  heat?: string;
  ac?: string;
  parking?: number | string;
  lotFrontage?: number;
  lotDepth?: number;
  type?: string;
  propertySubType?: string;
  position?: { type: string; coordinates: [number, number] };
}

interface ZoocasaHistoryEntry {
  id: number;
  price: number;
  addedAt?: string;
  expiredAt?: string;
  soldAt?: string;
  isAvailable?: boolean;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

function citySlug(city: string): string {
  return city.toLowerCase().replace(/\s+/g, "-");
}

function provSlug(province: string): string {
  return province.toLowerCase();
}

// Zoocasa uses abbreviated street types and directionals in URL slugs.
// Google Places gives full names — we must abbreviate to match.
const SLUG_ABBREVS: [RegExp, string][] = [
  // Directionals (must come before street types to avoid partial matches)
  [/\bnorthwest\b/gi, "nw"],
  [/\bnortheast\b/gi, "ne"],
  [/\bsouthwest\b/gi, "sw"],
  [/\bsoutheast\b/gi, "se"],
  // Street types
  [/\bstreet\b/gi, "st"],
  [/\bavenue\b/gi, "ave"],
  [/\bdrive\b/gi, "dr"],
  [/\bcrescent\b/gi, "cres"],
  [/\bboulevard\b/gi, "blvd"],
  [/\broad\b/gi, "rd"],
  [/\bplace\b/gi, "pl"],
  [/\bcourt\b/gi, "crt"],
  [/\bterrace\b/gi, "terr"],
  [/\bcircle\b/gi, "cir"],
  [/\blane\b/gi, "lane"],
  [/\btrail\b/gi, "trail"],
  [/\bway\b/gi, "way"],
  [/\bclose\b/gi, "close"],
  [/\bgate\b/gi, "gate"],
  [/\bheights\b/gi, "hts"],
  [/\bpoint\b/gi, "pt"],
  [/\bgreen\b/gi, "green"],
  [/\bgrove\b/gi, "grove"],
  [/\bcove\b/gi, "cove"],
  [/\blanding\b/gi, "landing"],
  [/\brise\b/gi, "rise"],
  [/\bsquare\b/gi, "sq"],
  [/\bpark\b/gi, "pk"],
  [/\bparkway\b/gi, "pkwy"],
];

function addressSlug(address: string): string {
  let street = address;

  // Extract trailing unit number and move it to the front to match Zoocasa's
  // slug convention.  Google Places returns "1628 Store St #900" but Zoocasa
  // expects "900-1628-store-st".
  let unit: string | null = null;
  const trailingUnit = street.match(/[\s,]+(?:#|unit\s*|suite\s*|apt\s*)(\d+[A-Z]?)\s*$/i);
  if (trailingUnit) {
    unit = trailingUnit[1];
    street = street.slice(0, trailingUnit.index!).trim();
  }

  let slug = street.toLowerCase();
  for (const [pat, repl] of SLUG_ABBREVS) {
    slug = slug.replace(pat, repl);
  }
  slug = slug
    .replace(/[#,\.]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (unit) {
    slug = `${unit.toLowerCase()}-${slug}`;
  }

  return slug;
}

export function buildSearchUrl(
  city: string,
  province: string,
  options?: {
    minPrice?: number;
    maxPrice?: number;
    type?: string;
    beds?: number;
    sortBy?: string;
  }
): string {
  const base = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate`;
  const params = new URLSearchParams({ saleOrRent: "sale" });

  if (options?.type) params.set("type", options.type);
  if (options?.minPrice) params.set("minPrice", options.minPrice.toString());
  if (options?.maxPrice) params.set("maxPrice", options.maxPrice.toString());
  if (options?.beds) params.set("beds", options.beds.toString());
  if (options?.sortBy) params.set("sortBy", options.sortBy);

  return `${base}?${params.toString()}`;
}

export function buildDetailUrl(
  address: string,
  city: string,
  province: string
): string {
  return `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate/${addressSlug(address)}`;
}

// ---------------------------------------------------------------------------
// __NEXT_DATA__ extractor
// ---------------------------------------------------------------------------

function extractNextData(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text detection helpers
// ---------------------------------------------------------------------------

function detectKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// ---------------------------------------------------------------------------
// DOM calculation
// ---------------------------------------------------------------------------

function computeDom(addedAt?: string, history?: ZoocasaHistoryEntry[]): number {
  let earliest = addedAt;
  if (history && history.length > 0) {
    for (const h of history) {
      if (h.addedAt && (!earliest || h.addedAt < earliest)) {
        earliest = h.addedAt;
      }
    }
  }
  if (!earliest) return 0;
  const ms = new Date(earliest).getTime();
  if (isNaN(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Address cleaning (search results include "Street, City, Province, Postal")
// ---------------------------------------------------------------------------

function cleanSearchAddress(fullAddress: string): string {
  // "1024 Boxcar Close, Langford, BC, V9B0Y4" → "1024 Boxcar Close"
  const parts = fullAddress.split(",");
  return parts[0]?.trim() || fullAddress;
}

// ---------------------------------------------------------------------------
// History parsing
// ---------------------------------------------------------------------------

export function parseHistory(
  listing: ZoocasaDetailResult
): ListingHistory {
  const history = listing.history || [];
  const slug = listing.addressSlug || "";
  const city = listing.city || "";
  const province = listing.province || "";
  const zoocasaUrl = slug
    ? `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate/${slug}`
    : "";

  if (history.length === 0) {
    return {
      found: true,
      source: "zoocasa",
      relistCount: 0,
      cumulativeDom: computeDom(listing.addedAt),
      priceChanges: [],
      zoocasaUrl,
    };
  }

  const sorted = [...history].sort((a, b) => {
    if (!a.addedAt || !b.addedAt) return 0;
    return a.addedAt.localeCompare(b.addedAt);
  });

  const relistCount = Math.max(0, sorted.length - 1);

  const priceChanges: NonNullable<ListingHistory["priceChanges"]> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.price !== curr.price) {
      priceChanges.push({
        date: curr.addedAt || "",
        oldPrice: prev.price,
        newPrice: curr.price,
        changePercent: prev.price
          ? ((curr.price - prev.price) / prev.price) * 100
          : 0,
      });
    }
  }

  const originalListPrice = sorted[0].price;
  const currentListPrice = sorted[sorted.length - 1].price;
  const totalPriceReduction =
    originalListPrice && currentListPrice
      ? originalListPrice - currentListPrice
      : 0;
  const totalReductionPercent =
    originalListPrice && totalPriceReduction
      ? (totalPriceReduction / originalListPrice) * 100
      : 0;

  const earliestDate = sorted[0].addedAt;
  const cumulativeDom = earliestDate
    ? Math.max(0, Math.floor((Date.now() - new Date(earliestDate).getTime()) / 86_400_000))
    : computeDom(listing.addedAt);

  return {
    found: true,
    source: "zoocasa",
    relistCount,
    cumulativeDom,
    priceChanges,
    originalListPrice,
    currentListPrice,
    totalPriceReduction: totalPriceReduction > 0 ? totalPriceReduction : undefined,
    totalReductionPercent: totalReductionPercent > 0 ? totalReductionPercent : undefined,
    zoocasaUrl,
  };
}

// ---------------------------------------------------------------------------
// Search listing mapper (snake_case search results → Listing)
// ---------------------------------------------------------------------------

function mapSearchListing(
  r: ZoocasaSearchResult,
  city: string,
  province: string
): Listing {
  const urlPath = r.listing_url_absolute_path || r.address_url_absolute_path;
  const url = urlPath
    ? `https://www.zoocasa.com${urlPath}`
    : buildDetailUrl(cleanSearchAddress(r.address), city, province);

  const sqft = r.square_footage?.gte || r.square_footage?.lt || 0;

  return {
    address: cleanSearchAddress(r.address),
    city: r.sub_division || city,
    province: r.province || province,
    dom: computeDom(r.created_at),
    price: r.price || 0,
    beds: String(r.bedrooms || 0),
    baths: String(r.bathrooms || 0),
    sqft: sqft ? String(sqft) : "",
    yearBuilt: "",
    taxes: "",
    lotSize: "",
    priceReduced: false,
    hasSuite: false,
    estateKeywords: false,
    description: "",
    notes: "",
    cluster: "",
    url,
    mlsNumber: r.mls,
  };
}

// ---------------------------------------------------------------------------
// Detail listing mapper (camelCase detail page → Listing with full data)
// ---------------------------------------------------------------------------

function mapDetailListing(
  r: ZoocasaDetailResult,
  city: string,
  province: string,
  parsedUnit?: string
): Listing {
  const desc = r.localeData?.en?.description || "";
  const descLower = desc.toLowerCase();

  const urlPath = r.addressPath;
  const slug = r.addressSlug || "";
  const url = urlPath
    ? `https://www.zoocasa.com${urlPath}`
    : slug
      ? `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate/${slug}`
      : "";

  const bareAddress = r.streetNumber && r.streetName
    ? `${r.streetNumber} ${r.streetName}`
    : "";

  // Extract unit number: prefer caller-provided, then try slug prefix.
  // Zoocasa slug for condos: "900-1628-store-st" where 900 is the unit.
  // If streetNumber is "1628" and slug starts with a number that isn't "1628",
  // that leading number is the unit.
  let unit = parsedUnit;
  if (!unit && slug && r.streetNumber) {
    const slugLeading = slug.match(/^(\d+[a-z]?)-/i);
    if (slugLeading && slugLeading[1] !== r.streetNumber) {
      unit = slugLeading[1];
    }
  }

  // Prepend unit to address for display: "106-1987 Kaltasin Rd"
  const address = unit && bareAddress ? `${unit}-${bareAddress}` : bareAddress;

  // Year built from approxAge (e.g., "2021" or "51-99")
  let yearBuilt = "";
  if (r.misc?.approxAge) {
    const raw = r.misc.approxAge;
    if (/^\d{4}$/.test(raw)) {
      yearBuilt = raw;
    } else {
      const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const midAge = (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2;
        yearBuilt = String(Math.round(new Date().getFullYear() - midAge));
      } else if (/^\d+$/.test(raw)) {
        yearBuilt = String(new Date().getFullYear() - parseInt(raw));
      }
    }
  }

  // Lot size: use acreage if available
  const acreage = r.misc?.acreage;
  const lotSize = acreage ? String(acreage) : "";

  const sqft = r.squareFootage?.max || 0;

  return {
    address,
    ...(unit ? { unit } : {}),
    city: r.city || city,
    province: r.province || province,
    dom: computeDom(r.addedAt, r.history),
    price: r.price || 0,
    beds: String(r.bedrooms || 0),
    baths: String(r.bathrooms || 0),
    sqft: sqft ? String(sqft) : "",
    yearBuilt,
    taxes: r.taxes ? String(Math.round(r.taxes)) : "",
    lotSize,
    priceReduced: detectKeywords(descLower, [
      "price reduced", "price reduction", "reduced!", "new price", "price improvement",
    ]),
    hasSuite: detectKeywords(descLower, [
      "suite", "in-law", "inlaw", "secondary dwelling", "2 kitchen", "two kitchen",
    ]),
    estateKeywords: detectKeywords(descLower, [
      "estate sale", "executor", "probate", "deceased", "must sell",
    ]),
    description: desc,
    notes: "",
    cluster: "",
    url,
    mlsNumber: r.mlsNum,
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function fetchPage(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });

  if (res.status === 404) {
    throw new ZoocasaNotFoundError(url);
  }

  if (res.url.includes("missingAddress")) {
    throw new ZoocasaNotFoundError(url);
  }

  if (!res.ok) {
    throw new Error(`Zoocasa returned ${res.status} for ${url}`);
  }

  return res.text();
}

export class ZoocasaNotFoundError extends Error {
  constructor(url: string) {
    super(`Listing not found: ${url}`);
    this.name = "ZoocasaNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Public API: Search
// ---------------------------------------------------------------------------

export async function searchListings(
  city: string,
  province: string,
  options?: {
    minPrice?: number;
    maxPrice?: number;
    type?: string;
    beds?: number;
    sortBy?: string;
  }
): Promise<Listing[]> {
  const url = buildSearchUrl(city, province, {
    type: options?.type || "house",
    ...options,
  });

  const html = await fetchPage(url);
  const data = extractNextData(html);
  if (!data) return [];

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  const listings = (innerProps?.listings || []) as ZoocasaSearchResult[];

  return listings.map((r) => mapSearchListing(r, city, province));
}

// ---------------------------------------------------------------------------
// Public API: Detail (single listing with full data + history)
// ---------------------------------------------------------------------------

export interface DetailResult {
  listing: Listing;
  history: ListingHistory;
  raw: ZoocasaDetailResult;
}

export async function fetchDetail(
  address: string,
  city: string,
  province: string,
  slug?: string
): Promise<DetailResult> {
  // Extract unit from input address before Zoocasa strips it.
  // Google Places: "6110 Seabroom Rd #4" → unit "4"
  const inputUnit = address.match(/[\s,]+(?:#|unit\s*|suite\s*|apt\s*)(\d+[A-Z]?)\s*$/i)?.[1];

  const base = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate`;
  const detailSlug = slug || addressSlug(address);

  let html: string;
  try {
    html = await fetchPage(`${base}/${detailSlug}`);
  } catch (err) {
    // If abbreviated slug 404s, try raw slug (some markets use full names)
    if (!slug && err instanceof ZoocasaNotFoundError) {
      const rawSlug = address
        .toLowerCase()
        .replace(/[#,\.]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      if (rawSlug !== detailSlug) {
        html = await fetchPage(`${base}/${rawSlug}`);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  const data = extractNextData(html);
  if (!data) throw new Error("Could not extract __NEXT_DATA__ from detail page");

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  const activeListing = innerProps?.activeListing as Record<string, unknown> | undefined;
  const raw = (activeListing?.listing || {}) as ZoocasaDetailResult;

  raw.city = raw.city || city;
  raw.province = raw.province || province;

  const listing = mapDetailListing(raw, city, province, inputUnit);
  const history = parseHistory(raw);

  return { listing, history, raw };
}

/**
 * Parse a Zoocasa listing URL into city, province, and slug.
 * Accepts: https://www.zoocasa.com/langford-bc-real-estate/316-2341-bear-mountain-pky
 */
export function parseZoocasaUrl(url: string): { city: string; province: string; slug: string } | null {
  const match = url.match(/zoocasa\.com\/([a-z][a-z0-9-]*)-([a-z]{2})-real-estate\/([a-z0-9][a-z0-9-]+)/i);
  if (!match) return null;
  // Convert city slug back to title case: "langford" → "Langford", "west-vancouver" → "West Vancouver"
  const city = match[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return { city, province: match[2].toLowerCase(), slug: match[3].toLowerCase() };
}

/**
 * Fetch a listing directly from a full Zoocasa URL.
 * Bypasses address parsing and slug construction entirely.
 */
export async function fetchDetailByUrl(url: string): Promise<DetailResult> {
  const parsed = parseZoocasaUrl(url);
  if (!parsed) throw new Error("Invalid Zoocasa URL");

  const html = await fetchPage(url);
  const data = extractNextData(html);
  if (!data) throw new Error("Could not extract __NEXT_DATA__ from detail page");

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  const activeListing = innerProps?.activeListing as Record<string, unknown> | undefined;
  const raw = (activeListing?.listing || {}) as ZoocasaDetailResult;

  raw.city = raw.city || parsed.city;
  raw.province = raw.province || parsed.province;

  const listing = mapDetailListing(raw, parsed.city, parsed.province);
  const history = parseHistory(raw);

  return { listing, history, raw };
}

// ---------------------------------------------------------------------------
// Public API: Freshness check (is a listing still active?)
// ---------------------------------------------------------------------------

export async function checkFreshness(
  address: string,
  city: string,
  province: string,
  slug?: string
): Promise<"live" | "dead" | "unknown"> {
  try {
    const detailSlug = slug || addressSlug(address);
    const url = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate/${detailSlug}`;

    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });

    if (res.status === 404 || res.url.includes("missingAddress")) {
      return "dead";
    }

    if (res.ok) return "live";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Public API: Batch search for pipeline (replaces realtor-ca fetchCandidates)
// ---------------------------------------------------------------------------

export interface FetchResult {
  listings: Listing[];
  internalDuplicates: number;
}

/**
 * Fetch candidates for a city using Zoocasa search.
 * Two complementary searches: default sort (relevance) + oldest first.
 */
export async function fetchCandidates(
  city: string,
  province: string,
  options?: {
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    type?: string;
  }
): Promise<FetchResult> {
  const baseOpts = {
    type: options?.type || "house",
    minPrice: options?.minPrice,
    maxPrice: options?.maxPrice,
    beds: options?.minBeds,
  };

  const [defaultResults, oldestResults] = await Promise.all([
    searchListings(city, province, baseOpts).catch(() => [] as Listing[]),
    searchListings(city, province, { ...baseOpts, sortBy: "days-desc" }).catch(
      () => [] as Listing[]
    ),
  ]);

  const seen = new Set<string>();
  const merged: Listing[] = [];
  let dupes = 0;

  for (const l of [...defaultResults, ...oldestResults]) {
    const key = l.mlsNumber || l.address;
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    merged.push(l);
  }

  return { listings: merged, internalDuplicates: dupes };
}
