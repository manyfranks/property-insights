/**
 * kv/listings.ts
 *
 * Read/write listings from Vercel KV (Upstash Redis REST API).
 *
 * KEY SCHEMA:
 *   listings:all         → JSON array of all Listing objects
 *   listings:by-slug:{s} → JSON of single Listing (for fast property page lookups)
 *   listings:meta        → { count, updatedAt, cities }
 *
 * Falls back to static PRELOADED_LISTINGS when KV is unavailable (local dev).
 */

import { Listing } from "../types";
import { slugify } from "../utils";

// ---------------------------------------------------------------------------
// KV helpers (same pattern as dedup.ts)
// ---------------------------------------------------------------------------

function kvUrl(): string | null {
  return process.env.KV_REST_API_URL || null;
}

function kvToken(): string | null {
  return process.env.KV_REST_API_TOKEN || null;
}

function kvAvailable(): boolean {
  return !!(kvUrl() && kvToken());
}

function kvHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${kvToken()}`,
    "Content-Type": "application/json",
  };
}

async function kvGet(key: string): Promise<unknown> {
  const url = kvUrl();
  if (!url) return null;

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: kvHeaders(),
    next: { revalidate: 300 }, // Cache for 5 min in Next.js
  });

  if (!res.ok) return null;
  const body = await res.json();
  return body.result;
}

async function kvSet(key: string, value: unknown, exSeconds?: number): Promise<boolean> {
  const url = kvUrl();
  if (!url) return false;

  const args = ["set", key, JSON.stringify(value)];
  if (exSeconds) args.push("EX", String(exSeconds));

  const path = args.map((a) => encodeURIComponent(a)).join("/");
  const res = await fetch(`${url}/${path}`, {
    method: "GET",
    headers: kvHeaders(),
  });

  return res.ok;
}

async function kvDel(key: string): Promise<boolean> {
  const url = kvUrl();
  if (!url) return false;

  const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: kvHeaders(),
  });

  return res.ok;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all listings from KV. Falls back to static data.
 */
export async function getAllListings(): Promise<Listing[]> {
  if (!kvAvailable()) {
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    return PRELOADED_LISTINGS;
  }

  try {
    const raw = await kvGet("listings:all");
    if (raw && typeof raw === "string") {
      return JSON.parse(raw) as Listing[];
    }
    if (Array.isArray(raw)) {
      return raw as Listing[];
    }
  } catch {
    // KV parse error — fall back
  }

  // Fallback to static
  const { PRELOADED_LISTINGS } = await import("../data/listings");
  return PRELOADED_LISTINGS;
}

/**
 * Get a single listing by slug.
 */
export async function getListingBySlug(slug: string): Promise<Listing | null> {
  if (!kvAvailable()) {
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    return PRELOADED_LISTINGS.find((l) => slugify(l.address) === slug) ?? null;
  }

  try {
    const raw = await kvGet(`listings:by-slug:${slug}`);
    if (raw && typeof raw === "string") {
      return JSON.parse(raw) as Listing;
    }
    if (raw && typeof raw === "object") {
      return raw as Listing;
    }
  } catch {
    // Fall through
  }

  // Fallback: search in full list
  const all = await getAllListings();
  return all.find((l) => slugify(l.address) === slug) ?? null;
}

/**
 * Get listings filtered by city.
 */
export async function getListingsByCity(city: string): Promise<Listing[]> {
  const all = await getAllListings();
  return all.filter((l) => l.city === city);
}

/**
 * Write all listings to KV. Also creates per-slug index entries.
 */
export async function writeAllListings(listings: Listing[]): Promise<{ written: number; slugs: number }> {
  if (!kvAvailable()) {
    throw new Error("KV not configured — cannot write listings");
  }

  // Write the full array
  await kvSet("listings:all", listings);

  // Write individual slug lookups
  let slugs = 0;
  for (const l of listings) {
    const slug = slugify(l.address);
    await kvSet(`listings:by-slug:${slug}`, l);
    slugs++;
  }

  // Write metadata
  const cities = [...new Set(listings.map((l) => l.city))];
  await kvSet("listings:meta", {
    count: listings.length,
    cities,
    updatedAt: new Date().toISOString(),
  });

  return { written: listings.length, slugs };
}

/**
 * Add or update a single listing in KV.
 * Reads the full list, upserts by address, writes back.
 */
export async function upsertListing(listing: Listing): Promise<void> {
  const all = await getAllListings();
  const idx = all.findIndex((l) => l.address === listing.address);
  if (idx >= 0) {
    all[idx] = listing;
  } else {
    all.push(listing);
  }
  await writeAllListings(all);
}

/**
 * Remove listings by address. Returns count removed.
 */
export async function removeListings(addresses: string[]): Promise<number> {
  const addrSet = new Set(addresses.map((a) => a.toLowerCase()));
  const all = await getAllListings();
  const filtered = all.filter((l) => !addrSet.has(l.address.toLowerCase()));
  const removed = all.length - filtered.length;

  if (removed > 0) {
    await writeAllListings(filtered);

    // Clean up slug entries for removed listings
    for (const l of all) {
      if (addrSet.has(l.address.toLowerCase())) {
        await kvDel(`listings:by-slug:${slugify(l.address)}`);
      }
    }
  }

  return removed;
}

/**
 * Get metadata about stored listings.
 */
export async function getListingsMeta(): Promise<{
  count: number;
  cities: string[];
  updatedAt: string;
  source: "kv" | "static";
} | null> {
  if (!kvAvailable()) {
    const { PRELOADED_LISTINGS } = await import("../data/listings");
    return {
      count: PRELOADED_LISTINGS.length,
      cities: [...new Set(PRELOADED_LISTINGS.map((l) => l.city))],
      updatedAt: "static",
      source: "static",
    };
  }

  try {
    const raw = await kvGet("listings:meta");
    if (raw && typeof raw === "string") {
      return { ...JSON.parse(raw), source: "kv" };
    }
    if (raw && typeof raw === "object") {
      return { ...(raw as any), source: "kv" };
    }
  } catch {
    // Fall through
  }

  return null;
}
