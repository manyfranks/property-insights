/**
 * components/insurance/landing/rollout-strip.tsx
 *
 * Five-column rollout strip (src/components/insurance/landing/data.ts's
 * ROLLOUT_COLUMNS) plus the honest geo-detection note. "Most provinces"
 * rather than "Rest of Canada" — QC and NB are permanently excluded
 * (INSURANCE_STATE_EXCLUSIONS), not just "not yet," so a nationwide claim
 * there would be false.
 */

import { ROLLOUT_COLUMNS } from "./data";

export default function RolloutStrip({ regionLabel, countryLabel }: { regionLabel: string; countryLabel: string }) {
  const geoNote = `We detect your region automatically from your connection — you're seeing ${regionLabel}, ${countryLabel}. Switch it any time from the address pill above.`;

  return (
    <section className="py-20 sm:py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-9">
          <h2 className="text-3xl sm:text-[40px] font-semibold tracking-tight">Live in BC. Rolling out fast.</h2>
          <p className="mt-3 text-[15px] text-muted max-w-xl">{geoNote}</p>
        </div>
        <div className="flex flex-wrap border border-border rounded-[20px] overflow-hidden">
          {ROLLOUT_COLUMNS.map((col) => (
            <div
              key={col.label}
              className={`flex-1 min-w-[160px] border-r border-border/70 last:border-r-0 px-6 py-6 ${
                col.live ? "bg-[#f3faf8]" : "bg-white"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full inline-block ${col.live ? "bg-cta-accent" : "bg-gray-300"}`} />
                <span
                  className={`font-mono text-[10px] uppercase tracking-wide ${
                    col.live ? "text-cta-accent" : "text-muted"
                  }`}
                >
                  {col.status}
                </span>
              </div>
              <div className="text-[16px] font-semibold">{col.label}</div>
              <div className="text-[13px] text-muted mt-0.5">{col.country}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
