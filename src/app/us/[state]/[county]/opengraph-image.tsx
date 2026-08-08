import { ImageResponse } from "next/og";
import { getCountyBySlug } from "@/lib/us-counties";
import { getCountyMarketPanel } from "@/lib/db/regional-econ";

export const runtime = "nodejs";
export const alt = "County housing market data — Property Insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

export default async function CountyOgImage({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}) {
  const { state: stateSlug, county: countySlug } = await params;
  const county = getCountyBySlug(stateSlug, countySlug);

  if (!county) {
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
          County not found
        </div>
      ),
      { ...size }
    );
  }

  const panel = await getCountyMarketPanel(county.fips).catch(() => null);

  const stats: { label: string; value: string }[] = [];
  if (panel?.medianHomeValue != null) {
    stats.push({ label: "Median Home Value", value: fmt(panel.medianHomeValue) });
  }
  if (panel?.medianGrossRent != null) {
    stats.push({ label: "Median Rent", value: fmt(panel.medianGrossRent) + "/mo" });
  }
  if (panel?.femaRiskScore != null) {
    stats.push({ label: "FEMA Risk Score", value: `${panel.femaRiskScore.toFixed(0)}/100` });
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

        {/* County name */}
        <div
          style={{
            fontSize: "48px",
            fontWeight: 700,
            color: "#171717",
            lineHeight: 1.15,
            marginBottom: "8px",
          }}
        >
          {county.county}, {county.state}
        </div>
        <div style={{ fontSize: "22px", color: "#6b7280", marginBottom: "56px" }}>
          Housing Market Data
        </div>

        {/* Stats row */}
        {stats.length > 0 ? (
          <div style={{ display: "flex", gap: "60px", alignItems: "baseline" }}>
            {stats.map((s) => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>
                  {s.label}
                </span>
                <span style={{ fontSize: "34px", fontWeight: 700, color: "#171717" }}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: "20px", color: "#9ca3af" }}>
            Home values, rents, and risk data
          </div>
        )}

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
