import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  async rewrites() {
    return [
      {
        // /sitemap.xml is now a STATIC file written by scripts/generate-sitemap.ts
        // at build time (prebuild) — GSC's fetcher repeatedly failed against the
        // dynamic /api/sitemap function. Keep the API route only as a manual
        // debugging endpoint; this rewrite maps it to a distinct path.
        source: "/sitemap-live.xml",
        destination: "/api/sitemap",
      },
    ];
  },
};

export default nextConfig;
