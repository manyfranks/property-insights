/**
 * GET /api/insurance/address-lookup?q=<partial address>
 *
 * Typeahead for the /insurance landing page: matches the visitor's partial
 * address against the listings we already track so a known property can be
 * picked from a dropdown and enter the coverage-profile wizard with full
 * prefill (listingId = slug), instead of relying on an exact slugified
 * address match.
 *
 * Flag-gated like every insurance surface (404 while off). Reads the full
 * listing set from KV once and keeps a slim in-memory index for 5 minutes —
 * typeahead fires per keystroke and the underlying data changes at most
 * daily (pipeline refresh cron).
 */

import { NextResponse } from "next/server";
import { getAllListings } from "@/lib/kv/listings";
import { slugify } from "@/lib/utils";

interface AddressHit {
  address: string;
  city: string;
  /** province/state code, e.g. "BC" | "TX" */
  region: string;
  country: "US" | "CA";
  slug: string;
}

const CA_PROVINCES = new Set(["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"]);

const INDEX_TTL_MS = 5 * 60 * 1000;
const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 6;

let indexCache: { hits: AddressHit[]; ts: number } | null = null;

async function getIndex(): Promise<AddressHit[]> {
  if (indexCache && Date.now() - indexCache.ts < INDEX_TTL_MS) {
    return indexCache.hits;
  }
  const listings = await getAllListings();
  const hits: AddressHit[] = listings.map((l) => {
    const region = l.province.toUpperCase();
    return {
      address: l.address,
      city: l.city,
      region,
      country: CA_PROVINCES.has(region) ? "CA" : "US",
      slug: slugify(l.address),
    };
  });
  indexCache = { hits, ts: Date.now() };
  return hits;
}

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_INSURANCE_INTAKE !== "1") {
    return NextResponse.json(
      { error: "Insurance intake is not enabled (NEXT_PUBLIC_INSURANCE_INTAKE)" },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [] });
  }

  let index: AddressHit[];
  try {
    index = await getIndex();
  } catch (err) {
    // Fail loud: typeahead degrading to "no suggestions" silently would
    // mask a KV outage — return the error so the client can log it.
    const message = err instanceof Error ? err.message : "listing index unavailable";
    return NextResponse.json({ error: `address lookup unavailable: ${message}` }, { status: 502 });
  }

  // Prefix matches rank above substring matches; both case-insensitive.
  const prefix: AddressHit[] = [];
  const substr: AddressHit[] = [];
  for (const hit of index) {
    const addr = hit.address.toLowerCase();
    if (addr.startsWith(q)) prefix.push(hit);
    else if (addr.includes(q)) substr.push(hit);
    if (prefix.length >= MAX_RESULTS) break;
  }

  return NextResponse.json({ results: [...prefix, ...substr].slice(0, MAX_RESULTS) });
}
