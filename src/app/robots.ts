import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Block AI training crawlers — these ingest content into model
      // weights with no attribution, citation, or referral traffic.
      // Each crawl triggers expensive SSR (KV reads, analysis computation).
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-Web",
          "anthropic-ai",
          "CCBot",
          "Google-Extended",
          "Bytespider",
          "cohere-ai",
          "Amazonbot",
        ],
        disallow: ["/"],
      },
      // Allow AI search/citation crawlers — these cite sources with
      // direct links, functioning as search engines. Worth the crawl cost.
      // PerplexityBot: links back to source in answers.
      // Applebot: powers Siri/Spotlight/Apple Intelligence citations.
      // FacebookBot: enables link previews in Messenger/WhatsApp.
      {
        userAgent: ["PerplexityBot", "Applebot-Extended", "FacebookBot"],
        allow: "/",
        disallow: ["/api/", "/assess"],
      },
      // Default: allow everything except internal routes.
      // Googlebot and Bingbot fall here — they drive both organic search
      // AND AI answer citations (Google AI Overviews, Microsoft Copilot).
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/assess"],
      },
    ],
    // Points at /sitemap-main.xml, not /sitemap.xml — GSC fetches
    // sitemap-main.xml successfully; /sitemap.xml is pinned in a
    // fetch-failure state on Google's side from an earlier pipeline
    // incident (see 71caf49 "Publish sitemap at fresh URL"). The
    // sitemap.xml route itself keeps being served (no callers removed),
    // this only changes which URL robots.txt advertises to crawlers.
    sitemap: `${BASE_URL}/sitemap-main.xml`,
  };
}
