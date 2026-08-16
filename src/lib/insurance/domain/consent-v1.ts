/**
 * lib/insurance/domain/consent-v1.ts
 *
 * The frozen "coverage-profile-consent-v1" text (owner+counsel approved),
 * extracted byte-identical out of coverage-profile-wizard.tsx (code-review
 * finding F4) so the server can recompute the exact string the client was
 * shown. Vendor/region-aware — it's a function of (vendorName, regionName),
 * not a static string — because the wizard resolves a vendor per coverage
 * line and swaps in a fee-disclosure sentence only when one resolves.
 *
 * No React/Next/browser import: safe to import from both the client wizard
 * (src/components/insurance/coverage-profile-wizard.tsx) and server code —
 * the A1 dual-write path (src/app/api/coverage-profile/route.ts) recomputes
 * this text from the same (vendor, region) inputs the client rendered it
 * from and rejects a submission whose `consentText` doesn't match: a
 * mismatch means a stale client or tampering, and silently storing it under
 * the v1 label would corrupt the audit artifact.
 */

/**
 * Copy with [Brokerage Name]/[Region] filled at render time. The
 * fee-disclosure sentence only appears here — the vendor actually resolved
 * to a paid affiliate/referral relationship — never in the no-vendor
 * variant below, where no fee arrangement exists.
 *
 * 2026-08-15 (Sprint C "say true things"): rewritten from "share my
 * property details with {vendor} ... so they can contact me" — that
 * described an automatic data handoff to the vendor that doesn't exist
 * today (the handoff is a plain tracked link; prefill is Stage 3,
 * unbuilt — see coverage-handoff.tsx's doc comment). The true mechanism:
 * consent saves the profile with Property Insights and clears the way to
 * continue to the vendor, who receives nothing until the user follows that
 * link and engages with the vendor's own site directly.
 */
// CONSENT TEXT IS OWNER+COUNSEL APPROVED — DO NOT EDIT without explicit
// owner sign-off. This is authorization language, not a description of
// current mechanics: the user grants permission for the sharing the
// privacy policy's coverage-profile amendment describes ("shared only
// with your explicit consent"), which covers the operator-notification
// email, manual routing on the fallback path, and future prefill — even
// though today's handoff link itself transmits no data. Descriptive UI
// copy elsewhere must stay truthful about mechanics (Sprint C), but
// narrowing THIS text would undercut the consent basis the amendment
// relies on. (A 2026-08-15 truth-sweep rewrite was reverted for exactly
// that reason.)
export function consentTextWithVendor(vendorName: string, regionName: string): string {
  return (
    `Yes — share my property details with ${vendorName} (licensed in ${regionName}) so they can contact me ` +
    `about insurance. I understand Property Insights may earn a referral fee if I do business with them, ` +
    `and that ${vendorName} alone provides any insurance quotes, advice, or coverage.`
  );
}

/**
 * Copy for the mailto fallback path (no resolved vendor). No fee sentence —
 * this isn't a sponsored placement. Same owner-approved-authorization rule
 * as consentTextWithVendor above: do not edit without owner sign-off.
 */
export const CONSENT_TEXT_WITHOUT_VENDOR =
  "Yes — share my property details with a licensed insurance brokerage for my region so they can contact " +
  "me about insurance. Any insurance quotes, advice, or coverage come from that licensed brokerage — " +
  "Property Insights does not sell, quote, or bind insurance.";

/**
 * The exact consent-v1 text for a given resolution outcome — the same
 * ternary the wizard evaluates (resolvedVendor ? consentTextWithVendor(...)
 * : CONSENT_TEXT_WITHOUT_VENDOR), factored out once so the client render
 * and the server-side recomputation in the A1 dual-write path can't drift.
 */
export function coverageProfileConsentTextV1(vendorName: string | null, regionName: string): string {
  return vendorName ? consentTextWithVendor(vendorName, regionName) : CONSENT_TEXT_WITHOUT_VENDOR;
}
