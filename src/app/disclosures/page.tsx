import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Licensing & Disclosures",
  description:
    "What Property Insights is and isn't, how insurance matches work, and how partner compensation is disclosed.",
  alternates: { canonical: "/disclosures" },
};

export default function DisclosuresPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Licensing &amp; disclosures</h1>
      <p className="text-sm text-muted mb-10">Last updated: August 14, 2026</p>

      <div className="space-y-8 text-sm text-muted leading-relaxed">
        <section>
          <h2 className="text-base font-medium text-foreground mb-2">What Property Insights is</h2>
          <p>
            Property Insights is a property-intelligence platform. We help home buyers and owners
            understand a property&apos;s value, market position, and coverage needs using public
            assessment data, listing data, and our own analysis.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">What Property Insights is not</h2>
          <p>
            Property Insights is not a licensed insurer or insurance broker. We do not sell, quote,
            or bind insurance policies of any kind. Nothing on this site is an offer of insurance
            or a substitute for advice from a licensed insurance professional.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">How insurance matches work</h2>
          <p>
            Where we surface an insurance coverage profile or a match, the connection is made to a
            third-party insurance provider, such as an agency or brokerage. Property Insights is not
            the provider of record and does not quote, bind, or service coverage. The provider you
            continue to is responsible for any quote, advice, policy, or service it provides.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Referral fees</h2>
          <p>
            Property Insights may receive compensation through a disclosed partner arrangement when a match
            leads to a policy. Any such arrangement is disclosed before a match is made, and it does not
            change the price you&apos;re quoted or the outcome of our property analysis.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Availability</h2>
          <p>
            Insurance matching availability varies by province and state, and some regions are
            excluded. Where we can&apos;t offer a sponsored match in your region, we&apos;ll point
            you to an appropriate insurance professional who can help instead.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Questions</h2>
          <p>
            If you have questions about how a match or referral works, contact us at{" "}
            <a
              href="mailto:insights@mail.propertyinsights.xyz"
              className="text-foreground hover:underline"
            >
              insights@mail.propertyinsights.xyz
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
