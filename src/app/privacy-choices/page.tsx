import type { Metadata } from "next";
import PrivacyChoicesPanel from "./privacy-choices-panel";

export const metadata: Metadata = {
  title: "Your Privacy Choices",
  description:
    "Opt out of the sale or sharing of your personal information, and see whether Property Insights has detected a Global Privacy Control signal from your browser.",
  alternates: { canonical: "/privacy-choices" },
};

export default function PrivacyChoicesPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Your Privacy Choices</h1>
      <p className="text-sm text-muted mb-10">
        Do Not Sell or Share My Personal Information
      </p>

      <div className="space-y-8 text-sm text-muted leading-relaxed">
        <section>
          <h2 className="text-base font-medium text-foreground mb-2">
            Do Not Sell or Share My Personal Information
          </h2>
          <p className="mb-4">
            Some US state privacy laws give you the right to opt out of the &quot;sale&quot; or
            &quot;sharing&quot; of your personal information — including, conservatively, the
            attribution of affiliate link clicks back to you or your browsing activity. The
            panel below shows your current status and lets you opt out (or back in).
          </p>
          <PrivacyChoicesPanel />
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">
            What opting out changes
          </h2>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              Affiliate links on property pages resolve to the partner&apos;s plain URL instead
              of a tracked affiliate link, and are no longer attributed to your click.
            </li>
            <li>
              Behavioral tracking (property views, searches, and similar usage events) stops
              being recorded for this browser.
            </li>
            <li>
              If you&apos;re signed in, we also turn off partner-sharing consent on your
              account to keep your account-level preference consistent with your browser-level
              choice.
            </li>
          </ul>
          <p className="mt-3">
            Opting out does not affect your ability to use Property Insights — assessments,
            search, and offer analysis work the same either way.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">
            Global Privacy Control (GPC)
          </h2>
          <p>
            Property Insights honors the Global Privacy Control browser signal. If your browser
            or a browser extension sends a GPC signal, we automatically treat it as a request to
            opt out of sale/share for that browser — no action needed on your part. The status
            panel above tells you whether a GPC signal was detected and confirms when it has
            been applied.
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">Per-browser, not per-person</h2>
          <p>
            This preference is stored in a cookie in this browser. If you opt out here and then
            visit from a different browser or device, you&apos;ll need to opt out there too,
            unless you&apos;re signed in — in which case we also record the choice on your
            account for partner-sharing consent (see above).
          </p>
        </section>

        <section>
          <h2 className="text-base font-medium text-foreground mb-2">
            Access, deletion, and correction requests
          </h2>
          <p>
            To request access to, deletion of, or correction of your personal information,
            contact us at{" "}
            <a
              href="mailto:privacy@propertyinsights.xyz"
              className="text-foreground hover:underline"
            >
              privacy@propertyinsights.xyz
            </a>
            . See our{" "}
            <a href="/privacy" className="text-foreground hover:underline">
              Privacy Policy
            </a>{" "}
            for more on how we handle your information.
          </p>
        </section>
      </div>
    </main>
  );
}
