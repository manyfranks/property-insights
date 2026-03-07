/**
 * POST /api/pipeline/run
 *
 * Trigger a city pipeline run on demand.
 * Returns top N motivated-seller picks for the requested city.
 *
 * REQUEST BODY:
 * {
 *   city:     string          — e.g. "Victoria", "Langford", "Saanich"
 *   province: string          — e.g. "BC", "AB", "ON"
 *   profile?: string          — "SFH_BUYER" | "INVESTOR_DEV" | "ALL"  (default: SFH_BUYER)
 *   limit?:   number          — picks to return per run (default: 5, max: 10)
 *   dryRun?:  boolean         — if true, don't update seen store (default: false)
 * }
 *
 * RESPONSE (200):
 * {
 *   city, province, profile, runAt,
 *   picks: [{ listing, score, summary }],
 *   stats: { fetched, afterExclusion, afterDedup, scored, returned, ... },
 *   dedupPersisted: boolean,
 *   warnings: string[]
 * }
 *
 * ERRORS:
 *   400 — missing/invalid params
 *   404 — city not in CITY_BOUNDS
 *   502 — realtor.ca fetch failed
 *   500 — unexpected error
 */

import { NextRequest, NextResponse } from "next/server";
import { runCityPipeline } from "@/lib/pipeline/city-run";
import { PROFILES, ProfileName } from "@/lib/pipeline/exclusions";
import { CITY_BOUNDS } from "@/lib/data/city-bounds";

export const maxDuration = 30;

// Valid profile names
const VALID_PROFILES = new Set<string>(Object.keys(PROFILES));

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { city, province, profile, limit, dryRun } = body;

  // --- Validate required params ---
  if (!city || typeof city !== "string") {
    return NextResponse.json(
      { error: "city is required (string)" },
      { status: 400 }
    );
  }

  if (!province || typeof province !== "string") {
    return NextResponse.json(
      { error: "province is required (string)" },
      { status: 400 }
    );
  }

  // --- Validate city is known ---
  if (!CITY_BOUNDS[city]) {
    return NextResponse.json(
      {
        error: `Unknown city: "${city}"`,
        availableCities: Object.keys(CITY_BOUNDS),
      },
      { status: 404 }
    );
  }

  // --- Validate optional params ---
  const profileName: ProfileName = (
    typeof profile === "string" && VALID_PROFILES.has(profile)
      ? profile
      : "SFH_BUYER"
  ) as ProfileName;

  const limitNum = typeof limit === "number"
    ? Math.min(Math.max(1, Math.floor(limit)), 10)
    : 5;

  const isDryRun = dryRun === true;

  // --- Run pipeline ---
  try {
    const result = await runCityPipeline(city, province, {
      profile: profileName,
      limit: limitNum,
      dryRun: isDryRun,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("Unknown city")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message.includes("Fetch failed") || message.includes("realtor.ca")) {
      return NextResponse.json(
        { error: message, hint: "realtor.ca may be rate-limiting — retry in 30s or check SCRAPER_API_KEY" },
        { status: 502 }
      );
    }

    console.error("[pipeline/run] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error", detail: message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/pipeline/run
 * Health check + list available cities and profiles.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    availableCities: Object.keys(CITY_BOUNDS),
    availableProfiles: Object.entries(PROFILES).map(([name, p]) => ({
      name,
      label: p.label,
      description: p.description,
      priceRange: p.priceMin !== null || p.priceMax !== null
        ? `$${(p.priceMin ?? 0).toLocaleString()} – $${(p.priceMax ?? 0).toLocaleString()}`
        : "No price filter",
    })),
    usage: {
      method: "POST",
      body: {
        city: "Victoria",
        province: "BC",
        profile: "SFH_BUYER | INVESTOR_DEV | ALL",
        limit: "1–10 (default 5)",
        dryRun: "boolean (default false)",
      },
    },
  });
}
