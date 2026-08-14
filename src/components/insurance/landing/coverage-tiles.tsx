/**
 * components/insurance/landing/coverage-tiles.tsx
 *
 * Five coverage-line cards. Each is an SSR <a> to /insurance?line=X (the
 * page reads the param and preselects the form's line — see
 * src/app/insurance/page.tsx) except the BC strata tile: BC bans referral
 * compensation on strata insurance entirely (INSURANCE_LINE_EXCLUSIONS.CA.BC
 * — see src/config/affiliate-vendors.ts), so in BC that tile renders as
 * plain informational text with no link at all, never a CTA that routes
 * into a flow the jurisdiction gate would just reject.
 */

import Link from "next/link";
import { INSURANCE_LINE_EXCLUSIONS, type Country } from "@/config/affiliate-vendors";
import { statusFor, shortStatusLabel, isLive } from "@/config/insurance-rollout";
import { COVERAGE_LINES } from "./data";

// Icon path data transcribed verbatim from the design's `vIcons` map
// (insurance-landing.dc.html) — each is a multi-subpath `d` string (house /
// building silhouette variants), rendered at 20x20 in a 24x24 viewBox with
// stroke-width 1.7, matching the design's `ic()` helper exactly.
const LINE_ICON_PATHS: Record<string, string> = {
  homeowner: "M3 11l9-8 9 8 M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5",
  landlord: "M4 21V8l8-5 8 5v13 M9 21v-6h6v6",
  tenant: "M6 21V9l6-4 6 4v12 M10 21v-5h4v5",
  strata: "M4 21V6l6-3v18 M10 21V8l6 3v10 M4 21h16",
  commercial: "M3 21V5l8-2v18 M11 21V9l8 2v10 M3 21h18",
};

function LineIcon({ lineId, color }: { lineId: string; color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={LINE_ICON_PATHS[lineId]}
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function tagFor(lineId: string, country: Country, region: string): { label: string; className: string } {
  if (lineId === "commercial") {
    return { label: "Beta", className: "bg-gray-100 text-gray-600" };
  }
  const status = statusFor(country, region);
  if (status === "live") return { label: shortStatusLabel(status, region), className: "bg-cta-accent/10 text-cta-accent" };
  if (status === "next" || status === "soon")
    return { label: shortStatusLabel(status, region), className: "bg-amber-50 text-amber-700" };
  if (status === "unavailable") return { label: "Unavailable", className: "bg-red-50 text-red-600" };
  return { label: "Preview", className: "bg-gray-100 text-gray-600" };
}

export default function CoverageTiles({ country, region }: { country: Country; region: string }) {
  const upperRegion = region.toUpperCase();

  return (
    <section className="py-20 sm:py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-9">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight max-w-sm text-balance">
            Whatever you own, we&apos;ve got the paperwork.
          </h2>
          <p className="text-[15px] text-muted max-w-sm">
            Five coverage lines, one platform. We route you to a licensed broker who places that line in{" "}
            {upperRegion}.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {COVERAGE_LINES.map((line, index) => {
            const excluded = (INSURANCE_LINE_EXCLUSIONS[country]?.[upperRegion] ?? []).includes(line.id);
            const tag = excluded
              ? { label: "Broker-placed", className: "bg-amber-50 text-amber-700" }
              : tagFor(line.id, country, upperRegion);

            // The design's prototype highlights whichever tile matches its
            // `state.vertical` (defaults to the first tile, "homeowner")
            // with a filled-teal icon square + tinted card. Our build has
            // no client-side tile selection, so we reproduce that default
            // state statically: the first tile gets the active treatment
            // whenever it's actually the live line for this region —
            // matching the design's look without claiming "live" on a tile
            // that isn't.
            const active = index === 0 && !excluded && isLive(country, upperRegion);
            const cardBg = active ? "#f3faf8" : "#fbfbfa";
            const cardBorder = active ? "#0f766e" : "#eef0f2";
            const iconBg = active ? "#0f766e" : "#fff";
            const iconColor = active ? "#fff" : "#0f766e";

            const inner = (
              <>
                <div
                  className="flex items-center justify-center mb-10 shrink-0"
                  style={{ width: "44px", height: "44px", borderRadius: "13px", background: iconBg, color: iconColor }}
                >
                  <LineIcon lineId={line.id} color={iconColor} />
                </div>
                <div className="text-[16px] font-semibold tracking-tight mb-1.5">{line.label}</div>
                <p className="text-[12.5px] text-muted leading-relaxed mb-4 min-h-[3.2em]">{line.blurb}</p>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-[9px] uppercase tracking-wide rounded-full px-2.5 py-1 ${tag.className}`}
                  >
                    {tag.label}
                  </span>
                  {!excluded && (
                    <span className="text-cta-accent" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M5 12h14M13 6l6 6-6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )}
                </div>
              </>
            );

            if (excluded) {
              return (
                <div
                  key={line.id}
                  className="text-left rounded-[22px] p-5"
                  style={{ background: cardBg, border: `1.5px solid ${cardBorder}` }}
                  title={`${line.label} insurance is placed directly by a licensed broker in ${upperRegion} — Property Insights doesn't earn a referral fee on this line here.`}
                >
                  {inner}
                </div>
              );
            }

            return (
              <Link
                key={line.id}
                href={`/insurance?line=${line.id}`}
                className="text-left rounded-[22px] p-5 transition-colors hover:border-foreground/30"
                style={{ background: cardBg, border: `1.5px solid ${cardBorder}` }}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
