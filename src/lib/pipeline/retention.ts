/**
 * pipeline/retention.ts
 *
 * The retention algorithm behind /api/pipeline/refresh, lifted out of the
 * route's GET handler so it can be exercised without a network, a KV
 * connection or a cron secret. Every function here is pure or takes its one
 * effect as an injected callback; nothing in this module reaches the outside
 * world. `scripts/test-listing-retention.ts` drives all of it from fixtures.
 *
 * Extraction is not cosmetic. This code is the only thing standing between a
 * provider outage and a mass deletion of published listings, and until it was
 * a function it had no test coverage at all — it could only be exercised by
 * running the real cron against the real store, which is the one thing nobody
 * may do to check a retention change.
 *
 * -------------------------------------------------------------------------
 * THE RETENTION INVARIANT — absence from a search result is NOT proof that a
 * listing is gone. Search may ADD a listing or REFRESH one; it may never
 * authorize a removal. The only thing allowed to mark a listing for removal
 * is a positive "dead" verdict from checkFreshness() (a 404 / missingAddress
 * redirect on the listing's OWN detail page — see zoocasa.ts; every failure
 * mode there returns "unknown", not "dead"), and that verdict removes only
 * the identity it was issued for.
 *
 * ROOT CAUSE OF THE 409-URL 404 INCIDENT (2026-08, verified against live
 * Zoocasa): the search endpoint /{city}-{prov}-real-estate parses the city
 * correctly but resolves its internal `electedAddress` to the PROVINCE, and
 * then serves one frozen page of 27 listings that is byte-identical across
 * every city, page number, cursor and filter. searchListings() correctly
 * scopes that page down with citiesMatch(), so the surviving candidate count
 * per city collapsed to roughly 0 (Calgary) / 1 (Ottawa) / 6 (Toronto)
 * against a target of 25.
 *
 * The pre-fix loop built `kept` exclusively out of stored listings that
 * re-matched THIS run's candidates. A stored listing that simply did not
 * appear in the (96%-truncated) candidate set was never freshness-checked,
 * never confirmed dead, and never re-added — it just fell out of the
 * replacement array, and the write phase then wrote that array and purged its
 * slug key. ~24 still-actively-for-sale listings per city per run became hard
 * 404s that way.
 *
 * The old shape had a guard for this, but it only fired on
 * `candidates.length === 0` (plus a twin branch for a rejected search
 * promise). "Returned a few" — the actual failure mode, and by far the most
 * likely one for any partial provider outage — sailed straight past it. Both
 * special cases are folded into the general rule below: EVERY city seeds
 * `kept` from storage first, so a search that returns 0, 1 or 27 candidates is
 * just a point on the same continuum rather than a separate code path that has
 * to be remembered. The loud [pipeline-guard] logging for empty/failed
 * searches is retained, since a sustained provider outage must still be
 * visible in the cron log even though it is no longer destructive.
 *
 * -------------------------------------------------------------------------
 * IDENTITY (2026-08 audit finding). Every collection here was originally
 * keyed on the bare `address` string, which is not an identity: two Canadian
 * properties can share a street address in different cities. Keyed that way,
 * `retainedStored` silently dropped one of the pair (a deletion with no
 * verdict — precisely what this module exists to prevent), one "dead" verdict
 * removed every namesake across every city, and an address collision could
 * suppress a legitimate user listing. The live CA store happens to hold no
 * such pair today; an invariant that holds only by luck is not an invariant.
 *
 * So every collection here keys on `listingKey()` — address|city|province,
 * normalized — from src/lib/listing-identity.ts, which cannot merge two
 * distinct properties. `listingMlsKey()` is used ONLY to follow one property
 * across an address-string rename, only after the primary key has missed, and
 * deliberately never as grounds for dropping or suppressing a row: MLS
 * numbers are unique per issuing board, not per province, so a same-province
 * cross-board collision is possible and must never cost a row.
 *
 * -------------------------------------------------------------------------
 * IDENTITY vs SLUG. `listingKey()` answers "same property"; `slugify(address)`
 * answers "same URL". They are different questions with different answers,
 * and conflating them is what produced the audit finding in the first place.
 * Two distinct properties sharing an address string are two records (identity
 * keeps them apart) that want one /property/{slug} URL (slug cannot). Where
 * that conflict is decidable — a NEW acquisition wanting a slug an already-
 * published listing owns — the published row wins and the newcomer is skipped.
 * Where it is not — two already-retained rows sharing a slug — both are kept
 * and the collision is reported, because retention outranks index tidiness:
 * a shared page is recoverable, a deleted row is not.
 */

