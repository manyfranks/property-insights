/**
 * app/insurance/page.tsx
 *
 * Dedicated landing page for the insurance path (Stage 2) — the
 * address-first entry point for visitors who arrive without a property
 * assessment in context. Complements the contextual "Protect this
 * property" module on result pages; both funnel into the same
 * /coverage-profile wizard.
 *
 * Gated behind NEXT_PUBLIC_INSURANCE_INTAKE like every other insurance
 * surface — 404s while the flag is off. All user-facing copy lives in
 * src/components/insurance/ (insurance-landing.tsx) so the
 * prohibited-terms build guard scans it; this file is a thin shell.
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

export const metadata: Metadata = {
  title: "Property Insurance — Property Insights",
  description:
    "Enter an address, build a coverage profile, and get matched with a licensed insurance broker for your region.",
};

export default async function InsuranceLandingPage() {
  if (process.env.NEXT_PUBLIC_INSURANCE_INTAKE !== "1") {
    notFound();
  }

  const usStates = getAllStatesWithCounties()
    .map((s) => ({ code: s.state, name: s.stateName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const headerList = await headers();
  const initialGeo = {
    country: headerList.get("x-vercel-ip-country") || null,
    region: headerList.get("x-vercel-ip-country-region") || null,
  };

  return <InsuranceLanding usStates={usStates} initialGeo={initialGeo} />;
}
