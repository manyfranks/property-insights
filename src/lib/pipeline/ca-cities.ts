/**
 * pipeline/ca-cities.ts
 *
 * THE single definition of which Canadian cities the daily refresh cron
 * ingests, and the price band it searches each one with.
 *
 * WHY THIS IS ITS OWN MODULE: this config used to live inside
 * api/pipeline/refresh/route.ts, unexported. When the canary was taught to
 * probe the cron's REAL query shape (its old bare `{ type: "house" }` probe
 * stayed green through a total ingestion outage), it had no way to import
 * these bands and had to duplicate all eleven of them. That is a silent
 * drift trap of the worst kind: change a band in the cron, and the canary
 * keeps probing the old query while still reporting on the new one — a
 * monitor that has quietly stopped watching the thing it names. Both now
 * import from here, so the cron and its watchdog cannot disagree.
 *
 * Anything that probes, ingests or monitors CA city inventory belongs on
 * this list rather than on a copy of it.
 */

export interface CityConfig {
  city: string;
  province: string;
  minPrice: number;
  maxPrice: number;
  target: number;
}

export const CITIES: CityConfig[] = [
  { city: "Victoria", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Saanich", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Langford", province: "BC", minPrice: 900000, maxPrice: 1300000, target: 25 },
  { city: "Vancouver", province: "BC", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Surrey", province: "BC", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Calgary", province: "AB", minPrice: 500000, maxPrice: 900000, target: 25 },
  { city: "Edmonton", province: "AB", minPrice: 500000, maxPrice: 900000, target: 25 },
  { city: "Toronto", province: "ON", minPrice: 1000000, maxPrice: 1800000, target: 25 },
  { city: "Hamilton", province: "ON", minPrice: 600000, maxPrice: 1000000, target: 25 },
  { city: "Ottawa", province: "ON", minPrice: 600000, maxPrice: 1000000, target: 25 },
  // Winnipeg REMOVED 2026-08-26. It was added on a search-based probe that
  // read the (now-known) province-wide-fallback feed. On the neighbourhood
  // discovery path — the real, ungated listing surface — Zoocasa serves
  // ZERO Latest-Listings links for Winnipeg: the city page claims "100,000+
  // listings" but its internalLinks Latest-Listings block is empty, and so
  // is every Winnipeg neighbourhood page checked. There is no MB listing
  // data to ingest from this source, so carrying Winnipeg here only produced
  // a guaranteed per-run failure. Re-add if Zoocasa's MB coverage returns
  // (the canary's discovery check will surface that).
];
