import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPost, getRelatedCities, BLOG_POSTS } from "@/lib/blog";
import { BASE_URL } from "@/lib/seo";
import { JsonLd, FaqJsonLd } from "@/components/json-ld";
import PartnerCta from "@/components/partner-cta";
import GuideViewSignal from "@/components/guide-view-signal";
import type { SurfaceKey, Vertical } from "@/config/affiliate-vendors";

/**
 * Maps a post's `ctaVertical` to the PartnerCta surface that best matches
 * its journey priority (see SURFACE_VERTICAL_PRIORITY in
 * src/config/affiliate-vendors.ts) — investor-tools content pairs with the
 * investor journey, tax-appeal content with the calculator journey, and
 * everything else (mortgage/insurance/home-services/agent-referral) with
 * the general buyer-result journey.
 */
function surfaceForVertical(vertical: Vertical): SurfaceKey {
  if (vertical === "investor-tools") return "result-investor";
  if (vertical === "tax-appeal") return "calculator";
  return "result-buyer";
}

const FAQ_MAP: Record<string, { question: string; answer: string }[]> = {
  "how-to-make-an-offer-on-a-house-in-canada": [
    { question: "How do you make an offer on a house in Canada?", answer: "Work with a real estate lawyer or agent to submit a written offer outlining the price, deposit, conditions (financing, inspection), and closing date. The offer is a legally binding contract once accepted by the seller." },
    { question: "Do you need a deposit to make an offer in Canada?", answer: "Yes. A deposit (typically 3–5% of the purchase price) is submitted with your offer to show good faith. It's held in trust and applied to the purchase price at closing." },
    { question: "Can you offer below asking price in Canada?", answer: "Yes. There is no rule against offering below asking price. In a balanced or buyer's market, offers 5–15% below asking are common, especially when properties have been listed for 30+ days or are priced above their government-assessed value." },
    { question: "What conditions should you include in a home offer?", answer: "Common conditions include financing approval, home inspection, and title review. Conditions protect you from being locked into a purchase if something unexpected is discovered. Waiving conditions is risky and should only be done with legal advice." },
  ],
  "property-assessment-vs-market-value-canada": [
    { question: "What is the difference between assessed value and market value in Canada?", answer: "Assessed value is determined by the government for property tax purposes, based on mass appraisal of comparable sales. Market value is what a buyer will actually pay today. They often diverge because assessments use older data and don't account for renovations, unique features, or current demand." },
    { question: "How often are property assessments updated in Canada?", answer: "It varies by province. BC Assessment updates annually (reflecting values as of July 1 of the prior year). Alberta municipalities update annually. Ontario's MPAC assessments were last updated in 2016 and are phased in over four years." },
    { question: "Can you look up a property's assessed value for free?", answer: "In BC, use bcassessment.ca. In Calgary and Edmonton, assessment data is available through their open data portals (SODA API) at no cost. Ontario assessments are available through MPAC's aboutmyproperty.ca with the property owner's consent or through municipal tax records." },
    { question: "Is assessed value a good indicator of what to offer?", answer: "It's a useful anchor, not a final answer. If a property is listed well above its assessed value, it may be overpriced. The assessment-to-listing ratio helps identify negotiation room, but you should also consider days on market, comparable sales, and seller motivation." },
  ],
  "how-to-tell-if-a-house-is-overpriced-canada": [
    { question: "How can you tell if a house is overpriced in Canada?", answer: "Five key signals: it's been listed for 30+ days without offers, the price is significantly above the government-assessed value, similar homes in the area have sold for less, the listing description uses urgency language ('must sell', 'price reduced'), and the property has been relisted at a lower price." },
    { question: "What does days on market (DOM) mean?", answer: "Days on market measures how long a property has been actively listed for sale. High DOM (30+ days in a normal market) often signals overpricing, as well-priced homes typically sell faster. Sellers with high DOM are generally more motivated to negotiate." },
    { question: "Should you still make an offer on an overpriced house?", answer: "Yes, if you want the property. Overpricing is actually an opportunity — it means fewer competing buyers and a more motivated seller. Make an offer backed by data (assessed value, comparable sales, DOM) and be prepared to negotiate." },
    { question: "What listing description phrases signal an overpriced home?", answer: "Watch for 'price reduced', 'price improvement', 'bring all offers', 'motivated seller', and 'must sell'. These phrases indicate the seller has already had to adjust expectations, suggesting the original price was too high." },
  ],
  "how-much-below-asking-price-to-offer-canada": [
    { question: "How much below asking price should you offer on a house in Canada?", answer: "There's no fixed rule. Use data to determine your range: compare the listing price to the government-assessed value, check days on market (30+ days = more room), analyze listing language for motivation signals, and review comparable sales. In a buyer's market, 5–15% below asking is common for motivated sellers." },
    { question: "Is it rude to offer 20% below asking price?", answer: "No. A low offer backed by data (assessment gap, high DOM, comparable sales) is a negotiation starting point, not an insult. Sellers can counter, accept, or reject. The worst outcome is a 'no.' Present your reasoning and let the data speak." },
    { question: "How does days on market affect your offer?", answer: "The longer a property sits unsold, the more leverage buyers have. At 0–14 days, there's little room to negotiate. At 30–60 days, sellers are becoming anxious. At 90+ days, significant discounts are often achievable because the seller is likely highly motivated." },
    { question: "What data should you use to determine your offer price?", answer: "Four key inputs: government-assessed value (your anchor), days on market (seller urgency), listing language (motivation signals like 'estate sale' or 'price reduced'), and recent comparable sales in the neighbourhood. Together, these tell you how much room you have to negotiate." },
  ],
  "bc-assessment-to-asking-price-gap": [
    { question: "How much above BC Assessment do homes typically list for?", answer: "In our sample of 15 matched listings, the median asking price was 7.4% above the BC Assessment value, and the mean was 7.5%. 80% of matched listings (12 of 15) were priced above assessment; 20% (3 of 15) were priced at or below it." },
    { question: "Does the assessment-to-asking gap vary by city?", answer: "Yes, even within Greater Victoria. In our sample, Victoria listings had a median gap of +9.0% above assessment (n=9), while Saanich listings had a median gap of -3.1%, meaning they trended slightly below assessment (n=4). Sample sizes are small, so these are directional, not definitive, municipal averages." },
    { question: "How was this assessment-to-asking gap data calculated?", answer: "We matched 15 of 250 live listings in our system to BC Assessment values by normalized street address, then compared asking price to assessed value for each matched pair. The snapshot was taken 2026-08-07. All matched pairs are in Greater Victoria, and BC Assessment values lag the market by about a year, so the gap reflects asking price versus a roughly one-year-old valuation, not today's fair value." },
  ],
  "what-is-fair-market-rent": [
    { question: "What is Fair Market Rent (FMR)?", answer: "Fair Market Rent is HUD's annual estimate of what a standard-quality rental unit costs in a given county, set at roughly the 40th percentile of local gross rent (rent plus a utility allowance). It's calculated for every county, broken out by bedroom size, and is primarily used to set Section 8 housing voucher payment standards." },
    { question: "What is the national median Fair Market Rent for a 2-bedroom in 2026?", answer: "Across 3,077 U.S. counties in our 2026 dataset, the national median 2-bedroom Fair Market Rent is $1,019/mo. County-level figures range from $776/mo in the lowest-cost counties to $4,214/mo in Santa Cruz County, California." },
    { question: "Is Fair Market Rent the same as actual median rent?", answer: "No. FMR is calibrated to current market activity and targets the 40th percentile of a new lease. Census ACS median gross rent averages in every existing tenancy, including older, below-market leases. Across 3,069 counties with both figures, the median county's FMR runs 19.2% above its ACS median rent, and FMR is higher in 94.9% of counties." },
    { question: "How is Fair Market Rent calculated?", answer: "HUD builds FMR mainly from Census ACS rent data, trended forward using recent CPI rent inflation, and republishes it every October for the following federal fiscal year. In low-population rural counties, HUD often groups several counties into one shared FMR area to get a reliable sample, which is why identical figures sometimes appear across neighboring counties." },
  ],
  "how-much-rent-should-i-charge": [
    { question: "How much rent should I charge for my property?", answer: "Start with three anchors: your county's HUD Fair Market Rent for the bedroom count (national 2-bedroom median is $1,019/mo in 2026), the Census ACS median gross rent for what tenants are actually paying, and direct comps for similar units nearby. The county figures set your range; comps set the exact number." },
    { question: "What's the difference between HUD Fair Market Rent and actual rents paid?", answer: "FMR reflects current-market pricing for a new lease. ACS median gross rent averages in existing tenancies, including older, below-market leases. In the median U.S. county, FMR runs about 19.2% above ACS median rent, and in extreme cases like Santa Cruz County, CA, the gap is 86% ($4,214 FMR vs. $2,264 ACS rent)." },
    { question: "What does it cost to overprice or underprice a rental?", answer: "Using a $1,852/mo 2-bedroom (Travis County, TX FMR) as an example, pricing 10% above market and losing one extra month to vacancy erases almost the entire year's markup. Pricing 10% below market with no offsetting benefit costs roughly $2,220/year in foregone rent for the life of the tenancy. Small mispricing is forgivable; extended vacancy from major overpricing is the real cost." },
    { question: "Should I check a per-address rent estimate instead of the county average?", answer: "County-level FMR and ACS figures are a good first pass, but once you have a specific address, especially with unusual features or renovations, a per-property estimate is more accurate than the county number alone. Property Insights surfaces a per-address rent estimate alongside its assessment-gap analysis when you run an address through the site." },
  ],
  "one-percent-rule-real-estate": [
    { question: "What is the 1% rule in real estate?", answer: "The 1% rule is a quick screening test: a rental property roughly clears it when its monthly rent is at least 1% of the purchase price. A $150,000 house would need to rent for about $1,500/mo. It's a first-pass filter for cash flow potential, not a final verdict on any specific deal." },
    { question: "Is the 1% rule realistic in 2026?", answer: "Mostly no. Using 2026 HUD Fair Market Rents against Census median home values, only 155 of 3,071 U.S. counties (5.0%) clear the 1% bar at the county level. The national median ratio is 0.572% monthly, which annualizes to a 6.86% gross yield. A 0.7% screen is passed by 818 counties (26.6%), which is a more realistic modern bar in most markets." },
    { question: "Which counties pass the 1% rule?", answer: "Stonewall County, Texas leads at 2.088% monthly, followed by King County, TX (1.948%), Apache County, AZ (1.845%), Cochran County, TX (1.829%), and Oglala Lakota County, SD (1.756%). Texas has the most passing counties (43), followed by Georgia (25), Kansas (12), and Kentucky (12)." },
    { question: "What should investors use instead of a strict 1% cutoff?", answer: "A blended screen. 149 of the 155 passing counties (96.1%) have median home values under $125,000, so the ratio mostly flags cheap homes rather than strong rental markets. Combining gross yield with 5-year appreciation, disaster risk, vacancy, and days on market, as our county investment scorecard does, gives a fuller picture than any single ratio." },
  ],
  "best-counties-rental-property-2026": [
    { question: "What are the best counties to buy rental property in 2026?", answer: "By our 2,724-county investment scorecard, Heard County, GA leads with a score of 88.3, followed by Richardson County, NE (86.8), Bacon County, GA (85.7), Wilkinson County, GA (85.5), and Benton County, IN (85.3). These combine high gross rental yields with strong 5-year appreciation and low disaster risk." },
    { question: "How is the county investment score calculated?", answer: "Each county is percentile-ranked on five factors and blended: gross rental yield (35%), 5-year home-price appreciation (25%), FEMA disaster risk inverted (20%), vacancy rate inverted (10%), and days on market inverted (10%). A county needs yield, appreciation, and risk data present to be scored; 2,724 counties qualify." },
    { question: "What data sources feed the ranking?", answer: "All public: HUD Fair Market Rents (2026), Census ACS median home values and vacancy (2024), the FHFA House Price Index (1975 to 2025), the FEMA National Risk Index (2025), and realtor.com median days on market via FRED." },
    { question: "Is this ranking investment advice?", answer: "No. It's a screening tool built from county-level public data. It can't see a specific property's condition, taxes, insurance costs, or local rules. Use it to shortlist markets, then underwrite individual deals with property-level numbers before making any offer." },
  ],
  "how-property-taxes-are-calculated": [
    { question: "How are property taxes calculated?", answer: "Property tax = assessed value × mill rate, minus any exemptions. Assessed value is a government estimate of market value (sometimes a fraction of it, depending on the jurisdiction's assessment ratio); the mill rate is set by adding up the budgets of every local taxing authority (county, municipality, school district) and dividing by total assessed value in the area." },
    { question: "What is the national median effective property tax rate?", answer: "Across 3,207 US counties with 2024 Census data, the median effective rate (annual tax bill divided by home value) is 0.79%, and the mean is 0.90%. The median annual bill is $1,595." },
    { question: "Why did my property taxes go up if my home's value didn't change?", answer: "The most common cause is a taxing authority (school district, municipality) raising its rate to meet a new budget, or a change to an exemption you were previously claiming. A reassessment that raised your assessed value is the other common cause, and it's the one that can sometimes be appealed." },
    { question: "What is a mill rate?", answer: "One mill equals $1 of tax per $1,000 of assessed value. A mill rate of 20 means $20 of tax per $1,000 of assessed value, or 2% of assessed value. Your total bill is the sum of the mill rates set by every taxing authority with a claim on your property." },
  ],
  "property-tax-rates-by-county": [
    { question: "What US county has the highest property tax rate?", answer: "Among reliably-estimated counties in our 2024 dataset, Menominee County, Wisconsin has the highest effective property tax rate at 3.56%, with a $110,200 median home value and a $3,926 median annual bill." },
    { question: "What US county has the lowest property tax rate?", answer: "Among reliably-estimated counties in our 2024 dataset, East Feliciana Parish, Louisiana has the lowest effective property tax rate at 0.15%, with a $228,100 median home value and a $339 median annual bill." },
    { question: "What is the national median property tax rate by county?", answer: "0.79% (mean 0.90%), based on 3,207 US counties with 2024 Census ACS data. The median annual property tax bill across those counties is $1,595." },
    { question: "Which states have the highest and lowest property tax rates?", answer: "By median county effective rate, New Jersey (2.10%), New York (2.04%), and Illinois (1.81%) rank highest; Hawaii (0.25%), Alabama (0.32%), and Colorado (0.39%) rank lowest, among states with at least 3 counties reporting." },
  ],
  "us-rent-to-price-ratio-by-county": [
    { question: "What is the national median rent-to-price ratio for U.S. counties?", answer: "Across 3,212 U.S. counties with both ACS median home value and median gross rent data for 2024, the median monthly rent-to-price ratio is 0.467%, which annualizes to a 5.60% gross rental yield before taxes, insurance, vacancy, or maintenance." },
    { question: "Which U.S. counties have the highest rent-to-price ratio?", answer: "Kinney County, Texas leads at 1.551% monthly (18.6% annualized gross yield) on an $82,000 median home value, followed by Harding County, New Mexico (1.483%) and Culberson County, Texas (1.315%). All of the top-ranked counties have median home values under $125,000 — the high ratio reflects very low home prices, not exceptionally strong rents." },
    { question: "How many U.S. counties clear the 1% rule?", answer: "29 of the 3,212 counties we analyzed (0.9%) have a median monthly rent at or above 1% of median home value, the informal cash-flow threshold real estate investors often use. They cluster in rural Texas, the Nevada mining belt, Kansas, and Appalachia, and all have median home values under $125,000." },
  ],
};

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post Not Found" };

  const url = `${BASE_URL}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.publishedAt,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

// Dynamic import for each post's content component
async function getPostContent(slug: string) {
  try {
    const mod = await import(`./posts/${slug}`);
    return mod.default;
  } catch {
    return null;
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const Content = await getPostContent(slug);
  if (!Content) notFound();

  const postIndex = BLOG_POSTS.findIndex((p) => p.slug === slug);
  const prevPost = postIndex > 0 ? BLOG_POSTS[postIndex - 1] : null;
  const nextPost = postIndex < BLOG_POSTS.length - 1 ? BLOG_POSTS[postIndex + 1] : null;
  const faqs = FAQ_MAP[slug];
  const relatedCities = getRelatedCities(post);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.description,
          datePublished: post.publishedAt,
          dateModified: post.updatedAt || post.publishedAt,
          author: {
            "@type": "Person",
            name: "Matt James",
          },
          publisher: {
            "@type": "Organization",
            name: "Property Insights",
            url: BASE_URL,
          },
          mainEntityOfPage: `${BASE_URL}/blog/${post.slug}`,
        }}
      />
      {faqs && <FaqJsonLd questions={faqs} />}

      <Link
        href="/blog"
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; Blog
      </Link>

      <div className="mt-6 mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
          {post.title}
        </h1>
        <div className="flex items-center gap-3 text-xs text-muted">
          <time dateTime={post.publishedAt}>
            {new Date(post.publishedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <span>{post.readingTime}</span>
        </div>
      </div>

      <GuideViewSignal slug={post.slug} tags={post.tags}>
        <article className="prose-custom">
          <Content />
        </article>
      </GuideViewSignal>

      {/* Topic-matched CTA — only renders once the registry sets ctaVertical for this post */}
      {post.ctaVertical && (
        <div className="mt-10 pt-6 border-t border-border">
          <PartnerCta
            country={post.ctaCountry ?? "CA"}
            source="blog"
            surface={surfaceForVertical(post.ctaVertical)}
          preferVertical={post.ctaVertical}
            heading="Tools for this topic"
          />
        </div>
      )}

      {/* Browse analyzed listings */}
      <div className="mt-10 pt-6 border-t border-border">
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
          Browse analyzed listings
        </div>
        <div className="flex flex-wrap gap-2">
          {relatedCities.map((city) => (
            <Link
              key={city.slug}
              href={`/discover/${city.slug}`}
              className="px-3.5 py-1.5 text-xs font-medium rounded-full border border-border text-muted hover:text-foreground hover:border-foreground/20 transition-all"
            >
              {city.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Prev / Next */}
      {(prevPost || nextPost) && (
        <nav className="mt-6 pt-6 border-t border-border flex justify-between">
          {prevPost ? (
            <Link
              href={`/blog/${prevPost.slug}`}
              className="text-sm text-muted hover:text-foreground transition-colors max-w-[45%]"
            >
              &larr; {prevPost.title}
            </Link>
          ) : <span />}
          {nextPost ? (
            <Link
              href={`/blog/${nextPost.slug}`}
              className="text-sm text-muted hover:text-foreground transition-colors text-right max-w-[45%]"
            >
              {nextPost.title} &rarr;
            </Link>
          ) : <span />}
        </nav>
      )}
    </main>
  );
}
