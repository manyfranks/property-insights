/**
 * components/insurance/landing/availability-note.tsx
 *
 * The "availability varies / licensed broker only" compliance disclaimer,
 * as its own thin strip right after Hero (see insurance-landing.tsx) — not
 * inside the hero itself. The hero's own pill widget suppresses this same
 * line via `hideLegalese` (src/components/insurance/insurance-landing-form.tsx)
 * so it isn't shown twice back to back.
 */

export default function AvailabilityNote() {
  return (
    <div className="max-w-[1200px] mx-auto px-8 py-4">
      <p className="text-xs leading-relaxed text-center text-muted">
        Availability varies by region. You&apos;ll only ever be matched with a licensed broker — Property Insights
        does not sell, quote, or bind insurance.
      </p>
    </div>
  );
}
