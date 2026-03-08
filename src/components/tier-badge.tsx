const tierConfig: Record<string, { color: string; label: string }> = {
  HOT: { color: "bg-red-100 text-red-700", label: "Hot" },
  WARM: { color: "bg-amber-100 text-amber-700", label: "Warm" },
  WATCH: { color: "bg-blue-50 text-blue-600", label: "Cool" },
};

export default function TierBadge({ tier }: { tier: string }) {
  const cfg = tierConfig[tier] || tierConfig.WATCH;
  return (
    <span
      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}
