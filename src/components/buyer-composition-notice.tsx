import type { BuyerCompositionModel } from "@/lib/property-intelligence/buyer-journey";

export default function BuyerCompositionNotice({ model }: { model: BuyerCompositionModel }) {
  if (!model.notice) return null;
  const withheld = model.notice.kind === "withheld";
  const classes = withheld
    ? "border-amber-200 bg-amber-50 text-amber-950"
    : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <section
      className={`border rounded-xl p-4 mb-6 ${classes}`}
      data-p6a-buyer-notice={model.notice.kind}
    >
      <div className="text-xs uppercase tracking-widest mb-1 opacity-75">Assessment scope</div>
      <h2 className="text-sm font-semibold">{model.notice.title}</h2>
      <p className="text-sm mt-1 opacity-90">{model.notice.detail}</p>
    </section>
  );
}
