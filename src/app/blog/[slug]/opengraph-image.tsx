import { ImageResponse } from "next/og";
import { getBlogPost } from "@/lib/blog";

export const runtime = "nodejs";
export const alt = "Blog post — Property Insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function BlogOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  const title = post?.title || "Property Insights Blog";
  const readingTime = post?.readingTime || "";

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
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "48px" }}>
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
          <span style={{ fontSize: "18px", color: "#9ca3af", marginLeft: "8px" }}>Blog</span>
        </div>

        {/* Title */}
        <div style={{ fontSize: "44px", fontWeight: 700, color: "#171717", lineHeight: 1.25, marginBottom: "24px", maxWidth: "900px" }}>
          {title}
        </div>

        {/* Reading time */}
        {readingTime && (
          <div style={{ fontSize: "20px", color: "#6b7280" }}>
            {readingTime}
          </div>
        )}

        {/* URL */}
        <div style={{ fontSize: "18px", color: "#9ca3af", position: "absolute", bottom: "40px", left: "80px" }}>
          propertyinsights.xyz/blog
        </div>
      </div>
    ),
    { ...size }
  );
}
