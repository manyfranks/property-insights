/**
 * scripts/journey-matrix.ts
 *
 * "Journey matrix oracle" for the insurance path. The insurance path's
 * per-geo/per-line/per-listing-type behavior is fully determined by config:
 *
 *   - src/config/insurance-stage.ts       (stage dial: off/landing/intake/switch)
 *   - src/config/insurance-rollout.ts     (CA_REGIONS statuses, isLive, statusFor)
 *   - src/config/affiliate-vendors.ts     (INSURANCE_STATE_EXCLUSIONS,
 *                                           INSURANCE_LINE_EXCLUSIONS,
 *                                           AFFILIATE_VENDORS, getVendorsForSurface)
 *   - src/components/insurance/resolve-vendor.ts (resolveVendor)
 *   - src/lib/property-intelligence/land-listing.ts
 *                                          (residentialPartnerActionsAllowed,
 *                                           isVerifiedLandListing)
 *
 * This script IMPORTS those real modules — it never re-implements the
 * rules — and computes the expected user-journey outcome for every
 * (stage x country/region x line x listingType) combination. The output is
 * the machine-checkable "trusted map" a Playwright agent (or a human) can
 * diff actual behavior against.
 *
 * Modes:
 *   npx tsx scripts/journey-matrix.ts             generate scripts/journey-matrix.snapshot.json
 *   npx tsx scripts/journey-matrix.ts --check      regenerate in-memory, diff against the snapshot
 *                                                   file, exit 1 with a per-cell diff on disagreement
 *   npx tsx scripts/journey-matrix.ts --table      print a compact equivalence-class summary
 *
 * --check runs three independent things, all of which must pass (wired into
 * `npm run prebuild`, so a failure of any of them fails the build):
 *   1. Snapshot diff (original behavior) — the regenerated matrix must match
 *      scripts/journey-matrix.snapshot.json cell-for-cell.
 *   2. Live-implies-vendor build guarantee — for every region whose rollout
 *      status (src/config/insurance-rollout.ts) is "live", every insurance
 *      line NOT excluded for that region (INSURANCE_LINE_EXCLUSIONS /
 *      INSURANCE_STATE_EXCLUSIONS, src/config/affiliate-vendors.ts) must
 *      have a non-empty eligible-vendor set — computed via the same
 *      eligibility filter resolveVendor() uses (eligibleInsuranceVendors,
 *      date-independent — this is about eligibility, not which tied vendor
 *      rotation would pick today). A "live" region promises referral CTAs
 *      actually work; an empty eligible set means the wizard would reach a
 *      dead end. This is ALSO asserted at boot time in
 *      src/config/insurance-rollout.ts (assertLiveRegionsHaveVendorCoverage)
 *      as a second line of defense for `next dev`/every server start, not
 *      just builds — both call the same eligibleInsuranceVendors so they
 *      can't drift from each other. The config -> components import
 *      direction (insurance-rollout.ts -> resolve-vendor.ts) that a naive
 *      boot-time version of this check would need was avoided by moving
 *      eligibleInsuranceVendors into src/config/affiliate-vendors.ts, which
 *      both insurance-rollout.ts and resolve-vendor.ts already depend on —
 *      see that function's doc comment.
 *   3. Fallback-floor assertion — every cell whose region is NOT live and
 *      NOT excluded (state- or line-level) must have formMode="waitlist" and
 *      handoffMode either "mailto-fallback" or "partner-link" — i.e. no cell
 *      may resolve to an undefined/unhandled path. (Cell.formMode/
 *      handoffMode are typed as closed unions so this can't literally be
 *      `undefined` in this script's own model, but the assertion still
 *      guards the *semantic* invariant against a future edit to
 *      computeFormMode/computeHandoffMode that weakens it.)
 *
 * Mortgage/lending oracle (separate from the insurance cells above): the
 * mortgage journey has no stage dial and no wizard — it's PartnerCta/
 * PartnerCtaRow surfaces (property/result pages) rendering an affiliate
 * outbound link, gated purely by registry eligibility
 * (getVendorsForSurface, src/config/affiliate-vendors.ts: enabled + country
 * + audienceMode + stateCoverage/affiliateRegions/stateExclusions) and
 * land-containment (residentialPartnerActionsAllowed,
 * src/lib/property-intelligence/land-listing.ts — same gate the insurance
 * module uses). Modeled with the mode/surface pair every non-/assess
 * property-page call site actually uses: mode="buyer", surface="result-
 * buyer" (src/app/property/[slug]/page.tsx never passes `mode`, so it
 * defaults to "buyer"; investor mode only appears on the /assess result
 * page, gated by the user's own explicit goal selection — not a config
 * dimension this config-derived oracle can enumerate). Output is a SEPARATE
 * top-level `mortgageCells` array (own key format, own dimensions — no
 * stage, no line) so the existing insurance `cells` array and its key
 * format (`${stage}|${country}-${region}|${line}|${listingType}`) stay
 * byte-identical in shape for e2e/support/oracle.ts, which reads `cells`
 * unchanged.
 *
 * Determinism note (read before touching resolveVendor/rotateTies):
 * AFFILIATE_VENDORS' rotateTies() (src/config/affiliate-vendors.ts) breaks
 * ties between same-cpaTier/same-affiliateReady vendors by *day of year*
 * (`new Date()`, no override param) — e.g. Square One and APOLLO tie on
 * CA homeowner/landlord/tenant, and rotateTies flips which one
 * resolveVendor() picks every single day. Left alone, that makes this
 * oracle's snapshot non-reproducible: a --check run tomorrow would report a
 * spurious diff for every CA cell with a tied vendor pair, even though
 * nothing in config changed. So generateMatrix() freezes the global Date
 * to a fixed reference instant (see FROZEN_REFERENCE_DATE below) for the
 * duration of vendor resolution, then restores it — same technique as
 * freezing a clock in a test. This is a real, load-bearing finding, not
 * just a snapshot-hygiene detail: see the journey-matrix report for what it
 * implies about resolveVendor's default (no vendorParam) pick in production.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { stageAtLeast, type InsuranceStage } from "../src/config/insurance-stage";
import { isLive, statusFor, CA_REGIONS, type RolloutStatus } from "../src/config/insurance-rollout";
import {
  INSURANCE_STATE_EXCLUSIONS,
  INSURANCE_LINE_EXCLUSIONS,
  eligibleInsuranceVendors,
  getVendorsForSurface,
  type Country,
  type InsuranceLine,
} from "../src/config/affiliate-vendors";
import { resolveVendor } from "../src/components/insurance/resolve-vendor";
import {
  isVerifiedLandListing,
  residentialPartnerActionsAllowed,
} from "../src/lib/property-intelligence/land-listing";
import type { PropertyClassification } from "../src/lib/property-intelligence/classification";

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

const STAGES: InsuranceStage[] = ["off", "landing", "intake", "switch"];

const LINES: InsuranceLine[] = ["homeowner", "landlord", "tenant", "strata", "commercial"];

const LISTING_TYPES = ["residential", "land"] as const;
type ListingType = (typeof LISTING_TYPES)[number];

/** Territories absent from CA_REGIONS (src/config/insurance-rollout.ts's own
 *  doc comment: "Territories (YT/NT/NU) are out of scope for now ... so
 *  they're simply absent rather than marked any particular status"). Kept
 *  as their own rows per the task brief — what statusFor/isLive actually DO
 *  with them (rather than what the comment claims) is itself a finding. */
