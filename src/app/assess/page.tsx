import AssessmentProgress from "@/components/assessment-progress";
import { parseAssessmentGoal } from "@/lib/property-intelligence/journey";
import { auth } from "@clerk/nextjs/server";
import { getUserAssessmentState } from "@/lib/db/user-assessments";

export default async function AssessPage({
  searchParams,
}: {
  searchParams: Promise<{
    address?: string;
    placeId?: string;
    journeys?: string;
    assessmentGoal?: string;
    assessmentId?: string;
  }>;
}) {
  const { address, placeId, journeys, assessmentGoal, assessmentId } = await searchParams;

  if (!address) {
    return (
      <main className="max-w-xl mx-auto px-6 py-16 text-center">
        <p className="text-sm text-muted">No address provided.</p>
      </main>
    );
  }

  const journeyPreview = journeys === "1";
  const journeyEnabled = process.env.PROPERTY_JOURNEYS_ENABLED === "true" || journeyPreview;
  const { userId } = assessmentId ? await auth() : { userId: null };
  const savedAssessment = userId && assessmentId
    ? await getUserAssessmentState(userId, assessmentId).catch(() => null)
    : null;
  const resumableAssessment = savedAssessment?.country === "US" ? savedAssessment : null;

  return (
    <AssessmentProgress
      key={`${address}:${placeId ?? ""}:${journeyEnabled}:${resumableAssessment?.id ?? "new"}`}
      address={address}
      placeId={placeId}
      journeyEnabled={journeyEnabled}
      journeyPreview={journeyPreview}
      initialGoal={parseAssessmentGoal(assessmentGoal) ?? resumableAssessment?.activeView ?? null}
      restoredAssessment={resumableAssessment ? {
        id: resumableAssessment.id,
        subjectScope: resumableAssessment.subjectScope,
        subjectUnit: resumableAssessment.subjectUnit,
        subjectSelectedBy: resumableAssessment.subjectSelectedBy,
      } : null}
    />
  );
}
