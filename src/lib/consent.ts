/**
 * consent.ts
 *
 * Consent types and helpers for PIPEDA-compliant data handling.
 * Consent state is stored in Clerk's unsafeMetadata per user.
 */

export interface ConsentState {
  /** User consents to behavioral tracking for improving the service */
  analytics: boolean;
  /** User consents to being connected with partner professionals */
  partnerSharing: boolean;
  /** ISO timestamp when consent was last updated */
  updatedAt: string;
  /** Version of the consent terms the user agreed to */
  version: number;
}

/** Current consent terms version. Bump when consent language changes. */
export const CONSENT_VERSION = 1;

/** Default consent state for new users (analytics on, partner sharing off) */
export const DEFAULT_CONSENT: ConsentState = {
  analytics: true,
  partnerSharing: false,
  updatedAt: new Date().toISOString(),
  version: CONSENT_VERSION,
};

/**
 * Extract consent state from Clerk's unsafeMetadata.
 * Returns null if user has never set consent preferences.
 */
export function getConsent(
  unsafeMetadata: Record<string, unknown> | undefined
): ConsentState | null {
  if (!unsafeMetadata?.consent) return null;
  return unsafeMetadata.consent as ConsentState;
}

/**
 * Check if user has consented to analytics tracking.
 */
export function hasAnalyticsConsent(
  unsafeMetadata: Record<string, unknown> | undefined
): boolean {
  const consent = getConsent(unsafeMetadata);
  // If no consent record yet, don't track (must accept first)
  if (!consent) return false;
  return consent.analytics;
}

/**
 * Check if user has consented to partner sharing.
 */
export function hasPartnerConsent(
  unsafeMetadata: Record<string, unknown> | undefined
): boolean {
  const consent = getConsent(unsafeMetadata);
  if (!consent) return false;
  return consent.partnerSharing;
}
