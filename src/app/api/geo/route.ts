/**
 * GET /api/geo
 *
 * Free, keyless visitor geolocation using Vercel's edge-injected geo
 * headers (populated by the platform at the edge — no external API call,
 * no billing, no signup). Locally (or on any host that doesn't set these
 * headers) everything comes back null and the client falls back to the
 * curated default explorer.
 *
 * Header reference (Vercel):
 *   x-vercel-ip-country         ISO 3166-1 alpha-2 country code, e.g. "US" | "CA"
 *   x-vercel-ip-country-region  ISO 3166-2 region code (no country prefix), e.g. "TX" | "BC"
 *   x-vercel-ip-city            URL-encoded city name, e.g. "Austin"
 */

import { NextRequest, NextResponse } from "next/server";

export interface GeoResponse {
  country: string | null;
  region: string | null;
  city: string | null;
}

export async function GET(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country");
  const region = req.headers.get("x-vercel-ip-country-region");
  const rawCity = req.headers.get("x-vercel-ip-city");

  let city: string | null = null;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }

  const body: GeoResponse = {
    country: country || null,
    region: region || null,
    city,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=86400" },
  });
}
