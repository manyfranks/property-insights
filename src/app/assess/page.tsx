import AssessmentProgress from "@/components/assessment-progress";

export default async function AssessPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;

  if (!address) {
    return (
      <main className="max-w-xl mx-auto px-6 py-16 text-center">
        <p className="text-sm text-muted">No address provided.</p>
      </main>
    );
  }

  return <AssessmentProgress address={address} />;
}
