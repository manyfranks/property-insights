/**
 * components/insurance/landing/hero.tsx
 *
 * Centered hero variant from the approved design (insurance-landing.dc.html)
 * — headline with a highlighter mark under "forms", subhead, the
 * address-first pill widget (client island — src/components/insurance/insurance-landing-form.tsx),
 * and a status row with the region picker. Server component; the only
 * client-side piece is the form itself.
 *
 * The design's "Insurance · reimagined for property" eyebrow badge has been
 * removed per owner directive — nothing replaces it. Top padding is bumped
 * (pt-14/pt-16 → pt-20/pt-24, matching the ~80/96px "chapter" padding used
 * elsewhere in the design, e.g. the coverage-tiles and data-moat sections'
 * `padding:96px 32px`) so the hero keeps its vertical rhythm instead of
 * reading as decapitated with the h1 jammed against the header.
 */

import InsuranceLandingForm from "@/components/insurance/insurance-landing-form";
import type { InsuranceLine } from "@/config/affiliate-vendors";

export const HERO_ANCHOR_ID = "insurance-hero";

export default function Hero({
  usStates,
  initialGeo,
  initialLine,
  intakeEnabled,
}: {
  usStates: { code: string; name: string }[];
  initialGeo: { country: string | null; region: string | null };
  initialLine?: InsuranceLine;
  intakeEnabled: boolean;
}) {
  return (
    <section className="relative overflow-hidden [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]">
      <div className="max-w-4xl mx-auto px-6 pt-20 pb-20 sm:pt-24 sm:pb-24 text-center">
        <h1 className="text-4xl sm:text-5xl md:text-[64px] leading-[1.02] md:leading-[0.98] font-semibold tracking-tight text-balance mx-auto max-w-3xl">
          Forget everything you know about insurance{" "}
          <span className="relative whitespace-nowrap">
            forms
            <span
              className="absolute -left-[2%] -right-[2%] bottom-1.5 h-3.5 -z-10 rounded-[3px]"
              style={{ background: "#7fd8cc", opacity: 0.55 }}
              aria-hidden="true"
            />
          </span>
          .
        </h1>

        <p className="mt-5 text-lg sm:text-xl text-muted font-medium">
          Instant profile. Licensed brokers. Zero cold-calls.
        </p>

        <div className="mt-8 max-w-xl mx-auto">
          <InsuranceLandingForm
            usStates={usStates}
            initialGeo={initialGeo}
            initialLine={initialLine}
            intakeEnabled={intakeEnabled}
            variant="teal"
            anchorId={HERO_ANCHOR_ID}
          />
        </div>
      </div>
    </section>
  );
}
