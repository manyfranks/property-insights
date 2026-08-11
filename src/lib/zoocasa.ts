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
import {
  addZoocasaEvidence,
  createPropertyEvidenceSnapshot,
} from "./property-intelligence/evidence";

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

export function mapSearchListing(
  r: ZoocasaSearchResult,
  city: string,
  province: string
): Listing {
  const urlPath = r.listing_url_absolute_path || r.address_url_absolute_path;
  const url = urlPath
    ? `https://www.zoocasa.com${urlPath}`
    : buildDetailUrl(cleanSearchAddress(r.address), city, province);

  const sqft = r.square_footage?.gte || r.square_footage?.lt || 0;
  const normalizedAddress = cleanSearchAddress(r.address);
  const propertyEvidence = addZoocasaEvidence(
    createPropertyEvidenceSnapshot({
      surface: "canada_listing",
      normalizedAddress,
    }),
    {
      stage: "search",
      propertyType: r.property_type,
      sourceRecordId: String(r.id),
    }
  );

  return {
    address: normalizedAddress,
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
    propertyEvidence,
  };
}

// ---------------------------------------------------------------------------
// Detail listing mapper (camelCase detail page → Listing with full data)
// ---------------------------------------------------------------------------

export function mapDetailListing(
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

  const listing: Listing = {
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
    propertyEvidence: addZoocasaEvidence(
      createPropertyEvidenceSnapshot({
        surface: "canada_listing",
        normalizedAddress: address,
        parsedUnit: unit,
      }),
      {
        stage: "detail",
        propertyType: r.type,
        propertySubType: r.propertySubType,
        sourceRecordId: String(r.id),
      }
    ),
  };

  // Single-listing extraction boundary: a malformed detail page (missing
  // price/address/city, or a dom that failed to compute) is exactly the
  // kind of Zoocasa drift the pipeline can't safely proceed on — throw
  // instead of letting the || 0 / "" defaults above silently flow into
  // scoring/offer math. Callers (fetchDetail, tryFetchByCitySlug via its
  // existing .catch(() => null), fetchDetailByUrl) already handle thrown
  // errors per-listing without crashing the wider batch.
  const issues = listingShapeIssues(listing);
  if (issues.length > 0) {
    const context = `detail listing "${listing.address || address || "(no address)"}" (${city}, ${province})`;
    console.error(`[zoocasa-shape] ${context}: missing/invalid fields [${issues.join(", ")}]`);
    throw new ZoocasaShapeError(context, issues);
  }

  return listing;
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
// Shape assertions — the extraction boundary (extractNextData + the
// mapSearchListing/mapDetailListing mappers below) is where Zoocasa's raw
// JSON crosses into our Listing type. If Zoocasa changes/drops a field we
// depend on, the old behavior was to silently coerce it to a falsy default
// (price: r.price || 0, address: "", ...) and let the bad value propagate
// into scoring/offer math downstream. Fail loud here instead.
//
// Note: Listing has no discrete "status" field (see src/lib/types.ts) — dom
// (days-on-market, derived from addedAt/history) is the closest available
// liveness/activity signal, so it stands in for "status" below.
// ---------------------------------------------------------------------------

export class ZoocasaShapeError extends Error {
  constructor(context: string, missingFields: string[]) {
    super(`[zoocasa-shape] ${context}: missing/invalid fields [${missingFields.join(", ")}]`);
    this.name = "ZoocasaShapeError";
  }
}

function listingShapeIssues(l: Pick<Listing, "address" | "city" | "price" | "dom">): string[] {
  const issues: string[] = [];
  if (!l.address || typeof l.address !== "string") issues.push("address");
  if (!l.city || typeof l.city !== "string") issues.push("city");
  if (typeof l.price !== "number" || !(l.price > 0)) issues.push("price");
  if (typeof l.dom !== "number" || Number.isNaN(l.dom)) issues.push("dom(status)");
  return issues;
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

  const mapped = listings.map((r) => mapSearchListing(r, city, province));

  // Search results are a batch — an individual malformed listing shouldn't
  // sink the whole page, so (unlike mapDetailListing) we filter + log loudly
  // rather than throw.
  const shapeValid = mapped.filter((l) => {
    const issues = listingShapeIssues(l);
    if (issues.length > 0) {
      console.error(
        `[zoocasa-shape] searchListings("${city}", "${province}"): dropping listing "${l.address}" — missing/invalid fields [${issues.join(", ")}]`
      );
      return false;
    }
    return true;
  });

  // Defend against the province-wide-fallback regression documented on
  // citiesMatch() above: drop listings whose returned city doesn't plausibly
  // match what was requested rather than silently mixing another city's
  // inventory into this one.
  const scoped = shapeValid.filter((l) => citiesMatch(l.city, city));
  if (scoped.length < shapeValid.length) {
    const dropped = shapeValid.length - scoped.length;
    const droppedPct = Math.round((dropped / shapeValid.length) * 100);
    console.error(
      `[zoocasa-scope] searchListings("${city}", "${province}"): dropped ${dropped}/${shapeValid.length} (${droppedPct}%) listings whose city didn't match the request — Zoocasa's subdivision scoping may be degraded (province-wide feed suspected).`
    );
  }

  return scoped;
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

// ---------------------------------------------------------------------------
// Address-to-listing matching
// ---------------------------------------------------------------------------
//
// fetchDetail() constructs a Zoocasa URL slug from a typed address, which
// fails whenever Zoocasa abbreviates differently than our SLUG_ABBREVS table
// (e.g., "Parkway" → "pky" not "pkwy", missing types like "Bay" / "Mews",
// neighbourhood path segments like /shaganappi/...). Verified at 93% on
// scripts/test-address-to-zoocasa.ts.
//
// findAndFetchDetail searches the city's active inventory and picks the
// highest-confidence match using a number-anchored token-overlap score.
// Anchor on street number (must match exactly), then Jaccard overlap on
// the remaining street-name tokens after stripping street types and
// directionals. Threshold 0.7 was chosen so a number-only match (no name
// overlap) doesn't pass — both halves must contribute.

const ADDRESS_STOPWORDS = new Set([
  // street types (full and abbreviated forms)
  "st", "street", "ave", "avenue", "dr", "drive", "rd", "road",
  "blvd", "boulevard", "cres", "crescent", "crt", "court", "pl", "place",
  "way", "lane", "ln", "trail", "tr", "terr", "terrace", "cir", "circle",
  "pk", "park", "pkwy", "pky", "parkway", "sq", "square", "close",
  "gate", "hts", "heights", "pt", "point", "green", "grove", "cove",
  "landing", "rise", "mews", "bay", "glen", "commons", "row", "walk",
  // directionals
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "northeast", "northwest", "southeast", "southwest",
]);

const ADDRESS_MATCH_THRESHOLD = 0.7;

function tokenizeStreetAddress(line: string): { number: string | null; words: string[] } {
  // Normalize: lowercase, strip punctuation, drop trailing "Unit X" / "Suite X" hints,
  // turn "4-170" into "4 170" so the dual-number heuristic below catches Zoocasa's
  // unit-prefix format ("4-170 Celano Cres" → unit 4, street # 170).
  const s = line
    .toLowerCase()
    .replace(/[#,\.]/g, " ")
    .replace(/\s+(unit|suite|apt|apartment)\s+\w+\s*$/i, "")
    .replace(/(\d)-(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  // Two leading numbers → unit + street number. Use the second.
  const dual = s.match(/^(\d+[a-z]?)\s+(\d+[a-z]?)\s+(.+)$/);
  if (dual) {
    return {
      number: dual[2],
      words: dual[3].split(" ").filter((w) => w && !ADDRESS_STOPWORDS.has(w)),
    };
  }

  const single = s.match(/^(\d+[a-z]?)\s+(.+)$/);
  if (!single) return { number: null, words: s.split(" ").filter(Boolean) };

  return {
    number: single[1],
    words: single[2].split(" ").filter((w) => w && !ADDRESS_STOPWORDS.has(w)),
  };
}

function scoreAddressMatch(typed: string, candidate: string): number {
  const a = tokenizeStreetAddress(typed);
  const b = tokenizeStreetAddress(candidate);
  if (!a.number || !b.number || a.number !== b.number) return 0;
  if (a.words.length === 0 || b.words.length === 0) return 0.5;
  const setA = new Set(a.words);
  const setB = new Set(b.words);
  let intersect = 0;
  for (const w of setA) if (setB.has(w)) intersect++;
  const union = setA.size + setB.size - intersect;
  return 0.5 + 0.5 * (union === 0 ? 0 : intersect / union);
}

// Metro-area siblings — Google Places usually labels Greater Toronto as
// "Toronto", Greater Victoria as "Victoria", etc., even when the listing's
// actual municipality is a separate city. Zoocasa keys URLs by municipality
// (e.g., 1227 Freshwater Crescent's URL is /langford-bc-real-estate/...,
// not /victoria-bc-real-estate/...). When the typed city's flat URL misses,
// we fan out to siblings.
//
// Keys are lowercased Google "locality" strings. Values are Zoocasa-format
// Title-Case city names (citySlug() lowercases them at URL build time).
const CITY_SIBLINGS: Record<string, string[]> = {
  victoria: [
    "Langford", "Saanich", "Esquimalt", "Oak Bay", "Sooke",
    "Colwood", "View Royal", "Central Saanich", "North Saanich",
    "Sidney", "Metchosin",
  ],
  vancouver: [
    "Burnaby", "Surrey", "Richmond", "Coquitlam", "Port Coquitlam",
    "Port Moody", "North Vancouver", "West Vancouver", "New Westminster",
    "Delta", "Langley", "White Rock", "Maple Ridge", "Pitt Meadows",
  ],
  toronto: [
    "Mississauga", "Brampton", "Vaughan", "Markham", "Richmond Hill",
    "Oakville", "Burlington", "Milton", "Pickering", "Ajax", "Whitby",
    "Oshawa", "Aurora", "Newmarket", "Etobicoke", "Scarborough",
    "North York", "East York",
  ],
  calgary: ["Airdrie", "Cochrane", "Okotoks", "Chestermere"],
  edmonton: [
    "St. Albert", "Sherwood Park", "Spruce Grove", "Stony Plain",
    "Beaumont", "Leduc", "Fort Saskatchewan",
  ],
  montreal: ["Laval", "Longueuil", "Brossard", "Saint-Lambert"],
  hamilton: ["Burlington", "Stoney Creek", "Ancaster", "Dundas"],
  ottawa: ["Gatineau", "Kanata", "Orleans", "Nepean"],
};

function siblingsFor(city: string): string[] {
  const key = city.trim().toLowerCase();
  return CITY_SIBLINGS[key] || [];
}

/**
 * True if `returnedCity` is a plausible match for `requestedCity` — either
 * the same city, or a known metro sibling in either direction (requested
 * city's spoke list contains returned, or returned city's spoke list
 * contains requested — CITY_SIBLINGS is keyed by hub only, so both
 * directions have to be checked).
 *
 * Used to defend against a live Zoocasa regression (observed 2026-08):
 * subdivision-scoped search/sold URLs (e.g. /edmonton-ab-real-estate,
 * /hamilton-on-real-estate) intermittently resolve their internal
 * "electedAddress" to the PROVINCE rather than the requested city, silently
 * widening results to a province-wide "-date" feed instead of the
 * requested city's listings. Confirmed externally (varying headers/
 * referer/cache-busting params/trailing slash all reproduce it identically)
 * — this is Zoocasa server-side behavior, not something a request-shape
 * change on our end can fix. See searchListings()/fetchSoldListings() below.
 */
function citiesMatch(returnedCity: string, requestedCity: string): boolean {
  const r = returnedCity.trim().toLowerCase();
  const q = requestedCity.trim().toLowerCase();
  if (!r || !q) return false;
  if (r === q) return true;
  if (siblingsFor(requestedCity).some((s) => s.toLowerCase() === r)) return true;
  if (siblingsFor(returnedCity).some((s) => s.toLowerCase() === q)) return true;
  return false;
}

/**
 * Try to fetch the detail page directly via flat-URL slug construction.
 * Returns null on 404 / missingAddress so callers can fan out to siblings.
 * Other errors propagate.
 */
async function tryFetchByCitySlug(
  street: string,
  city: string,
  province: string
): Promise<DetailResult | null> {
  const base = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate`;
  const slug = addressSlug(street);
  const inputUnit = street.match(/[\s,]+(?:#|unit\s*|suite\s*|apt\s*)(\d+[A-Z]?)\s*$/i)?.[1];

  let html: string;
  try {
    html = await fetchPage(`${base}/${slug}`);
  } catch (err) {
    if (!(err instanceof ZoocasaNotFoundError)) throw err;
    // Raw-slug retry — some markets use unabbreviated street types.
    const rawSlug = street
      .toLowerCase()
      .replace(/[#,\.]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (rawSlug === slug) return null;
    try {
      html = await fetchPage(`${base}/${rawSlug}`);
    } catch (err2) {
      if (err2 instanceof ZoocasaNotFoundError) return null;
      throw err2;
    }
  }

  const data = extractNextData(html);
  if (!data) return null;
  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  const activeListing = innerProps?.activeListing as Record<string, unknown> | undefined;
  const raw = (activeListing?.listing || {}) as ZoocasaDetailResult;
  // Empty raw = SSR served the area page rather than a listing detail.
  if (!raw.streetNumber && !raw.streetName && !raw.mlsNum) return null;

  raw.city = raw.city || city;
  raw.province = raw.province || province;
  return {
    listing: mapDetailListing(raw, city, province, inputUnit),
    history: parseHistory(raw),
    raw,
  };
}

/**
 * Find a listing on Zoocasa by typed street address and fetch its detail page.
 *
 * Strategy:
 *   1. Try flat URLs across [user-typed city, ...metro siblings] in parallel.
 *      First 200 wins. Handles the common Google-Places-says-Victoria-but-
 *      listing-is-in-Langford failure mode.
 *   2. If all flat URLs miss, fall back to search-and-match scoring against
 *      the typed city's inventory. Less reliable since Zoocasa's SSR widens
 *      to province-level, but catches cases where the typed city is right
 *      but the slug doesn't match (rare street-type abbreviations etc.).
 *
 * Throws ZoocasaNotFoundError if both phases miss — callers should surface
 * a "paste the Zoocasa URL instead" UX.
 */
export async function findAndFetchDetail(
  street: string,
  city: string,
  province: string
): Promise<DetailResult> {
  const candidates = [city, ...siblingsFor(city)];

  // Phase 1 — flat URL fan-out.
  const flatResults = await Promise.all(
    candidates.map((c) =>
      tryFetchByCitySlug(street, c, province).catch(() => null)
    )
  );
  const flatHit = flatResults.find((r) => r !== null);
  if (flatHit) return flatHit;

  // Phase 2 — search-and-match against the typed city's inventory. Province-
  // wide noise from Zoocasa's SSR makes this a low-confidence path, hence
  // the same 0.7 threshold as before.
  const searchCandidates = await searchListings(city, province).catch(() => []);
  let best: { listing: Listing; score: number } | null = null;
  for (const c of searchCandidates) {
    const s = scoreAddressMatch(street, c.address);
    if (s >= ADDRESS_MATCH_THRESHOLD && (!best || s > best.score)) {
      best = { listing: c, score: s };
    }
  }
  if (best && best.listing.url) {
    return fetchDetailByUrl(best.listing.url);
  }

  throw new ZoocasaNotFoundError(`${street}, ${city}, ${province}`);
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
// Public API: Sold listings (for comparables)
// ---------------------------------------------------------------------------

/** Raw sold listing from Zoocasa search-level __NEXT_DATA__ */
export interface ZoocasaSoldRaw {
  address: string;
  sold_price: number;
  price: number;
  sold_at: string;
  bedrooms: number;
  bathrooms: number;
  square_footage?: { gt?: number; gte?: number; lt?: number; lte?: number };
  property_type: string;
  position: string; // "POINT(lng lat)"
  postal_code: string;
  mls: string;
  neighbourhood?: string;
  unit?: string;
  maintenance?: number;
  sub_division?: string;
  province?: string;
  street_name?: string;
  street_number?: string;
  slug?: string;
  address_url_absolute_path?: string;
  listing_url_absolute_path?: string;
}

/**
 * Fetch recently sold listings for a city.
 * Returns raw search-level data (27 most recent).
 * URL: /{city}-{province}-real-estate/sold
 */
export async function fetchSoldListings(
  city: string,
  province: string
): Promise<ZoocasaSoldRaw[]> {
  const url = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate/sold`;

  const html = await fetchPage(url);
  const data = extractNextData(html);
  if (!data) return [];

  const props = data.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const innerProps = pageProps?.props as Record<string, unknown> | undefined;
  const listings = (innerProps?.listings || []) as ZoocasaSoldRaw[];

  // Only return listings with sold data
  const sold = listings.filter((l) => l.sold_price > 0 && l.sold_at);

  // Same province-wide-fallback defense as searchListings() — see
  // citiesMatch() for why this is necessary (Zoocasa's /sold pages hit the
  // identical electedAddress regression as the main search pages).
  const scoped = sold.filter((l) => citiesMatch(l.sub_division || "", city));
  if (scoped.length < sold.length) {
    const dropped = sold.length - scoped.length;
    const droppedPct = Math.round((dropped / sold.length) * 100);
    console.error(
      `[zoocasa-scope] fetchSoldListings("${city}", "${province}"): dropped ${dropped}/${sold.length} (${droppedPct}%) sold comps whose city didn't match the request — Zoocasa's subdivision scoping may be degraded (province-wide feed suspected).`
    );
  }

  return scoped;
}

/**
 * Fetch detail page for a sold listing to get enriched fields.
 * Returns yearBuilt, lotSize, taxes, description excerpt, or null on failure.
 */
export async function fetchSoldDetail(
  slug: string,
  city: string,
  province: string
): Promise<{
  yearBuilt: string | null;
  lotSize: string | null;
  taxes: number | null;
  description: string | null;
} | null> {
  try {
    const base = `https://www.zoocasa.com/${citySlug(city)}-${provSlug(province)}-real-estate`;
    const html = await fetchPage(`${base}/${slug}`, 10000);
    const data = extractNextData(html);
    if (!data) return null;

    const props = data.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    const innerProps = pageProps?.props as Record<string, unknown> | undefined;
    const activeListing = innerProps?.activeListing as Record<string, unknown> | undefined;
    const raw = (activeListing?.listing || {}) as ZoocasaDetailResult;

    let yearBuilt: string | null = null;
    if (raw.misc?.approxAge) {
      const age = raw.misc.approxAge;
      if (/^\d{4}$/.test(age)) {
        yearBuilt = age;
      } else {
        const rangeMatch = age.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
          const midAge = (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2;
          yearBuilt = String(Math.round(new Date().getFullYear() - midAge));
        } else if (/^\d+$/.test(age)) {
          yearBuilt = String(new Date().getFullYear() - parseInt(age));
        }
      }
    }

    const acreage = raw.misc?.acreage;
    const lotSize = acreage ? String(acreage) : null;
    const taxes = raw.taxes ? Math.round(raw.taxes) : null;
    const desc = raw.localeData?.en?.description || null;
    const description = desc ? desc.slice(0, 200) : null;

    return { yearBuilt, lotSize, taxes, description };
  } catch {
    return null;
  }
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
