import {
  casePortalRateLimitAllowsAccess,
  readCaseStatusForPortal,
} from "../src/lib/insurance/application/case-portal";
import { postHogEventContainsInsuranceCapability } from "../src/lib/insurance/privacy/sensitive-routes";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[insurance-case-portal] ${message}`);
}

const accessToken = Buffer.alloc(32, 9).toString("base64url");
const ip = "203.0.113.42";
const originalConsoleError = console.error;
const logs: string[] = [];
async function main(): Promise<void> {
  console.error = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    let tokenLimiterCalled = false;
    const ipFailureAllowed = await casePortalRateLimitAllowsAccess({
      ip,
      accessToken,
      isProduction: true,
      ipLimiter: {
        limit: async () => {
          throw new Error(`upstash failed for ${ip} ${accessToken}`);
        },
      },
      tokenLimiter: {
        limit: async () => {
          tokenLimiterCalled = true;
          return { success: true };
        },
      },
    });
    expect(!ipFailureAllowed, "an IP limiter exception must fail closed");
    expect(!tokenLimiterCalled, "token limiter must not run after an IP limiter exception");
    expect(logs.length === 1 && logs[0] === "insurance-portal: rate limiter failed — failing closed", "IP limiter exception must emit only the generic portal failure log");
    expect(!logs.join(" ").includes(accessToken) && !logs.join(" ").includes(ip), "portal limiter failure log must not leak capability or IP data");

    logs.length = 0;
    const order: string[] = [];
    const tokenFailureAllowed = await casePortalRateLimitAllowsAccess({
      ip,
      accessToken,
      isProduction: true,
      ipLimiter: {
        limit: async () => {
          order.push("ip");
          return { success: true };
        },
      },
      tokenLimiter: {
        limit: async () => {
          order.push("token");
          throw new Error(`upstash failed for ${accessToken}`);
        },
      },
    });
    expect(!tokenFailureAllowed, "a token limiter exception must fail closed");
    expect(order.join(",") === "ip,token", "IP limiter must precede token limiter");
    expect(logs.length === 1 && logs[0] === "insurance-portal: rate limiter failed — failing closed", "token limiter exception must emit only the generic portal failure log");
    expect(!logs.join(" ").includes(accessToken) && !logs.join(" ").includes(ip), "token limiter failure log must not leak capability or IP data");

    logs.length = 0;
    tokenLimiterCalled = false;
    const denied = await casePortalRateLimitAllowsAccess({
      ip,
      accessToken,
      isProduction: true,
      ipLimiter: { limit: async () => ({ success: false }) },
      tokenLimiter: {
        limit: async () => {
          tokenLimiterCalled = true;
          return { success: true };
        },
      },
    });
    expect(!denied, "rate-limit denials must fail closed");
    expect(!tokenLimiterCalled, "token limiter must not run after an IP denial");
    expect(logs.length === 0, "rate-limit denials must remain silent");

    logs.length = 0;
    const missingProductionLimiter = await casePortalRateLimitAllowsAccess({
      ip,
      accessToken,
      isProduction: true,
      ipLimiter: null,
      tokenLimiter: { limit: async () => ({ success: true }) },
    });
    expect(!missingProductionLimiter, "missing production limiter must fail closed");
    expect(logs.length === 1 && logs.join("\n") === "insurance-portal: rate limiter unavailable — failing closed", "missing production limiter must use the generic unavailable log");
    expect(!logs.join(" ").includes(accessToken) && !logs.join(" ").includes(ip), "missing limiter log must not leak capability or IP data");

    logs.length = 0;
    const noMatch = await readCaseStatusForPortal({
      accessToken,
      isDatabaseAvailable: true,
      readCaseStatus: async () => null,
    });
    expect(noMatch === null, "unknown, revoked, or expired capability must remain a no-match");
    expect(logs.length === 0, "a genuine no-match must remain silent");
    expect(
      postHogEventContainsInsuranceCapability({ properties: { $current_url: `https://propertyinsights.xyz/insurance/case/${accessToken}` } }),
      "capability URL must remain excluded from analytics"
    );

    console.log("insurance case portal failure handling passed");
  } finally {
    console.error = originalConsoleError;
  }
}

void main();
