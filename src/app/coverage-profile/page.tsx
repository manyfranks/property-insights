/**
 * app/coverage-profile/page.tsx
 *
 * Entry point for Stage 2 of the insurance path: screen 2 (the intake
 * wizard) and, after submission, screen 4 (the handoff) — both rendered by
 * the client wizard component this page hands prefill data to. Thin server
 * component: parse + validate the query contract, gate on the feature flag
 * and jurisdiction exclusions, load listing data for prefill when a
 * listingId is present, then render.
 *
 * URL contract (see docs/plans/18-INSURANCE-PATH-BUILD.md):
 *   /coverage-profile?country=..&region=..&line=..&address=..
 *     (&listingId=..&vendor=<registryId>)
 *
 * Transactional page — never indexed (`robots: { index: false }`), and
 * gated behind NEXT_PUBLIC_INSURANCE_INTAKE the same way
 * POST /api/coverage-profile is (src/app/api/coverage-profile/route.ts) —
 * this page 404s while the flag is off rather than rendering a flow that
 * can't submit.
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  INSURANCE_LINE_EXCLUSIONS,
  INSURANCE_STATE_EXCLUSIONS,
  type Country,
  type InsuranceLine,
} from "@/config/affiliate-vendors";
import { getListingBySlug } from "@/lib/kv/listings";
import { slugify } from "@/lib/utils";
import { buildCoveragePrefill } from "@/components/insurance/coverage-prefill";
import { CoverageExcludedNotice } from "@/components/insurance/coverage-excluded-notice";
import CoverageProfileWizard from "@/components/insurance/coverage-profile-wizard";

export const metadata: Metadata = {
  title: "Build your coverage profile — Property Insights",
  description:
    "Confirm your property details and get matched with a licensed insurance broker for this address.",
  robots: { index: false, follow: false },
};

const VALID_COUNTRIES: Country[] = ["US", "CA"];
const VALID_LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CoverageProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NEXT_PUBLIC_INSURANCE_INTAKE !== "1") {
    notFound();
  }

  const query = await searchParams;

  const countryRaw = first(query.country)?.toUpperCase();
  const country =
    countryRaw && VALID_COUNTRIES.includes(countryRaw as Country) ? (countryRaw as Country) : undefined;
  const region = first(query.region)?.trim().toUpperCase();
  const lineRaw = first(query.line);
  const line = lineRaw && VALID_LINES.includes(lineRaw as InsuranceLine) ? (lineRaw as InsuranceLine) : undefined;
  const address = first(query.address)?.trim();
  const listingId = first(query.listingId)?.trim() || null;
  const vendorParam = first(query.vendor)?.trim() || null;

  if (!country || !region || !line || !address) {
    notFound();
  }

  // Jurisdiction gates — a visible notice, not a silent empty flow or a
  // bare 404 (see CoverageExcludedNotice's doc comment).
  if (INSURANCE_STATE_EXCLUSIONS[country].includes(region)) {
    return <CoverageExcludedNotice region={region} />;
  }
  if ((INSURANCE_LINE_EXCLUSIONS[country][region] ?? []).includes(line)) {
    return <CoverageExcludedNotice region={region} />;
  }

  // listingId is treated as a listing slug (this app's addressing scheme
  // everywhere else, e.g. /property/[slug]) — a missing or unresolved
  // listing degrades to query-params-only prefill rather than failing the
  // page; buildCoveragePrefill renders "— not on file" for anything it
  // can't source, never a fabricated value.
  //
  // Address-first entries (the /insurance landing page) arrive with no
  // listingId — try the slugified address against tracked listings so a
  // known property still gets full prefill. A miss just means
  // params-only prefill; it is never an error.
  const lookupSlug = listingId ?? slugify(address);
  const listing = lookupSlug ? await getListingBySlug(lookupSlug).catch(() => null) : null;

  const prefill = buildCoveragePrefill({
    country,
    region,
    line,
    address,
    listingSlug: listing ? lookupSlug : listingId,
    vendorParam,
    listing,
  });

  return (
    <main className="max-w-2xl mx-auto px-6 py-8 sm:py-10">
      <CoverageProfileWizard prefill={prefill} />
    </main>
  );
}