import { Listing } from "../types";
import { listingKey, listingMlsKey, isSameRecord } from "../listing-identity";
import { slugify } from "../utils";

/** The slice of the route's CityConfig retention actually depends on. */
export interface RetentionCityConfig {
  city: string;
  province: string;
  /**
   * ACQUISITION cap, never a retention cap. See `acquisitionAllowance`.
   */
  target: number;
}

/** One city's search outcome, as produced by the route's Phase 1. */
export interface CitySearchOutcome<C extends RetentionCityConfig = RetentionCityConfig> {
  cfg: C;
  candidates: Listing[];
}

export interface CityBucket<C extends RetentionCityConfig = RetentionCityConfig> {
  cfg: C;
  /** Stored listings retained for this city. Never sliced, never sorted-off. */
  kept: Listing[];
  /** Search candidates with no stored counterpart — the acquisition pool. */
  needsDetail: Listing[];
}

export interface RetentionPlan<C extends RetentionCityConfig = RetentionCityConfig> {
  cityBuckets: CityBucket<C>[];
  /** Retained rows whose city matches no CityConfig — see `planRetention`. */
  orphanRetained: Listing[];
  /** Every retained row, from every bucket plus the orphans. */
  freshnessQueue: Listing[];
  /** Lines for the route's `log[]`. Degraded paths announce themselves here. */
  log: string[];
}

export interface RetentionInputs<C extends RetentionCityConfig = RetentionCityConfig> {
  cities: C[];
  /** Positionally aligned with `cities` — the route's Promise.allSettled result. */
  searchResults: PromiseSettledResult<CitySearchOutcome<C>>[];
  /** The full store read, including rows this pipeline does not own. */
  existingListings: Listing[];
  /**
   * True for stored rows THIS pipeline retains. Injected rather than
   * hardcoded so the rule stays visible at the call site and testable here:
   * the route passes `l.source !== "user" && !isUSState(l.province)` — user
   * listings are carried by Phase 5 with their own freshness pass, US
   * listings by Phase 8 unconditionally. Legacy rows with no `source` at all
   * are owned: they are CA cron listings that predate the field, and the old
   * `source === "cron"` filter was silently dropping them.
   */
  isOwned: (l: Listing) => boolean;
}

/**
 * City bucket key. Built through `listingKey` with an empty address so the
 * city/province halves are normalized by exactly the same rule the row keys
 * are — a bucket a row cannot key into is a row with nowhere to be retained.
 */
export function cityBucketKey(city: string, province: string): string {
  return listingKey({ address: "", city, province });
}

/**
 * Phase 2: seed retention from STORED listings, then let this run's search
 * candidates refresh or extend that set.
 */
