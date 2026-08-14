/**
 * components/insurance/insurance-landing.tsx
 *
 * Server component rendering the full /insurance landing page (the
 * approved redesign — see the build spec for section-by-section detail).
 * Composes the sections under src/components/insurance/landing/*; the only
 * client-side pieces are InsuranceLandingForm instances embedded in Hero
 * and FinalCta. Kept under src/components/insurance/ so every user-facing
 * string in this file and its landing/ children is scanned by
 * scripts/check-insurance-copy.ts.
 */

import type { InsuranceLine, Country } from "@/config/affiliate-vendors";
import { getVendorsForSurface } from "@/config/affiliate-vendors";
import { regionName as lookupRegionName } from "@/config/insurance-rollout";
import Hero from "./landing/hero";
import AvailabilityNote from "./landing/availability-note";
import CoverageTiles from "./landing/coverage-tiles";
import DataMoat from "./landing/data-moat";
import NoLeadAuction from "./landing/no-lead-auction";
import HowItWorks from "./landing/how-it-works";
import RolloutStrip from "./landing/rollout-strip";
import Faq from "./landing/faq";
import FinalCta from "./landing/final-cta";
import SwitchSection from "./landing/switch-section";

export default function InsuranceLanding({
  usStates,
  initialGeo,
  initialLine,
  intakeEnabled,
}: {
  usStates: { code: string; name: string }[];
  /** Visitor geo read server-side (per request) from Vercel's edge headers — see app/insurance/page.tsx. */
  initialGeo: { country: string | null; region: string | null };
  /** Preselected line from a coverage-tile link (`/insurance?line=X`). */
  initialLine?: InsuranceLine;
  /** Whether the coverage-profile wizard can accept a submission at all. */
  intakeEnabled: boolean;
}) {
  const country: Country = initialGeo.country === "US" ? "US" : "CA";
  const region =
    country === "US"
      ? initialGeo.region && usStates.some((s) => s.code === initialGeo.region)
        ? (initialGeo.region as string)
        : "TX"
      : initialGeo.region && initialGeo.region.length > 0
        ? initialGeo.region
        : "BC";

  // "discover" is the closest existing SurfaceKey to a general marketing
  // landing page (src/config/affiliate-vendors.ts defines no dedicated
  // "insurance-landing" surface); preferVertical hoists insurance vendors
  // to the front regardless of that surface's default vertical order.
  const vendors = getVendorsForSurface(country, region, "buyer", "discover", "insurance").filter(
    (v) => v.vertical === "insurance"
  );

  const regionLabel = lookupRegionName(country, region, usStates);
  const countryLabel = country === "CA" ? "Canada" : "United States";
  const waitlistMode = !intakeEnabled; // page-level default for static CTAs; the form itself also factors in per-region status

  return (
    <main>
      <Hero
        usStates={usStates}
        initialGeo={initialGeo}
        initialLine={initialLine}
        intakeEnabled={intakeEnabled}
        country={country}
      />
      <AvailabilityNote />
      <CoverageTiles country={country} region={region} />
      <DataMoat country={country} region={region} />
      <NoLeadAuction vendorCount={vendors.length} />
      <HowItWorks waitlistMode={waitlistMode} />
      <SwitchSection />
      <RolloutStrip regionLabel={regionLabel} countryLabel={countryLabel} />
      <Faq />
      <FinalCta usStates={usStates} initialGeo={initialGeo} initialLine={initialLine} intakeEnabled={intakeEnabled} />
    </main>
  );
}
