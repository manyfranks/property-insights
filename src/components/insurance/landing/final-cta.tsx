/**
 * components/insurance/landing/final-cta.tsx
 *
 * Full-bleed teal final CTA. Same form component as the hero (variant
 * "navy" swaps the pill's button color for contrast against the teal
 * background, matching the design). The form itself already renders the
 * dynamic "availability varies / licensed broker only" disclaimer at its
 * bottom (src/components/insurance/insurance-landing-form.tsx) — not
 * repeated here.
 */

import InsuranceLandingForm from "@/components/insurance/insurance-landing-form";
import type { InsuranceLine } from "@/config/affiliate-vendors";

export default function FinalCta({
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
    <section className="[background-image:radial-gradient(circle,rgba(255,255,255,.055)_1px,transparent_1px)] [background-size:22px_22px] bg-cta-accent text-white">
      <div className="max-w-2xl mx-auto px-6 py-20 sm:py-24 text-center">
        <h2 className="text-4xl sm:text-[52px] leading-[1.02] font-semibold tracking-tight">
          Ready to skip the forms?
        </h2>
        <p className="mt-4 mb-9 text-lg text-white/85 max-w-md mx-auto">
          Enter an address. If we know it, it&apos;s already filled in — and a licensed broker takes it from there.
        </p>

        <div className="max-w-xl mx-auto [&_input]:text-foreground">
          <InsuranceLandingForm
            usStates={usStates}
            initialGeo={initialGeo}
            initialLine={initialLine}
            intakeEnabled={intakeEnabled}
            variant="navy"
          />
        </div>
      </div>
    </section>
  );
}