export function planRetention<C extends RetentionCityConfig>(
  input: RetentionInputs<C>
): RetentionPlan<C> {
  const { cities, searchResults, existingListings, isOwned } = input;
  const log: string[] = [];

  // ---------------------------------------------------------------------
  // Candidate -> stored-row index. Primary is listingKey; the MLS index is
  // the fallback for a candidate whose address string has been rewritten
  // since it was stored. An MLS key claimed by two DIFFERENT properties is
  // withdrawn from the index entirely rather than resolved last-write-wins:
  // a fallback that can return the wrong property would push this run's
  // `dom` onto a row it does not describe. Withdrawal costs only the
  // rename-following, and it is announced.
  // ---------------------------------------------------------------------
  const existingByKey = new Map<string, Listing>();
  const existingByMlsKey = new Map<string, Listing>();
  const ambiguousMls = new Set<string>();
  for (const l of existingListings) {
    existingByKey.set(listingKey(l), l);
    const mlsKey = listingMlsKey(l);
    if (!mlsKey) continue;
    const prior = existingByMlsKey.get(mlsKey);
    if (prior && listingKey(prior) !== listingKey(l)) {
      ambiguousMls.add(mlsKey);
      continue;
    }
    existingByMlsKey.set(mlsKey, l);
  }
  for (const key of ambiguousMls) existingByMlsKey.delete(key);
  if (ambiguousMls.size > 0) {
    log.push(
      `[pipeline-guard] ${ambiguousMls.size} MLS key(s) are claimed by more than one stored property ` +
        `(${[...ambiguousMls].slice(0, 5).join(", ")}${ambiguousMls.size > 5 ? ", ..." : ""}) — withdrawn ` +
        `from secondary matching; candidates for those rows match on address|city|province only`
    );
  }

  // ---------------------------------------------------------------------
  // The retention set: one entry per owned property.
  //
  // A Map means two owned rows sharing one listingKey collapse to the later
  // one. For the overwhelming case — the same row read twice — that loses
  // nothing. It is not free in general: 105-107 Broad St in Newark proves two
  // genuinely different properties can share an address string within one
  // city (different MLS, different price). The CA store holds no such pair,
  // and this is strictly better than the address-only key it replaces, but a
  // collapse that drops information is still a row leaving the payload with
  // no verdict behind it, so it is measured with the contract's own strict
  // test (isSameRecord — the only test allowed to authorize dropping a row)
  // and announced when it is not provably a duplicate. It is not silently
  // repaired here: separating such a pair needs a URL-disambiguation design,
  // which is the listing-lifecycle work, not a retention loop's call to make.
  // ---------------------------------------------------------------------
  const retainedStored = new Map<string, Listing>();
  const ambiguousIdentities: string[] = [];
  for (const l of existingListings) {
    if (!isOwned(l)) continue;
    const key = listingKey(l);
    const prior = retainedStored.get(key);
    if (prior && !isSameRecord(prior, l)) ambiguousIdentities.push(key);
    retainedStored.set(key, l);
  }
  if (ambiguousIdentities.length > 0) {
    log.push(
      `[pipeline-guard] ${ambiguousIdentities.length} stored row(s) share an address|city|province with a ` +
        `DIFFERENT row and are not provably the same record (${[...new Set(ambiguousIdentities)].slice(0, 5).join("; ")}` +
        `${ambiguousIdentities.length > 5 ? "; ..." : ""}) — retained as one property this run; the earlier ` +
        `row is not written and needs URL disambiguation, not a retention fix`
    );
  }

  const storedByCity = new Map<string, Listing[]>();
  for (const l of retainedStored.values()) {
    const key = cityBucketKey(l.city, l.province);
    const bucket = storedByCity.get(key);
    if (bucket) bucket.push(l);
    else storedByCity.set(key, [l]);
  }

  // Identities claimed by some city bucket's seed. Anything left in
  // `retainedStored` afterwards is an orphan (see below) — it must still be
  // carried forward, never dropped for lack of a matching CityConfig.
  const seededKeys = new Set<string>();
  const cityBuckets: CityBucket<C>[] = [];
  const freshnessQueue: Listing[] = [];

  for (const [idx, cfg] of cities.entries()) {
    const result = searchResults[idx];
    let candidates: Listing[] = [];

    if (!result) {
      // Positional misalignment between cities[] and searchResults[]. Not a
      // reachable state today, but it would silently mean "this city ran no
      // search" — say so rather than let it read as a clean empty result.
      log.push(
        `[pipeline-guard] ${cfg.city}, ${cfg.province}: no search result slot at index ${idx} ` +
          `(${searchResults.length} slot(s) for ${cities.length} cities) — stored listings retained ` +
          `and freshness-checked; no new listings acquired this run`
      );
    } else if (result.status === "rejected") {
      log.push(
        `[pipeline-guard] Search FAILED for ${cfg.city}, ${cfg.province}: ${result.reason} — ` +
          `stored listings retained and freshness-checked; no new listings acquired this run`
      );
    } else {
      candidates = result.value.candidates;
      if (candidates.length === 0) {
        log.push(
          `[pipeline-guard] ${cfg.city}, ${cfg.province}: search returned 0 candidates — ` +
            `stored listings retained and freshness-checked; no new listings acquired this run`
        );
      }
    }

    candidates = [...candidates].sort((a, b) => b.dom - a.dom);

    // Seed: ALL stored listings for this exact city+province, whether or not
    // this run's search happened to surface them.
    const keptByKey = new Map<string, Listing>();
    for (const stored of storedByCity.get(cityBucketKey(cfg.city, cfg.province)) ?? []) {
      const key = listingKey(stored);
      keptByKey.set(key, stored);
      seededKeys.add(key);
    }

    const needsDetail: Listing[] = [];

    for (const candidate of candidates) {
      const candidateMlsKey = listingMlsKey(candidate);
      const existing =
        existingByKey.get(listingKey(candidate)) ??
        (candidateMlsKey ? existingByMlsKey.get(candidateMlsKey) : undefined);

      if (!existing) {
        needsDetail.push(candidate);
        continue;
      }

      const key = listingKey(existing);
      const seeded = keptByKey.get(key);
      if (seeded) {
        // Already retained by the seed above; the candidate's only job is to
        // refresh the volatile field the search row is authoritative for
        // (days-on-market), exactly as the pre-fix code did.
        keptByKey.set(key, { ...seeded, dom: candidate.dom, source: "cron" });
        continue;
      }

      if (retainedStored.has(key)) {
        // Retained by ANOTHER bucket's seed, or by the orphan set.
        // citiesMatch() deliberately accepts metro siblings (a Hamilton
        // search legitimately returns Burlington rows), so the same stored
        // listing can surface under a city it isn't filed under. Adding it
        // here too would write it twice into listings:all and race itself on
        // the shared by-slug key — skip it and let its own bucket own it. It
        // forfeits this run's `dom` refresh, which is a cosmetic staleness,
        // not a retention risk.
        continue;
      }

      if (existing.preNarrative) {
        // A stored listing this pipeline does NOT own (a source:"user" one)
        // that a city search has now surfaced: adopt it as cron, unchanged
        // from the pre-fix behavior. Phase 5 skips it via the claimed-key set
        // so it can't also be carried forward.
        keptByKey.set(key, { ...existing, dom: candidate.dom, source: "cron" });
        continue;
      }

      needsDetail.push(candidate);
    }

    const kept = [...keptByKey.values()];
    cityBuckets.push({ cfg, kept, needsDetail });
    freshnessQueue.push(...kept);
  }

  // ---------------------------------------------------------------------
  // Orphan carry-forward. A stored listing whose city+province matches no
  // CityConfig has no bucket to seed — because it was ingested as a metro
  // sibling (citiesMatch() lets a Hamilton search return Burlington, an
  // Ottawa search return Kanata/Gatineau, and so on, and the listing is then
  // filed under the city Zoocasa reported), or because its city was removed
  // from CITIES since. Under the old candidate-driven `kept` these survived
  // only by luck: they were re-matched every run because the sibling search
  // kept re-surfacing them. Seeding by exact city+province would strand them,
  // so they are collected here, put through the same freshness gate as
  // everything else, and folded into the write payload by the caller.
  // ---------------------------------------------------------------------
  const orphanRetained = [...retainedStored.values()].filter((l) => !seededKeys.has(listingKey(l)));
  if (orphanRetained.length > 0) {
    const orphanCities = [...new Set(orphanRetained.map((l) => `${l.city}, ${l.province}`))].join("; ");
    log.push(
      `[pipeline-guard] ${orphanRetained.length} stored listing(s) match no configured city ` +
        `(${orphanCities}) — retained and freshness-checked`
    );
    freshnessQueue.push(...orphanRetained);
  }

  return { cityBuckets, orphanRetained, freshnessQueue, log };
}

