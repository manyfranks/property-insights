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
  // Added 2026-08 — live coverage probe confirmed real Winnipeg inventory
  // (19 valid house listings on a clean run; Zoocasa returns province="MB"
  // correctly). Price band set from that probe's observed range (~$250K-
  // $670K for 3-bed houses). Note: Winnipeg searches intermittently hit the
  // documented province-wide-fallback regression (see zoocasa.ts's
  // citiesMatch doc comment) and return 0 candidates on some requests — the
  // two-search-variant dedup above plus daily reruns already tolerate this
  // for other cities, so no special-casing needed here.
  { city: "Winnipeg", province: "MB", minPrice: 300000, maxPrice: 650000, target: 25 },
];
