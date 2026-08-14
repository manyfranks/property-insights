/**
 * components/insurance/landing/switch-section.tsx
 *
 * "Already insured? We'll help you switch" (mint section) — built faithfully
 * from the design, but parked behind stageAtLeast("switch")
 * (src/config/insurance-stage.ts — NEXT_PUBLIC_INSURANCE_STAGE, which
 * supersedes the old NEXT_PUBLIC_INSURANCE_SWITCH flag; default stage is
 * "off"). This flow isn't licensed yet, so it must not ship until the
 * rollout dial is explicitly turned to "switch". Kept under
 * src/components/insurance/landing/ (not deleted/excluded) specifically so
 * scripts/check-insurance-copy.ts still scans this copy even while it's
 * dark.
 */

import { stageAtLeast } from "@/config/insurance-stage";

const SWITCH_POINTS = [
  "Tell us when your current policy renews",
  "We time your match so your coverage never lapses",
  "Your new licensed broker handles the cancellation",
];

export function isSwitchSectionEnabled(): boolean {
  return stageAtLeast("switch");
}

export default function SwitchSection() {
  if (!isSwitchSectionEnabled()) return null;

  return (
    <section className="bg-[#eef6f4]">
      <div className="max-w-5xl mx-auto px-6 py-20 sm:py-24 grid gap-14 lg:grid-cols-2 items-center">
        <div>
          <span className="font-mono text-xs tracking-wide text-cta-accent">Switching is easy</span>
          <h2 className="mt-3 text-3xl sm:text-[40px] leading-tight font-semibold tracking-tight text-balance">
            Already insured? We&apos;ll help you switch.
          </h2>
          <p className="mt-5 text-[17px] text-gray-600 leading-relaxed max-w-md">
            Tell us when your current policy renews. We&apos;ll time your match so a licensed broker can line up
            better coverage before it lapses — and handle the cancellation with your old insurer.
          </p>
          <div className="flex items-center gap-4 flex-wrap mt-8">
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-cta-accent hover:bg-cta-accent-hover text-white text-sm font-semibold px-7 py-3.5 transition-colors"
            >
              Start a switch →
            </button>
            <span className="text-sm text-muted">No cancellation fees from us</span>
          </div>
        </div>

        <div className="bg-white border border-[#dbe7e4] rounded-[22px] px-7 py-6 shadow-[0_28px_64px_-30px_rgba(26,26,46,0.45)]">
          <div className="font-mono text-[10px] uppercase tracking-wide text-muted mb-2.5">
            When does your policy renew?
          </div>
          <div className="flex items-center gap-3 border border-border rounded-2xl px-4 py-3.5 bg-[#fbfbfa]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" stroke="#0f766e" strokeWidth="1.8" />
              <path d="M3 9h18M8 3v4M16 3v4" stroke="#0f766e" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="text-[15px] font-semibold flex-1">Coverage renewal date</span>
            <span className="font-mono text-[9px] uppercase tracking-wide text-cta-accent bg-cta-accent/10 rounded-full px-2.5 py-1">
              We&apos;ll time it
            </span>
          </div>
          <div className="h-px bg-border my-5" />
          <div className="flex flex-col gap-3.5">
            {SWITCH_POINTS.map((point) => (
              <div key={point} className="flex items-start gap-3">
                <span className="shrink-0 inline-flex w-[22px] h-[22px] rounded-full bg-cta-accent/10 items-center justify-center mt-0.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      stroke="#0f766e"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-[14.5px] text-gray-700 leading-snug">{point}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
