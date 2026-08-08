import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import PricingButtons from "@/components/pricing-buttons";
import { stripeConfigured, isPro } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Pricing — Free & Pro Plans",
  description:
    "Property Insights is free to use, with 15 assessments per day. Upgrade to Pro for unlimited assessments and priority access to new markets and features.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const { upgraded } = await searchParams;
  const configured = stripeConfigured();

  const { userId } = await auth();
  const pro = userId ? await isPro(userId) : false;

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <div className="text-center mb-8 sm:mb-14">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-3">
          Simple, transparent pricing.
        </h1>
        <p className="text-sm sm:text-base text-muted max-w-xl mx-auto">
          Start free. Upgrade when you need more assessments than a casual
          search turns up.
        </p>
      </div>

      {upgraded === "1" && (
        <div className="mb-8 sm:mb-10 border border-border rounded-xl p-4 bg-white text-center">
          <p className="text-sm text-green-700 font-medium">
            Thanks for upgrading — your Pro access will activate within a few moments.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Free */}
        <div className="border border-border rounded-xl p-5 sm:p-6 flex flex-col">
          <div className="mb-4">
            <h2 className="text-sm font-medium text-foreground mb-1">Free</h2>
            <div className="text-2xl font-semibold text-foreground">$0</div>
            <p className="text-xs text-muted mt-1">No credit card required</p>
          </div>
          <ul className="space-y-2 text-sm text-muted mb-6 flex-1">
            <li>15 assessments per day</li>
            <li>Full offer &amp; scoring analysis</li>
            <li>County market context</li>
            <li>Discover: browse pre-analyzed listings</li>
          </ul>
          <button
            disabled
            className="w-full px-5 py-2.5 text-sm font-medium rounded-full border border-border text-muted disabled:cursor-default"
          >
            {pro ? "Included in Pro" : "Your current plan"}
          </button>
        </div>

        {/* Pro */}
        <div className="border border-foreground rounded-xl p-5 sm:p-6 flex flex-col relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 text-[10px] uppercase tracking-wide font-medium bg-foreground text-white rounded-full">
            Pro
          </div>
          <div className="mb-4 mt-2">
            <h2 className="text-sm font-medium text-foreground mb-1">Pro</h2>
            <div className="text-2xl font-semibold text-foreground">
              $29<span className="text-sm font-normal text-muted">/month</span>
            </div>
            <p className="text-xs text-muted mt-1">Price may change before launch</p>
          </div>
          <ul className="space-y-2 text-sm text-muted mb-6 flex-1">
            <li>Unlimited assessments</li>
            <li>Everything in Free</li>
            <li>Priority access to new markets and features</li>
          </ul>
          <PricingButtons configured={configured} initialPro={pro} />
          <p className="text-xs text-muted mt-3 text-center">
            Secure checkout through our payment processor.
          </p>
        </div>
      </div>
    </main>
  );
}
