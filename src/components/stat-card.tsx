/**
 * Small labeled stat tile used across the /us county market pages (main
 * county page + the /rent sub-page) — white card, uppercase label, mono
 * figure, optional sub-line and data-vintage footnote.
 */
export default function StatCard({
  label,
  value,
  sub,
  vintage,
}: {
  label: string;
  value: string;
  sub?: string;
  vintage?: number;
}) {
  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-2">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
      {vintage && <div className="text-xs text-muted/60 mt-1">{vintage} data</div>}
    </div>
  );
}
