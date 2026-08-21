"use client";

import { useAssessmentJourneyGoal } from "@/components/assessment-journey";
import InsuranceModule, { type InsuranceModuleProps } from "@/components/insurance/insurance-module";
import { insuranceSelectionForJourney } from "@/components/insurance/goal-line-map";
import type { AssessmentGoal } from "@/lib/property-intelligence/journey";

/**
 * Keeps the result-page insurance default aligned with the live assessment
 * focus. The key deliberately remounts the line chooser after a focus change:
 * a Rental Investment -> Buying a Home switch must not leave Landlord selected
 * simply because rental_investment was the server-rendered URL goal.
 */
export default function JourneyInsuranceModule(
  {
    fallbackGoal,
    ...props
  }: Omit<InsuranceModuleProps, "initialLine"> & {
    fallbackGoal?: AssessmentGoal | null;
  }
) {
  const goal = useAssessmentJourneyGoal() ?? fallbackGoal;
  const selection = insuranceSelectionForJourney(goal);

  return (
    <InsuranceModule
      key={selection.key}
      {...props}
      initialLine={selection.initialLine}
    />
  );
}
