/** Small, framework-independent authorization guards used inside handlers. */

export function authenticatedUserId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Account-owned resources never treat anonymous identity as an owner. */
export function isOwnedByUser(
  requestUserId: string | null | undefined,
  resourceOwnerUserId: string | null | undefined
): boolean {
  const requester = authenticatedUserId(requestUserId);
  const owner = authenticatedUserId(resourceOwnerUserId);
  return requester !== null && owner !== null && requester === owner;
}

/**
 * Coverage-profile handoffs support intentionally anonymous/opted-out rows.
 * Two null owners match; a null owner and an account owner never do.
 */
export function isSameNullableOwner(
  requestUserId: string | null | undefined,
  resourceOwnerUserId: string | null | undefined
): boolean {
  const requester = authenticatedUserId(requestUserId);
  const owner = authenticatedUserId(resourceOwnerUserId);
  return requester === owner;
}

/** Privacy opt-out deliberately severs account attribution. */
export function privacyResolvedOwnerId(
  authenticatedId: string | null | undefined,
  isOptedOut: boolean
): string | null {
  return isOptedOut ? null : authenticatedUserId(authenticatedId);
}

export function ownedBillingCustomerId(
  requestUserId: string | null | undefined,
  subscription: { userId: string; stripeCustomerId: string | null } | null | undefined
): string | null {
  if (!subscription || !isOwnedByUser(requestUserId, subscription.userId)) return null;
  return subscription.stripeCustomerId;
}
