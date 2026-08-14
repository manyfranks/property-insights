/**
 * components/insurance/landing/how-it-works.tsx
 *
 * SSR-only editorial 3-step section (src/components/insurance/landing/data.ts's
 * HOW_STEPS — see that file's comment for how the "six questions" count was
 * verified against the real wizard). The CTA is a plain anchor back up to
 * the hero's address pill (src/components/insurance/landing/hero.tsx) rather
 * than a second form — no client JS needed here.
 */

import Link from "next/link";
import { HOW_STEPS } from "./data";
import { HERO_ANCHOR_ID } from "./hero";

export default function HowItWorks({ waitlistMode }: { waitlistMode: boolean }) {
  return (
    <section className="py-20 sm:py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">Three steps. About a minute.</h2>
        <p className="text-[16px] text-muted mb-12 max-w-lg">The paperwork&apos;s mostly done before you start.</p>

        <div className="grid gap-10 sm:grid-cols-3">
          {HOW_STEPS.map((step) => (
            <div key={step.num}>
              <div className="font-mono text-sm font-semibold text-cta-accent mb-4">{step.num}</div>
              <div className="h-0.5 bg-border mb-5 relative">
                <span className="absolute left-0 top-0 h-0.5 w-8 bg-cta-accent" />
              </div>
              <div className="text-lg font-semibold tracking-tight mb-2">{step.title}</div>
              <p className="text-[14.5px] text-muted leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-11 flex items-center gap-4 flex-wrap">
          <Link
            href={`#${HERO_ANCHOR_ID}`}
            className="inline-flex items-center rounded-full bg-cta-accent hover:bg-cta-accent-hover text-white text-sm font-semibold px-7 py-3.5 transition-colors"
          >
            {waitlistMode ? "Join the waitlist →" : "Build your coverage profile →"}
          </Link>
          <span className="text-sm text-muted">Free &middot; about a minute &middot; no obligation</span>
        </div>
      </div>
    </section>
  );
}
