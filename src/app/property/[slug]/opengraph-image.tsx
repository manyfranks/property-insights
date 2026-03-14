import { ImageResponse } from "next/og";
import { getListingBySlug } from "@/lib/kv/listings";
import { analyzeListing } from "@/lib/analyze";

export const runtime = "nodejs";
export const alt = "Property analysis — Property Insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  HOT: { bg: "#fee2e2", text: "#b91c1c" },
  WARM: { bg: "#fef3c7", text: "#b45309" },
  WATCH: { bg: "#eff6ff", text: "#2563eb" },
};

const TIER_LABELS: Record<string, string> = {
  HOT: "Hot",
  WARM: "Warm",
  WATCH: "Cool",
};

function fmt(n: number): string {
  return "$" + n.toLocaleString();
}

export default async function PropertyOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);

  if (!listing) {
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
          Property not found
        </div>
      ),
      { ...size }
    );
  }

  const analysis = analyzeListing(listing);
  const tier = analysis.score.tier;
  const tierColor = TIER_COLORS[tier] || TIER_COLORS.WATCH;
  const tierLabel = TIER_LABELS[tier] || "Cool";
  const offer = analysis.offer;

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
        {/* Header: brand + tier */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "48px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                <path d="M9 21V12h6v9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span style={{ fontSize: "20px", fontWeight: 600, color: "#171717" }}>
              Property Insights
            </span>
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 700,
              padding: "8px 20px",
              borderRadius: "9999px",
              backgroundColor: tierColor.bg,
              color: tierColor.text,
            }}
          >
            {tierLabel}
          </div>
        </div>

        {/* Address */}
        <div style={{ fontSize: "42px", fontWeight: 700, color: "#171717", lineHeight: 1.2, marginBottom: "8px" }}>
          {listing.address}
        </div>
        <div style={{ fontSize: "24px", color: "#6b7280", marginBottom: "48px" }}>
          {listing.city}, {listing.province}
        </div>

        {/* Pricing */}
        <div style={{ display: "flex", gap: "60px", alignItems: "baseline" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>Listed</span>
            <span style={{ fontSize: "36px", fontWeight: 700, color: "#171717" }}>
              {fmt(listing.price)}
            </span>
          </div>
          {offer && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>Recommended offer</span>
              <span style={{ fontSize: "36px", fontWeight: 700, color: "#171717" }}>
                {fmt(offer.finalOffer)}
              </span>
            </div>
          )}
          {offer && offer.savings > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>Save</span>
              <span style={{ fontSize: "36px", fontWeight: 700, color: "#16a34a" }}>
                {fmt(offer.savings)}
              </span>
            </div>
          )}
        </div>

        {/* URL */}
        <div style={{ fontSize: "18px", color: "#9ca3af", position: "absolute", bottom: "40px", left: "80px" }}>
          propertyinsights.xyz
        </div>
      </div>
    ),
    { ...size }
  );
}
