/**
 * e2e/intake.spec.ts — "stage-intake" project (NEXT_PUBLIC_INSURANCE_STAGE=intake).
 *
 * Covers the /coverage-profile wizard's gates (exclusions, not-live,
 * live-and-walkable) and confirms /insurance's CTA switches out of waitlist
 * mode once intake is reached. See src/app/coverage-profile/page.tsx for
 * the gate order this file's tests are keyed to: exclusions
 * (INSURANCE_STATE_EXCLUSIONS / INSURANCE_LINE_EXCLUSIONS) before rollout
 * (isLive()) before the actual wizard.
 *
 * The consent-copy test resolves the expected vendor via the SAME pure
 * function the wizard itself calls (resolveVendor(), src/components/
 * insurance/resolve-vendor.ts) rather than hardcoding a vendor name:
 * Square One and APOLLO Insurance are tied (both cpaTier 1, both eligible
 * for CA/BC/homeowner — see src/config/affiliate-vendors.ts) and
 * `rotateTies()` in that file swaps which one sorts first by day-of-year,
 * by design (see that function's doc comment). Hardcoding "Square One"
 * would make this test flip flaky depending on what day it runs.
 */

import { test, expect } from "@playwright/test";
import { resolveVendor, regionFullName } from "../src/components/insurance/resolve-vendor";
import { loadSnapshot, getCell, expectOracleField, expectVendorInformational } from "./support/oracle";

const snapshot = loadSnapshot();

function geo(country: string, region: string) {
  return { "x-vercel-ip-country": country, "x-vercel-ip-country-region": region };
}

function coverageProfileUrl(params: Record<string, string>): string {
  return `/coverage-profile?${new URLSearchParams(params).toString()}`;
}

test.describe("BC + homeowner + address (live, walkable)", () => {
  test.use({ extraHTTPHeaders: geo("CA", "BC") });

  test("step 1 shows Known prefill; walks to step 4; consent names the resolved vendor + referral fee (no submit)", async ({
    page,
  }) => {
    const res = await page.goto(
      coverageProfileUrl({ country: "CA", region: "BC", line: "homeowner", address: "195 Atkins Rd" })
    );
    expect(res?.status()).toBe(200);

    // Step 1 of 4 — the Address confirm row always renders with
    // source="known" (coverage-profile-wizard.tsx's ConfirmRow), so the
    // "Known" provenance chip is visible regardless of whether this exact
    // address happens to be a tracked KV listing today.
    await expect(page.getByText("Confirm the property", { exact: true })).toBeVisible();
    await expect(page.getByText("Known", { exact: true }).first()).toBeVisible();

    // Step 1 -> 2 ("What are you insuring?")
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("What are you insuring?", { exact: true })).toBeVisible();

    // Step 2 -> 3 ("How is it occupied?") — homeowner is already selected
    // from the URL's line=homeowner, but click it anyway for a real
        // interaction rather than relying on the preselected default.
    await page.getByRole("button", { name: /Homeowner/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("How is it occupied?", { exact: true })).toBeVisible();

    // Step 3 requires all four underwriting selects/picks before Continue
    // unlocks (step3Ready in coverage-profile-wizard.tsx) — real
    // clicks/selects, not a shortcut.
    await page.getByRole("button", { name: /Owner-occupied/ }).click();
    await page.getByLabel("Units in the building").selectOption("1");
    await page.getByLabel("Claims in the last 5 years").selectOption("0");
    await page.getByLabel("Roof / systems age").selectOption("Under 5 years");
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Step 4 of 4 — consent copy. Resolve the same vendor the wizard itself
    // resolves (see module doc comment for why this isn't a hardcoded name).
    // 2026-08-15 (Sprint C "say true things"): title updated from "Where
    // should the broker reach you?" — the broker doesn't receive contact
    // info automatically today (no Stage 2/3 handoff transmission built
    // yet), so "we" (Property Insights, who actually stores it) replaced
    // "the broker" here to match coverage-profile-wizard.tsx's STEP_META fix.
    await expect(page.getByText("Where should the broker reach you?", { exact: true })).toBeVisible();
    const expectedVendor = resolveVendor("CA", "BC", "homeowner", null);
    expect(expectedVendor, "expected an eligible CA/BC/homeowner insurance vendor to resolve").not.toBeNull();
    const vendorName = expectedVendor!.name;

    const bcCell = getCell(snapshot, "intake", "CA", "BC", "homeowner");
    expectOracleField(bcCell, "rolloutStatus", "live", "intake/CA-BC/homeowner");
    expectOracleField(bcCell, "formMode", "wizard-entry", "intake/CA-BC/homeowner");
    expectOracleField(bcCell, "wizardOutcome", "wizard", "intake/CA-BC/homeowner");
    // resolvedVendor is informational-only (soft) — the oracle pins it to a
    // fixed reference date (2026-01-02) while this assertion uses the SAME
    // resolveVendor() call live, today, on purpose (see this file's and
    // e2e/support/oracle.ts's doc comments); the two are expected to
    // disagree on days the tie-rotation lands differently.
    expectVendorInformational(bcCell, expectedVendor!.id, "intake/CA-BC/homeowner");

    const consentLabel = page.getByText(/I understand Property Insights may earn a referral fee/, {
      exact: false,
    });
    await expect(consentLabel).toBeVisible();
    await expect(consentLabel).toContainText(vendorName);
    await expect(consentLabel).toContainText("referral fee");
    await expect(consentLabel).toContainText(regionFullName("BC"));

    // DO NOT submit: no consent checkbox check, no contact fields, no click
    // on "Get matched" — this test writes nothing to the shared prod DB and
    // never trips the coverage-profile rate limiter (5 req/min/IP).
    await expect(page.getByRole("button", { name: "Get matched" })).toBeVisible();
  });
});

