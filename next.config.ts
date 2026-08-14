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
      // PostHog reverse proxy — routes analytics traffic through the app
      // origin so it isn't blocked by ad blockers.
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // Required to support PostHog trailing-slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
