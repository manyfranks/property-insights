/**
 * Deterministic authorization/ownership regression checks.
 *
 * No Clerk, Stripe, Neon, Upstash, provider, or network calls are made.
 * These exercise the same pure guards used by the route and persistence
 * boundaries, plus the case-portal dependency seam.
 */

import assert from "node:assert/strict";
import {
  authenticatedUserId,
  isOwnedByUser,
  isSameNullableOwner,
  ownedBillingCustomerId,
  privacyResolvedOwnerId,
} from "../src/lib/security/authorization";
import {
  caseCapabilityAllowsAccess,
} from "../src/lib/insurance/application/cases";
import { hashAccessToken } from "../src/lib/insurance/domain/submission";
import { readCaseStatusForPortal } from "../src/lib/insurance/application/case-portal";

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => console.log(`  ✓ ${name}`));
}

async function main(): Promise<void> {
  console.log("\nAuth and ownership regressions\n");

  await test("unauthenticated identities are rejected by handler-local guards", () => {
    assert.equal(authenticatedUserId(null), null);
    assert.equal(authenticatedUserId(undefined), null);
    assert.equal(authenticatedUserId(""), null);
    assert.equal(authenticatedUserId("user_owner"), "user_owner");
  });

  await test("account-owned assessment state rejects cross-owner and anonymous access", () => {
    assert.equal(isOwnedByUser("user_owner", "user_owner"), true);
    assert.equal(isOwnedByUser("user_other", "user_owner"), false);
    assert.equal(isOwnedByUser(null, "user_owner"), false);
    assert.equal(isOwnedByUser("user_owner", null), false);
    assert.equal(isOwnedByUser(null, null), false);
  });

  await test("billing customer selection rejects a mismatched subscription owner", () => {
    const ownerSubscription = { userId: "user_owner", stripeCustomerId: "cus_owner" };
    assert.equal(ownedBillingCustomerId("user_owner", ownerSubscription), "cus_owner");
    assert.equal(ownedBillingCustomerId("user_other", ownerSubscription), null);
    assert.equal(ownedBillingCustomerId(null, ownerSubscription), null);
    assert.equal(ownedBillingCustomerId("user_owner", null), null);
  });

  await test("coverage-profile ownership preserves anonymous writes without crossing account owners", () => {
    assert.equal(privacyResolvedOwnerId("user_owner", false), "user_owner");
    assert.equal(privacyResolvedOwnerId("user_owner", true), null);
    assert.equal(privacyResolvedOwnerId(null, false), null);
    assert.equal(isSameNullableOwner("user_owner", "user_owner"), true);
    assert.equal(isSameNullableOwner("user_other", "user_owner"), false);
    assert.equal(isSameNullableOwner(null, "user_owner"), false);
    assert.equal(isSameNullableOwner("user_owner", null), false);
    assert.equal(isSameNullableOwner(null, null), true);
  });

  const token = Buffer.alloc(32, 7).toString("base64url");
  const otherToken = Buffer.alloc(32, 8).toString("base64url");
  const tokenHash = hashAccessToken(token);
  const otherTokenHash = hashAccessToken(otherToken);
  const now = new Date("2026-08-21T12:00:00.000Z");
  const activeCapability = {
    presentedTokenHash: tokenHash,
    storedTokenHash: tokenHash,
    revokedAt: null,
    expiresAt: "2026-08-22T12:00:00.000Z",
    status: "READY_FOR_SUBMISSION" as const,
    now,
  };

  await test("insurance bearer capabilities are hashed deterministically without retaining raw tokens", () => {
    assert.equal(tokenHash, hashAccessToken(token));
    assert.notEqual(tokenHash, token);
    assert.notEqual(tokenHash, otherTokenHash);
    assert.match(tokenHash, /^[a-f0-9]{64}$/);
  });

  await test("wrong, revoked, expired, and withdrawn insurance capabilities fail closed", () => {
    assert.equal(caseCapabilityAllowsAccess(activeCapability), true);
    assert.equal(caseCapabilityAllowsAccess({ ...activeCapability, presentedTokenHash: otherTokenHash }), false);
    assert.equal(caseCapabilityAllowsAccess({ ...activeCapability, revokedAt: "2026-08-21T11:00:00.000Z" }), false);
    assert.equal(caseCapabilityAllowsAccess({ ...activeCapability, expiresAt: "2026-08-21T12:00:00.000Z" }), false);
    assert.equal(caseCapabilityAllowsAccess({ ...activeCapability, expiresAt: "not-a-date" }), false);
    assert.equal(caseCapabilityAllowsAccess({ ...activeCapability, status: "WITHDRAWN" }), false);
  });

  await test("unknown insurance capabilities remain an indistinguishable portal no-match", async () => {
    let calls = 0;
    const result = await readCaseStatusForPortal({
      accessToken: otherToken,
      isDatabaseAvailable: true,
      readCaseStatus: async () => {
        calls += 1;
        return null;
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 1);
  });

  await test("an unavailable case store fails closed before attempting capability lookup", async () => {
    const originalError = console.error;
    let calls = 0;
    console.error = () => undefined;
    try {
      const result = await readCaseStatusForPortal({
        accessToken: token,
        isDatabaseAvailable: false,
        readCaseStatus: async () => {
          calls += 1;
          throw new Error("must not run");
        },
      });
      assert.equal(result, null);
      assert.equal(calls, 0);
    } finally {
      console.error = originalError;
    }
  });

  console.log("\n8 auth and ownership regressions passed\n");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
