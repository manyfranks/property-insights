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
      <p className="text-sm text-muted mb-10">Last updated: August 7, 2026</p>

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
          <p className="mt-3">
            If you are a resident of the United States, US state privacy laws also apply to our
            collection and use of your personal information, in addition to the Canadian framework
            described throughout this policy. See{" "}
            <span className="text-foreground font-medium">United States State Privacy Rights</span>{" "}
            below for the rights and choices available to you under those laws.
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
              properties viewed, and time on site, collected through a cookieless, privacy-focused
              analytics service.
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
              With your consent, to generate aggregated insights that help us improve recommendations
              and understand market activity in the cities we cover.
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
          <h2 className="text-base font-medium text-foreground mb-2">Affiliate Links</h2>
          <p>
            Property pages include outbound links to third-party services such as mortgage comparison
            tools, pre-approval providers, and home insurance platforms. When you click these links,
            you leave Property Insights and interact directly with the third-party service on their
            own site under their own privacy policy.
          </p>
          <p className="mt-3">
            We do not share your personal information (email, search history, or behavioral data)
            with affiliate partners. We may receive referral fees when you use a service through
            these links. This does not affect the analysis or recommendations you see on Property
            Insights.
          </p>
          <p className="mt-3">
            If you would prefer that your affiliate link clicks not be attributed back to you, visit{" "}
            <a href="/privacy-choices" className="text-foreground hover:underline">
              Your Privacy Choices
            </a>{" "}
            to opt out.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">What We Don&apos;t Do</h2>
          <ul className="list-disc list-inside space-y-1.5">
            <li>We do not sell your personal information in bulk to data brokers or advertisers.</li>
            <li>We do not share your data with advertisers or ad networks.</li>
            <li>We do not use targeted advertising or third-party ad trackers.</li>
            <li>We do not share your information with partners without your explicit, per-action consent.</li>
            <li>We do not require partner sharing consent as a condition of using the service.</li>
          </ul>
          <p className="mt-3">
            We do not sell personal information for money. However, some US states define
            &quot;sale&quot; and &quot;sharing&quot; broadly enough that attributing an affiliate
            link click back to a visitor could qualify, even though no personal information
            changes hands with the partner beyond the click itself. Rather than rely on a narrow
            reading of those definitions, we treat affiliate click attribution as a share and give
            you a way to opt out of it — see{" "}
            <span className="text-foreground font-medium">United States State Privacy Rights</span>{" "}
            below.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Third-Party Services</h2>
          <p className="mb-3">We use the following categories of services to operate Property Insights:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <span className="text-foreground font-medium">Hosting and analytics</span> provided by
              a privacy-focused platform that does not use cookies or track users across sites.
            </li>
            <li>
              <span className="text-foreground font-medium">Authentication</span> managed by a
              third-party identity provider. Your email and login credentials are handled under
              their privacy policy.
            </li>
            <li>
              <span className="text-foreground font-medium">Transactional email</span> for delivering
              assessment results to your inbox.
            </li>
            <li>
              <span className="text-foreground font-medium">Cloud databases</span> for storing
              listing data, assessment data, and user behavioral data in encrypted storage.
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
          <h2 className="text-base font-medium text-foreground mb-2">Your Rights Under Canadian Law</h2>
          <p className="mb-3">Under PIPEDA, BC PIPA, and Alberta PIPA, you have the right to:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>Access the personal information we hold about you.</li>
            <li>Request correction of any inaccurate information.</li>
            <li>Withdraw your consent for data collection at any time.</li>
            <li>Request deletion of your personal information.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, contact us at the address below. We will respond within
            30 days. (If you are a US resident, see{" "}
            <span className="text-foreground font-medium">United States State Privacy Rights</span>{" "}
            below for the response timeline that applies to your requests instead.)
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">United States State Privacy Rights</h2>
          <p className="mb-4">
            If you are a resident of the United States, this section describes the rights and
            choices available to you under applicable state privacy laws (such as the California
            Consumer Privacy Act and comparable laws in other states), in addition to — not in
            place of — the rest of this policy.
          </p>

          <h3 className="text-sm font-medium text-foreground mb-2">
            Categories of personal information we collect
          </h3>
          <div className="overflow-x-auto my-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium text-foreground">Category</th>
                  <th className="text-left py-2 pr-4 font-medium text-foreground">Examples</th>
                  <th className="text-left py-2 pr-4 font-medium text-foreground">Source</th>
                  <th className="text-left py-2 font-medium text-foreground">Purpose(s)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border align-top">
                  <td className="py-2 pr-4 text-foreground font-medium">Identifiers</td>
                  <td className="py-2 pr-4">Email address, user ID, account profile</td>
                  <td className="py-2 pr-4">
                    Provided by you when you create an account
                  </td>
                  <td className="py-2">
                    Account creation, sign-in, delivering requested assessments, support
                  </td>
                </tr>
                <tr className="border-b border-border align-top">
                  <td className="py-2 pr-4 text-foreground font-medium">
                    Internet or other electronic network activity
                  </td>
                  <td className="py-2 pr-4">
                    Pages visited, properties viewed, searches run, affiliate link clicks
                  </td>
                  <td className="py-2 pr-4">
                    Recorded automatically as you use the service (account activity only for
                    signed-in, consented users; affiliate-link clicks are logged in aggregate
                    with no direct identifiers for signed-out visitors)
                  </td>
                  <td className="py-2">
                    Improving recommendations and scoring models; measuring which affiliate
                    referrals convert, in aggregate; with consent, connecting you with partner
                    professionals
                  </td>
                </tr>
                <tr className="align-top">
                  <td className="py-2 pr-4 text-foreground font-medium">
                    Geolocation-lite (property-level, not device GPS)
                  </td>
                  <td className="py-2 pr-4">Addresses and cities you search for or view</td>
                  <td className="py-2 pr-4">Search requests you submit</td>
                  <td className="py-2">
                    Returning assessment results for the address requested; aggregate,
                    city-level market interest
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mb-4">
            We do not collect precise device geolocation (no GPS or lat/long from your browser).
            We do not collect Social Security numbers, health information, biometric data, or
            other categories that state laws typically treat as sensitive personal information.
          </p>

          <h3 className="text-sm font-medium text-foreground mb-2">Your rights</h3>
          <p className="mb-3">Depending on your state of residence, you have the right to:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <span className="text-foreground font-medium">Know and access</span> the categories
              and specific pieces of personal information we hold about you.
            </li>
            <li>
              <span className="text-foreground font-medium">Correct</span> inaccurate personal
              information.
            </li>
            <li>
              <span className="text-foreground font-medium">Delete</span> personal information we
              hold about you.
            </li>
            <li>
              <span className="text-foreground font-medium">Port</span> your data — receive a copy
              in a portable format.
            </li>
            <li>
              <span className="text-foreground font-medium">Opt out</span> of the &quot;sale&quot;
              or &quot;sharing&quot; of your personal information and of targeted advertising.
            </li>
            <li>
              <span className="text-foreground font-medium">Non-discrimination</span> — we will not
              deny you access to Property Insights, charge you a different price, or provide a
              lesser level of service because you exercised any of these rights.
            </li>
          </ul>

          <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
            &quot;Sale&quot; and &quot;sharing&quot; of personal information
          </h3>
          <p>
            We do not sell personal information for money. However, some states define
            &quot;sale&quot; and &quot;sharing&quot; broadly enough to reach the attribution of an
            affiliate link click back to a visitor, even though no personal information is
            transferred to the partner beyond the click itself. We take the conservative position
            that this attribution is a share for opt-out purposes, and we offer an opt-out
            regardless of whether your specific state&apos;s definition would technically reach it.
          </p>

          <h3 className="text-sm font-medium text-foreground mt-4 mb-2">How to opt out</h3>
          <p>
            Visit{" "}
            <a href="/privacy-choices" className="text-foreground hover:underline">
              Do Not Sell or Share My Personal Information
            </a>{" "}
            to opt out at any time. We also honor the Global Privacy Control (GPC) signal: if your
            browser or a browser extension sends GPC, we automatically apply it as an opt-out of
            sale/sharing for that browser, with no action required from you, and the{" "}
            <a href="/privacy-choices" className="text-foreground hover:underline">
              privacy choices
            </a>{" "}
            page shows a confirmation when a GPC signal has been detected and applied.
          </p>

          <h3 className="text-sm font-medium text-foreground mt-4 mb-2">
            Exercising your other rights
          </h3>
          <p>
            To exercise your right to know, access, correct, delete, or port your personal
            information, email{" "}
            <a
              href="mailto:privacy@propertyinsights.xyz"
              className="text-foreground hover:underline"
            >
              privacy@propertyinsights.xyz
            </a>
            . We will verify your identity before acting on your request, and we will respond
            within 45 days of a verifiable request. If we need more time, we may extend the
            response period by another 45 days (90 days total) and will notify you of the
            extension and the reason for it within the initial 45-day period. An authorized agent
            may submit a request on your behalf.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Cookies</h2>
          <p>
            We use only essential cookies required for authentication, provided by our
            authentication provider, and a privacy-preference cookie that stores your opt-out
            choice from{" "}
            <a href="/privacy-choices" className="text-foreground hover:underline">
              Your Privacy Choices
            </a>
            . We do not use advertising cookies, tracking pixels, or third-party analytics
            cookies. Our analytics service operates without cookies.
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
