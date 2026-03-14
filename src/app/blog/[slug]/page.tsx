import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPost, getRelatedCities, BLOG_POSTS } from "@/lib/blog";
import { BASE_URL } from "@/lib/seo";
import { JsonLd, FaqJsonLd } from "@/components/json-ld";

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
            {new Date(post.publishedAt).toLocaleDateString("en-CA", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <span>{post.readingTime}</span>
        </div>
      </div>

      <article className="prose-custom">
        <Content />
      </article>

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
