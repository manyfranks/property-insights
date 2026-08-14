/**
 * components/insurance/landing/faq.tsx
 *
 * "The honest answers" FAQ — native <details>/<summary>, SSR text only, no
 * client JS. Renders from FAQ_ITEMS (src/components/insurance/landing/data.ts),
 * the same data src/app/insurance/page.tsx feeds into FaqJsonLd so the
 * visible copy and the structured data can never drift apart.
 */

import { FAQ_ITEMS } from "./data";

export default function Faq() {
  return (
    <section className="[background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px] py-20 sm:py-24 px-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-center mb-10">The honest answers</h2>
        <div className="flex flex-col gap-3">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group bg-white border border-border rounded-2xl overflow-hidden">
              <summary className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer text-[16px] font-semibold tracking-tight list-none [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span>
                <span className="shrink-0 text-cta-accent text-xl leading-none transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="text-[14.5px] text-muted leading-relaxed px-6 pb-5">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
