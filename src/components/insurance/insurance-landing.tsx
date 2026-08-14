/**
 * components/insurance/insurance-landing.tsx
 *
 * Server component rendering the /insurance landing page content (hero,
 * address-first form, how-it-works strip). Kept under
 * src/components/insurance/ so every user-facing string is scanned by
 * scripts/check-insurance-copy.ts; app/insurance/page.tsx stays a thin
 * flag-gated shell.
 */

import InsuranceLandingForm from "./insurance-landing-form";

const STEPS: [string, string][] = [
  ["1 · Confirm the property", "We fill in what we know — you fix anything that's off."],
  ["2 · Answer six questions", "Occupancy, claims, coverage dates — what no dataset can supply."],
  ["3 · Get matched", "A licensed broker for your region picks it up, details already on file."],
];

export default function InsuranceLanding({
  usStates,
  initialGeo,
}: {
  usStates: { code: string; name: string }[];
  /** Visitor geo read server-side (per request) from Vercel's edge headers — see app/insurance/page.tsx. */
  initialGeo: { country: string | null; region: string | null };
}) {
  return (
    <main className="max-w-2xl mx-auto px-6 py-10 sm:py-14">
      <div className="text-xs uppercase tracking-widest text-muted mb-2">Insurance</div>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">Protect any property</h1>
      <p className="text-sm text-muted leading-relaxed mb-6 max-w-lg">
        Enter an address and pick a coverage type. If we already track the property, its details come
        pre-filled — either way, you&apos;ll build a coverage profile and get matched with a licensed broker
        for your region.
      </p>

      <InsuranceLandingForm usStates={usStates} initialGeo={initialGeo} />

      <div className="mt-8 grid sm:grid-cols-3 gap-3">
        {STEPS.map(([title, body]) => (
          <div key={title} className="border border-border rounded-xl bg-white p-4">
            <div className="text-sm font-medium mb-1">{title}</div>
            <p className="text-xs text-muted leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
