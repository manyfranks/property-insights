import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Property Insights collects, uses, and protects your personal information under PIPEDA and provincial privacy laws.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted mb-10">Last updated: March 8, 2026</p>

      <div className="space-y-8 text-sm text-muted leading-relaxed">
        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Overview</h2>
          <p>
            Property Insights (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the website at
            propertyinsights.xyz. This policy explains what personal information we collect, why we
            collect it, and how we handle it in compliance with Canada&apos;s Personal Information
            Protection and Electronic Documents Act (PIPEDA), British Columbia&apos;s Personal
            Information Protection Act (BC PIPA), and Alberta&apos;s Personal Information Protection
            Act (Alberta PIPA).
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">What We Collect</h2>
          <p className="mb-3">We collect the following personal information when you use our service:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <span className="text-foreground font-medium">Email address</span> when you sign up
              or request a property assessment.
            </li>
            <li>
              <span className="text-foreground font-medium">Property search queries</span> including
              addresses you search for.
            </li>
            <li>
              <span className="text-foreground font-medium">Usage data</span> such as pages visited,
              properties viewed, and time on site, collected through Vercel Analytics.
            </li>
          </ul>
          <p className="mt-3">
            If you consent to analytics tracking (via the consent banner shown on first sign-in), we
            also collect:
          </p>
          <ul className="list-disc list-inside space-y-1.5 mt-3">
            <li>
              <span className="text-foreground font-medium">Property view history</span> including
              which listings you view and how often.
            </li>
            <li>
              <span className="text-foreground font-medium">Assessment requests</span> including
              the addresses and cities you request analysis for.
            </li>
            <li>
              <span className="text-foreground font-medium">Interest signals</span> such as city
              subscriptions and price ranges you search within.
            </li>
          </ul>
          <p className="mt-3">
            This behavioral data is stored per-user in encrypted cloud databases and is used to
            improve our recommendations and, with your express consent, to connect you with
            relevant professionals (see Partner Connections below).
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Why We Collect It</h2>
          <p className="mb-3">We use your information for the following purposes:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>To deliver property assessments, offer analysis, and notifications you request.</li>
            <li>To improve the accuracy of our scoring and offer models.</li>
            <li>To understand how the site is used and identify areas for improvement.</li>
            <li>To respond to your inquiries or support requests.</li>
            <li>
              With your express consent, to connect you with mortgage brokers, real estate agents,
              home inspectors, and insurance providers who can assist with your purchase.
            </li>
          </ul>
          <p className="mt-3">
            We do not use your personal information for any purpose beyond what is described here
            without obtaining your consent first.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Consent and Your Choices</h2>
          <p className="mb-3">
            When you create an account, we present a consent banner with two options:
          </p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <span className="text-foreground font-medium">Accept all</span> enables analytics
              tracking and allows us to connect you with partner professionals when you request it.
            </li>
            <li>
              <span className="text-foreground font-medium">Analytics only</span> enables tracking
              to improve your experience, but we will not share your information with any
              third-party professionals.
            </li>
          </ul>
          <p className="mt-3">
            You can change your consent preferences at any time. Withdrawing consent does not affect
            your access to the core service. We never require consent to partner sharing as a
            condition of using Property Insights.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Partner Connections</h2>
          <p>
            When you click a &quot;Connect with a mortgage broker,&quot; &quot;Talk to an agent,&quot;
            or similar button on a property page, you are giving express consent for us to share your
            email address and the relevant property details with a licensed professional. We disclose
            exactly what will be shared before you confirm.
          </p>
          <p className="mt-3">
            This is the only circumstance in which we share your personal information with third
            parties for commercial purposes. We never share your data with partners without your
            explicit, per-action consent.
          </p>
          <p className="mt-3">
            Partners we may connect you with include licensed mortgage brokers, real estate agents,
            home inspectors, and home insurance providers operating in the provinces we cover
            (BC, Alberta, Ontario).
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">What We Don&apos;t Do</h2>
          <ul className="list-disc list-inside space-y-1.5">
            <li>We do not sell your personal information in bulk to third parties.</li>
            <li>We do not share your data with advertisers or ad networks.</li>
            <li>We do not use targeted advertising or third-party ad trackers.</li>
            <li>We do not share your information with partners without your explicit, per-action consent.</li>
            <li>We do not require partner sharing consent as a condition of using the service.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Third-Party Services</h2>
          <p className="mb-3">We use the following services to operate Property Insights:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <span className="text-foreground font-medium">Vercel</span> for hosting and analytics.
              Vercel&apos;s analytics are privacy-focused and do not use cookies or track users
              across sites.
            </li>
            <li>
              <span className="text-foreground font-medium">Clerk</span> for authentication. Your
              email and login credentials are managed by Clerk under their privacy policy.
            </li>
            <li>
              <span className="text-foreground font-medium">Resend</span> for transactional emails
              (assessment results delivered to your inbox).
            </li>
            <li>
              <span className="text-foreground font-medium">Upstash</span> for data storage. Listing
              and assessment data is stored in Upstash Redis.
            </li>
          </ul>
          <p className="mt-3">
            These services may process your data on servers located outside Canada, including in the
            United States. By using our service, you acknowledge this transfer.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Data Retention</h2>
          <p>
            We retain your email address and account information for as long as your account is
            active. Assessment requests and property analysis results are stored indefinitely to
            improve our service. You can request deletion of your data at any time by contacting us.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Your Rights</h2>
          <p className="mb-3">Under PIPEDA, BC PIPA, and Alberta PIPA, you have the right to:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>Access the personal information we hold about you.</li>
            <li>Request correction of any inaccurate information.</li>
            <li>Withdraw your consent for data collection at any time.</li>
            <li>Request deletion of your personal information.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, contact us at the address below. We will respond within
            30 days.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Cookies</h2>
          <p>
            We use only essential cookies required for authentication (provided by Clerk). We do not
            use advertising cookies, tracking pixels, or third-party analytics cookies. Vercel
            Analytics operates without cookies.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Changes will be posted on this page with an
            updated date. We encourage you to review this page periodically.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Contact</h2>
          <p>
            If you have questions about this privacy policy or want to exercise your rights, contact
            us at{" "}
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
