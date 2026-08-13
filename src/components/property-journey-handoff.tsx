import Link from "next/link";
import {
  assessmentJourneyHref,
  type AssessmentGoal,
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
}: {
  assessmentInput: string;
}) {
  return (
    <section className="border border-border rounded-xl p-5 sm:p-6 mb-6 bg-white" data-property-journey-handoff="true">
      <div className="mb-4">
        <div className="text-xs uppercase tracking-widest text-muted">Choose your assessment</div>
        <h2 className="text-lg font-semibold mt-1">What are you evaluating here?</h2>
        <p className="text-xs text-muted mt-1">
          We will run the full property lookup with this focus. Property records never choose a goal for you.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {OPTIONS.map((option) => (
          <Link
            key={option.goal}
            href={assessmentJourneyHref(assessmentInput, option.goal)}
            className={`rounded-lg border p-4 transition-colors hover:border-foreground/40 ${
              option.goal === "rental_investment" ? "border-foreground bg-gray-50" : "border-border"
            }`}
          >
            <span className="block text-sm font-semibold text-foreground">{option.label}</span>
            <span className="block text-xs text-muted mt-1">{option.detail}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