const CA_TERRITORIES = ["YT", "NT", "NU"];

/** 50 states + DC. Not derived from src/lib/us-counties.ts on purpose —
 *  that module pulls in the full county JSON (the same reason
 *  resolve-vendor.ts's REGION_FULL_NAMES keeps its own standalone list
 *  instead of importing it) — this is a plain, well-known code list. */
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
];

interface RegionEntry {
  country: Country;
  code: string;
  kind: "province" | "territory" | "state" | "district";
}

const REGIONS: RegionEntry[] = [
  ...CA_REGIONS.map((r): RegionEntry => ({ country: "CA", code: r.code, kind: "province" })),
  ...CA_TERRITORIES.map((code): RegionEntry => ({ country: "CA", code, kind: "territory" })),
  ...US_STATES.map((code): RegionEntry => ({ country: "US", code, kind: code === "DC" ? "district" : "state" })),
].sort((a, b) => (a.country === b.country ? a.code.localeCompare(b.code) : a.country.localeCompare(b.country)));

// ---------------------------------------------------------------------------
// Land-listing fixtures — minimal shapes residentialPartnerActionsAllowed /
// isVerifiedLandListing actually read (src/lib/property-intelligence/
// land-listing.ts): isVerifiedLandListing only touches
// classification.parcelUse.value and classification.listingScope.{state,
// confidence}; residentialPartnerActionsAllowed only touches
// capabilities.items.insurancePrefill.reason when capabilities is non-null.
// capabilities: null is itself a valid, minimal input — the function
// explicitly short-circuits `if (!capabilities) return true` (after the
// land check), so there is no need to construct a full PropertyCapabilities
// envelope to exercise the residential/land branch this matrix cares about.
// ---------------------------------------------------------------------------

const RESIDENTIAL_CLASSIFICATION: PropertyClassification | null = null;
const LAND_CLASSIFICATION = { parcelUse: { value: "land" } } as unknown as PropertyClassification;

