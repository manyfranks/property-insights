import Link from "next/link";
import { analyzeListing } from "@/lib/analyze";
import { scoreV2 } from "@/lib/scoring";
import { slugify, fmt } from "@/lib/utils";
import type { Listing } from "@/lib/types";
import TierBadge from "@/components/tier-badge";

// ---------------------------------------------------------------------------
// Day-of-year rotation, deterministic (no per-render randomness): the
// featured listing changes once per calendar day (UTC) and naturally
// rotates in newly-cached listings as the candidate pool changes over time,
// without any client-side state, cookies, or Math.random() re-render churn.
// ---------------------------------------------------------------------------
function dayOfYearUTC(d: Date = new Date()): number {
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - startOfYear) / 86_400_000);
}

const TIER_RANK: Record<string, number> = { HOT: 2, WARM: 1, WATCH: 0 };

export interface VisitorGeo {
  country: string | null;
  region: string | null;
  city: string | null;
}

function rotateByDay<T>(candidates: T[]): T {
  const index = dayOfYearUTC() % candidates.length;
  return candidates[index];
}

/**
 * Picks the day-rotating "live example" listing from the cached pool.
 *
 * Geo-targeting: page.tsx reads Vercel's `x-vercel-ip-*` edge headers via
 * `headers()` (same headers src/app/api/geo/route.ts uses) and passes them
 * in as `geo`. That `headers()` call is itself what opts "/" out of static
 * generation/ISR (see the comment in src/app/page.tsx) — it is a deliberate
 * choice, not a side effect of something else already forcing this route
 * dynamic. `geo` being nullable is purely because it's genuinely absent
 * locally / off Vercel, not because the geo branch was judged not worth the
 * rendering-mode cost.
 *
 * Selection order: (a) a listing in the visitor's own region/city, when geo
 * resolved to something and a match exists; else (b) the highest-scoring /
 * HOT-tier-first pool. Either pool then rotates deterministically by
 * day-of-year modulo pool size, so the featured listing changes once a day
 * (UTC) and naturally rotates in newly-cached listings over time.
 */
function pickFeaturedListing(listings: Listing[], geo?: VisitorGeo | null): Listing | null {
  const valid = listings.filter((l) => l.address && l.city && l.province && l.price > 0);
  if (valid.length === 0) return null;

  if (geo?.region) {
    const regionMatches = valid.filter((l) => l.province.toUpperCase() === geo.region!.toUpperCase());
    const cityMatches = geo.city
      ? regionMatches.filter((l) => l.city.toLowerCase() === geo.city!.toLowerCase())
      : [];
    const geoPool = cityMatches.length > 0 ? cityMatches : regionMatches;
    if (geoPool.length > 0) return rotateByDay(geoPool);
  }

  const tierPool = valid
    .map((l) => ({
      listing: l,
      tier: l.preTier ?? scoreV2(l).tier,
      score: l.preScore ?? scoreV2(l).total,
    }))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.score - a.score)
    .slice(0, 10)
    .map((c) => c.listing);

  if (tierPool.length === 0) return null;
  return rotateByDay(tierPool);
}

export default function ExampleAnalysisCard({
  listings,
  geo,
}: {
  listings: Listing[];
  geo?: VisitorGeo | null;
}) {
  const listing = pickFeaturedListing(listings, geo);
  if (!listing) return null;

  const analysis = analyzeListing(listing);
  const tier = listing.preTier ?? analysis.score.tier;

  // Row 3 figure, in order of how directly it answers "what should I
  // offer": recommended offer > assessed value > list price.
  let figure: number;
  let figureLabel: string;
  if (analysis.offer?.finalOffer) {
    figure = analysis.offer.finalOffer;
    figureLabel = "Recommended offer";
  } else if (analysis.assessment?.totalValue) {
    figure = analysis.assessment.totalValue;
    figureLabel = "Assessed value";
  } else {
    figure = listing.price;
    figureLabel = "List price";
  }

  const chips: string[] = [];
  if (analysis.offer?.finalOffer && listing.price > 0 && analysis.offer.finalOffer < listing.price) {
    const belowPct = Math.round((1 - analysis.offer.finalOffer / listing.price) * 100);
    if (belowPct > 0) chips.push(`${belowPct}% below asking`);
  }
  if (listing.dom > 0) chips.push(`${listing.dom} days on market`);
  if (listing.city && listing.province) chips.push(`${listing.city}, ${listing.province}`);

  const slug = slugify(listing.address);

  return (
    <Link
      href={`/property/${slug}`}
      className="mt-6 mx-auto max-w-sm block border border-border rounded-xl bg-white p-4 text-left transition-colors hover:border-foreground/20 hover:shadow-sm"
    >
      <div className="mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted">Live example</span>
      </div>

      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-semibold text-foreground truncate min-w-0">{listing.address}</span>
        <span className="shrink-0">
          <TierBadge tier={tier} />
        </span>
      </div>

      <div className="font-mono text-2xl font-semibold text-foreground">{fmt(figure)}</div>
      <div className="text-xs text-muted mb-2">{figureLabel}</div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="text-[11px] border border-border rounded-full px-2 py-0.5 text-muted"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
