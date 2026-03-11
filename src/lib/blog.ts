/**
 * Blog post definitions. Each post is a static entry with metadata and content.
 * Content is stored as the post's page component for full SSR and SEO.
 */

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  readingTime: string;
  tags: string[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-make-an-offer-on-a-house-in-canada",
    title: "How to Make an Offer on a House in Canada: A Practical Guide for Buyers",
    description:
      "Everything you need to know about making an offer on a Canadian home, from understanding assessed values to writing conditions and negotiating below asking price.",
    publishedAt: "2026-03-08",
    readingTime: "12 min read",
    tags: ["home buying", "offers", "Canada"],
  },
  {
    slug: "property-assessment-vs-market-value-canada",
    title: "Property Assessment vs. Market Value in Canada: What Buyers Should Know",
    description:
      "A clear explanation of how government property assessments work in BC, Alberta, and Ontario, why assessed values differ from listing prices, and how buyers can use the gap to their advantage.",
    publishedAt: "2026-03-08",
    readingTime: "10 min read",
    tags: ["assessments", "market value", "BC", "Alberta", "Ontario"],
  },
  {
    slug: "how-to-tell-if-a-house-is-overpriced-canada",
    title: "How to Tell If a House Is Overpriced in Canada",
    description:
      "Five concrete signals that a Canadian property may be listed above its realistic selling price, and how to use public data to make a smarter offer.",
    publishedAt: "2026-03-08",
    readingTime: "9 min read",
    tags: ["pricing", "negotiation", "data analysis"],
  },
  {
    slug: "how-much-below-asking-price-to-offer-canada",
    title:
      "How Much Below Asking Price Should You Offer on a House in Canada?",
    description:
      "A data-driven framework for determining your offer price on a Canadian home. Learn how assessments, days on market, seller signals, and 2026 market conditions tell you how much room you have to negotiate.",
    publishedAt: "2026-03-11",
    readingTime: "11 min read",
    tags: ["negotiation", "offers", "buyer's market", "2026"],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