const RESIDENTIAL_ALLOWED = residentialPartnerActionsAllowed(null, RESIDENTIAL_CLASSIFICATION);
const LAND_ALLOWED = residentialPartnerActionsAllowed(null, LAND_CLASSIFICATION);
// Sanity-check the fixtures themselves against isVerifiedLandListing directly
// — if these ever disagree, the fixture is wrong, not the oracle's cell math.
if (isVerifiedLandListing(RESIDENTIAL_CLASSIFICATION) !== false || isVerifiedLandListing(LAND_CLASSIFICATION) !== true) {
  throw new Error(
    "[journey-matrix] fixture sanity check failed: isVerifiedLandListing did not classify the " +
      "residential/land fixtures as expected — land-listing.ts's contract may have changed."
  );
}
if (RESIDENTIAL_ALLOWED !== true || LAND_ALLOWED !== false) {
  throw new Error(
    `[journey-matrix] fixture sanity check failed: residentialPartnerActionsAllowed(null, residential)=` +
      `${RESIDENTIAL_ALLOWED}, residentialPartnerActionsAllowed(null, land)=${LAND_ALLOWED} — expected true/false.`
  );
}

// ---------------------------------------------------------------------------
// ENV_URL_MAP var-name check — src/config/affiliate-vendors.ts keeps a
// private (unexported) ENV_URL_MAP literal keyed by vendor id ->
// `process.env.NEXT_PUBLIC_X` reads (Next.js only inlines static literal
// `process.env.X` member access, so it can't be resolved dynamically — see
// that file's doc comment above ENV_URL_MAP). We are told NOT to read actual
// env values here, only to check that the var NAME a vendor expects is
// actually wired into that map — so this statically parses the map's
// literal source text out of the real file, rather than importing/reading
// process.env. This is reading the module's source for its declared names,
// not its runtime environment.
// ---------------------------------------------------------------------------

function parseEnvUrlMap(): Record<string, string> {
  const filePath = path.join(process.cwd(), "src/config/affiliate-vendors.ts");
  const source = readFileSync(filePath, "utf8");
  const mapStart = source.indexOf("const ENV_URL_MAP");
  if (mapStart === -1) {
    throw new Error("[journey-matrix] could not locate 'const ENV_URL_MAP' in src/config/affiliate-vendors.ts");
  }
  const blockEnd = source.indexOf("\n};", mapStart);
  if (blockEnd === -1) {
    throw new Error("[journey-matrix] could not locate the end of ENV_URL_MAP in src/config/affiliate-vendors.ts");
  }
  const block = source.slice(mapStart, blockEnd);
  const map: Record<string, string> = {};
  const lineRe = /^\s*([a-zA-Z0-9_]+):\s*process\.env\.([A-Z0-9_]+),?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(block))) {
    map[match[1]] = match[2];
  }
  return map;
}

const ENV_URL_MAP_SOURCE = parseEnvUrlMap();

