# Complete SEO Stack Playbook

A reusable, framework-agnostic SEO playbook built from two production deployments: a Vite + React SPA and a Next.js 16 App Router application (Property Insights). Every layer was implemented, tested, and validated against real Google indexing behavior.

This playbook is ordered by dependency — each layer builds on the one before it. Skip nothing in layers 1–3. Layers 4+ can be prioritized based on your product.

---

## Layer 1: Crawlability

**What:** robots.txt, sitemap.xml, Google Search Console verification.

**Why:** Google needs to discover your pages, know which to index, and which to ignore. Without a sitemap, discovery relies entirely on link-following. Without robots.txt, crawlers have no guidance. GSC verification lets you monitor how Google sees your site and submit sitemaps directly.

**Implementation:**

- **robots.txt** — Allow all crawlers except AI *training* crawlers (GPTBot, ClaudeBot, CCBot, Bytespider, cohere-ai). Allow AI *citation/search* crawlers (PerplexityBot, Applebot, FacebookBot) — these link back to your site in AI-generated answers. Never block Googlebot or Bingbot — they drive both organic search AND AI answer citations (Google AI Overviews, Copilot). Block internal routes (`/api/`, `/assess`, `/admin`). Point to sitemap. See the Deployment Security Playbook for the full training vs. citation crawler framework.
- **sitemap.xml** — Auto-generated from routes + data. Never manually maintain a sitemap. In Next.js, use `app/sitemap.ts`. In Vite/React, use a build-time script that reads route config and generates XML.
  - Set `priority`: homepage 1.0, core pages 0.9, content pages 0.8, legal pages 0.3.
  - Set `changeFrequency`: data-driven pages "daily", content pages "weekly", legal "yearly".
  - Include every indexable URL. Exclude API routes, auth pages, and utility routes.
- **GSC verification** — DNS TXT record is cleanest. HTML file in public/ as fallback. Meta tag in `<head>` as belt-and-suspenders.

**SPA-specific:** Make sure your hosting rewrite rules don't intercept `robots.txt` and `sitemap.xml`. In Vite + Vercel, these must be in `public/` or served via API routes. In Next.js App Router, use `app/robots.ts` and `app/sitemap.ts` — they're first-class route handlers.

**Anti-pattern:** Static sitemaps that go stale. If you add a page and forget to update the sitemap, Google won't find it for weeks. Always auto-generate.

---

## Layer 2: Metadata

**What:** Per-route `<title>`, `<meta description>`, canonical URLs, Open Graph tags, Twitter Card tags.

**Why:** Every page needs a unique title and description. Without them, Google uses whatever text it finds on the page, and every link share (LinkedIn, Slack, Reddit) shows a blank card. OG tags control how your links appear when shared. Canonical URLs prevent duplicate content penalties from query params or trailing slashes.

**Implementation:**