test.describe("BC + strata (line exclusion)", () => {
  test.use({ extraHTTPHeaders: geo("CA", "BC") });

  test("shows the excluded notice, not the wizard", async ({ page }) => {
    await page.goto(
      coverageProfileUrl({ country: "CA", region: "BC", line: "strata", address: "1 E2E Journey Test St" })
    );
    await expect(page.getByText("Insurance matching isn't available in BC yet.", { exact: true })).toBeVisible();
    await expect(page.getByText("Confirm the property")).toHaveCount(0);

    const cell = getCell(snapshot, "intake", "CA", "BC", "strata");
    expectOracleField(cell, "wizardOutcome", "excluded-notice", "intake/CA-BC/strata");
  });
});

test.describe("QC (whole-province exclusion)", () => {
  test.use({ extraHTTPHeaders: geo("CA", "QC") });

  test("shows the excluded notice", async ({ page }) => {
    await page.goto(
      coverageProfileUrl({ country: "CA", region: "QC", line: "homeowner", address: "1 E2E Journey Test St" })
    );
    await expect(page.getByText("Insurance matching isn't available in QC yet.", { exact: true })).toBeVisible();

    const cell = getCell(snapshot, "intake", "CA", "QC", "homeowner");
    expectOracleField(cell, "rolloutStatus", "unavailable", "intake/CA-QC/homeowner");
    expectOracleField(cell, "wizardOutcome", "excluded-notice", "intake/CA-QC/homeowner");
  });
});

test.describe("WA (US whole-state exclusion)", () => {
  test.use({ extraHTTPHeaders: geo("US", "WA") });

  test("shows the excluded notice", async ({ page }) => {
    await page.goto(
      coverageProfileUrl({ country: "US", region: "WA", line: "homeowner", address: "1 E2E Journey Test St" })
    );
    await expect(page.getByText("Insurance matching isn't available in WA yet.", { exact: true })).toBeVisible();

    const cell = getCell(snapshot, "intake", "US", "WA", "homeowner");
    expectOracleField(cell, "rolloutStatus", "unavailable", "intake/US-WA/homeowner");
    expectOracleField(cell, "wizardOutcome", "excluded-notice", "intake/US-WA/homeowner");
  });
});

