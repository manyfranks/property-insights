/**
 * components/insurance/landing/trust-bar.tsx
 *
 * Three-card trust strip from the design file's unused `trustCards` data —
 * see src/components/insurance/landing/data.ts (TRUST_CARDS), which this
 * renders verbatim (already run past scripts/check-insurance-copy.ts —
 * these phrases matched the compliance vocabulary already shipped in
 * coverage-profile-wizard.tsx's consent text with no edits needed).
 */

import { TRUST_CARDS } from "./data";

export default function TrustBar() {
  return (
    <section className="border-t border-b border-border bg-[#fbfbfa]">
      <div className="max-w-5xl mx-auto px-6 py-10 grid gap-6 sm:grid-cols-3">
        {TRUST_CARDS.map((card) => (
          <div key={card.title}>
            <div className="text-[15px] font-semibold tracking-tight mb-1.5">{card.title}</div>
            <p className="text-[13px] text-muted leading-relaxed">{card.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
