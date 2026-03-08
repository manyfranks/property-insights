import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Usage Policy",
  description:
    "How Property Insights handles property data, assessment information, and user analytics. Our commitment to transparency and responsible data practices.",
  alternates: { canonical: "/data-usage" },
};

export default function DataUsagePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Data Usage Policy</h1>
      <p className="text-sm text-muted mb-10">Last updated: March 8, 2026</p>

      <div className="space-y-8 text-sm text-muted leading-relaxed">
        <section>
          <h2 className="text-base font-medium text-foreground mb-2">How We Use Property Data</h2>
          <p>
            Property Insights aggregates publicly available data from government assessment
            authorities and third-party listing services to provide analysis for home buyers. Here
            is a breakdown of the data we work with and how we handle it.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Public Assessment Data</h2>
          <p>
            Government property assessment values are public records. We retrieve assessment data
            from BC Assessment, the City of Calgary, and the City of Edmonton through their
            publicly accessible databases and APIs. This data includes assessed land values, building
            values, and assessment years.
          </p>
          <p className="mt-3">
            Ontario assessment data comes from publicly available MPAC records. We cache this data
            to reduce load on public systems and to speed up our analysis.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Listing Data</h2>
          <p>
            We collect active residential listing data including addresses, prices, property details,
            days on market, and listing descriptions from third-party real estate platforms. This
            data powers our scoring models and offer analysis.
          </p>
          <p className="mt-3">
            Listings are refreshed daily and stale or delisted properties are automatically removed
            through our freshness checks.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">AI-Generated Analysis</h2>
          <p>
            We use large language models to generate narrative analysis for each property. These
            models process listing descriptions, market signals, and assessment data to produce
            human-readable summaries. The AI does not have access to your personal information
            when generating these analyses.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Aggregated Insights</h2>
          <p>
            We may produce and publish aggregated, anonymized market insights based on the data we
            collect. This includes statistics like average assessment-to-listing ratios by city,
            average days on market trends, and scoring distribution across regions.
          </p>
          <p className="mt-3">
            Aggregated insights never identify individual users, specific user searches, or
            individual browsing behavior. They are derived from property-level data that is already
            publicly available.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">User Behavioral Data</h2>
          <p>
            When you consent to analytics tracking, we record your property views, assessment
            requests, search patterns, and city interests. This data is stored per-user in encrypted
            cloud databases and is used for two purposes:
          </p>
          <ul className="list-disc list-inside space-y-1.5 mt-3">
            <li>
              <span className="text-foreground font-medium">Improving the service.</span> Your usage
              patterns help us understand which features are most valuable and where our models can
              be improved.
            </li>
            <li>
              <span className="text-foreground font-medium">Facilitating partner connections.</span> When
              you choose to connect with a mortgage broker or real estate agent, your behavioral
              profile (cities of interest, price range, properties viewed) helps ensure the
              connection is relevant. This sharing only happens when you explicitly request it.
            </li>
          </ul>
          <p className="mt-3">
            We retain up to 200 events per user. Older events are automatically trimmed.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">What We Do Not Sell</h2>
          <p className="mb-3">
            We want to be explicit about what we will never do with your data:
          </p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              We do not sell user data in bulk to third parties, data brokers, or advertisers.
            </li>
            <li>
              We do not share your email address, search history, or behavioral data with any
              third party without your explicit, per-action consent.
            </li>
            <li>
              We do not use targeted advertising, retargeting, or third-party ad networks.
            </li>
            <li>
              We do not sell or share data with partners behind the scenes. Every partner
              connection requires you to click a button, read what will be shared, and confirm.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">How Partner Connections Work</h2>
          <p>
            Property Insights may connect you with licensed mortgage brokers, real estate agents,
            home inspectors, and insurance providers. Here is exactly how this works:
          </p>
          <ol className="list-decimal list-inside space-y-1.5 mt-3">
            <li>You click a &quot;Connect&quot; button on a property page.</li>
            <li>We show you exactly what information will be shared (your email and the property details).</li>
            <li>You confirm by clicking &quot;Yes, connect me.&quot;</li>
            <li>Only then do we share your information with the relevant professional.</li>
          </ol>
          <p className="mt-3">
            We may receive referral fees from these professionals. This does not affect your
            property analysis or offer recommendations, which are generated independently.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Legal Framework</h2>
          <p>
            Our data practices comply with PIPEDA at the federal level, BC PIPA for British Columbia
            users, and Alberta PIPA for Alberta users. Ontario users are protected under PIPEDA
            directly. These laws require that we collect only what is necessary, use it only for
            stated purposes, and protect it with appropriate safeguards.
          </p>
          <p className="mt-3">
            We take these obligations seriously. If Canadian privacy law changes or new provincial
            legislation is introduced, we will update our practices and this policy accordingly.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Data Storage and Security</h2>
          <p>
            Property and assessment data is stored in encrypted cloud databases (Upstash Redis on
            Vercel infrastructure). Access is restricted to application-level operations. We do not
            maintain local or unencrypted copies of user data.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Questions</h2>
          <p>
            If you have questions about how we use data, contact us at{" "}
            <a
              href="mailto:privacy@propertyinsights.xyz"
              className="text-foreground hover:underline"
            >
              privacy@propertyinsights.xyz
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