function expectedEnvVarName(vendorId: string, envKey: string | undefined): string {
  return envKey ?? `NEXT_PUBLIC_AFFILIATE_URL_${vendorId.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Date freeze — see the module doc comment for why. Only wrapped around
// vendor resolution (the only real-module call whose output is
// date-dependent); everything else here is a pure function of stage/env
// which we control directly.
// ---------------------------------------------------------------------------

/** Fixed reference instant, NOT a "generated at" timestamp — chosen once so
 *  every run of this script (today, tomorrow, next year) resolves ties the
 *  same way and the snapshot stays reproducible. Deliberately NOT stored as
 *  a "generatedFrom"-adjacent field implying "when this ran". */
const FROZEN_REFERENCE_DATE = "2026-01-02T00:00:00.000Z";

function withFrozenDate<T>(fn: () => T): T {
  const OriginalDate = Date;
  const fixed = new OriginalDate(FROZEN_REFERENCE_DATE).getTime();
  // Only the zero-arg `new Date()` / `Date.now()` paths need freezing here —
  // the only real-module call site that constructs a Date
  // (dayOfYearUTC(d: Date = new Date()) in src/config/affiliate-vendors.ts,
  // invoked with no args by rotateTies()) uses exactly that form. A
  // multi-arg constructor call would be a sign this freeze no longer
  // matches its one intended call site, so it fails loudly instead of
  // silently ignoring the extra args.
  class FrozenDate extends OriginalDate {
    constructor(...args: unknown[]) {
      if (args.length !== 0) {
        throw new Error(
          "[journey-matrix] withFrozenDate's FrozenDate only supports the zero-arg `new Date()` form " +
            "(dayOfYearUTC's default param) — a multi-arg constructor call means a new real-module call " +
            "site now constructs Date differently than expected."
        );
      }
      super(fixed);
    }
    static now() {
      return fixed;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = FrozenDate;
  try {
    return fn();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = OriginalDate;
  }
}

// ---------------------------------------------------------------------------
// Cell type + per-field computation — each function is a thin wrapper that
// calls the REAL imported logic in the same order the real component/route
// does. See the per-function comment for which source file/lines it mirrors.
// ---------------------------------------------------------------------------

type LandingAccess = "none" | "public";
type FormMode = "waitlist" | "wizard-entry";
type WizardOutcome = "not-found" | "excluded-notice" | "not-live-notice" | "wizard";
type HandoffMode = "partner-link" | "mailto-fallback";
type PropertyPageModule = "shown" | "hidden-stage" | "hidden-not-live" | "hidden-excluded" | "hidden-land";
type SwitchSectionState = "shown" | "hidden";

interface Cell {
  key: string;
  stage: InsuranceStage;
  country: Country;
  region: string;
  regionKind: RegionEntry["kind"];
  line: InsuranceLine;
  listingType: ListingType;
  rolloutStatus: RolloutStatus;
  landingAccess: LandingAccess;
  formMode: FormMode;
  wizardOutcome: WizardOutcome;
  resolvedVendor: string | null;
  envVarRegistered: boolean | null;
  handoffMode: HandoffMode;
  propertyPageModule: PropertyPageModule;
  switchSection: SwitchSectionState;
}

/** app/insurance/page.tsx: `if (!stageAtLeast("landing")) notFound();` */
function computeLandingAccess(): LandingAccess {
  return stageAtLeast("landing") ? "public" : "none";
}

/** insurance-landing-form.tsx: `waitlistMode = !intakeEnabled || status !== "live"` */
function computeFormMode(country: Country, region: string): FormMode {
  const intakeEnabled = stageAtLeast("intake");
  const status = statusFor(country, region);
  const waitlistMode = !intakeEnabled || status !== "live";
  return waitlistMode ? "waitlist" : "wizard-entry";
}

/**
 * app/coverage-profile/page.tsx gate order (no listing match assumed —
 * this oracle has no KV to look a slug up against, matching the
 * address-only / no-tracked-listing path):
 *   1. !stageAtLeast("intake")                        -> notFound()   ("not-found" here)
 *   2. INSURANCE_STATE_EXCLUSIONS[country].includes    -> CoverageExcludedNotice
 *   3. INSURANCE_LINE_EXCLUSIONS[country][region]      -> CoverageExcludedNotice
 *   4. !isLive(country, region)                        -> CoverageNotLiveNotice
 *   5. otherwise                                        -> wizard
 * "not-found" is a 4th value beyond the 3 the task brief named
 * (excluded-notice | not-live-notice | wizard) — it's what actually happens
 * below stage=intake (the route 404s outright) and collapsing it into one
 * of the other 3 would misreport real behavior, so it's reported loudly as
 * its own value instead.
 */
function computeWizardOutcome(country: Country, region: string, line: InsuranceLine): WizardOutcome {
  if (!stageAtLeast("intake")) return "not-found";
  if (INSURANCE_STATE_EXCLUSIONS[country].includes(region)) return "excluded-notice";
  if ((INSURANCE_LINE_EXCLUSIONS[country][region] ?? []).includes(line)) return "excluded-notice";
  if (!isLive(country, region)) return "not-live-notice";
  return "wizard";
}

/** resolve-vendor.ts's resolveVendor(country, region, line, vendorParam=null). */
function computeResolvedVendor(
  country: Country,
  region: string,
  line: InsuranceLine
): { id: string | null; envVarRegistered: boolean | null } {
  const vendor = withFrozenDate(() => resolveVendor(country, region, line, null));
  if (!vendor) return { id: null, envVarRegistered: null };
  const expected = expectedEnvVarName(vendor.id, vendor.envKey);
  return { id: vendor.id, envVarRegistered: ENV_URL_MAP_SOURCE[vendor.id] === expected };
}

/** coverage-handoff.tsx: `vendor && resolved ? <partner-link> : <mailto-fallback>` */
function computeHandoffMode(resolvedVendorId: string | null): HandoffMode {
  return resolvedVendorId ? "partner-link" : "mailto-fallback";
}

/**
 * app/property/[slug]/page.tsx wraps <InsuranceModule> in
 * `{showResidentialPartnerActions && <InsuranceModule .../>}` where
 * showResidentialPartnerActions = residentialPartnerActionsAllowed(...) —
 * so a land listing never even mounts the module (checked first, outside
 * it). Once mounted, insurance-module.tsx applies its own gates in this
 * order: stageAtLeast("intake") -> INSURANCE_STATE_EXCLUSIONS (country+
 * region only, NOT line) -> isLive. Line exclusions do NOT hide the module —
 * they swap in a "Licensed broker required" notice inline while the module
 * itself still renders, so that's "shown", not a hidden-* value.
 */
function computePropertyPageModule(country: Country, region: string, listingType: ListingType): PropertyPageModule {
  const allowed = listingType === "land" ? LAND_ALLOWED : RESIDENTIAL_ALLOWED;
  if (!allowed) return "hidden-land";
  if (!stageAtLeast("intake")) return "hidden-stage";
  if (INSURANCE_STATE_EXCLUSIONS[country].includes(region)) return "hidden-excluded";
  if (!isLive(country, region)) return "hidden-not-live";
  return "shown";
}

/** landing/switch-section.tsx: `if (!stageAtLeast("switch")) return null;` */
function computeSwitchSection(): SwitchSectionState {
  return stageAtLeast("switch") ? "shown" : "hidden";
}

// ---------------------------------------------------------------------------
// Mortgage/lending cells — see the module doc comment's "Mortgage/lending
// oracle" section for the modeling rationale (mode="buyer",
// surface="result-buyer", no stage, no line).
// ---------------------------------------------------------------------------

/** src/app/property/[slug]/page.tsx never passes `mode` to PartnerCta/
 *  PartnerCtaRow, so it defaults to "buyer" (see partner-cta.tsx's default
 *  param) — that's the mode every non-/assess property/result page actually
 *  renders with. */
const MORTGAGE_MODE = "buyer" as const;
/** Every property-page PartnerCta/PartnerCtaRow call site passes
 *  surface="result-buyer" (src/app/property/[slug]/page.tsx). */
const MORTGAGE_SURFACE = "result-buyer" as const;

interface MortgageVendorEntry {
  id: string;
  envVarName: string;
  envVarRegistered: boolean;
}

type MortgageSurfaceShown = "shown" | "hidden-land";

interface MortgageCell {
  key: string;
  country: Country;
  region: string;
  regionKind: RegionEntry["kind"];
  listingType: ListingType;
  surfaceShown: MortgageSurfaceShown;
  eligibleVendors: MortgageVendorEntry[];
}

/**
 * getVendorsForSurface(country, region, mode, surface) — the real sort
 * PartnerCta/PartnerCtaRow use (src/components/partner-cta.tsx,
 * src/components/partner-cta-row.tsx): eligibility filter (enabled +
 * country + audienceMode + state gate) from filterEligibleVendors, ordered
 * by the surface's vertical journey priority, then cpaTier desc, then
 * affiliateReady desc, then rotateTies' day-of-year tie-break — same
 * date-freeze concern as insurance vendor resolution, so this is also
 * wrapped in withFrozenDate. The full surface-ordered list mixes verticals
 * (mortgage, insurance, investor-tools, ...); filtering to vertical ===
 * "mortgage" AFTER computing the full order (rather than pre-filtering
 * AFFILIATE_VENDORS to mortgage-only before sorting) preserves the real
 * relative order — including rotateTies' tie-breaking, which operates on
 * contiguous same-vertical/same-cpaTier runs in the FULL sorted array, not
 * on a pre-filtered subset.
 */
function computeMortgageVendors(country: Country, region: string): MortgageVendorEntry[] {
  const ordered = withFrozenDate(() => getVendorsForSurface(country, region, MORTGAGE_MODE, MORTGAGE_SURFACE));
  return ordered
    .filter((v) => v.vertical === "mortgage")
    .map((v) => {
      const envVarName = expectedEnvVarName(v.id, v.envKey);
      return {
        id: v.id,
        envVarName,
        envVarRegistered: ENV_URL_MAP_SOURCE[v.id] === envVarName,
      };
    });
}

/**
 * PartnerCta/PartnerCtaRow on property/result pages are gated entirely by
 * showResidentialPartnerActions = residentialPartnerActionsAllowed(...) — a
 * land listing never mounts the CTA cluster at all (checked outside/before
 * it, same land-containment gate the insurance module uses — see
 * computePropertyPageModule above). There is no stage or exclusion gate on
 * top of that for mortgage (unlike insurance's stage dial / line
 * exclusions) — eligibility alone (computeMortgageVendors) decides what
 * would render if shown.
 */
function computeMortgageSurfaceShown(listingType: ListingType): MortgageSurfaceShown {
  const allowed = listingType === "land" ? LAND_ALLOWED : RESIDENTIAL_ALLOWED;
  return allowed ? "shown" : "hidden-land";
}

function generateMortgageCells(): MortgageCell[] {
  const cells: MortgageCell[] = [];

  for (const region of REGIONS) {
    const eligibleVendors = computeMortgageVendors(region.country, region.code);

    for (const listingType of LISTING_TYPES) {
      cells.push({
        key: `${region.country}-${region.code}|${listingType}`,
        country: region.country,
        region: region.code,
        regionKind: region.kind,
        listingType,
        surfaceShown: computeMortgageSurfaceShown(listingType),
        eligibleVendors,
      });
    }
  }

  cells.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return cells;
}

// ---------------------------------------------------------------------------
// Matrix generation
// ---------------------------------------------------------------------------

interface MatrixHeader {
  generatedFrom: string[];
  vendorTieBreakReferenceDate: string;
  dimensions: {
    stages: InsuranceStage[];
    lines: InsuranceLine[];
    listingTypes: readonly ListingType[];
    regionCount: number;
    caProvinces: string[];
    caTerritories: string[];
    usStatesAndDc: number;
  };
  cellCount: number;
  /** Mortgage/lending oracle metadata — see the module doc comment's
   *  "Mortgage/lending oracle" section. `mortgageCells` (a sibling of
   *  `cells`, not nested under it) carries the actual per-cell data. */
  mortgage: {
    mode: typeof MORTGAGE_MODE;
    surface: typeof MORTGAGE_SURFACE;
    cellCount: number;
  };
}

interface Matrix {
  header: MatrixHeader;
  /** Insurance cells — key format and shape UNCHANGED, see module doc
   *  comment: e2e/support/oracle.ts reads this array and must keep working
   *  without modification. */
  cells: Cell[];
  /** Mortgage/lending cells — separate top-level array, own key format
   *  (`${country}-${region}|${listingType}`, no stage/line component). */
  mortgageCells: MortgageCell[];
}

function generateMatrix(): Matrix {
  const cells: Cell[] = [];

  for (const stage of STAGES) {
    process.env.NEXT_PUBLIC_INSURANCE_STAGE = stage;

    for (const region of REGIONS) {
      for (const line of LINES) {
        const { id: resolvedVendor, envVarRegistered } = computeResolvedVendor(region.country, region.code, line);
        const handoffMode = computeHandoffMode(resolvedVendor);
        const formMode = computeFormMode(region.country, region.code);
        const wizardOutcome = computeWizardOutcome(region.country, region.code, line);
        const rolloutStatus = statusFor(region.country, region.code);

        for (const listingType of LISTING_TYPES) {
          const propertyPageModule = computePropertyPageModule(region.country, region.code, listingType);

          cells.push({
            key: `${stage}|${region.country}-${region.code}|${line}|${listingType}`,
            stage,
            country: region.country,
            region: region.code,
            regionKind: region.kind,
            line,
            listingType,
            rolloutStatus,
            landingAccess: computeLandingAccess(),
            formMode,
            wizardOutcome,
            resolvedVendor,
            envVarRegistered,
            handoffMode,
            propertyPageModule,
            switchSection: computeSwitchSection(),
          });
        }
      }
    }
  }

  delete process.env.NEXT_PUBLIC_INSURANCE_STAGE;

  cells.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const mortgageCells = generateMortgageCells();

  const header: MatrixHeader = {
    generatedFrom: [
      "src/config/insurance-stage.ts",
      "src/config/insurance-rollout.ts",
      "src/config/affiliate-vendors.ts",
      "src/components/insurance/resolve-vendor.ts",
      "src/lib/property-intelligence/land-listing.ts",
    ],
    vendorTieBreakReferenceDate: FROZEN_REFERENCE_DATE,
    dimensions: {
      stages: STAGES,
      lines: LINES,
      listingTypes: LISTING_TYPES,
      regionCount: REGIONS.length,
      caProvinces: CA_REGIONS.map((r) => r.code).sort(),
      caTerritories: [...CA_TERRITORIES].sort(),
      usStatesAndDc: US_STATES.length,
    },
    cellCount: cells.length,
    mortgage: {
      mode: MORTGAGE_MODE,
      surface: MORTGAGE_SURFACE,
      cellCount: mortgageCells.length,
    },
  };

  return { header, cells, mortgageCells };
}

// ---------------------------------------------------------------------------
// Output modes
// ---------------------------------------------------------------------------

const SNAPSHOT_PATH = path.join(process.cwd(), "scripts/journey-matrix.snapshot.json");

function writeSnapshot(matrix: Matrix): void {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(matrix, null, 2) + "\n", "utf8");
  console.log(
    `[journey-matrix] wrote ${matrix.cells.length} insurance cells + ${matrix.mortgageCells.length} mortgage ` +
      `cells to ${SNAPSHOT_PATH}`
  );
}

const CELL_FIELDS: (keyof Cell)[] = [
  "landingAccess",
  "formMode",
  "wizardOutcome",
  "resolvedVendor",
  "envVarRegistered",
  "handoffMode",
  "propertyPageModule",
  "switchSection",
];

/**
 * Live-implies-vendor build guarantee — see module doc comment item 2. Pure
 * enumeration + eligibleInsuranceVendors (date-independent), not derived
 * from `cells` (whose resolvedVendor already picked a single winner via
 * rotateTies — this check needs the full eligible SET, not the pick).
 */
function checkLiveImpliesVendor(): string[] {
  const diffs: string[] = [];

  for (const region of REGIONS) {
    if (statusFor(region.country, region.code) !== "live") continue;
    if (INSURANCE_STATE_EXCLUSIONS[region.country].includes(region.code)) continue; // whole-vertical excluded — never expected to have vendor coverage

    const lineExclusions = INSURANCE_LINE_EXCLUSIONS[region.country][region.code] ?? [];

    for (const line of LINES) {
      if (lineExclusions.includes(line)) continue;

      const eligible = eligibleInsuranceVendors(region.country, region.code, line);
      if (eligible.length === 0) {
        diffs.push(
          `[live-implies-vendor] ${region.country}-${region.code}/${line}: rollout status is "live" and this ` +
            `line is not excluded (INSURANCE_LINE_EXCLUSIONS/INSURANCE_STATE_EXCLUSIONS), but zero enabled, ` +
            `eligible vendors cover it. Remedy: exclude "${line}" for ${region.country}-${region.code} in ` +
            `INSURANCE_LINE_EXCLUSIONS, or enable a vendor whose \`lines\`/coverage includes ` +
            `${region.country}-${region.code}/${line}.`
        );
      }
    }
  }

  return diffs;
}

