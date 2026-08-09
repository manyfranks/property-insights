/**
 * Blog post definitions. Each post is a static entry with metadata and content.
 * Content is stored as the post's page component for full SSR and SEO.
 */

import type { Vertical } from "@/config/affiliate-vendors";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  readingTime: string;
  tags: string[];
  /**
   * When set, the post template (src/app/blog/[slug]/page.tsx) renders a
   * topic-matched PartnerCta block after the article body, sourced from the
   * vendor registry for this vertical. Absent on existing posts until the
   * registry merge sets it per-post (docs/plans/11-CTA-OPTIMIZATION-
   * PLAYBOOK.md, "Blog" section).
   */
  ctaVertical?: Vertical;
  /** Country context for the end-of-post CTA's vendors; defaults to "CA" when ctaVertical is set. */
  ctaCountry?: "US" | "CA";
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
    ctaVertical: "mortgage",
    ctaCountry: "CA",
  },
  {
    slug: "property-assessment-vs-market-value-canada",
    title: "Property Assessment vs. Market Value in Canada: What Buyers Should Know",
    description:
      "A clear explanation of how government property assessments work in BC, Alberta, and Ontario, why assessed values differ from listing prices, and how buyers can use the gap to their advantage.",
    publishedAt: "2026-03-08",
    readingTime: "10 min read",
    tags: ["assessments", "market value", "BC", "Alberta", "Ontario"],
    ctaVertical: "mortgage",
    ctaCountry: "CA",
  },
  {
    slug: "how-to-tell-if-a-house-is-overpriced-canada",
    title: "How to Tell If a House Is Overpriced in Canada",
    description:
      "Five concrete signals that a Canadian property may be listed above its realistic selling price, and how to use public data to make a smarter offer.",
    publishedAt: "2026-03-08",
    readingTime: "9 min read",
    tags: ["pricing", "negotiation", "data analysis"],
    ctaVertical: "mortgage",
    ctaCountry: "CA",
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
    ctaVertical: "mortgage",
    ctaCountry: "CA",
  },
  {
    slug: "bc-assessment-to-asking-price-gap",
    title:
      "How Far Above BC Assessment Do Sellers List? We Measured 15 Listings",
    description:
      "An original data analysis matching 15 live BC listings to their government assessment values. The median asking price runs 7.4% above assessment, with a city-by-city breakdown and full methodology.",
    publishedAt: "2026-08-07",
    readingTime: "7 min read",
    tags: ["assessments", "BC", "data analysis", "market value"],
    ctaVertical: "insurance",
    ctaCountry: "CA",
  },
  {
    slug: "us-rent-to-price-ratio-by-county",
    title:
      "Where Rents Are Outrunning Home Prices: 29 U.S. Counties That Clear the 1% Rule",
    description:
      "An original analysis of rent-to-price ratios across 3,212 U.S. counties using Census ACS and FHFA data. The national median sits at 0.467% monthly, but 29 counties clear the classic 1% investing rule — led by Kinney County, Texas at 1.55%.",
    publishedAt: "2026-08-08",
    readingTime: "10 min read",
    tags: ["data analysis", "market value", "US"],
    ctaVertical: "investor-tools",
    ctaCountry: "US",
  },
  {
    slug: "what-is-fair-market-rent",
    title: "What Is Fair Market Rent? HUD's Rent Data, Explained (2026)",
    description:
      "What HUD Fair Market Rent actually measures, how it's calculated, and what it's used for, with real 2026 figures across 3,077 U.S. counties: a $1,019 national median 2-bedroom FMR, a $776 to $4,214 county range, and how FMR compares to what tenants are actually paying.",
    publishedAt: "2026-08-08",
    readingTime: "9 min read",
    tags: ["data analysis", "rent", "US", "2026"],
    ctaVertical: "investor-tools",
    ctaCountry: "US",
  },
  {
    slug: "how-much-rent-should-i-charge",
    title: "How Much Rent Should You Charge? A Data-First Answer for Landlords",
    description:
      "A three-anchor framework for pricing a rental: HUD Fair Market Rent by county, Census ACS actual rents, and property-specific comps, with a worked Travis County, TX example and the real vacancy math behind under- and over-pricing.",
    publishedAt: "2026-08-08",
    readingTime: "8 min read",
    tags: ["rent", "landlords", "US", "data analysis"],
    ctaVertical: "investor-tools",
    ctaCountry: "US",
  },

  {
    slug: "one-percent-rule-real-estate",
    title: "The 1% Rule in Real Estate: What It Is and Where It Still Works in 2026",
    description:
      "What the 1% rule actually measures, why it's a screening test rather than a verdict, and which of 3,071 U.S. counties still clear it in 2026 using HUD Fair Market Rent and Census home-value data.",
    publishedAt: "2026-08-08",
    readingTime: "7 min read",
    tags: ["1% rule", "data analysis", "US", "investing"],
    ctaVertical: "investor-tools",
    ctaCountry: "US",
  },
  {
    slug: "best-counties-rental-property-2026",
    title: "How to Find the Best Counties for Rental Property (2026 Data Method)",
    description:
      "Why county-level screening beats city listicles, the five public data factors that predict a strong rental market, and the real top-10 U.S. counties from our 2,724-county investment scorecard.",
    publishedAt: "2026-08-08",
    readingTime: "7 min read",
    tags: ["investing", "data analysis", "US", "rankings"],
    ctaVertical: "investor-tools",
    ctaCountry: "US",
  },

  {
    slug: "how-property-taxes-are-calculated",
    title: "How Property Taxes Are Calculated: Assessments, Mill Rates, and Your Actual Bill",
    description:
      "A plain-language walkthrough of assessed value, mill rates, and exemptions, with real 2024 Census data across 3,207 US counties and a worked example showing exactly how a tax bill is built.",
    publishedAt: "2026-08-08",
    readingTime: "8 min read",
    tags: ["property tax", "data analysis", "US"],
    ctaVertical: "tax-appeal",
    ctaCountry: "US",
  },
  {
    slug: "property-tax-rates-by-county",
    title: "US Property Tax Rates by County: The Highest, the Lowest, and the National Median (2024 Data)",
    description:
      "An original data analysis of effective property tax rates across 3,207 US counties. The national median is 0.79%, led by Menominee County, WI at 3.56% and anchored at the bottom by four counties under 0.20%.",
    publishedAt: "2026-08-08",
    readingTime: "7 min read",
    tags: ["property tax", "data analysis", "US"],
    ctaVertical: "tax-appeal",
    ctaCountry: "US",
  },

];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/** Return 2-3 blog posts relevant to a province (for city page cross-links) */
export function getRelatedPosts(province: string): BlogPost[] {
  const provinceTag = province === "BC" ? "BC" : province === "AB" ? "Alberta" : "Ontario";
  const provinceMatches = BLOG_POSTS.filter((p) =>
    p.tags.some((t) => t.toLowerCase() === provinceTag.toLowerCase())
  );
  // Always include universally relevant posts
  const universalSlugs = [
    "how-to-make-an-offer-on-a-house-in-canada",
    "how-much-below-asking-price-to-offer-canada",
  ];
  const universal = BLOG_POSTS.filter((p) => universalSlugs.includes(p.slug));
  // Merge, deduplicate, cap at 3
  const seen = new Set<string>();
  const result: BlogPost[] = [];
  for (const p of [...provinceMatches, ...universal]) {
    if (!seen.has(p.slug) && result.length < 3) {
      seen.add(p.slug);
      result.push(p);
    }
  }
  return result;
}

/** Return city links relevant to a blog post (for blog→city cross-links) */
export function getRelatedCities(post: BlogPost): { name: string; slug: string }[] {
  const tags = post.tags.map((t) => t.toLowerCase());
  const cities: { name: string; slug: string }[] = [];
  if (tags.includes("bc")) cities.push({ name: "Victoria", slug: "victoria" }, { name: "Vancouver", slug: "vancouver" });
  if (tags.includes("alberta")) cities.push({ name: "Calgary", slug: "calgary" }, { name: "Edmonton", slug: "edmonton" });
  if (tags.includes("ontario")) cities.push({ name: "Toronto", slug: "toronto" }, { name: "Ottawa", slug: "ottawa" });
  // Default: one from each province if no tag match
  if (cities.length === 0) {
    cities.push(
      { name: "Victoria", slug: "victoria" },
      { name: "Calgary", slug: "calgary" },
      { name: "Toronto", slug: "toronto" },
    );
  }
  return cities.slice(0, 3);
}
