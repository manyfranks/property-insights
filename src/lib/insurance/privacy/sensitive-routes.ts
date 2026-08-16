const INSURANCE_CAPABILITY_PREFIX = "/insurance/case/";

/** Capability URLs can reveal access credentials and must never enter analytics. */
export function isSensitiveInsuranceCapabilityPath(pathname: string): boolean {
  return pathname === "/insurance/case" || pathname.startsWith(INSURANCE_CAPABILITY_PREFIX);
}

/** PostHog's before_send hook receives loosely typed event properties. */
export function postHogEventContainsInsuranceCapability(
  event: { properties?: Record<string, unknown> } | null | undefined
): boolean {
  if (!event?.properties) return false;
  const forbiddenPayloadKey = /^(caseId|caseAccessToken|caseAccessPath|consent|consentText|submissionId|submissionAnswers)$/i;
  if (Object.keys(event.properties).some((key) => forbiddenPayloadKey.test(key))) return true;
  for (const key of ["$current_url", "$pathname", "$referrer", "current_url", "path"]) {
    const value = event.properties[key];
    if (typeof value !== "string") continue;
    try {
      const pathname = value.startsWith("http") ? new URL(value).pathname : value.split("?")[0];
      if (isSensitiveInsuranceCapabilityPath(pathname)) return true;
    } catch {
      if (value.includes(INSURANCE_CAPABILITY_PREFIX)) return true;
    }
  }
  return false;
}
