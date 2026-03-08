import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Block AI crawlers / scrapers
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
          "Applebot-Extended",
          "FacebookBot",
          "cohere-ai",
          "PerplexityBot",
          "Amazonbot",
        ],
        disallow: ["/"],
      },
      // Default: allow everything except internal routes
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/assess"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