/**
 * Fallback-floor assertion — see module doc comment item 3. Operates on
 * already-generated cells (formMode/handoffMode are cheap to read off them;
 * no need to recompute).
 */
function checkFallbackFloor(cells: Cell[]): string[] {
  const diffs: string[] = [];
  const VALID_HANDOFF = new Set<HandoffMode>(["mailto-fallback", "partner-link"]);

  for (const cell of cells) {
    if (cell.rolloutStatus === "live") continue; // live cells legitimately reach formMode="wizard-entry"

    const stateExcluded = INSURANCE_STATE_EXCLUSIONS[cell.country].includes(cell.region);
    const lineExcluded = (INSURANCE_LINE_EXCLUSIONS[cell.country][cell.region] ?? []).includes(cell.line);
    if (stateExcluded || lineExcluded) continue; // excluded cells route to CoverageExcludedNotice, not the waitlist floor

    if (cell.formMode !== "waitlist") {
      diffs.push(
        `[fallback-floor] ${cell.key}: rolloutStatus="${cell.rolloutStatus}" (non-live, non-excluded) but ` +
          `formMode="${cell.formMode}" (expected "waitlist")`
      );
    }
    if (!VALID_HANDOFF.has(cell.handoffMode)) {
      diffs.push(
        `[fallback-floor] ${cell.key}: handoffMode="${cell.handoffMode}" is not a recognized fallback path ` +
          `(expected "mailto-fallback" or "partner-link") — no cell may have an undefined/none handoff path`
      );
    }
  }

  return diffs;
}

