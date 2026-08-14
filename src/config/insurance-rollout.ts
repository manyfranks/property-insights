/**
 * config/insurance-rollout.ts
 *
 * Single source of truth for insurance rollout status by region — what
 * stage of availability a country/region is in. Consumed by the /insurance
 * landing page's hero status line, region picker, coverage-tile chips, and
 * rollout strip (src/components/insurance/landing/*) — the rollout strip's
 * five-column data (src/components/insurance/landing/data.ts's
 * ROLLOUT_COLUMNS) is itself derived from CA_REGIONS via
 * `rolloutStripColumns()` below rather than hand-duplicated, so the strip
 * can never silently disagree with the isLive() gate that
 * coverage-profile/page.tsx and insurance-module.tsx enforce.
 *
 * Must agree with INSURANCE_STATE_EXCLUSIONS (src/config/affiliate-vendors.ts):
 * a region marked "live" here implies referral CTAs actually work there, so
 * it can never also be in that exclusions list — and every excluded region
 * must be marked "unavailable" here, not left as some lesser-but-still-
 * offered status. That's a config authoring bug, not a runtime edge case,
 * so it's asserted once at module load — fails the build/boot loudly rather
 * than shipping a landing page that claims a region is live while its own
 * referral links dead-end at the jurisdiction gate.
 */

import { INSURANCE_STATE_EXCLUSIONS, type Country } from "./affiliate-vendors";

export type RolloutStatus = "live" | "next" | "soon" | "preview" | "unavailable";

export interface RegionOption {
  code: string;
  name: string;
  status: RolloutStatus;
}

/** CA provinces/territories this page's region picker and rollout strip
 *  cover. Territories (YT/NT/NU) are out of scope for now — the address
 *  typeahead and coverage-profile flow don't target them — so they're
 *  simply absent rather than marked any particular status. */
export const CA_REGIONS: RegionOption[] = [
  { code: "BC", name: "British Columbia", status: "live" },
  { code: "AB", name: "Alberta", status: "next" },
  { code: "ON", name: "Ontario", status: "soon" },
  { code: "SK", name: "Saskatchewan", status: "preview" },
  { code: "MB", name: "Manitoba", status: "preview" },
  { code: "NS", name: "Nova Scotia", status: "preview" },
  { code: "PE", name: "Prince Edward Island", status: "preview" },
  { code: "NL", name: "Newfoundland and Labrador", status: "preview" },
  { code: "QC", name: "Quebec", status: "unavailable" },
  { code: "NB", name: "New Brunswick", status: "unavailable" },
];

/** US states with no compliant referral path (see INSURANCE_STATE_EXCLUSIONS).
 *  Every other US state is "preview" — geo-targeted but not yet live
 *  anywhere. */
const US_UNAVAILABLE = new Set(["WA"]);

export const STATUS_LABEL: Record<RolloutStatus, string> = {
  live: "Live",
  next: "Next",
  soon: "Soon",
  preview: "Preview",
  unavailable: "Unavailable",
};

/** Short status copy for chips/badges that want a region name baked in,
 *  e.g. coverage-tile "Coming to AB" / "Live in BC". */
export function shortStatusLabel(status: RolloutStatus, regionCode: string): string {
  switch (status) {
    case "live":
      return `Live in ${regionCode}`;
    case "next":
    case "soon":
      return `Coming to ${regionCode}`;
    case "preview":
      return "Preview";
    case "unavailable":
      return "Unavailable";
  }
}

export function statusFor(country: Country, region: string | null | undefined): RolloutStatus {
  const code = (region ?? "").toUpperCase();
  if (!code) return "preview";
  if (country === "CA") {
    return CA_REGIONS.find((r) => r.code === code)?.status ?? "preview";
  }
  return US_UNAVAILABLE.has(code) ? "unavailable" : "preview";
}

export function isLive(country: Country, region: string | null | undefined): boolean {
  return statusFor(country, region) === "live";
}

/** Resolves a display name for a region code. `usStates` is the
 *  server-provided {code,name} list (src/lib/us-counties.ts) — passed
 *  through rather than imported here to keep this a light, framework-
 *  neutral config module. Falls back to the bare code when no name is
 *  known (never fabricates a name). */
