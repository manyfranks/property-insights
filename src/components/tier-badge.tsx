const tierColors: Record<string, string> = {
  HOT: "bg-red-100 text-red-700",
  WARM: "bg-amber-100 text-amber-700",
  WATCH: "bg-gray-100 text-gray-600",
};

export default function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tierColors[tier] || tierColors.WATCH}`}
    >
      {tier}
    </span>
  );
}
