import { ImageResponse } from "next/og";
import { getAllListings } from "@/lib/kv/listings";
import { buildCityMetadata, getCityBySlug } from "@/lib/data/city-metadata";
import { analyzeListing } from "@/lib/analyze";

export const runtime = "nodejs";
export const alt = "City real estate overview — Property Insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fmt(n: number): string {
  return "$" + n.toLocaleString();
}

/** Minimal title-only render that can't itself throw — used both for the
 * "not found" case and as a last-resort fallback if anything upstream
 * (KV fetch, stats computation) throws unexpectedly, so this route never 500s. */
function fallbackImage(message: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafafa",
          fontSize: "32px",
          color: "#6b7280",
        }}
      >
        {message}
      </div>
    ),
    { ...size }
  );
}

export default async function CityOgImage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: slug } = await params;

  let meta;
  let listings;
  try {
    listings = await getAllListings();
    const { cities } = buildCityMetadata(listings);
    meta = getCityBySlug(slug, cities);
  } catch {
    return fallbackImage("Property Insights");
  }

  if (!meta) {
    return fallbackImage("City not found");
  }

  let stats: { label: string; value: string }[];
  try {
    // Compute stats — mirrors page.tsx logic
    const cityListings = listings.filter((l) => l.city === meta.name);
    const analyses = cityListings.map((l) => analyzeListing(l));

    const withSavings = analyses.filter((a) => a.offer && (a.offer.savings ?? 0) > 0);
    const avgSavings =
      withSavings.length > 0
        ? Math.round(
            withSavings.reduce((sum, a) => sum + (a.offer?.savings ?? 0), 0) / withSavings.length
          )
        : 0;
    const avgDom =
      analyses.length > 0
        ? Math.round(analyses.reduce((sum, a) => sum + a.listing.dom, 0) / analyses.length)
        : 0;

    stats = [
      { label: "Listings", value: String(analyses.length) },
      { label: "Avg Savings", value: fmt(avgSavings) },
      { label: "Avg DOM", value: String(avgDom) },
    ];
  } catch {
    stats = [];
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 80px",
          backgroundColor: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "56px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              backgroundColor: "#171717",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5Z"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 21V12h6v9"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#171717" }}>
            Property Insights
          </span>
        </div>

        {/* City name */}
        <div
          style={{
            display: "flex",
            fontSize: "52px",
            fontWeight: 700,
            color: "#171717",
            lineHeight: 1.15,
            marginBottom: "8px",
          }}
        >
          {meta.name} Real Estate
        </div>
        <div style={{ fontSize: "24px", color: "#6b7280", marginBottom: "56px" }}>
          {meta.province}
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: "60px", alignItems: "baseline" }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>
                {s.label}
              </span>
              <span style={{ fontSize: "36px", fontWeight: 700, color: "#171717" }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* URL */}
        <div
          style={{
            fontSize: "18px",
            color: "#9ca3af",
            position: "absolute",
            bottom: "40px",
            left: "80px",
          }}
        >
          propertyinsights.xyz
        </div>
      </div>
    ),
    { ...size }
  );
}