function runCheck(): void {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`[journey-matrix] --check: no snapshot at ${SNAPSHOT_PATH} — run without flags first to generate it.`);
    process.exit(1);
  }

  const expected: Matrix = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const actual = generateMatrix();

  const diffs: string[] = [];

  if (JSON.stringify(expected.header) !== JSON.stringify(actual.header)) {
    diffs.push(
      `[header] expected=${JSON.stringify(expected.header)}\n         actual=${JSON.stringify(actual.header)}`
    );
  }

  // --- Build guarantees (independent of the snapshot diff below) ---
  diffs.push(...checkLiveImpliesVendor());
  diffs.push(...checkFallbackFloor(actual.cells));

  // --- Insurance cells diff (original behavior, key format unchanged) ---
  const expectedByKey = new Map(expected.cells.map((c) => [c.key, c]));
  const actualByKey = new Map(actual.cells.map((c) => [c.key, c]));

  for (const key of expectedByKey.keys()) {
    if (!actualByKey.has(key)) diffs.push(`[missing] ${key} present in snapshot, absent from regenerated matrix`);
  }
  for (const key of actualByKey.keys()) {
    if (!expectedByKey.has(key)) diffs.push(`[extra] ${key} present in regenerated matrix, absent from snapshot`);
  }

  for (const [key, expCell] of expectedByKey) {
    const actCell = actualByKey.get(key);
    if (!actCell) continue;
    for (const field of CELL_FIELDS) {
      if (expCell[field] !== actCell[field]) {
        diffs.push(`[${key}] ${field}: snapshot=${JSON.stringify(expCell[field])} actual=${JSON.stringify(actCell[field])}`);
      }
    }
  }

  // --- Mortgage cells diff (separate array, own key format) ---
  const expectedMortgage: MortgageCell[] = expected.mortgageCells ?? [];
  const expectedMortgageByKey = new Map(expectedMortgage.map((c) => [c.key, c]));
  const actualMortgageByKey = new Map(actual.mortgageCells.map((c) => [c.key, c]));

  for (const key of expectedMortgageByKey.keys()) {
    if (!actualMortgageByKey.has(key)) {
      diffs.push(`[mortgage missing] ${key} present in snapshot, absent from regenerated matrix`);
    }
  }
  for (const key of actualMortgageByKey.keys()) {
    if (!expectedMortgageByKey.has(key)) {
      diffs.push(`[mortgage extra] ${key} present in regenerated matrix, absent from snapshot`);
    }
  }
  for (const [key, expCell] of expectedMortgageByKey) {
    const actCell = actualMortgageByKey.get(key);
    if (!actCell) continue;
    if (expCell.surfaceShown !== actCell.surfaceShown) {
      diffs.push(`[mortgage ${key}] surfaceShown: snapshot=${expCell.surfaceShown} actual=${actCell.surfaceShown}`);
    }
    const expVendors = JSON.stringify(expCell.eligibleVendors);
    const actVendors = JSON.stringify(actCell.eligibleVendors);
    if (expVendors !== actVendors) {
      diffs.push(`[mortgage ${key}] eligibleVendors: snapshot=${expVendors} actual=${actVendors}`);
    }
  }

  if (diffs.length > 0) {
    console.error(`\n[journey-matrix] --check FAILED: ${diffs.length} diff(s) against ${SNAPSHOT_PATH}\n`);
    for (const d of diffs) console.error(`  - ${d}`);
    console.error(
      "\nEither the snapshot is stale (rerun `npx tsx scripts/journey-matrix.ts` and review the diff before " +
        "committing), one of the imported config/logic modules changed behavior, or (for [live-implies-vendor] / " +
        "[fallback-floor] diffs) a real build guarantee was violated — investigate before assuming any direction.\n"
    );
    process.exit(1);
  }

  console.log(
    `[journey-matrix] --check passed: ${actual.cells.length} insurance cells + ${actual.mortgageCells.length} ` +
      `mortgage cells match ${SNAPSHOT_PATH}; live-implies-vendor and fallback-floor guarantees hold.`
  );
}

