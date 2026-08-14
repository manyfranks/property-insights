/**
 * components/insurance/landing/hero.tsx
 *
 * Centered hero variant from the approved design (insurance-landing.dc.html)
 * — headline with a highlighter mark under "insurance", subhead, the
 * address-first pill widget (client island — src/components/insurance/insurance-landing-form.tsx),
 * and a status row with the region picker. Server component; the only
 * client-side piece is the form itself.
 *
 * Fills the viewport below the h-14 (56px) global header so nothing from
 * the next section is visible without scrolling — see the header markup in
 * src/app/layout.tsx for that 56px figure; keep them in sync if the header
 * height ever changes. A flex column, not absolute positioning: the pill
 * widget centers in the remaining space and PartnerStrip sits as the last
 * flex child, which pins it to the bottom of the viewport without needing
 * to know the centered content's height.
 *
 * The pill's own "availability varies / licensed broker only" disclaimer
 * (src/components/insurance/insurance-landing-form.tsx) is suppressed here
 * via `hideLegalese` — that compliance line renders once, in its own strip
 * right after this section (see insurance-landing.tsx), not inside the
 * hero at all. FinalCta's copy of the form still renders its own (see that
 * file).
 *
 * The design's "Insurance · reimagined for property" eyebrow badge has been
 * removed per owner directive — nothing replaces it. Top padding is bumped
 * (pt-14/pt-16 → pt-20/pt-24, matching the ~80/96px "chapter" padding used
 * elsewhere in the design, e.g. the coverage-tiles and data-moat sections'
 * `padding:96px 32px`) so the hero keeps its vertical rhythm instead of
 * reading as decapitated with the h1 jammed against the header.
 */

import InsuranceLandingForm from "@/components/insurance/insurance-landing-form";
import PartnerStrip from "./partner-strip";
import type { InsuranceLine, Country } from "@/config/affiliate-vendors";

export const HERO_ANCHOR_ID = "insurance-hero";

export default function Hero({
  usStates,
  initialGeo,
  initialLine,
  intakeEnabled,
  country,
}: {
  usStates: { code: string; name: string }[];
  initialGeo: { country: string | null; region: string | null };
  initialLine?: InsuranceLine;
  intakeEnabled: boolean;
  country: Country;
}) {
  return (
    <section className="relative overflow-hidden flex flex-col min-h-[calc(100vh-56px)] [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]">
      <div className="flex-1 flex items-center">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center w-full">
          <h1 className="text-4xl sm:text-5xl md:text-[64px] leading-[1.02] md:leading-[0.98] font-semibold tracking-tight text-balance mx-auto max-w-3xl">
            Forget everything you know about{" "}
            <span className="relative whitespace-nowrap">
              insurance
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
              hideLegalese
            />
          </div>
        </div>
      </div>

      <PartnerStrip country={country} />
    </section>
  );
}