export type FreshnessVerdict = "live" | "dead" | "unknown";

export interface FreshnessPassResult {
  /** listingKey() of every row that came back "dead". Nothing else may remove a row. */
  deadKeys: Set<string>;
  /** Rows that got a verdict of any kind. */
  checked: number;
  /** Rows left in the queue when the deadline hit. */
  remaining: number;
  /** Rows whose check threw — no verdict, therefore retained. */
  errored: number;
  log: string[];
}

/**
 * Phase 3: the route's ONLY removal authority.
 *
 * `check` is injected so this runs against fixtures; the route passes a
 * closure over checkFreshness(), which returns "dead" solely on a 404 or a
 * missingAddress redirect from the listing's own detail page and returns
 * "unknown" (never "dead") for a timeout, a non-OK status or a thrown
 * request — so a provider outage degrades to "kept, unverified", never to a
 * deletion.
 *
 * Three ways a row can leave here without a verdict — deadline, throw, or a
 * literal "unknown" — and all three mean the same thing: it stays. Each of
 * the first two is counted and logged, because "we did not check 900 of your
 * listings" is a degraded run even when it is a safe one.
 */
export async function runFreshnessPass(opts: {
  queue: Listing[];
  check: (l: Listing) => Promise<FreshnessVerdict>;
  /** Milliseconds since the run started, as the route measures it. */
  elapsed: () => number;
  deadlineMs: number;
  maxWorkers?: number;
}): Promise<FreshnessPassResult> {
  const deadKeys = new Set<string>();
  const log: string[] = [];
  if (opts.queue.length === 0) {
    return { deadKeys, checked: 0, remaining: 0, errored: 0, log };
  }

  const queue = [...opts.queue];
  let checked = 0;
  let errored = 0;
  const errorSamples: string[] = [];

  async function worker() {
    while (queue.length > 0) {
      if (opts.elapsed() > opts.deadlineMs) break;
      const l = queue.shift();
      if (!l) break;
      let status: FreshnessVerdict;
      try {
        status = await opts.check(l);
      } catch (err) {
        errored++;
        if (errorSamples.length < 3) {
          errorSamples.push(`${l.address}, ${l.city}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }
      checked++;
      if (status === "dead") deadKeys.add(listingKey(l));
    }
  }

  const workerCount = Math.min(opts.maxWorkers ?? 20, opts.queue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const remaining = queue.length;
  if (remaining > 0) {
    log.push(
      `[pipeline-guard] freshness budget hit at ${opts.elapsed()}ms — ${remaining} listing(s) went ` +
        `unchecked this run and are retained UNVERIFIED (no verdict is never a removal)`
    );
  }
  if (errored > 0) {
    log.push(
      `[pipeline-guard] ${errored} freshness check(s) threw and produced no verdict — those listings are ` +
        `retained UNVERIFIED: ${errorSamples.join(" | ")}${errored > errorSamples.length ? " | ..." : ""}`
    );
  }

  return { deadKeys, checked, remaining, errored, log };
}

/**
 * Drop exactly the identities a "dead" verdict was issued for. A namesake in
 * another city keys differently and is untouched — that is the whole point.
 */
export function pruneDead(listings: Listing[], deadKeys: Set<string>): Listing[] {
  if (deadKeys.size === 0) return listings;
  return listings.filter((l) => !deadKeys.has(listingKey(l)));
}

/**
 * cfg.target is an ACQUISITION cap, not a retention cap. It bounds how many
 * NEW listings a run may fetch, enrich and publish for a city — that bound is
 * real work and a real cost, and it stays. What it must NOT do is decide
 * which ALREADY-PUBLISHED listings survive: the pre-fix code built
 * `combined = [...kept, ...filtered]`, sorted it by dom, then sliced it to
 * cfg.target. Every stored, still-alive listing past index 24 was silently
 * dropped from the write payload — a freshly-detailed newcomer with a high
 * dom could evict a live stored listing purely on sort order, and its
 * /property/[slug] page 404'd the moment the write phase ran. So `kept` is
 * never sliced and this returns 0 once a city is at or over target.
 */
export function acquisitionAllowance(target: number, keptCount: number): number {
  return Math.max(0, target - keptCount);
}

export interface NewListingSelection {
  newListings: Listing[];
  /** Candidates dropped because a published listing already owns their slug. */
  slugSkipped: Listing[];
}

/**
 * Choose which freshly-detailed candidates a city may publish this run.
 *
 * `claimedSlugs` is the caller's, mutated in place and deliberately shared
 * across every bucket: writeAllListings keys listings:by-slug:* by
 * slugify(address) with no city in it, so a Calgary newcomer can collide with
 * a retained Victoria row it never meets in its own bucket. Slug identity is
 * coarser than property identity (see the module header) and this is the one
 * place the coarser rule is allowed to decide anything — because the loser is
 * a listing that has not been published yet, not one already on the site.
 */
export function selectNewListings(opts: {
  kept: Listing[];
  detailed: Listing[];
  target: number;
  claimedSlugs: Set<string>;
}): NewListingSelection {
  const allowance = acquisitionAllowance(opts.target, opts.kept.length);

  // Prefer 1500+ sqft, relax if that would leave the city short of target.
  let filtered = opts.detailed.filter((l) => {
    const sqft = parseInt(l.sqft) || 0;
    return sqft === 0 || sqft >= 1500;
  });
  if (opts.kept.length + filtered.length < opts.target) {
    filtered = opts.detailed;
  }

  const newListings: Listing[] = [];
  const slugSkipped: Listing[] = [];
  for (const l of filtered) {
    if (newListings.length >= allowance) break;
    const slug = slugify(l.address);
    if (opts.claimedSlugs.has(slug)) {
      slugSkipped.push(l);
      continue;
    }
    opts.claimedSlugs.add(slug);
    newListings.push(l);
  }

  return { newListings, slugSkipped };
}

/**
 * Phase 5: which source:"user" rows still need carrying forward.
 *
 * `claimedKeys` holds listingKey() of everything the city buckets already
 * published, so a user listing a city search surfaced and adopted is not
 * written twice. The test is the PRIMARY key only, deliberately not the MLS
 * secondary: being claimed here DROPS the row from the carry-forward, and a
 * false positive would therefore delete a user's listing with no freshness
 * verdict against it. MLS is unique per issuing board, not per province, so a
 * cross-board collision inside one province is possible — rare, but the cost
 * of being wrong is a deletion and the only benefit is avoiding a duplicate
 * row that writeAllListings' dedup already collapses. Suppression keys on the
 * identity that cannot merge two properties, and on nothing else.
 */
export function selectUserCarryForward(
  existingListings: Listing[],
  claimedKeys: Set<string>
): Listing[] {
  return existingListings.filter((l) => l.source === "user" && !claimedKeys.has(listingKey(l)));
}

export interface SlugCollision {
  slug: string;
  /** listingKey() of each distinct property claiming this slug. */
  identities: string[];
}

/**
 * Retained rows that are distinct properties but slugify to one URL.
 *
 * This is the cost of keying retention on identity instead of address: the
 * pre-fix Map collapsed such a pair to one row (losing one property with no
 * verdict), so the collision could not exist. Now both rows survive and only
 * one of them can own listings:by-slug:{slug} — the other renders the
 * survivor's snapshot at its own URL until the listing-lifecycle work lands.
 * kv/listings.ts console.warns the same condition on the write path; this
 * surfaces it in the cron's own log[] and response, where the operator of
 * this route is actually looking.
 */
export function retainedSlugCollisions(retained: Listing[]): SlugCollision[] {
  const bySlug = new Map<string, Set<string>>();
  for (const l of retained) {
    const slug = slugify(l.address);
    const ids = bySlug.get(slug);
    if (ids) ids.add(listingKey(l));
    else bySlug.set(slug, new Set([listingKey(l)]));
  }
  return [...bySlug.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([slug, ids]) => ({ slug, identities: [...ids] }));
}
