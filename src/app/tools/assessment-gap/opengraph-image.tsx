import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Assessment Gap Calculator — Property Insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
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
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "48px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              backgroundColor: "#171717",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
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
          <span style={{ fontSize: "24px", fontWeight: 600, color: "#171717" }}>
            Property Insights
          </span>
        </div>

        {/* Headline */}
        <div style={{ fontSize: "48px", fontWeight: 700, color: "#171717", lineHeight: 1.2, marginBottom: "24px" }}>
          Assessment Gap Calculator
        </div>

        {/* Subline */}
        <div style={{ display: "flex", flexDirection: "column", fontSize: "22px", color: "#6b7280", lineHeight: 1.5 }}>
          <span>See how far asking price sits above or below the</span>
          <span>government-assessed value — free, no sign-up.</span>
        </div>

        {/* URL */}
        <div style={{ fontSize: "18px", color: "#9ca3af", position: "absolute", bottom: "40px", left: "80px" }}>
          propertyinsights.xyz/tools/assessment-gap
        </div>
      </div>
    ),
    { ...size }
  );
}
