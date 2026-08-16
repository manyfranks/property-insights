import { sha256 } from "@/lib/insurance/domain/submission";
import type { CaseStatusView } from "./cases";

type CasePortalRateLimiter = {
  limit(identifier: string): Promise<{ success: boolean }>;
};

/**
 * The status URL is a capability. Any unavailable or errored abuse-control
 * dependency must look exactly like an unknown capability, rather than
 * revealing infrastructure state or allowing an unbounded lookup path.
 */
export async function casePortalRateLimitAllowsAccess({
  ip,
  accessToken,
  ipLimiter,
  tokenLimiter,
  isProduction,
}: {
  ip: string;
  accessToken: string;
  ipLimiter: CasePortalRateLimiter | null;
  tokenLimiter: CasePortalRateLimiter | null;
  isProduction: boolean;
}): Promise<boolean> {
  if ((!ipLimiter || !tokenLimiter) && isProduction) {
    console.error("insurance-portal: rate limiter unavailable — failing closed");
    return false;
  }

  try {
    // Per-IP limiter first and keyed on IP alone (no token material), so an
    // attacker guessing many distinct tokens from one IP still shares a single
    // budget instead of getting a fresh bucket per guess.
    if (ipLimiter) {
      const result = await ipLimiter.limit(ip);
      if (!result.success) return false;
    }
    if (tokenLimiter) {
      const result = await tokenLimiter.limit(`${ip}:${sha256(accessToken).slice(0, 16)}`);
      if (!result.success) return false;
    }
    return true;
  } catch {
    // Do not attach the caught error: provider errors can include request
    // identifiers, and this log must never disclose capability material.
    console.error("insurance-portal: rate limiter failed — failing closed");
    return false;
  }
}

/** Keeps an absent, revoked, or expired capability silent and indistinguishable. */
export async function readCaseStatusForPortal({
  accessToken,
  isDatabaseAvailable,
  readCaseStatus,
}: {
  accessToken: string;
  isDatabaseAvailable: boolean;
  readCaseStatus: (token: string) => Promise<CaseStatusView | null>;
}): Promise<CaseStatusView | null> {
  if (!isDatabaseAvailable) {
    console.error("insurance-portal: database unavailable — failing closed");
    return null;
  }

  try {
    return await readCaseStatus(accessToken);
  } catch {
    console.error("insurance-portal: case lookup failed — failing closed");
    return null;
  }
}
