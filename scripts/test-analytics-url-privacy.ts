/**
 * scripts/test-analytics-url-privacy.ts
 *
 * Guards the redaction that keeps raw addresses and property identifiers out
 * of the URL properties PostHog captures (events and session-recording start
 * URLs). Four of nine recent recordings had stored a full street address in
 * their start URL via /assess?address=...; this pins the fix.
 *
 * Run with: npx tsx scripts/test-analytics-url-privacy.ts
 */
import {
  redactSensitiveUrlParams,
  redactAnalyticsUrlProperties,
} from "@/lib/analytics-url-privacy";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log((cond ? "  OK    " : "  FAIL  ") + name + (cond ? "" : ` — ${extra}`));
  if (!cond) failed++;
}

// --- redactSensitiveUrlParams ------------------------------------------------

const addrUrl = "https://app.example.com/assess?address=123%20Main%20St%2C%20Vancouver%2C%20BC&placeId=ChIJabc123";
const redactedAddr = redactSensitiveUrlParams(addrUrl);
check("street address value is removed", !redactedAddr.includes("Main"), redactedAddr);
check("placeId value is removed", !redactedAddr.includes("ChIJabc123"), redactedAddr);
check("route and parameter keys survive", redactedAddr.includes("/assess") && redactedAddr.includes("address=") && redactedAddr.includes("placeId="), redactedAddr);

const relative = redactSensitiveUrlParams("/assess?address=123%20Main%20St&assessmentId=asmt_99&verify=tok_secret");
check("root-relative path stays relative", relative.startsWith("/assess?"), relative);
check("assessmentId value is removed", !relative.includes("asmt_99"), relative);
check("verify value is removed", !relative.includes("tok_secret"), relative);

check("matching is case-insensitive", !redactSensitiveUrlParams("/x?Address=secret").includes("secret"));
check("non-sensitive params are untouched", redactSensitiveUrlParams("/assess?journeys=1&assessmentGoal=offer") === "/assess?journeys=1&assessmentGoal=offer");
check("url without query is returned unchanged", redactSensitiveUrlParams("/property/123-main-st") === "/property/123-main-st");
check("hash is preserved", redactSensitiveUrlParams("/assess?address=x#top").endsWith("#top"));

// --- redactAnalyticsUrlProperties -------------------------------------------

const event = {
  event: "$pageview",
  properties: {
    $current_url: "https://app.example.com/assess?address=123%20Main%20St&verify=tok_secret",
    $referrer: "https://app.example.com/property/123?assessmentId=asmt_1",
    $pathname: "/assess",
    $set_once: { $initial_current_url: "https://app.example.com/assess?address=123%20Main%20St" },
  },
};
const out = redactAnalyticsUrlProperties(event);
check("event $current_url is redacted", !out.properties.$current_url.includes("Main") && !out.properties.$current_url.includes("tok_secret"), out.properties.$current_url);
check("event $referrer is redacted", !out.properties.$referrer.includes("asmt_1"), out.properties.$referrer);
check("$initial_current_url person property is redacted", !(out.properties.$set_once.$initial_current_url as string).includes("Main"), String(out.properties.$set_once.$initial_current_url));
check("null event is passed through", redactAnalyticsUrlProperties(null) === null);
check("event without properties is passed through", redactAnalyticsUrlProperties({}) !== undefined);

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
