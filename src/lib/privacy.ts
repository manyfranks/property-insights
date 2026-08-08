/**
 * privacy.ts
 *
 * Shared "Do Not Sell or Share My Personal Information" opt-out primitives.
 *
 * Mechanism (distinct from src/lib/consent.ts's opt-in banner): a
 * per-browser cookie plus honoring the Global Privacy Control (GPC) signal,
 * per the 12-state US requirement (see docs/legal/US-EXPANSION-LEGAL-BRIEFING.md).
 * The cookie is intentionally NOT httpOnly — it must be readable and
 * writable from client components (the privacy-choices toggle, partner-cta,
 * track-view) as well as inspected on the server for API gating.
 */

/** Cookie name carrying the opt-out preference. Value "1" means opted out. */
export const OPT_OUT_COOKIE = "pi_dns";

/** ~1 year, in seconds — matches typical US state opt-out signal retention practice. */
const OPT_OUT_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Global Privacy Control is exposed by supporting browsers/extensions as
 * `navigator.globalPrivacyControl` (boolean) and as a `Sec-GPC: 1` request
 * header. Not in lib.dom.d.ts, so we read it via an untyped lookup.
 */
export function hasGpcSignal(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Reads the raw opt-out cookie from document.cookie. Client-only. */
export function hasOptOutCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((pair) => pair === `${OPT_OUT_COOKIE}=1`);
}

/**
 * True if this browser is currently opted out — either the cookie is set
 * (from a prior explicit choice, or a prior GPC auto-honor) or a live GPC
 * signal is present right now.
 */
export function isOptedOutClient(): boolean {
  return hasOptOutCookie() || hasGpcSignal();
}

/** Sets or clears the opt-out cookie. Client-only. */
export function setOptOutCookie(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) {
    document.cookie = `${OPT_OUT_COOKIE}=1; path=/; max-age=${OPT_OUT_MAX_AGE}; SameSite=Lax`;
  } else {
    document.cookie = `${OPT_OUT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

/**
 * Server-side check for API routes: true when the request carries a live
 * GPC header (Sec-GPC: 1) or the opt-out cookie. Works against the standard
 * `Request` object (Next.js route handlers).
 */
export function isOptedOutRequest(req: Request): boolean {
  if (req.headers.get("Sec-GPC") === "1") return true;

  const cookieHeader = req.headers.get("cookie") ?? req.headers.get("Cookie");
  if (!cookieHeader) return false;

  return cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .some((pair) => pair === `${OPT_OUT_COOKIE}=1`);
}