function runTable(): void {
  const { cells, mortgageCells } = generateMatrix();

  console.log("=== Insurance ===\n");

  const classes = new Map<string, { count: number; exemplar: Cell; fields: Partial<Cell> }>();
  for (const cell of cells) {
    const fields: Partial<Cell> = {};
    for (const f of CELL_FIELDS) (fields as Record<string, unknown>)[f] = cell[f];
    const classKey = JSON.stringify(fields);
    const existing = classes.get(classKey);
    if (existing) {
      existing.count++;
    } else {
      classes.set(classKey, { count: 1, exemplar: cell, fields });
    }
  }

  const sorted = [...classes.values()].sort((a, b) => b.count - a.count);

  console.log(`[journey-matrix] ${cells.length} cells collapse into ${sorted.length} equivalence classes:\n`);
  sorted.forEach((cls, i) => {
    const f = cls.fields;
    console.log(
      `${String(i + 1).padStart(2, " ")}. (${cls.count} cells) ` +
        `landing=${f.landingAccess} form=${f.formMode} wizard=${f.wizardOutcome} ` +
        `vendor=${f.resolvedVendor ?? "none"}${f.resolvedVendor ? `(env:${f.envVarRegistered ? "ok" : "MISSING"})` : ""} ` +
        `handoff=${f.handoffMode} module=${f.propertyPageModule} switch=${f.switchSection}`
    );
    console.log(`    exemplar: ${cls.exemplar.key}`);
  });

  console.log("\n=== Mortgage/Lending ===\n");
  runMortgageTable(mortgageCells);
}

