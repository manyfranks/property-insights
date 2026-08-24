import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16.3+ otherwise writes framework-generated AGENTS.md/CLAUDE.md files
  // into the repository whenever the dev server starts. Project instructions
  // are maintained by the team, not generated as a runtime side effect.
  agentRules: false,
  // Lets e2e/playwright.config.ts run its "stage-landing"/"stage-intake" dev
  // servers against their own .next output — Next's dev server takes an
  // flock-style lock at `<distDir>/dev/lock` (node_modules/next/dist/server/
  // lib/router-utils/setup-dev-bundler.js), scoped to distDir, not the repo
  // directory. Without this override every `next dev` invocation over this
  // project (this file's own `npm run dev`, on port 3117, included) fights
  // over the same `.next/dev/lock` and the second process exits immediately
  // ("Unable to acquire lock... is another instance of next dev running?").
  // Unset (the default everywhere else — Vercel build/deploy, `npm run dev`,
  // `npm run build`) this is a no-op: falls back to the normal ".next".
  distDir: process.env.NEXT_DIST_DIR || ".next",
  trailingSlash: false,
  async headers() {
    return [
      {
        // Next's per-route opengraph-image handlers return image/png, but
        // Google discovers them from each page's og:image meta, crawls them,
        // and then files them under "Crawled - currently not indexed" —
        // correctly, since they are images, not pages.
        //
        // Harmless in itself, but it buries real signal. The 2026-08-23
        // coverage validation export was 42 URLs of which 37 (88%) were these,
        // leaving exactly 4 genuine content pages hidden underneath. The
        // notification read as a site-wide quality problem; it was not one.
        //
        // noindex rather than a robots.txt Disallow deliberately: social
        // crawlers (Facebook, LinkedIn) honour robots.txt, so disallowing
        // would break link previews. noindex still permits the fetch that
        // previews need, while keeping these out of the page index.
        source: "/:path*/opengraph-image",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      {
        source: "/insurance/case/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
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