test.describe("AB (on the roadmap, not yet live)", () => {
  test.use({ extraHTTPHeaders: geo("CA", "AB") });

  test("shows the not-live notice, names Alberta, links back to /insurance", async ({ page }) => {
    await page.goto(
      coverageProfileUrl({ country: "CA", region: "AB", line: "homeowner", address: "1 E2E Journey Test St" })
    );
    await expect(page.getByText("Insurance matching isn't live in Alberta yet.", { exact: true })).toBeVisible();
    await expect(page.getByText("Alberta", { exact: false }).first()).toBeVisible();
    const link = page.getByRole("link", { name: "Join the waitlist" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/insurance");

    const cell = getCell(snapshot, "intake", "CA", "AB", "homeowner");
    expectOracleField(cell, "rolloutStatus", "next", "intake/CA-AB/homeowner");
    expectOracleField(cell, "wizardOutcome", "not-live-notice", "intake/CA-AB/homeowner");
  });
});

test.describe("US TX + landlord (all-US preview, not yet live)", () => {
  test.use({ extraHTTPHeaders: geo("US", "TX") });

  test("shows the not-live notice", async ({ page }) => {
    await page.goto(
      coverageProfileUrl({ country: "US", region: "TX", line: "landlord", address: "1 E2E Journey Test St" })
    );
    await expect(page.getByText("isn't live in TX yet", { exact: false })).toBeVisible();

    const cell = getCell(snapshot, "intake", "US", "TX", "landlord");
    expectOracleField(cell, "rolloutStatus", "preview", "intake/US-TX/landlord");
    expectOracleField(cell, "wizardOutcome", "not-live-notice", "intake/US-TX/landlord");
  });
});

test.describe("/insurance at intake stage", () => {
  test.use({ extraHTTPHeaders: geo("CA", "BC") });

  test("BC's CTA is wizard-entry mode, not waitlist mode", async ({ page }) => {
    await page.goto("/insurance");
    const cta = page.getByRole("button", { name: "Check my address" }).first();
    await expect(cta).toBeVisible();
    await expect(cta).not.toContainText(/waitlist/i);

    const cell = getCell(snapshot, "intake", "CA", "BC", "homeowner");
    expectOracleField(cell, "formMode", "wizard-entry", "intake/CA-BC/homeowner (landing CTA)");
  });
});

// ---------------------------------------------------------------------------
// Property-page module (insurance-module.tsx, rendered on /property/[slug])
// deliberately SKIPPED — no stable fixture exists.
// ---------------------------------------------------------------------------
test.describe("property-page insurance module", () => {
  test.skip(
    true,
    "No stable /property/[slug] fixture: getListingBySlug() (src/lib/kv/listings.ts) reads live Upstash KV " +
      "whenever KV_REST_API_URL is configured (it is, via .env.local, for this repo's dev servers) rather than " +
      "the static PRELOADED_LISTINGS fallback, and per MEMORY.md the KV listing set is refreshed by a daily " +
      "pipeline (src/app/api/pipeline/refresh) plus a weekly freshness cron that removes sold/delisted listings " +
      "(src/app/api/pipeline/freshness) — no slug is guaranteed to exist, let alone stay in a fixed province/line " +
      "combination, across runs. Pinning a specific slug would make this test flaky (or silently vacuous once " +
      "the listing rotates out) rather than a real journey-class check; skipping with this documented reason per " +
      "the build instructions rather than shipping that."
  );
  test("insurance-module.tsx classes on a tracked listing's result page", async () => {
    // Intentionally empty — see test.skip() reason above.
  });
});