/**
 * Mortgage equivalence classes — same collapse-by-identical-outcome idea as
 * the insurance table above, keyed on surfaceShown + the ordered vendor id
 * list (env-registration state included, since a vendor with a missing env
 * var is a materially different outcome even at the same eligibility). A
 * "dead zone" — surfaceShown="shown" but zero eligible vendors — is called
 * out with its own loud marker, since that's the severity-1 finding this
 * enumeration exists to catch (see the task report).
 */
function runMortgageTable(mortgageCells: MortgageCell[]): void {
  const classes = new Map<
    string,
    { count: number; exemplar: MortgageCell; surfaceShown: MortgageSurfaceShown; vendorIds: string[] }
  >();

  for (const cell of mortgageCells) {
    const vendorIds = cell.eligibleVendors.map((v) => (v.envVarRegistered ? v.id : `${v.id}(env:MISSING)`));
    const classKey = JSON.stringify({ surfaceShown: cell.surfaceShown, vendorIds });
    const existing = classes.get(classKey);
    if (existing) {
      existing.count++;
    } else {
      classes.set(classKey, { count: 1, exemplar: cell, surfaceShown: cell.surfaceShown, vendorIds });
    }
  }

  const sorted = [...classes.values()].sort((a, b) => b.count - a.count);

  console.log(`[journey-matrix] ${mortgageCells.length} mortgage cells collapse into ${sorted.length} equivalence classes:\n`);
  sorted.forEach((cls, i) => {
    const deadZone = cls.surfaceShown === "shown" && cls.vendorIds.length === 0;
    console.log(
      `${String(i + 1).padStart(2, " ")}. (${cls.count} cells) surfaceShown=${cls.surfaceShown} ` +
        `vendors=[${cls.vendorIds.join(", ") || "NONE"}]${deadZone ? "  <<< DEAD ZONE — surface shown, zero eligible mortgage vendors" : ""}`
    );
    console.log(`    exemplar: ${cls.exemplar.key}`);
  });

  const deadZoneCount = sorted
    .filter((c) => c.surfaceShown === "shown" && c.vendorIds.length === 0)
    .reduce((sum, c) => sum + c.count, 0);
  if (deadZoneCount > 0) {
    console.log(
      `\n[journey-matrix] ${deadZoneCount}/${mortgageCells.length} mortgage cells are DEAD ZONES ` +
        "(surface would render but zero eligible vendors) — see the journey-matrix report for the region list."
    );
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    runCheck();
  } else if (args.includes("--table")) {
    runTable();
  } else {
    writeSnapshot(generateMatrix());
  }
}

main();
