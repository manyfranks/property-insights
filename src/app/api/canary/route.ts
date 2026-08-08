/**
 * /api/canary
 *
 * Minimal daily health probe for the Canadian pipeline (Zoocasa scrape +
 * assessment adapters). Runs three cheap, representative checks:
 *   1. Zoocasa searchListings("Victoria", "BC") — shape-check the response
 *      (province/city scoping, price/address/city/dom presence).
 *   2. BC Assessment cache lookup — no network, just confirms the cache
 *      module loads and returns a well-formed Assessment.
 *   3. Calgary SODA health probe — confirms the assessed_value field is
 *      still present/numeric on the live dataset.
 *
 * Returns 500 (not 200) on any failure so Vercel's cron dashboard marks the
 * run failed and alerts, in addition to the console.error("[canary]", ...)
 * log line for log-based alerting.
 *
 * Auth: same pattern as /api/pipeline/refresh — requires CRON_SECRET as a
 * Bearer token when the env var is set; unauthenticated access is allowed
 * only when CRON_SECRET is unset (Vercel cron infra handles security then).
 */

import { NextResponse } from "next/server";
import { searchListings } from "@/lib/zoocasa";
import { lookupBCSync } from "@/lib/assessment/bc";
import { calgarySodaHealthCheck } from "@/lib/assessment/ab";
import { BC_ASSESSMENT_CACHE } from "@/lib/data/assessments";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface CheckResult {
  ok: boolean;
  detail: string;
}

function errDetail(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

async function checkZoocasaSearch(): Promise<CheckResult> {
  try {
    const listings = await searchListings("Victoria", "BC", { type: "house", beds: 3 });
    if (listings.length === 0) {
      return { ok: false, detail: "searchListings(\"Victoria\", \"BC\") returned 0 listings" };
    }
    const bad = listings.find(
      (l) =>
        !l.address ||
        typeof l.address !== "string" ||
        !l.city ||
        typeof l.city !== "string" ||
        typeof l.price !== "number" ||
        !(l.price > 0) ||
        typeof l.dom !== "number" ||
        Number.isNaN(l.dom)
    );
    if (bad) {
      return { ok: false, detail: `malformed listing in response: address="${bad.address}"` };
    }
    return { ok: true, detail: `${listings.length} listings, shape OK` };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

function checkBcCache(): CheckResult {
  try {
    const [address] = Object.keys(BC_ASSESSMENT_CACHE);
    if (!address) {
      return { ok: false, detail: "BC_ASSESSMENT_CACHE is empty" };
    }
    const a = lookupBCSync(address);
    if (!a || !a.found || !(a.totalValue > 0)) {
      return { ok: false, detail: `lookupBCSync("${address}") returned ${JSON.stringify(a)}` };
    }
    return { ok: true, detail: `${address}: totalValue=${a.totalValue}` };
  } catch (err) {
    return { ok: false, detail: errDetail(err) };
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const [zoocasaSearch, calgarySoda] = await Promise.all([
    checkZoocasaSearch(),
    calgarySodaHealthCheck(),
  ]);
  const bcCache = checkBcCache();

  const checks = { zoocasaSearch, bcCache, calgarySoda };
  const failures = Object.entries(checks)
    .filter(([, result]) => !result.ok)
    .map(([name, result]) => `${name}: ${result.detail}`);

  const ok = failures.length === 0;

  if (!ok) {
    console.error(`[canary] ${failures.length} check(s) failed:`, failures.join(" | "));
  }

  return NextResponse.json({ ok, checks, failures }, { status: ok ? 200 : 500 });
}
