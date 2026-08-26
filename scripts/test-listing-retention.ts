/**
 * scripts/test-listing-retention.ts
 *
 * Regression test for the listing-retention algorithm in
 * src/lib/pipeline/retention.ts — the code /api/pipeline/refresh runs every
 * day at 2pm UTC, and the only thing standing between a Zoocasa outage and a
 * mass deletion of published listings.
 *
 * Entirely fixture-driven: no network, no KV, no env, no .env.local. The one
 * effect the algorithm has (a freshness check) is an injected callback, so
 * every scenario below states its verdicts up front. This test must NEVER be
 * pointed at the live store — running the real route is what deletes things.
 *
 * WHAT IS ASSERTED, and why each case exists:
 *
 *  1. Partial non-zero search — the ACTUAL 2026-08 production failure.
 *     Ottawa returned 1 candidate against a target of 25 and the pre-fix
 *     code silently dropped the other 24 live listings. The old guard only
 *     fired on `candidates.length === 0`, so this case sailed past it.
 *  2. Rejected search promise — retains everything, logs loudly.
 *  3. Empty search result — retains everything, logs loudly.
 *  4. Metro-sibling orphans — rows filed under a city that matches no
 *     CityConfig (citiesMatch() deliberately accepts siblings, and the row
 *     is filed under the city Zoocasa reported) are retained AND queued for
 *     freshness, not stranded.
 *  5. Same address, two cities — two records, not one. This is the first
 *     audit finding: the address-keyed Map collapsed the pair and dropped one
 *     with no verdict behind it.
 * 5b. Same address, same city, two distinct rows — the follow-up finding.
 *     The identity-keyed Map collapsed THAT pair the same way. Both rows now
 *     survive; only isSameRecord (byte-equality) may still collapse anything;
 *     and a candidate that matches such an identity binds to neither row
 *     rather than stamping its dom onto whichever one it guessed.
 *  6. Dead verdict scope — removes the one ROW it was issued for, leaving
 *     both a cross-city namesake and a same-identity namesake alone. That is
 *     why the removal authority is the checked row object and not a key:
 *     these tests assert that the identity key alone would have taken both.
 *  7. Freshness deadline — no verdict is never a removal, and the shortfall
 *     is announced.
 *  8. cfg.target — an acquisition cap, never an eviction rule.
 *  9. MLS secondary — follows one property across an address-string rename,
 *     only after the primary key misses; an MLS claimed by two properties is
 *     withdrawn from matching and announced rather than guessed at.
 * 10. User carry-forward — an address collision in another city cannot
 *     suppress a user listing, and a row a city bucket adopted is not
 *     carried twice.
 * 11. Whole-run invariant — a stored row leaves the payload only when a
 *     "dead" verdict was issued for ITS OWN ROW, including when its identity
 *     is shared with a second row that got no such verdict.
 *
 * Plus the degraded paths that must announce themselves rather than pass for
 * clean runs: a missing search-result slot, an "unknown" verdict, a freshness
 * check that throws, two stored rows that share one address|city|province
 * without being provably the same record (the Newark pair), and a search
 * candidate that cannot be bound to either of them.
 *
 * Usage: npx tsx scripts/test-listing-retention.ts
 */

import { Listing } from "../src/lib/types";
import { listingKey } from "../src/lib/listing-identity";
import { slugify } from "../src/lib/utils";
import {
  planRetention,
  runFreshnessPass,
  pruneDead,
  acquisitionAllowance,
  selectNewListings,
  selectUserCarryForward,
  retainedSlugCollisions,
  type CitySearchOutcome,
  type FreshnessVerdict,
  type RetentionCityConfig,
} from "../src/lib/pipeline/retention";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
let section = "";

function heading(name: string) {
  section = name;
  process.stdout.write(`\n--- ${name} ---\n`);
}

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    process.stdout.write(`  OK    ${label}\n`);
  } else {
    fail++;
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}  [${section}]\n`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
interface CityConfig extends RetentionCityConfig {
  minPrice: number;
  maxPrice: number;
}

const CITY = (city: string, province: string, target = 25): CityConfig => ({
  city,
  province,
  target,
  minPrice: 0,
  maxPrice: 9_999_999,
});

let seq = 0;
function mk(address: string, city: string, province: string, extra: Partial<Listing> = {}): Listing {
  seq++;
  return {
    address,
    city,
    province,
    dom: 30,
    price: 700_000,
    beds: "3",
    baths: "2",
    sqft: "1800",
    yearBuilt: "1985",
    taxes: "4000",
    lotSize: "5000",
    priceReduced: false,
    hasSuite: false,
    estateKeywords: false,
    description: "",
    notes: "",
    cluster: "",
    url: `https://www.zoocasa.com/${city.toLowerCase()}-${province.toLowerCase()}-real-estate/listing-${seq}`,
    mlsNumber: `X${1000 + seq}`,
    preNarrative: "stored narrative",
    source: "cron",
    enrichedAt: new Date().toISOString(),
    ...extra,
  };
}

