import AssessmentProgress from "@/components/assessment-progress";
import { parseAssessmentGoal } from "@/lib/property-intelligence/journey";

export default async function AssessPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string; placeId?: string; journeys?: string; assessmentGoal?: string }>;
}) {
  const { address, placeId, journeys, assessmentGoal } = await searchParams;

  if (!address) {
    return (
      <main className="max-w-xl mx-auto px-6 py-16 text-center">
        <p className="text-sm text-muted">No address provided.</p>
      </main>
    );
  }

  const journeyPreview = journeys === "1";
  const journeyEnabled = process.env.PROPERTY_JOURNEYS_ENABLED === "true" || journeyPreview;

  return (
    <AssessmentProgress
      key={`${address}:${placeId ?? ""}:${journeyEnabled}`}
      address={address}
      placeId={placeId}
      journeyEnabled={journeyEnabled}
      journeyPreview={journeyPreview}
      initialGoal={parseAssessmentGoal(assessmentGoal)}
    />
  );
}
