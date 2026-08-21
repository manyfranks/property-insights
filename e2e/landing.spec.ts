/**
 * e2e/landing.spec.ts — "stage-landing" project (NEXT_PUBLIC_INSURANCE_STAGE=landing).
 *
 * Journey classes covered here all share one fact about this stage:
 * stageAtLeast("intake") is false everywhere (src/config/insurance-stage.ts),
 * so InsuranceLanding always renders with intakeEnabled=false — the pill
 * widget's CTA is always in waitlist mode, for every region, even BC/live,
 * because insurance-landing-form.tsx's `waitlistMode = !intakeEnabled ||
 * status !== "live"` short-circuits on the first half. That's the whole
 * point of this stage as a distinct equivalence class from "intake" (see
 * intake.spec.ts) — same rollout config, different rendered CTA.
 *
 * Expected values below are read directly from the source-of-truth config
 * (src/config/insurance-rollout.ts, src/config/affiliate-vendors.ts) — that's
 * what every hard assertion here checks the rendered page against — and
 * additionally hard-cross-checked against scripts/journey-matrix.snapshot.json's
 * matching cell when it exists (e2e/support/oracle.ts; that file is produced
 * by a parallel change on this branch — this suite still runs and still
 * asserts real behavior even on a run where it doesn't exist yet).
 */

import { test, expect, type Page } from "@playwright/test";
import { loadSnapshot, getCell, expectOracleField } from "./support/oracle";
import { deleteE2eWaitlistRows, E2E_WAITLIST_EMAIL } from "./support/db-cleanup";

const snapshot = loadSnapshot();

function geo(country: string, region: string) {
  return { "x-vercel-ip-country": country, "x-vercel-ip-country-region": region };
}

/** Reveals the waitlist email row via the pill's primary CTA (first click
 *  only reveals it — see insurance-landing-form.tsx's handlePrimaryCta doc
 *  comment) and returns the email input locator. */
async function revealWaitlistRow(page: Page) {
  const emailInput = page.getByPlaceholder("you@email.com");
  await expect(emailInput).toHaveCount(0);
  await page.getByRole("button", { name: /waitlist/i }).first().click();
  await expect(emailInput).toBeVisible();
  return emailInput;
}