export function regionName(
  country: Country,
  code: string,
  usStates: { code: string; name: string }[]
): string {
  const upper = code.toUpperCase();
  if (country === "CA") {
    return CA_REGIONS.find((r) => r.code === upper)?.name ?? upper;
  }
  return usStates.find((s) => s.code === upper)?.name ?? upper;
}

// ---------------------------------------------------------------------------
// Rollout strip derivation — /insurance landing page
// ---------------------------------------------------------------------------

export interface RolloutStripColumn {
  label: string;
  country: string;
  status: string;
  live: boolean;
}

/** Positional display copy for the strip's first three columns — distinct
 *  from STATUS_LABEL because the strip's copy reads as a sequence ("Live
 *  now" → "Next" → "After that") rather than a standalone status word. */
const STRIP_STATUS_COPY: Record<"live" | "next" | "soon", string> = {
  live: "Live now",
  next: "Next",
  soon: "After that",
};

/**
 * Builds the /insurance rollout strip's five columns from CA_REGIONS
 * instead of a hand-maintained duplicate list — see the module doc comment.
 * Picks the (at most one) CA_REGIONS entry at each of "live"/"next"/"soon"
 * for the first three columns, then a "rest of Canada" aggregate and a US
 * aggregate. "Most provinces" rather than "Rest of Canada" — QC and NB are
 * permanently excluded (INSURANCE_STATE_EXCLUSIONS), not just "not yet," so
 * a nationwide claim there would be false. Returns the same five entries as
 * today's config for the current rollout state; this is a refactor for
 * single-source-of-truth, not a presentation change.
 */
export function rolloutStripColumns(): RolloutStripColumn[] {
  const columns: RolloutStripColumn[] = [];
  for (const statusKey of ["live", "next", "soon"] as const) {
    const region = CA_REGIONS.find((r) => r.status === statusKey);
    if (!region) continue;
    columns.push({
      label: region.name,
      country: "Canada",
      status: STRIP_STATUS_COPY[statusKey],
      live: statusKey === "live",
    });
  }
  columns.push({ label: "Most provinces", country: "Rest of Canada", status: "Rolling out", live: false });
  columns.push({ label: "United States", country: "Geo-targeted", status: "Rolling out", live: false });
  return columns;
}

// ---------------------------------------------------------------------------
// Consistency guard — fails loudly at module load, not at request time.
//
// Note: this only guards CA_REGIONS/US_UNAVAILABLE against
// INSURANCE_STATE_EXCLUSIONS — it does not (and doesn't need to) separately
// guard the rollout strip, since rolloutStripColumns() above reads directly
// from CA_REGIONS rather than keeping its own copy of the data.
// ---------------------------------------------------------------------------
(function assertRolloutConsistency() {
  for (const r of CA_REGIONS) {
    const excluded = INSURANCE_STATE_EXCLUSIONS.CA.includes(r.code);
    if (excluded && r.status !== "unavailable") {
      throw new Error(
        `insurance-rollout: CA region "${r.code}" is in INSURANCE_STATE_EXCLUSIONS.CA but its rollout ` +
          `status is "${r.status}" (expected "unavailable"). A region can't be excluded from every ` +
          `referral CTA and still be advertised as available.`
      );
    }
    if (!excluded && r.status === "unavailable") {
      throw new Error(
        `insurance-rollout: CA region "${r.code}" is marked "unavailable" but is NOT in ` +
          `INSURANCE_STATE_EXCLUSIONS.CA — either add the exclusion or change the rollout status.`
      );
    }
  }
  for (const code of INSURANCE_STATE_EXCLUSIONS.US) {
    if (!US_UNAVAILABLE.has(code)) {
      throw new Error(
        `insurance-rollout: US region "${code}" is in INSURANCE_STATE_EXCLUSIONS.US but is not in this ` +
          `file's US_UNAVAILABLE set — the landing page would advertise a jurisdiction that every ` +
          `referral link actually refuses.`
      );
    }
  }
})();
