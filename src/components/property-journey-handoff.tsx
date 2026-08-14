import Link from "next/link";
import {
  assessmentJourneyHref,
  type AssessmentGoal,
  type JourneyCapabilityStatus,
} from "@/lib/property-intelligence/journey";

const OPTIONS: Array<{
  goal: AssessmentGoal;
  label: string;
  detail: string;
}> = [
  { goal: "buy_home", label: "Buying as a home", detail: "Offer and valuation evidence" },
  { goal: "rental_investment", label: "Screening as a rental", detail: "Rent and gross-yield evidence" },
  { goal: "own_manage", label: "I own or manage it", detail: "Value, rent, and property context" },
  { goal: "explore", label: "Explore everything", detail: "Every supported insight" },
];

/**
 * Discover pages contain seed evidence, not the complete on-demand bundle.
 * This handoff lets the user select a goal in the current property-detail UX,
 * then deliberately starts the richer assessment flow for the exact listing.
 */
export default function PropertyJourneyHandoff({
  assessmentInput,
  goalStatuses,
}: {
  assessmentInput: string;
  goalStatuses?: Partial<Record<AssessmentGoal, JourneyCapabilityStatus>>;
}) {
  return (
    <section className="mb-6" data-property-journey-handoff="true">
      <details className="group border border-border rounded-xl bg-white">
        <summary className="cursor-pointer list-none px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-gray-50 rounded-xl">
          <span>
            <span className="block text-sm font-medium text-foreground">Change assessment focus</span>
            <span className="block text-xs text-muted mt-0.5">Optional · applies only to this property assessment</span>
          </span>
          <span aria-hidden="true" className="text-muted text-lg transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="border-t border-border p-4">
          <p className="text-xs text-muted mb-3">
            Choose another perspective to run the full property lookup. This does not label your profile or change the property facts.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OPTIONS.map((option) => {
              const status = goalStatuses?.[option.goal];
              const unavailable = status?.availability === "unavailable";
              const content = (
                <>
                  <span className={`block text-sm font-semibold ${unavailable ? "text-muted" : "text-foreground"}`}>
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted mt-1">
                    {unavailable ? status.message : option.detail}
                  </span>
                </>
              );
              return unavailable ? (
                <div
                  key={option.goal}
                  aria-disabled="true"
                  data-journey-option={option.goal}
                  data-journey-availability="unavailable"
                  className="rounded-lg border border-border bg-gray-50 p-4"
                >
                  {content}
                </div>
              ) : (
                <Link
                  key={option.goal}
                  href={assessmentJourneyHref(assessmentInput, option.goal)}
                  data-journey-option={option.goal}
                  data-journey-availability={status?.availability ?? "unknown"}
                  className="rounded-lg border border-border p-4 transition-colors hover:border-foreground/40"
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </details>
    </section>
  );
}
