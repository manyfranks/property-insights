/**
 * components/insurance/landing/partner-strip.tsx
 *
 * "We place coverage with licensed brokers, including" + text wordmarks of
 * enabled insurance vendors for the visitor's country (src/config/affiliate-vendors.ts) —
 * no logos, no hardcoded names. Hidden entirely when fewer than 2 vendors
 * are enabled, since a strip with 0-1 names reads as an overclaim rather
 * than evidence.
 */

import { AFFILIATE_VENDORS, type Country } from "@/config/affiliate-vendors";

export default function PartnerStrip({ country }: { country: Country }) {
  const names = AFFILIATE_VENDORS.filter((v) => v.enabled && v.vertical === "insurance" && v.country === country).map(
    (v) => v.name
  );

  if (names.length < 2) return null;

  return (
    <section style={{ borderTop: "1px solid #eef0f2", borderBottom: "1px solid #eef0f2", background: "#fbfbfa" }}>
      <div
        className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-center"
        style={{ padding: "22px 32px", gap: "16px 40px" }}
      >
        <span style={{ fontSize: "13px", color: "#9ca3af" }}>We place coverage with licensed brokers, including</span>
        {names.map((name) => (
          <span key={name} style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em", color: "#b8bcc4" }}>
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}