test.describe("BC visitor (live region, landing-only stage)", () => {
  test.use({ extraHTTPHeaders: geo("CA", "BC") });

  test("hero, CTA, partner strip, and FAQ all match the config-derived expectation", async ({ page }) => {
    const res = await page.goto("/insurance");
    expect(res?.status()).toBe(200);

    // Scoped to the hero pill (#insurance-hero, HERO_ANCHOR_ID) — the same
    // status text also renders in the FinalCta section's own copy of
    // InsuranceLandingForm further down the page, so an unscoped match hits
    // both (Playwright strict mode).
    await expect(page.locator("#insurance-hero").getByText("Live in British Columbia", { exact: true })).toBeVisible();

    const cta = page.getByRole("button", { name: /waitlist/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/waitlist/i);

    const bcCell = getCell(snapshot, "landing", "CA", "BC", "homeowner");
    expectOracleField(bcCell, "formMode", "waitlist", "landing/CA-BC/homeowner");
    expectOracleField(bcCell, "rolloutStatus", "live", "landing/CA-BC/homeowner");

    // Partner strip: Square One + APOLLO Insurance are the only two enabled
    // CA insurance vendors (src/config/affiliate-vendors.ts) — the strip
    // hides itself below 2 names (partner-strip.tsx), so seeing it at all
    // already implies >=2; assert both names explicitly.
    await expect(page.getByText("Insurance partners currently shown include")).toBeVisible();
    await expect(page.getByText("Square One", { exact: true })).toBeVisible();
    await expect(page.getByText("APOLLO Insurance", { exact: true })).toBeVisible();

    await expect(page.locator("details")).toHaveCount(9);
  });

  test("waitlist email row is hidden until the CTA is clicked, then revealed", async ({ page }) => {
    await page.goto("/insurance");
    await revealWaitlistRow(page);
  });
});

test.describe("AB visitor (next/rolling-out region)", () => {
  test.use({ extraHTTPHeaders: geo("CA", "AB") });

  test("hero status reflects rolling-out, not live; CTA stays in waitlist mode", async ({ page }) => {
    await page.goto("/insurance");

    // statusFor("CA","AB") is "next" (src/config/insurance-rollout.ts CA_REGIONS)
    // -> heroStatusText renders "Opening in Alberta soon", never "Live in Alberta".
    await expect(page.locator("#insurance-hero").getByText("Opening in Alberta soon", { exact: true })).toBeVisible();
    await expect(page.getByText("Live in Alberta", { exact: true })).toHaveCount(0);

    const abCell = getCell(snapshot, "landing", "CA", "AB", "homeowner");
    expectOracleField(abCell, "rolloutStatus", "next", "landing/CA-AB/homeowner");
    expectOracleField(abCell, "formMode", "waitlist", "landing/CA-AB/homeowner");

    await expect(page.getByRole("button", { name: /waitlist/i }).first()).toBeVisible();
  });
});

test.describe("US (TX) visitor (preview, zero enabled US insurance vendors)", () => {
  test.use({ extraHTTPHeaders: geo("US", "TX") });

  test("preview state; no partner strip; no no-lead-auction section", async ({ page }) => {
    const res = await page.goto("/insurance");
    expect(res?.status()).toBe(200);

    // statusFor("US","TX") is "preview" (only WA is in US_UNAVAILABLE) ->
    // heroStatusText renders "Texas · preview".
    await expect(page.locator("#insurance-hero").getByText("Texas · preview", { exact: true })).toBeVisible();

    // Every enabled=true US insurance vendor check: none exist today (The
    // Zebra/Allstate/SmartFinancial/Insurify/Steadily/Obie are all
    // enabled:false in src/config/affiliate-vendors.ts) -> PartnerStrip
    // returns null below 2 names, NoLeadAuction returns null at 0 vendors.
    await expect(page.getByText("Insurance partners currently shown include")).toHaveCount(0);
    await expect(page.getByText("No lead auction", { exact: true })).toHaveCount(0);
    await expect(page.getByText("One match. Not a phone that won", { exact: false })).toHaveCount(0);

    const txCell = getCell(snapshot, "landing", "US", "TX", "homeowner");
    expectOracleField(txCell, "rolloutStatus", "preview", "landing/US-TX/homeowner");
    expectOracleField(txCell, "formMode", "waitlist", "landing/US-TX/homeowner");
    // No enabled US insurance vendor -> the oracle's own handoffMode records
    // the mailto fallback rather than a partner link, agreeing with "no
    // partner strip, no no-lead-auction section" above from a different
    // angle (config-derived, not DOM-derived).
    expectOracleField(txCell, "handoffMode", "mailto-fallback", "landing/US-TX/homeowner");
    expectOracleField(txCell, "resolvedVendor", null, "landing/US-TX/homeowner");
  });
});

test.describe("/coverage-profile gate", () => {
  test("404s at landing stage regardless of geo (stageAtLeast('intake') is false)", async ({ page }) => {
    const res = await page.goto(
      "/coverage-profile?country=CA&region=BC&line=homeowner&address=195%20Atkins%20Rd"
    );
    expect(res?.status()).toBe(404);
  });
});

test.describe("A1 case portal default-deny", () => {
  test("404s while the server-only portal flag is off and sets capability-safe headers", async ({ page }) => {
    const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const res = await page.goto(`/insurance/case/${token}`);
    expect(res?.status()).toBe(404);
    expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
    // Next dev replaces next.config's production `private, no-store` value on
    // a shared not-found response with `no-cache, must-revalidate`. Both keep
    // this generic 404 from being reused without revalidation; prod-smoke.ts
    // separately enforces the stronger live `no-store` contract.
    const cacheControl = res?.headers()["cache-control"] ?? "";
    expect(
      cacheControl.includes("no-store") ||
        (cacheControl.includes("no-cache") && cacheControl.includes("must-revalidate"))
    ).toBe(true);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  });
});

test.describe("waitlist POST via real page interaction", () => {
  test.use({ extraHTTPHeaders: geo("CA", "BC") });

  test.afterAll(async () => {
    // Cleanup regardless of pass/fail — a failed assertion mid-test can
    // still have successfully written the row. Fail loud if cleanup itself
    // fails (never swallow — see e2e/support/db-cleanup.ts), but don't let
    // a cleanup failure mask a real assertion failure above it: report both.
    const deleted = await deleteE2eWaitlistRows();
    if (deleted === 0) {
      console.warn(
        `[e2e/landing.spec] cleanup deleted 0 rows for ${E2E_WAITLIST_EMAIL} — either the submit test didn't ` +
          "reach a successful POST, or a previous run already cleaned it up."
      );
    }
  });

  test("fill email, submit, see success state", async ({ page }) => {
    await page.goto("/insurance");
    const emailInput = await revealWaitlistRow(page);
    await emailInput.fill(E2E_WAITLIST_EMAIL);
    await page.getByRole("button", { name: "Notify me" }).click();
    await expect(page.getByText("You're on the list", { exact: false })).toBeVisible();
  });
});