/** The route's ownership rule, restated for fixtures (no US rows in play). */
const isOwned = (l: Listing) => l.source !== "user";

function fulfilled(cfg: CityConfig, candidates: Listing[]): PromiseSettledResult<CitySearchOutcome<CityConfig>> {
  return { status: "fulfilled", value: { cfg, candidates } };
}
function rejected(reason: string): PromiseSettledResult<CitySearchOutcome<CityConfig>> {
  return { status: "rejected", reason };
}

const alwaysLive = async (): Promise<FreshnessVerdict> => "live";
const keys = (rows: Listing[]) => rows.map(listingKey).sort();
const hasLog = (log: string[], needle: string) => log.some((line) => line.includes(needle));

// ---------------------------------------------------------------------------
// Scenarios. Wrapped in main() rather than run at module scope because tsx
// transpiles these scripts to CJS, where top-level await is unavailable.
// ---------------------------------------------------------------------------
async function main() {
  // ---------------------------------------------------------------------------
  // 1. Partial non-zero search result — the production failure
  // ---------------------------------------------------------------------------
  heading("Partial search result (Ottawa: 1 candidate, 25 stored, target 25)");
  {
    const cfg = CITY("Ottawa", "ON");
    const stored = Array.from({ length: 25 }, (_, i) => mk(`${100 + i} Bank St`, "Ottawa", "ON"));
    // Zoocasa's frozen-page regression surfaced exactly one of the 25.
    const surfaced = { ...stored[7], dom: 99 };
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [surfaced])],
      existingListings: stored,
      isOwned,
    });

    eq("all 25 stored listings retained", plan.cityBuckets[0].kept.length, 25);
    eq("all 25 queued for freshness", plan.freshnessQueue.length, 25);
    eq("no orphans", plan.orphanRetained.length, 0);
    eq("surfaced candidate is not re-acquired", plan.cityBuckets[0].needsDetail.length, 0);
    const refreshed = plan.cityBuckets[0].kept.find((l) => listingKey(l) === listingKey(stored[7]));
    eq("surfaced candidate refreshed this run's dom", refreshed?.dom, 99);
    eq(
      "unsurfaced listings keep their stored dom",
      plan.cityBuckets[0].kept.filter((l) => l.dom === 30).length,
      24
    );
  }

  // ---------------------------------------------------------------------------
  // 2/3. Rejected and empty searches
  // ---------------------------------------------------------------------------
  heading("Rejected search promise");
  {
    const cfg = CITY("Calgary", "AB");
    const stored = Array.from({ length: 12 }, (_, i) => mk(`${i} Elbow Dr`, "Calgary", "AB"));
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [rejected("HTTP 503 from zoocasa")],
      existingListings: stored,
      isOwned,
    });
    eq("every stored listing retained", plan.cityBuckets[0].kept.length, 12);
    eq("every stored listing freshness-queued", plan.freshnessQueue.length, 12);
    check("logs loudly", hasLog(plan.log, "[pipeline-guard] Search FAILED for Calgary, AB"));
    check("log names the rejection reason", hasLog(plan.log, "HTTP 503 from zoocasa"));
  }

  heading("Empty search result");
  {
    const cfg = CITY("Winnipeg", "MB");
    const stored = Array.from({ length: 9 }, (_, i) => mk(`${i} Portage Ave`, "Winnipeg", "MB"));
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [])],
      existingListings: stored,
      isOwned,
    });
    eq("every stored listing retained", plan.cityBuckets[0].kept.length, 9);
    eq("every stored listing freshness-queued", plan.freshnessQueue.length, 9);
    check("logs loudly", hasLog(plan.log, "search returned 0 candidates"));
  }

  heading("Missing search result slot (arrays out of alignment)");
  {
    const cfg = CITY("Surrey", "BC");
    const stored = [mk("1 King George Blvd", "Surrey", "BC")];
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [],
      existingListings: stored,
      isOwned,
    });
    eq("stored listing still retained", plan.cityBuckets[0].kept.length, 1);
    check("degraded path announces itself", hasLog(plan.log, "no search result slot at index 0"));
  }

  // ---------------------------------------------------------------------------
  // 4. Metro-sibling orphans
  // ---------------------------------------------------------------------------
  heading("Two different properties at one address in one city are BOTH retained");
  {
    const cfg = CITY("Newark", "NJ");
    // The Newark pair: same address string, same city, different MLS and
    // price. listingKey cannot tell them apart. The identity-keyed Map that
    // stood here kept only the second and dropped the first from the write
    // payload with no dead verdict behind it — a permanent data loss, sold as
    // a design decision by the comment above it. Both rows are now written;
    // the only thing they lose is exclusive ownership of /property/{slug},
    // which is a routing defect and recoverable.
    const a = mk("105-107 Broad St", "Newark", "NJ", { mlsNumber: "4016139", price: 224_900 });
    const b = mk("105-107 Broad St", "Newark", "NJ", { mlsNumber: "26010654", price: 254_900 });
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [])],
      existingListings: [a, b],
      isOwned,
    });

    eq("both rows retained", plan.cityBuckets[0].kept.length, 2);
    check("the first row is in the payload", plan.cityBuckets[0].kept.includes(a));
    check("the second row is in the payload", plan.cityBuckets[0].kept.includes(b));
    eq("both are freshness-queued", plan.freshnessQueue.length, 2);
    eq("neither is written twice", new Set(plan.freshnessQueue).size, 2);
    eq("neither is stranded as an orphan", plan.orphanRetained.length, 0);
    eq("the shared identity is reported ambiguous", [...plan.ambiguousIdentities], [listingKey(a)]);

    check("the ambiguity is announced", hasLog(plan.log, "not provably the same record"));
    check("the log names the affected identity", hasLog(plan.log, listingKey(a)));
    check(
      "the log counts the identity and the rows holding it",
      hasLog(plan.log, "1 address|city|province identity(ies) held by 2 distinct stored row(s)")
    );
    check("the log says both are retained", hasLog(plan.log, "ALL of those rows are retained and written"));
    check("and says they share one URL", hasLog(plan.log, "sharing one /property/{slug} URL"));
    check("and no longer claims a row goes unwritten", !plan.log.some((l) => l.includes("is not written")));

    // A byte-identical duplicate is a real duplicate and must NOT be flagged.
    // isSameRecord is the only test allowed to authorize dropping a row, and
    // this is the only collapse left in the module.
    const clean = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [])],
      existingListings: [a, { ...a }],
      isOwned,
    });
    eq("an exact duplicate collapses silently", clean.cityBuckets[0].kept.length, 1);
    check("and raises no ambiguity warning", !hasLog(clean.log, "not provably the same record"));
    eq("and flags no ambiguous identity", clean.ambiguousIdentities.size, 0);
  }

  heading("An ambiguous pair survives a whole run with no dead verdicts");
  {
    const cfg = CITY("Newark", "NJ");
    const a = mk("105-107 Broad St", "Newark", "NJ", { mlsNumber: "4016139", price: 224_900 });
    const b = mk("105-107 Broad St", "Newark", "NJ", { mlsNumber: "26010654", price: 254_900 });
    const other = mk("12 Market St", "Newark", "NJ");
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [])],
      existingListings: [a, b, other],
      isOwned,
    });
    const freshness = await runFreshnessPass({
      queue: plan.freshnessQueue,
      check: alwaysLive,
      elapsed: () => 0,
      deadlineMs: 60_000,
    });

    const survivors = pruneDead(plan.cityBuckets[0].kept, freshness.deadRows);
    eq("no verdict was dead", freshness.deadRows.size, 0);
    eq("all three rows survive", survivors.length, 3);
    check("the first of the pair survives", survivors.includes(a));
    check("the second of the pair survives", survivors.includes(b));
    eq("and neither appears twice", new Set(survivors).size, 3);

    // The URL they share is reported, not resolved by deleting a row.
    const collisions = retainedSlugCollisions(survivors);
    eq("the shared slug is reported", collisions.length, 1);
    eq("as two rows", collisions[0]?.rows, 2);
    eq("of a single identity", collisions[0]?.identities.length, 1);
  }

  heading("A dead verdict on one row of an ambiguous pair spares its namesake");
  {
    const cfg = CITY("Newark", "NJ");
    const a = mk("105-107 Broad St", "Newark", "NJ", { mlsNumber: "4016139", price: 224_900 });
    const b = mk("105-107 Broad St", "Newark", "NJ", { mlsNumber: "26010654", price: 254_900 });
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [])],
      existingListings: [a, b],
      isOwned,
    });

    // checkFreshness is asked about the row's OWN detail url (address, city,
    // province and the slug taken from l.url), which is the only thing that
    // separates these two. The route passes exactly that, so a verdict here
    // is genuinely about one of the pair.
    const freshness = await runFreshnessPass({
      queue: plan.freshnessQueue,
      check: async (l) => (l.url === a.url ? "dead" : "live"),
      elapsed: () => 0,
      deadlineMs: 10_000,
      maxWorkers: 2,
    });

    eq("both rows were checked", freshness.checked, 2);
    eq("exactly one row died", freshness.deadRows.size, 1);
    check("and it is the row whose own page 404s", freshness.deadRows.has(a));
    check("the namesake got no verdict against it", !freshness.deadRows.has(b));

    const survivors = pruneDead(plan.cityBuckets[0].kept, freshness.deadRows);
    eq("exactly one row leaves the payload", survivors.length, 1);
    check("the dead row is the one that left", !survivors.includes(a));
    check("the namesake is retained", survivors.includes(b));

    // Why the removal authority is the row and not the key: the identity-
    // level summary cannot tell these two apart, and applying it would have
    // deleted the live row with no verdict of its own.
    eq("the identity summary names one identity", freshness.deadKeys.size, 1);
    check(
      "which both rows answer to",
      plan.cityBuckets[0].kept.every((l) => freshness.deadKeys.has(listingKey(l)))
    );
  }

  heading("A candidate matching an ambiguous identity binds to neither row");
  {
    const cfg = CITY("Victoria", "BC");
    const a = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-A" });
    const b = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-B" });
    // Shares address, city and province with both; its MLS is exactly what
    // makes it a different record from at least one of them.
    const candidate = mk("1200 Fairfield Rd", "Victoria", "BC", {
      mlsNumber: "V-A",
      dom: 91,
      preNarrative: undefined,
    });

    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [candidate])],
      existingListings: [a, b],
      isOwned,
    });

    eq("both stored rows retained", plan.cityBuckets[0].kept.length, 2);
    eq("neither row took the candidate's dom", plan.cityBuckets[0].kept.filter((l) => l.dom === 30).length, 2);
    eq("no row was rewritten as a cron refresh", plan.cityBuckets[0].kept.filter((l) => l.dom === 91).length, 0);
    eq("and it is not acquired as a third row at that address", plan.cityBuckets[0].needsDetail.length, 0);
    check("the refusal is announced", hasLog(plan.log, "bound to none of them"));
  }

  heading("An ambiguous identity cannot suppress a user listing's carry-forward");
  {
    const cfg = CITY("Victoria", "BC");
    const cronA = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-A" });
    const cronB = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-B" });
    const userRow = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-U", source: "user" });
    const stored = [cronA, cronB, userRow];

    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [])],
      existingListings: stored,
      isOwned,
    });
    eq("both owned rows retained", plan.cityBuckets[0].kept.length, 2);
    eq("the identity is flagged ambiguous", plan.ambiguousIdentities.size, 1);

    const claimed = new Set(plan.cityBuckets[0].kept.map(listingKey));
    eq(
      "treating the claim as unambiguous would delete the user row",
      selectUserCarryForward(stored, claimed).length,
      0
    );
    eq(
      "declaring the ambiguity carries it forward instead",
      selectUserCarryForward(stored, claimed, plan.ambiguousIdentities).length,
      1
    );
    check(
      "and it is the user's own row",
      selectUserCarryForward(stored, claimed, plan.ambiguousIdentities)[0] === userRow
    );
  }

  heading("Metro-sibling orphans (city matches no CityConfig)");
  {
    const hamilton = CITY("Hamilton", "ON");
    const configured = mk("10 James St", "Hamilton", "ON");
    // Ingested via citiesMatch()'s sibling acceptance, filed under the city
    // Zoocasa reported — Burlington has no CityConfig of its own.
    const sibling = mk("55 Brant St", "Burlington", "ON");
    const plan = planRetention<CityConfig>({
      cities: [hamilton],
      searchResults: [fulfilled(hamilton, [])],
      existingListings: [configured, sibling],
      isOwned,
    });

    eq("orphan is not in the configured city's bucket", keys(plan.cityBuckets[0].kept), [listingKey(configured)]);
    eq("orphan carried forward", keys(plan.orphanRetained), [listingKey(sibling)]);
    check("orphan is freshness-queued, not stranded", plan.freshnessQueue.some((l) => listingKey(l) === listingKey(sibling)));
    check("orphan carry-forward is announced", hasLog(plan.log, "match no configured city"));
    check("log names the orphan's city", hasLog(plan.log, "Burlington, ON"));
  }

  heading("Metro sibling re-surfaced by the parent city's search is not double-written");
  {
    const hamilton = CITY("Hamilton", "ON");
    const sibling = mk("55 Brant St", "Burlington", "ON");
    const plan = planRetention<CityConfig>({
      cities: [hamilton],
      // The Hamilton search legitimately returns the Burlington row.
      searchResults: [fulfilled(hamilton, [{ ...sibling, dom: 77 }])],
      existingListings: [sibling],
      isOwned,
    });
    eq("not added to the Hamilton bucket", plan.cityBuckets[0].kept.length, 0);
    eq("not re-acquired as a new candidate", plan.cityBuckets[0].needsDetail.length, 0);
    eq("retained exactly once, via the orphan set", plan.freshnessQueue.length, 1);
  }

  // ---------------------------------------------------------------------------
  // 5/6. Cross-city address collision — the audit finding
  // ---------------------------------------------------------------------------
  heading("Same address in two cities");
  {
    const victoria = CITY("Victoria", "BC");
    const calgary = CITY("Calgary", "AB");
    const vic = mk("123 Main St", "Victoria", "BC", { mlsNumber: "V-1" });
    const cal = mk("123 Main St", "Calgary", "AB", { mlsNumber: "C-1" });

    const plan = planRetention<CityConfig>({
      cities: [victoria, calgary],
      searchResults: [fulfilled(victoria, []), fulfilled(calgary, [])],
      existingListings: [vic, cal],
      isOwned,
    });

    eq("two independent records retained", plan.freshnessQueue.length, 2);
    eq("Victoria bucket holds its own", keys(plan.cityBuckets[0].kept), [listingKey(vic)]);
    eq("Calgary bucket holds its own", keys(plan.cityBuckets[1].kept), [listingKey(cal)]);
    check("identities are distinct", listingKey(vic) !== listingKey(cal));
    // Two cities is two identities, not one identity held by two rows. The
    // module must not confuse the two shapes: they need different fixes.
    eq("this is not an ambiguous identity", plan.ambiguousIdentities.size, 0);
    check("and nothing is announced as ambiguous", !hasLog(plan.log, "not provably the same record"));

    // The slug index cannot tell them apart, and says so rather than dropping one.
    const collisions = retainedSlugCollisions([vic, cal]);
    eq("slug collision detected", collisions.length, 1);
    eq("collision names both identities", collisions[0]?.identities.length ?? 0, 2);
    eq("both rows still retained despite the shared slug", plan.freshnessQueue.length, 2);
  }

  heading("A dead verdict removes only its own row (cross-city namesake)");
  {
    const victoria = CITY("Victoria", "BC");
    const calgary = CITY("Calgary", "AB");
    const vic = mk("123 Main St", "Victoria", "BC", { mlsNumber: "V-1" });
    const cal = mk("123 Main St", "Calgary", "AB", { mlsNumber: "C-1" });
    const other = mk("9 Cook St", "Victoria", "BC");

    const plan = planRetention<CityConfig>({
      cities: [victoria, calgary],
      searchResults: [fulfilled(victoria, []), fulfilled(calgary, [])],
      existingListings: [vic, cal, other],
      isOwned,
    });

    const freshness = await runFreshnessPass({
      queue: plan.freshnessQueue,
      // Only the Victoria row's own detail page 404s.
      check: async (l) => (listingKey(l) === listingKey(vic) ? "dead" : "live"),
      elapsed: () => 0,
      deadlineMs: 10_000,
      maxWorkers: 4,
    });

    eq("exactly one dead identity", freshness.deadKeys.size, 1);
    eq("all three checked", freshness.checked, 3);
    check("the verdict is recorded against the full identity", freshness.deadKeys.has(listingKey(vic)));
    check("and not against the bare address", !freshness.deadKeys.has(vic.address.toLowerCase()));
    eq(
      "pruneDead keeps the namesake when handed both rows directly",
      keys(pruneDead([vic, cal], new Set([vic]))),
      [listingKey(cal)]
    );

    const vicKept = pruneDead(plan.cityBuckets[0].kept, freshness.deadRows);
    const calKept = pruneDead(plan.cityBuckets[1].kept, freshness.deadRows);
    eq("dead Victoria row pruned", keys(vicKept), [listingKey(other)]);
    eq("Calgary namesake untouched", keys(calKept), [listingKey(cal)]);
  }

  heading("An 'unknown' verdict is not a removal");
  {
    const cfg = CITY("Toronto", "ON");
    const stored = Array.from({ length: 5 }, (_, i) => mk(`${i} Queen St W`, "Toronto", "ON"));
    const freshness = await runFreshnessPass({
      queue: stored,
      check: async () => "unknown",
      elapsed: () => 0,
      deadlineMs: 10_000,
    });
    eq("nothing marked dead", freshness.deadKeys.size, 0);
    eq("everything survives the prune", pruneDead(stored, freshness.deadRows).length, 5);
    eq("cfg is untouched by the pass", cfg.target, 25);
  }

  heading("A throwing freshness check is retained and announced");
  {
    const stored = Array.from({ length: 4 }, (_, i) => mk(`${i} Yonge St`, "Toronto", "ON"));
    const freshness = await runFreshnessPass({
      queue: stored,
      check: async (l) => {
        if (l.address.startsWith("0")) throw new Error("socket hang up");
        return "live";
      },
      elapsed: () => 0,
      deadlineMs: 10_000,
      maxWorkers: 2,
    });
    eq("no verdict from the thrown check", freshness.deadKeys.size, 0);
    eq("one row errored", freshness.errored, 1);
    eq("three rows got a verdict", freshness.checked, 3);
    check("the error is announced, not swallowed", hasLog(freshness.log, "freshness check(s) threw"));
    check("the log carries the underlying error", hasLog(freshness.log, "socket hang up"));
    eq("every row still retained", pruneDead(stored, freshness.deadRows).length, 4);
  }

  // ---------------------------------------------------------------------------
  // 7. Freshness deadline
  // ---------------------------------------------------------------------------
  heading("Freshness deadline leaves unchecked rows retained");
  {
    const stored = Array.from({ length: 40 }, (_, i) => mk(`${i} Douglas St`, "Victoria", "BC"));
    let clock = 0;
    const freshness = await runFreshnessPass({
      queue: stored,
      // Every row is genuinely dead; the point is that the ones the deadline
      // cuts off never get asked, so they are never removed.
      check: async () => "dead",
      elapsed: () => (clock += 1_000),
      deadlineMs: 5_000,
      maxWorkers: 1,
    });

    check("the pass stopped early", freshness.remaining > 0, `remaining=${freshness.remaining}`);
    eq("checked + remaining accounts for the whole queue", freshness.checked + freshness.remaining, 40);
    check("budget shortfall is announced", hasLog(freshness.log, "freshness budget hit"));
    check("log states the retention rule", hasLog(freshness.log, "no verdict is never a removal"));

    const survivors = pruneDead(stored, freshness.deadRows);
    eq("only the rows that got a verdict are pruned", survivors.length, 40 - freshness.deadRows.size);
    eq("every checked row got a dead verdict here", freshness.deadRows.size, freshness.checked);
    check("unchecked rows all survived", survivors.length === freshness.remaining);
  }

  // ---------------------------------------------------------------------------
  // 8. cfg.target is an acquisition cap
  // ---------------------------------------------------------------------------
  heading("cfg.target bounds acquisition, never retention");
  {
    // 40 retained against a target of 25 — the pre-fix code sliced this to 25.
    const kept = Array.from({ length: 40 }, (_, i) => mk(`${i} Fort St`, "Victoria", "BC"));
    const detailed = Array.from({ length: 6 }, (_, i) => mk(`${900 + i} New Rd`, "Victoria", "BC", { preNarrative: undefined }));

    eq("allowance is zero when over target", acquisitionAllowance(25, kept.length), 0);
    const over = selectNewListings({ kept, detailed, target: 25, claimedSlugs: new Set() });
    eq("no new listings acquired while over target", over.newListings.length, 0);
    eq("kept is not sliced by the caller's target", [...kept, ...over.newListings].length, 40);

    // Under target: acquisition resumes, still bounded.
    const few = kept.slice(0, 22);
    eq("allowance is the shortfall", acquisitionAllowance(25, few.length), 3);
    const under = selectNewListings({ kept: few, detailed, target: 25, claimedSlugs: new Set() });
    eq("acquires exactly the shortfall", under.newListings.length, 3);
    eq("payload reaches but does not exceed target", few.length + under.newListings.length, 25);
  }

  heading("Slug identity guards acquisition only, never retention");
  {
    const kept = [mk("123 Main St", "Victoria", "BC")];
    const newcomer = mk("123 Main St", "Calgary", "AB", { preNarrative: undefined });
    // Distinct properties, one slug: the published row owns the URL.
    const claimedSlugs = new Set(kept.map((l) => slugify(l.address)));
    const sel = selectNewListings({ kept, detailed: [newcomer], target: 25, claimedSlugs });
    eq("colliding newcomer is skipped", sel.newListings.length, 0);
    eq("and reported, not silently dropped", sel.slugSkipped.length, 1);
    eq("the published row is untouched", kept.length, 1);
  }

  // ---------------------------------------------------------------------------
  // 9. MLS as a secondary key
  // ---------------------------------------------------------------------------
  heading("MLS secondary follows an address rename after the primary misses");
  {
    const cfg = CITY("Victoria", "BC");
    const stored = mk("867 Walfred Rd", "Victoria", "BC", { mlsNumber: "VRE-991" });
    // Same property, provider rewrote the street type. Primary key misses.
    const renamed = mk("867 Walfred Road", "Victoria", "BC", { mlsNumber: "VRE-991", dom: 61 });

    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [renamed])],
      existingListings: [stored],
      isOwned,
    });

    eq("stored row retained once", plan.cityBuckets[0].kept.length, 1);
    eq("rename is not acquired as a second property", plan.cityBuckets[0].needsDetail.length, 0);
    eq("retained under the stored identity", listingKey(plan.cityBuckets[0].kept[0]), listingKey(stored));
    eq("dom refreshed from the renamed candidate", plan.cityBuckets[0].kept[0].dom, 61);
  }

  heading("An MLS number claimed by two properties is withdrawn, not guessed");
  {
    const cfg = CITY("Victoria", "BC");
    // Two boards inside one province can issue the same number.
    const a = mk("1 Alpha Way", "Victoria", "BC", { mlsNumber: "DUP-1" });
    const b = mk("2 Beta Way", "Victoria", "BC", { mlsNumber: "DUP-1" });
    const candidate = mk("3 Gamma Way", "Victoria", "BC", { mlsNumber: "DUP-1", preNarrative: undefined });

    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [candidate])],
      existingListings: [a, b],
      isOwned,
    });

    eq("both stored rows retained", plan.cityBuckets[0].kept.length, 2);
    check("ambiguity is announced", hasLog(plan.log, "claimed by more than one stored property"));
    eq("the candidate matched neither and is treated as new", plan.cityBuckets[0].needsDetail.length, 1);
  }

  // ---------------------------------------------------------------------------
  // 10. User-listing carry-forward
  // ---------------------------------------------------------------------------
  heading("User carry-forward is suppressed only by its own identity");
  {
    const cronVictoria = mk("123 Main St", "Victoria", "BC");
    const userCalgary = mk("123 Main St", "Calgary", "AB", { source: "user" });
    const userVictoria = mk("77 Oak Bay Ave", "Victoria", "BC", { source: "user" });
    const claimed = new Set([listingKey(cronVictoria), listingKey(userVictoria)]);

    const carried = selectUserCarryForward([cronVictoria, userCalgary, userVictoria], claimed);
    eq("cross-city namesake is NOT suppressed", keys(carried), [listingKey(userCalgary)]);
    check("a user listing a city bucket adopted is not carried twice", !carried.some((l) => listingKey(l) === listingKey(userVictoria)));
    check("cron rows are never carried by this path", !carried.some((l) => l.source !== "user"));
  }

  heading("A user listing surfaced by a city search is adopted, not duplicated");
  {
    const cfg = CITY("Victoria", "BC");
    const userRow = mk("77 Oak Bay Ave", "Victoria", "BC", { source: "user" });
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, [{ ...userRow, dom: 12 }])],
      existingListings: [userRow],
      isOwned,
    });

    eq("adopted into the city bucket", plan.cityBuckets[0].kept.length, 1);
    eq("adopted as a cron row", plan.cityBuckets[0].kept[0].source, "cron");
    const claimed = new Set(plan.cityBuckets[0].kept.map(listingKey));
    eq("and therefore not carried forward again", selectUserCarryForward([userRow], claimed).length, 0);
  }

  // ---------------------------------------------------------------------------
  // 11. Whole-run invariant
  // ---------------------------------------------------------------------------
  heading("Whole run: nothing leaves the payload without a verdict for its own row");
  {
    const cities = [CITY("Ottawa", "ON"), CITY("Victoria", "BC"), CITY("Calgary", "AB")];
    // Two distinct rows at one address|city|province, riding through a city
    // whose search failed outright. mk() gives each its own MLS and its own
    // detail url, which is what lets a verdict be about one of them.
    const twinA = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-TWIN-A", price: 810_000 });
    const twinB = mk("1200 Fairfield Rd", "Victoria", "BC", { mlsNumber: "V-TWIN-B", price: 749_000 });
    const stored: Listing[] = [
      ...Array.from({ length: 25 }, (_, i) => mk(`${100 + i} Bank St`, "Ottawa", "ON")),
      ...Array.from({ length: 30 }, (_, i) => mk(`${i} Douglas St`, "Victoria", "BC")),
      mk("123 Main St", "Victoria", "BC", { mlsNumber: "V-1" }),
      mk("123 Main St", "Calgary", "AB", { mlsNumber: "C-1" }),
      twinA,
      twinB,
      mk("55 Brant St", "Burlington", "ON"),          // metro-sibling orphan
      mk("77 Oak Bay Ave", "Victoria", "BC", { source: "user" }),
    ];
    const doomed = stored[0];                          // one genuine 404

    const plan = planRetention<CityConfig>({
      cities,
      searchResults: [
        fulfilled(cities[0], [{ ...stored[3], dom: 88 }]),  // partial: 1 of 25
        rejected("timeout"),                                // total failure
        fulfilled(cities[2], []),                           // empty
      ],
      existingListings: stored,
      isOwned,
    });

    const freshness = await runFreshnessPass({
      queue: plan.freshnessQueue,
      // Two 404s: one whole identity, and ONE ROW of the ambiguous pair —
      // matched on the detail url, which is what the route hands
      // checkFreshness and the only thing that separates the twins.
      check: async (l) =>
        listingKey(l) === listingKey(doomed) || l.url === twinB.url ? "dead" : "live",
      elapsed: () => 0,
      deadlineMs: 60_000,
      maxWorkers: 8,
    });

    const survivors = [
      ...plan.cityBuckets.flatMap((b) => pruneDead(b.kept, freshness.deadRows)),
      ...pruneDead(plan.orphanRetained, freshness.deadRows),
    ];
    const claimed = new Set(survivors.map(listingKey));
    const payload = [
      ...survivors,
      ...selectUserCarryForward(stored, claimed, plan.ambiguousIdentities),
    ];

    // ROW identity, not property identity. listingKey can no longer express
    // this invariant on its own: the twins share one listingKey and both must
    // be present exactly once. Every fixture row has its own MLS number and
    // the dom refresh preserves it, so this names a row.
    const rowId = (l: Listing) => `${listingKey(l)}#${l.mlsNumber ?? ""}`;
    const payloadRows = new Set(payload.map(rowId));
    const dead = [doomed, twinB];
    const deadRowIds = new Set(dead.map(rowId));
    const missing = stored.filter((l) => !payloadRows.has(rowId(l)));

    eq("exactly the rows with a dead verdict left the payload", missing.map(rowId).sort(), [...deadRowIds].sort());
    check(
      "every other stored row is present",
      stored.filter((l) => !deadRowIds.has(rowId(l))).every((l) => payloadRows.has(rowId(l)))
    );
    eq("no row is written twice", payload.length, payloadRows.size);
    eq("the user listing is in the payload", payload.filter((l) => l.source === "user").length, 1);

    // The ambiguous pair, specifically: one row died on its own url, the
    // other had no verdict against it and must still be there.
    check("the surviving twin is in the payload", payloadRows.has(rowId(twinA)));
    check("the twin with the 404 is not", !payloadRows.has(rowId(twinB)));
    eq(
      "and the shared identity is still represented, once",
      payload.filter((l) => listingKey(l) === listingKey(twinA)).length,
      1
    );
    check(
      "the ambiguity was announced for exactly one identity",
      hasLog(plan.log, "1 address|city|province identity(ies) held by 2 distinct stored row(s)")
    );
    eq("and only that identity is flagged", [...plan.ambiguousIdentities], [listingKey(twinA)]);
  }

  // ---------------------------------------------------------------------------
  heading("Baseline: an all-live run with no verdicts removes nothing");
  {
    const cfg = CITY("Victoria", "BC");
    const stored = Array.from({ length: 8 }, (_, i) => mk(`${i} Blanshard St`, "Victoria", "BC"));
    const plan = planRetention<CityConfig>({
      cities: [cfg],
      searchResults: [fulfilled(cfg, stored.slice(0, 2))],
      existingListings: stored,
      isOwned,
    });
    const freshness = await runFreshnessPass({
      queue: plan.freshnessQueue,
      check: alwaysLive,
      elapsed: () => 0,
      deadlineMs: 60_000,
    });
    eq("no dead verdicts", freshness.deadKeys.size, 0);
    eq("all retained", pruneDead(plan.cityBuckets[0].kept, freshness.deadRows).length, 8);
    eq("no slug collisions in a clean fixture", retainedSlugCollisions(stored).length, 0);
  }

}

main()
  .then(() => {
    process.stdout.write(`\n=== ${pass} passed, ${fail} failed ===\n`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
