/**
 * app/insurance/page.tsx
 *
 * Dedicated landing page for the insurance path (Stage 2) — the
 * address-first entry point for visitors who arrive without a property
 * assessment in context. Complements the contextual "Protect this
 * property" module on result pages; both funnel into the same
 * /coverage-profile wizard.
 *
 * Gated behind stageAtLeast("landing") (src/config/insurance-stage.ts —
 * NEXT_PUBLIC_INSURANCE_STAGE, which supersedes the old
 * NEXT_PUBLIC_INSURANCE_LANDING / NEXT_PUBLIC_INSURANCE_INTAKE pair) rather
 * than the narrower "intake" stage alone, so this marketing/waitlist surface
 * can go live ahead of the coverage-profile wizard itself. `intakeEnabled`
 * (stageAtLeast("intake")) is threaded down separately so every section can
 * tell "landing is public" apart from "the wizard can actually accept a
 * submission" — the difference is exactly what puts the form into waitlist
 * mode. All user-facing copy lives in
 * src/components/insurance/ (insurance-landing.tsx + landing/*) so the
 * prohibited-terms build guard scans it; this file is a thin shell plus SEO.
 *
 * Geo: read directly from Vercel's edge-injected geo headers per request
 * (same headers /api/geo reads — see src/app/api/geo/route.ts — but read
 * here in-process rather than calling that route) and passed down as
 * `initialGeo`. Deliberately independent of the shared `useVisitorGeo` /
 * `pi_geo_override` system the homepage explorer uses: no localStorage
 * caching, no cross-page pollution, and every load reflects the visitor's
 * current IP (so a VPN change shows up immediately).
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllStatesWithCounties } from "@/lib/us-counties";
import InsuranceLanding from "@/components/insurance/insurance-landing";
import { FaqJsonLd, BreadcrumbJsonLd } from "@/components/json-ld";
import { FAQ_ITEMS } from "@/components/insurance/landing/data";
import { BASE_URL } from "@/lib/seo";
import { stageAtLeast } from "@/config/insurance-stage";
import type { InsuranceLine } from "@/config/affiliate-vendors";

const VALID_LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];

export const metadata: Metadata = {
  title: "Home & Landlord Insurance, Pre-Filled From Your Address",
  description:
    "Enter your address for a pre-filled coverage profile — homeowner, landlord, tenant, strata, or commercial insurance — then get matched with one licensed broker.",
  alternates: {
    canonical: `${BASE_URL}/insurance`,
  },
};

export default async function InsuranceLandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!stageAtLeast("landing")) {
    notFound();
  }

  const query = await searchParams;
  const lineRaw = Array.isArray(query.line) ? query.line[0] : query.line;
  const initialLine =
    lineRaw && VALID_LINES.includes(lineRaw as InsuranceLine) ? (lineRaw as InsuranceLine) : undefined;

  const usStates = getAllStatesWithCounties()
    .map((s) => ({ code: s.state, name: s.stateName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const headerList = await headers();
  const initialGeo = {
    country: headerList.get("x-vercel-ip-country") || null,
    region: headerList.get("x-vercel-ip-country-region") || null,
  };

  return (
    <>
      <FaqJsonLd questions={FAQ_ITEMS.map((f) => ({ question: f.question, answer: f.answer }))} />
      <BreadcrumbJsonLd
        items={[
          { name: "Property Insights", url: BASE_URL },
          { name: "Insurance", url: `${BASE_URL}/insurance` },
        ]}
      />
      <InsuranceLanding
        usStates={usStates}
        initialGeo={initialGeo}
        initialLine={initialLine}
        intakeEnabled={stageAtLeast("intake")}
      />
    </>
  );
}
