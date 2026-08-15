/**
 * e2e/support/oracle.ts
 *
 * Defensive loader + typed accessors for scripts/journey-matrix.snapshot.json
 * — the config-derived expected-outcome oracle a parallel change on this
 * branch (scripts/journey-matrix.ts) generates. This suite does NOT create
 * or edit that script or its snapshot; it only reads the snapshot when
 * present.
 *
 * Written defensively per the build instructions: this file's shape wasn't
 * known while this suite was first written (built concurrently on the same
 * branch), so nothing here hard-fails if the file is missing, malformed, or
 * has an unexpected shape — every caller in landing.spec.ts/intake.spec.ts
 * has its own inline expected constant (read straight from the source
 * config: src/config/insurance-rollout.ts, src/config/affiliate-vendors.ts,
 * src/config/insurance-stage.ts) as the thing it actually asserts against
 * the rendered page; the oracle is an EXTRA cross-check layered on top, not
 * a dependency. A missing/bad snapshot degrades to "no extra cross-check",
 * logged loudly once — it never silently skips or fails this suite.
 *
 * The snapshot's actual shape (confirmed once the file existed): a flat
 * `cells[]` array keyed `${stage}|${country}-${region}|${line}|${listingType}`,
 * one row per journey-matrix cell (2,560 total: 4 stages x 64 regions x 5
 * lines x 2 listing types). getCell() below looks a specific class up by
 * that same key.
 *
 * One field is deliberately NOT hard-asserted against: `resolvedVendor`.
 * The snapshot's header pins `vendorTieBreakReferenceDate: 2026-01-02` — a
 * fixed date so the snapshot doesn't re-diff every day — but
 * resolveVendor()'s rotateTies() (src/config/affiliate-vendors.ts) rotates
 * Square One/APOLLO by the CURRENT day of year. Confirmed empirically: as
 * of this suite's last run, resolveVendor("CA","BC","homeowner",null)
 * resolves to APOLLO Insurance *today*, while the snapshot (pinned to
 * 2026-01-02) says "squareone" — a real, expected, by-design divergence,
 * not a bug in either file. expectVendorInformational() below only warns.
 */

import { expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SNAPSHOT_PATH = path.resolve(__dirname, "../../scripts/journey-matrix.snapshot.json");

export interface JourneyMatrixCell {
  key: string;
  stage: string;
  country: string;
  region: string;
  regionKind: string;
  line: string;
  listingType: string;
  rolloutStatus: string;
  landingAccess: string;
  formMode: string;
  wizardOutcome: string;
  resolvedVendor: string | null;
  envVarRegistered: boolean | null;
  handoffMode: string;
  propertyPageModule: string;
  switchSection: string;
}

interface JourneyMatrixSnapshot {
  header?: unknown;
  cells?: JourneyMatrixCell[];
}

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(`[e2e/oracle] ${message}`);
}

/**
 * Returns the parsed snapshot, or null if it's missing/unreadable/invalid
 * JSON/missing a `cells` array. Never throws — a broken oracle degrades
 * this suite to "no extra cross-check," it never fails the whole run.
 */
export function loadSnapshot(): JourneyMatrixSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) {
    warnOnce(
      `scripts/journey-matrix.snapshot.json not found at ${SNAPSHOT_PATH} — every test's own inline expected ` +
        "constant (read from the real config source) still runs and is still asserted; this only skips the " +
        "extra oracle cross-check layered on top."
    );
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8")) as JourneyMatrixSnapshot;
    if (!Array.isArray(parsed.cells)) {
      warnOnce(`scripts/journey-matrix.snapshot.json exists but has no "cells" array — treating as unavailable.`);
      return null;
    }
    return parsed;
  } catch (err) {
    warnOnce(
      `scripts/journey-matrix.snapshot.json exists but failed to parse (${
        err instanceof Error ? err.message : String(err)
      }) — treating as unavailable.`
    );
    return null;
  }
}

/** Looks up one cell by the snapshot's own key scheme. Returns null (not a
 *  throw) on a miss — an unrecognized class just gets no extra cross-check. */
export function getCell(
  snapshot: JourneyMatrixSnapshot | null,
  stage: string,
  country: string,
  region: string,
  line: string,
  listingType: "residential" | "land" = "residential"
): JourneyMatrixCell | null {
  if (!snapshot?.cells) return null;
  const key = `${stage}|${country}-${region}|${line}|${listingType}`;
  return snapshot.cells.find((c) => c.key === key) ?? null;
}

/**
 * Hard assertion against one field of an oracle cell — used for the fields
 * that are NOT time-dependent (rolloutStatus, formMode, wizardOutcome,
 * landingAccess, handoffMode, propertyPageModule): if the oracle has an
 * opinion, this suite's rendered-page assertion must agree with it, full
 * stop. A null cell (oracle unavailable/no match) is a no-op — the caller's
 * own inline-constant assertion against the real page is what actually
 * guards that class either way.
 */
export function expectOracleField<K extends keyof JourneyMatrixCell>(
  cell: JourneyMatrixCell | null,
  field: K,
  expected: JourneyMatrixCell[K],
  label: string
): void {
  if (!cell) return;
  expect(cell[field], `oracle mismatch for ${label}.${String(field)} (scripts/journey-matrix.snapshot.json)`).toBe(
    expected
  );
}

/**
 * Informational-only check for `resolvedVendor` — see module doc comment
 * for why this field is pinned to a fixed reference date and legitimately
 * diverges from a live resolveVendor() call on any other day. Warns, never
 * fails.
 */
export function expectVendorInformational(cell: JourneyMatrixCell | null, liveVendorId: string, label: string): void {
  if (!cell || cell.resolvedVendor === null) return;
  if (cell.resolvedVendor !== liveVendorId) {
    warnOnce(
      `${label}: oracle's resolvedVendor is "${cell.resolvedVendor}" (pinned to the snapshot's ` +
        `vendorTieBreakReferenceDate), live resolveVendor() picked "${liveVendorId}" today — expected ` +
        "divergence from Square One/APOLLO's day-of-year tie rotation (rotateTies(), src/config/affiliate-" +
        "vendors.ts), not a failure."
    );
  }
}