- **Title template:** Use `"%s | Site Name"` pattern so every page gets a branded suffix without repetition.
- **Description:** 150–160 characters. Include the primary keyword naturally. Describe what the user will get, not what the page is.
- **Canonical URLs:** Set on every page. Use absolute URLs (`https://example.com/page`, not `/page`). Must match the URL you want Google to index.
- **Open Graph:** `og:title`, `og:description`, `og:url`, `og:image`, `og:type` (website for pages, article for posts), `og:locale`.
- **Twitter Cards:** `twitter:card` (use `summary_large_image` if you have OG images, `summary` if you don't), `twitter:title`, `twitter:description`.
- **Keywords meta tag:** Low value for Google ranking, but still useful for internal documentation and some secondary search engines. Include 10–15 relevant terms.

**Framework patterns:**
- **Next.js App Router:** Export `metadata` object or `generateMetadata()` function from each `page.tsx`. Set defaults in root `layout.tsx`.
- **Vite + React SPA:** Use `react-helmet-async` with a centralized `seo-config.ts` mapping routes to metadata. Add fallback meta in `index.html` for crawlers and social scrapers that don't execute JS.

**Anti-pattern:** Identical titles and descriptions across pages. Every page must have unique metadata targeting different keywords.

---

## Layer 3: Structured Data (JSON-LD)

**What:** Schema.org vocabulary injected via `<script type="application/ld+json">`. Tells Google what your content IS, not just what it says.

**Why:** Enables rich results (FAQ dropdowns, knowledge panels, breadcrumb trails in SERPs), AI Overview citations, and "People Also Ask" eligibility. FAQPage schema is especially valuable for new sites — it can get you into featured snippets even before you rank organically.

**Implementation — which schemas and where:**

| Schema | Where | When to use |
|---|---|---|
| **Organization** or **WebApplication** | Root layout (renders on every page) | Always. Establishes who you are. |
| **BreadcrumbList** | Every non-homepage page | Always. Shows site hierarchy in SERPs. |
| **FAQPage** | Landing pages, product explainers, blog posts | Any page with Q&A-style content. 3–5 questions per page. |
| **Article** / **BlogPosting** | Blog posts | Every post. Include headline, author, datePublished, dateModified, publisher. |
| **Product** / **Service** / **SoftwareApplication** | Homepage or service pages | Describes what you offer. Include pricing if applicable. |
| **LocalBusiness** or **Place** | Location-specific pages | If your content targets geographic areas. |
| **RealEstateListing** / **JobPosting** / etc. | Domain-specific listing pages | Match the schema to your vertical. |

**Pattern:** Create a reusable `JsonLd` component that accepts a data object and renders the script tag. Build typed wrapper components (`FaqJsonLd`, `BreadcrumbJsonLd`, `ArticleJsonLd`) for each schema type. Import and compose them per page.

```tsx
// Reusable base
function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

// Typed wrapper
function FaqJsonLd({ questions }: { questions: { question: string; answer: string }[] }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(q => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.answer },
    })),
  }} />;
}
```

**Anti-pattern:** Adding structured data that doesn't match the visible page content. Google penalizes schema/content mismatches.

---

## Layer 4: Open Graph Images

**What:** Dynamic, per-page social preview images rendered at build/request time. 1200x630px PNG.

**Why:** Every time someone shares your URL on Reddit, Slack, LinkedIn, Twitter, or iMessage, the preview card is a free ad. A blank or generic card gets scrolled past. A branded card with specific data (price, title, key metric) gets clicked.

**Implementation:**

- **Homepage OG:** Brand logo + headline + tagline. Static content, can use edge runtime.
- **Dynamic pages (listings, products, posts):** Fetch the page's data, render key fields (title, price, key metric) on a branded background. Use the same brand colors and typography feel as your site.
- **Blog posts:** Post title + reading time + brand. Simple and clean.

**Framework patterns:**
- **Next.js App Router:** Create `opengraph-image.tsx` files in route directories. Uses `ImageResponse` from `next/og`. Use `runtime = "nodejs"` if the image needs to fetch data from your database. Use `runtime = "edge"` for static/computed-only images.
- **Vite + React:** Generate OG images at build time using a headless browser (Playwright) or a service like `@vercel/og`. Store as static assets.

**Design principles:**
- One second to communicate value. Lead with the most compelling data point.
- Use large text (36–48px for primary info). Mobile previews are small.
- Consistent brand identity across all OG images (same background, same logo placement).
- Avoid clutter. Three data points maximum.

**Anti-pattern:** OG images with too much information. If someone needs context to understand the image, it's too complex for a social card.

---

## Layer 5: Performance (Core Web Vitals)

**What:** LCP (Largest Contentful Paint), CLS (Cumulative Layout Shift), INP (Interaction to Next Paint). Google uses these as ranking signals.

**Why:** A 1-second improvement in LCP can measurably improve search rankings. Font files are the most common hidden performance killer. Unoptimized images and layout shifts destroy CWV scores.

**Implementation — audit in this order:**

1. **Fonts:** The single biggest quick win.
   - Subset to Latin-only (pyftsubset for custom fonts, `subsets: ["latin"]` for Google Fonts in Next.js).
   - Add `font-display: swap` to every `@font-face`.
   - Delete unused font weights/styles. A variable font can be 2MB — subset to 120KB.
   - In Next.js, use `next/font` for automatic optimization.

2. **Images:**
   - Use `next/image` (Next.js) or responsive `<picture>` elements with `srcset`.
   - Always specify `width` and `height` to prevent CLS.
   - Lazy-load below-fold images (`loading="lazy"`).
   - Use WebP/AVIF formats where supported.

3. **Video:**
   - Always provide a `poster` attribute (extract first frame with `ffmpeg`).
   - Lazy-load below-fold video with `IntersectionObserver`.
   - Never autoplay video above the fold without a poster.

4. **JavaScript:**
   - Code-split routes. In Next.js, this is automatic. In Vite, use `React.lazy()` + `Suspense`.
   - Defer non-critical third-party scripts (analytics, chat widgets).
   - Audit bundle size with `npx next build` or `vite-bundle-visualizer`.

**Measurement:** Use PageSpeed Insights (lab data), Chrome DevTools Lighthouse (local), and Google Search Console Core Web Vitals report (field data from real users).

---

## Layer 6: Favicons & Brand Identity

**What:** SVG favicon, PNG favicons at standard sizes, apple-touch-icon, web manifest.

**Why:** Favicons appear in browser tabs, bookmarks, Google search results, and mobile home screens. The default framework favicon signals "this site isn't finished."

**Implementation:**

| File | Size | Purpose |
|---|---|---|
| `icon.svg` | Scalable | Modern browsers. Placed at `app/icon.svg` (Next.js) or `public/favicon.svg`. |
| `apple-icon.png` | 180×180 | iOS home screen. Placed at `app/apple-icon.png` (Next.js) or linked in `<head>`. |
| `favicon.ico` | 32×32 | Legacy fallback. Next.js auto-generates from `icon.svg`. |
| `manifest.webmanifest` | — | PWA metadata: name, icons, theme_color, background_color. |

**Generating icons:** Start from the highest-resolution brand asset. Use `sharp` (Node.js), `sips` (macOS), or ImageMagick to generate all sizes from one source. Script this so updating the brand mark regenerates all sizes.

---

## Layer 7: Analytics

**What:** Page view tracking, user behavior analytics, conversion tracking.

**Why:** Without analytics, you can't measure SEO results. You need to know which pages get organic traffic, which queries drive visits, and where users drop off.

**Implementation:**

- **Privacy-first option:** Vercel Analytics (zero-cookie, automatic CWV tracking, no consent banner needed in most jurisdictions).
- **Full-featured option:** GA4 measurement ID. Share the `gtag` snippet with Google Ads if running paid campaigns.
- **Custom events:** Track key conversion actions (assessment requests, sign-ups, property views) via a server-side endpoint. Require consent before tracking.
- **Consent management:** Required under GDPR/PIPEDA/CCPA for non-essential cookies. Build a simple banner with "Accept all" / "Analytics only" options. Store preference in auth system metadata or localStorage.

**Pattern:** One analytics snippet, multiple configurations. GA4 for traffic, Google Ads for conversions, Vercel Analytics for CWV. They coexist.

---

## Layer 8: Content Architecture

**What:** The pages you create specifically to rank for target keywords. This is where SEO stops being technical and starts being strategic.

**Why:** A homepage alone can only rank for branded queries ("Property Insights"). Every additional page targeting a specific keyword cluster is a new entry point from Google. Content creates the funnel: blog post (awareness) → landing page (consideration) → conversion action.

**Implementation — three content types:**

### 8A: Vertical / City / Category Landing Pages

One template, many pages. Each page gets unique metadata, H1, data-driven stats, and a call to action. Add a new page by adding data, not code.

**Property Insights pattern:** `/discover/[city]` — 10 city pages auto-generated from listing data. Each has: city-specific stats (avg savings, avg DOM, listings in range), filtered listing feed, breadcrumb JSON-LD, unique metadata targeting "[city] real estate deals."

**Reusable pattern:** Identify the axes your product covers (cities, industries, categories, use cases). Create one template component. Drive it with a data file or database query. Each page targets: `[axis value] + [your product category]` (e.g., "Calgary real estate deals", "automation for healthcare").

### 8B: Blog Posts

Target informational queries earlier in the buyer journey. Each post targets 1 primary long-tail keyword in the H1/title + 3–5 secondary keywords throughout.

**Organization:**
- Posts as components/MDX files with exported metadata (title, description, publishedAt, tags, readingTime).
- Auto-discovery via glob import or a registry array. Drop a file, it appears on the blog and in the sitemap.
- Article JSON-LD + FAQ JSON-LD on every post.

**Content quality bar:** Write for a specific person (a first-time homebuyer, a healthcare ops manager), not "businesses" or "users." Include concrete data, real examples, and actionable advice. If a post could appear on any competitor's blog without modification, it's too generic.

### 8C: Sitemap Automation

The sitemap must auto-update when content is added. Never manually edit a sitemap.

- **Next.js:** `app/sitemap.ts` — dynamic function that queries your data sources and returns all URLs.
- **Vite/React:** Build-time script that reads route config + content directory and generates `sitemap.xml`.
- Split into multiple sitemaps when approaching 50,000 URLs (Google's per-sitemap limit).

---

## Layer 9: Keyword Research

**What:** Identifying search queries you can realistically rank for, before writing content.

**Why:** Generic content targeting head terms ("what is workflow automation", "how to buy a house") will never rank for a new domain. The sites on page 1 have domain authority scores of 80+. Long-tail queries at the intersection of vertical + pain point + specificity are where a new site wins.

**Process:**

1. **Check who ranks on page 1 first.** If it's HubSpot, Zillow, NerdWallet — don't compete. Find the query variation they haven't covered.

2. **Target the intersection:**
   ```
   [industry/location] + [pain point] + [solution type]
   ```
   Examples:
   - "how much below asking price to offer in Canada" (not "how to negotiate")
   - "agentic AI for healthcare billing" (not "what is AI automation")
   - "Calgary vs Edmonton real estate investment 2026" (not "best cities to invest")

3. **Target emerging categories** where page-1 positions aren't locked down. New terminology, new regulations, new market conditions.

4. **Every post targets:**
   - 1 primary long-tail keyword (in H1, title tag, first paragraph)
   - 3–5 secondary keywords (in H2s and body text, naturally)
   - 1 geographic or temporal modifier when relevant ("Canada", "2026")

5. **Validate demand:** Use Google's autocomplete, "People Also Ask" boxes, and Search Console query data from similar content. If nobody's searching for it, ranking #1 is worthless.

---

## Layer 10: Internal Linking

**What:** Deliberate cross-linking between pages to distribute authority and signal content relationships to Google.

**Why:** Internal links are the primary way Google discovers page relationships and distributes PageRank within your site. A blog post linking to a landing page tells Google "these are related, and the landing page is the parent topic." Without internal links, each page is an island.

**Implementation — the linking map:**

```
Homepage
  ├── Landing pages (city/vertical)
  │     ├── Related blog posts ("Related reading" section)
  │     └── Conversion CTA
  ├── Blog index
  │     └── Blog posts
  │           ├── Related landing pages (inline CTAs)
  │           ├── Previous / Next post links
  │           └── Conversion CTA
  └── Product explainer (how-it-works)
        ├── FAQ section (with JSON-LD)
        └── Conversion CTA
```

**Rules:**
- Every new page links TO at least 2 existing pages.
- Every new page is linked FROM at least 2 existing pages.
- Blog posts always link to the most relevant landing page.
- Landing pages always link to 2–3 related blog posts.
- Navigation (header + footer) links to top-level pages: homepage, product explainer, blog, discovery/listing page.
- Use descriptive anchor text, not "click here." The anchor text tells Google what the target page is about.

**Anti-pattern:** Orphan pages (pages with no internal links pointing to them). Google deprioritizes orphan pages because they signal low importance.

---

## Layer 11: Technical Hardening

**What:** The details that separate a "site that exists" from a "site that ranks."

**Implementation checklist:**

- [ ] **Custom 404 page** — Branded, with navigation links. Not the framework default. Helps retain users who hit dead links.
- [ ] **One H1 per page** — Audit every page. The H1 is the most important on-page ranking signal. Multiple H1s dilute it.
- [ ] **Heading hierarchy** — H1 → H2 → H3, never skip levels. Screen readers and crawlers use heading structure to understand content organization.
- [ ] **Trailing slash enforcement** — Pick one (`/page` or `/page/`) and enforce it. Both variants being indexable = duplicate content. Set `trailingSlash: false` in Next.js config.
- [ ] **Alt text** — Every non-decorative image needs descriptive alt text. Decorative images get `alt="" aria-hidden="true"`. Logo images get `alt="[Brand] logo"`.
- [ ] **HTTPS everywhere** — Enforced by default on Vercel/Netlify. If self-hosting, redirect HTTP → HTTPS.
- [ ] **Mobile responsiveness** — Google uses mobile-first indexing. If your mobile layout is broken, your rankings suffer even on desktop searches.
- [ ] **No soft 404s** — Pages that return 200 but show "not found" content. Use proper HTTP 404 status codes via `notFound()` in Next.js or equivalent.

---

## Layer 12: Monitoring & Iteration

**What:** Ongoing measurement and optimization after the initial stack is deployed.

**Implementation:**

1. **Google Search Console** — Monitor weekly:
   - **Coverage report:** Ensure all pages are indexed. Fix any "excluded" or "error" pages.
   - **Performance report:** Track impressions, clicks, CTR, and average position for target keywords.
   - **Core Web Vitals report:** Field data from real users. Fix any "poor" URLs.

2. **Submit sitemap:** After deploying the sitemap, submit it in GSC → Sitemaps. Google will confirm how many URLs it found and indexed.

3. **Track indexing velocity:** After deploying new pages, use GSC's URL Inspection tool to request indexing. Monitor how quickly new pages appear in search results.

4. **Content refresh cycle:**
   - Blog posts: Review quarterly. Update dates, statistics, and recommendations.
   - Landing pages: Auto-refresh via data pipeline (daily/weekly).
   - Update `lastModified` in sitemap when content changes — this signals Google to re-crawl.

5. **Ranking tracking:** Monitor target keywords weekly. If a page drops, check for:
   - Technical issues (indexing errors, CWV regression)
   - Content freshness (outdated data, stale recommendations)
   - New competitors (someone published better content on the same topic)

---

## Quick-Start Checklist

For a brand new project, implement in this exact order:

```
Week 1: Foundation
  □ robots.txt + sitemap.xml (auto-generated)
  □ GSC verification + sitemap submission
  □ Root metadata (title template, description, OG, Twitter)
  □ Per-page metadata on every existing route
  □ Organization JSON-LD in root layout
  □ Custom 404 page
  □ Favicon set (SVG + apple-touch-icon)
  □ Trailing slash enforcement

Week 2: Structured Data + Performance
  □ BreadcrumbList JSON-LD on non-homepage pages
  □ Domain-specific JSON-LD (Article, Product, Listing, etc.)
  □ FAQPage JSON-LD on landing pages
  □ Font audit + subsetting
  □ Image optimization (next/image or srcset)
  □ Analytics integration

Week 3: Content
  □ Keyword research for 5-10 target queries
  □ Landing page template + first 3-5 data-driven pages
  □ Blog setup + first 2-3 posts targeting long-tail queries
  □ Internal linking map implemented
  □ OG images (homepage + dynamic pages)

Week 4+: Scale
  □ More landing pages (expand to all axes/cities/verticals)
  □ More blog posts (1-2 per week)
  □ Blog cross-linking (prev/next, related posts, inline CTAs)
  □ Tag/category pages for additional indexable URLs
  □ Monitor GSC, iterate on underperforming pages
```

---

## Property Insights Reference Implementation

| Layer | File(s) | Notes |
|---|---|---|
| Crawlability | `app/robots.ts`, `app/sitemap.ts` | Dynamic sitemap with 60+ URLs, AI crawlers blocked |
| Metadata | `app/layout.tsx` (defaults), every `page.tsx` | Title template, OG, Twitter, canonical on all routes |
| Structured Data | `components/json-ld.tsx` | WebApplication, RealEstateListing, BreadcrumbList, Article, FAQPage |
| OG Images | `app/opengraph-image.tsx`, `property/[slug]/opengraph-image.tsx`, `blog/[slug]/opengraph-image.tsx` | Option A (minimal): address + price + offer + tier |
| Performance | `next/font` (Geist), ISR on dynamic pages | Latin subset, 600s revalidation |
| Favicons | `app/icon.svg`, `app/apple-icon.png` | SVG + 180×180 PNG |
| Analytics | Vercel Analytics + custom event tracking | Zero-cookie + consent-gated custom events |
| Content | 250 property pages, 10 city landing pages, 4 blog posts, how-it-works | Data-driven landing pages + editorial blog |
| Internal Linking | Header/footer nav, breadcrumbs, city→blog cross-links, blog→city CTAs | Every page links to 2+ other pages |
| Technical | Custom 404, heading hierarchy, `trailingSlash: false`, proper `notFound()` | No soft 404s, mobile-first responsive |

---

*Built by Orio. Validated on propertyinsights.xyz and useorio.com.*
