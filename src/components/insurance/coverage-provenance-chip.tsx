/**
 * components/insurance/coverage-provenance-chip.tsx
 *
 * Small pill labeling where a coverage-profile field's value came from —
 * "Known" (our own listing data), "Modeled" (an estimate, e.g. an
 * assessment/AVM value), or "You" (the visitor answered it directly). Shared
 * by the intake wizard (screen 2, Known/Modeled only) and the handoff
 * summary (screen 4, all three).
 */

export type ProvenanceSource = "known" | "modeled" | "you";

const STYLES: Record<ProvenanceSource, string> = {
  known: "bg-teal-50 text-teal-700",
  modeled: "bg-zinc-100 text-zinc-600",
  you: "bg-amber-50 text-amber-700",
};

const LABELS: Record<ProvenanceSource, string> = {
  known: "Known",
  modeled: "Modeled",
  you: "You",
};

export function ProvenanceChip({ source }: { source: ProvenanceSource }) {
  return (
    <span
      className={`font-mono text-[9px] uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap ${STYLES[source]}`}
    >
      {LABELS[source]}
    </span>
  );
}
