import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Property insurance, pre-filled from your address — Property Insights";
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
          backgroundColor: "#1a1a2e",
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
              backgroundColor: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5Z"
                stroke="#1a1a2e"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 21V12h6v9"
                stroke="#1a1a2e"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span style={{ fontSize: "24px", fontWeight: 600, color: "#ffffff" }}>Property Insights</span>
        </div>

        {/* Eyebrow */}
        <div
          style={{
            display: "flex",
            fontSize: "18px",
            fontWeight: 600,
            color: "#7fd8cc",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: "20px",
          }}
        >
          Insurance, reimagined for property
        </div>

        {/* Headline */}
        <div style={{ fontSize: "52px", fontWeight: 700, color: "#ffffff", lineHeight: 1.15, marginBottom: "24px" }}>
          Forget everything you know
          <br />
          about insurance forms.
        </div>

        {/* Subline */}
        <div style={{ display: "flex", fontSize: "24px", color: "rgba(255,255,255,0.7)" }}>
          Instant profile. Licensed brokers. Zero cold-calls.
        </div>
      </div>
    ),
    { ...size }
  );
}
