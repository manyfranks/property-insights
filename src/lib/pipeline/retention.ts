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
 * the ROW it was issued for — see "IDENTITY IS NOT A ROW" below.
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
 * IDENTITY IS NOT A ROW (2026-08 follow-up audit). Keying on the locality
 * tuple removed the cross-city merge but left one row-losing case standing:
 * two DIFFERENT stored rows can share one address|city|province — Newark's
 * 105-107 Broad St, different MLS, different price — and a Map keyed by
 * identity kept only the last of them. The dropped row left the write payload
 * with no dead verdict behind it, which is the deletion this module exists to
 * refuse, arriving through the front door. Worse, the comment that stood here
 * called that acceptable and deferred it to "URL disambiguation".
 *
 * It was never a URL question. Preserving both rows does not require deciding
 * which of them owns /property/{slug}: listings:all and the sharded chunks are
 * ARRAYS and hold both rows fine, and listings:by-slug:{slug} — the one
 * one-per-slug key — is already last-write-wins today. A shared page is a
 * display/routing defect for the listing-lifecycle work to fix; a dropped row
 * is permanent data loss. Those are not the same severity. So an identity now
 * maps to a GROUP of rows, and every row in the group is retained and written.
 * The only collapse left is the one the contract authorizes: `isSameRecord`,
 * byte-equality in every field, where the discarded row provably carried
 * nothing the survivor lacks.
 *
 * A VERDICT ATTACHES TO A ROW. checkFreshness is asked about
 * (address, city, province, slug-taken-from-that-row's-own-url). For two rows
 * sharing an identity it therefore cannot distinguish them when their urls
 * match too — both then get the same verdict, which is the correct answer for
 * both — but when the urls differ it is genuinely answering about one of them.
 * So runFreshnessPass records the row OBJECT it checked and pruneDead removes
 * exactly those objects. Rows travel by reference from the freshness queue
 * into the write payload, so this is exact; a row that got copied in between
 * simply survives, which is the safe direction. `deadKeys` (identities with at
 * least one dead row) is still reported for the log and the response, but it
 * is NOT a removal authority and must never be made one again.
 *
 * -------------------------------------------------------------------------
 * IDENTITY vs SLUG. `listingKey()` answers "same property"; `slugify(address)`
 * answers "same URL". They are different questions with different answers,
 * and conflating them is what produced the audit finding in the first place.
 * Two distinct properties sharing an address string are two records (identity
 * keeps them apart) that want one /property/{slug} URL (slug cannot). Where
 * that conflict is decidable — a NEW acquisition wanting a slug an already-
 * published listing owns — the published row wins and the newcomer is skipped.
 * Where it is not — two already-retained rows sharing a slug, be they two
 * distinct identities or the two rows of one ambiguous identity — both are
 * kept and the collision is reported, because retention outranks index
 * tidiness: a shared page is recoverable, a deleted row is not.
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
  /**
   * Identities held by more than one distinct stored row (owned or not).
   * Every one of those rows is retained; this is here so callers that key
   * anything on identity know which keys do not name a single row. The route
   * hands it to `selectUserCarryForward`, whose suppression is a deletion.
   */
  ambiguousIdentities: Set<string>;
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
 * Group stored rows by primary identity.
 *
 * The value is a LIST, not a row. `listingKey` answers "same property", and
 * two stored rows can answer yes to that and still be different records —
 * which is why a Map<key, Listing> here was losing one of them. The only rows
 * this collapses are those `isSameRecord` proves are byte-equal in every
 * field: the one test in this codebase allowed to authorize dropping a row,
 * and the only one whose discard provably loses nothing. First occurrence
 * wins among those, which is a statement about object identity and nothing
 * else, since they are byte-equal.
 *
 * The inner scan is O(group²), against a group size that is 1 for every
 * identity in the live store and 2 for the one pathological pair on record.
 */
function groupByIdentity(rows: Listing[]): Map<string, Listing[]> {
  const groups = new Map<string, Listing[]>();
  for (const l of rows) {
    const key = listingKey(l);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, [l]);
      continue;
    }
    if (group.some((prior) => isSameRecord(prior, l))) continue;
    group.push(l);
  }
  return groups;
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
  // Every stored row, grouped by the identity it claims. A group, not a row:
  // see groupByIdentity and the IDENTITY IS NOT A ROW block up top.
  //
  // Candidate -> stored-GROUP index. Primary is the identity itself; the MLS
  // index is the fallback for a candidate whose address string has been
  // rewritten since it was stored, and it resolves to an identity rather than
  // to a row because the group is the unit a candidate binds to. An MLS key
  // claimed by two DIFFERENT identities is withdrawn from the index entirely
  // rather than resolved last-write-wins: a fallback that can return the wrong
  // property would push this run's `dom` onto a row it does not describe.
  // Withdrawal costs only the rename-following, and it is announced.
  // ---------------------------------------------------------------------
  const existingGroups = groupByIdentity(existingListings);
  const existingByMlsKey = new Map<string, string>();
  const ambiguousMls = new Set<string>();
  for (const l of existingListings) {
    const mlsKey = listingMlsKey(l);
    if (!mlsKey) continue;
    const key = listingKey(l);
    const prior = existingByMlsKey.get(mlsKey);
    if (prior !== undefined && prior !== key) {
      ambiguousMls.add(mlsKey);
      continue;
    }
    existingByMlsKey.set(mlsKey, key);
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
  // The retention set: every owned ROW, filed under the identity it claims.
  // An identity can hold more than one, and all of them are retained — the
  // Map<key, Listing> this replaces kept only the last, and the rows it
  // discarded left the write payload with no dead verdict behind them.
  //
  // The ownership filter runs after grouping rather than before it so the
  // grouping (and therefore the ambiguity report below) sees the whole store:
  // a cron row and a user row can share an identity too, and the route's
  // Phase 5 suppression keys on identity, so it has to be told.
  // ---------------------------------------------------------------------
  const retainedGroups = new Map<string, Listing[]>();
  for (const [key, rows] of existingGroups) {
    const owned = rows.filter(isOwned);
    if (owned.length > 0) retainedGroups.set(key, owned);
  }

  // Identities that do not name a single row. Every row involved is kept;
  // this is a data problem for the listing-lifecycle work, and it is stated in
  // those terms rather than as a retention decision, because retention no
  // longer makes one here.
  const ambiguousIdentities = new Set<string>();
  let ambiguousRowCount = 0;
  for (const [key, rows] of existingGroups) {
    if (rows.length < 2) continue;
    ambiguousIdentities.add(key);
    ambiguousRowCount += rows.length;
  }
  if (ambiguousIdentities.size > 0) {
    log.push(
      `[pipeline-guard] ${ambiguousIdentities.size} address|city|province identity(ies) held by ` +
        `${ambiguousRowCount} distinct stored row(s) that are not provably the same record ` +
        `(${[...ambiguousIdentities].slice(0, 5).join("; ")}${ambiguousIdentities.size > 5 ? "; ..." : ""}) — ` +
        `ALL of those rows are retained and written, both/all sharing one /property/{slug} URL until ` +
        `listing-lifecycle work separates them; a shared page is recoverable, a dropped row is not`
    );
  }

  // City index over identities, not rows: every row of a group shares the
  // group's normalized city and province by construction (they are two thirds
  // of the key), so a group can never want two buckets.
  const storedByCity = new Map<string, string[]>();
  for (const [key, rows] of retainedGroups) {
    const bucket = cityBucketKey(rows[0].city, rows[0].province);
    const keysHere = storedByCity.get(bucket);
    if (keysHere) keysHere.push(key);
    else storedByCity.set(bucket, [key]);
  }

  // Identities claimed by some city bucket's seed. Any identity left in
  // `retainedGroups` afterwards is an orphan (see below) and every row it
  // holds must still be carried forward, never dropped for lack of a
  // matching CityConfig.
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
    // this run's search happened to surface them. The value is the whole
    // identity group — copied, so the refresh below cannot reach back into
    // `retainedGroups` and mutate the orphan computation's input.
    const keptByKey = new Map<string, Listing[]>();
    for (const key of storedByCity.get(cityBucketKey(cfg.city, cfg.province)) ?? []) {
      keptByKey.set(key, [...(retainedGroups.get(key) ?? [])]);
      seededKeys.add(key);
    }

    const needsDetail: Listing[] = [];
    // Identities a candidate matched but could not be bound to — see below.
    const unbindableKeys = new Set<string>();

    for (const candidate of candidates) {
      const primaryKey = listingKey(candidate);
      const candidateMlsKey = listingMlsKey(candidate);
      const key = existingGroups.has(primaryKey)
        ? primaryKey
        : candidateMlsKey
          ? existingByMlsKey.get(candidateMlsKey)
          : undefined;
      const group = key === undefined ? undefined : existingGroups.get(key);

      if (!group || key === undefined) {
        needsDetail.push(candidate);
        continue;
      }

      if (group.length > 1) {
        // The candidate matched an identity held by several distinct stored
        // rows, and nothing it carries says WHICH one it is: the search row
        // shares its address, city and province with all of them, and its MLS
        // is exactly what makes it a different record from at least one. So
        // it is bound to none of them. It does not refresh a `dom` — stamping
        // this run's days-on-market onto the wrong row is a quiet corruption
        // of a published listing — and it is not acquired as a new listing
        // either, since publishing a third row at an address that already has
        // two is not a repair. Every stored row involved stays retained
        // (their seed above already did that); the candidate is simply
        // dropped for this run, and says so.
        unbindableKeys.add(key);
        continue;
      }

      const existing = group[0];
      const seededRows = keptByKey.get(key);
      if (seededRows && seededRows.length > 0) {
        // Already retained by the seed above; the candidate's only job is to
        // refresh the volatile field the search row is authoritative for
        // (days-on-market), exactly as the pre-fix code did. The group is
        // unambiguous here, so `seededRows` holds exactly the one row.
        seededRows[0] = { ...seededRows[0], dom: candidate.dom, source: "cron" };
        continue;
      }

      if (retainedGroups.has(key)) {
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
        // so it can't also be carried forward. Only reachable for a group of
        // one — an ambiguous identity never gets here — which is what keeps
        // that claimed-key suppression from deleting the row it did not adopt.
        keptByKey.set(key, [{ ...existing, dom: candidate.dom, source: "cron" }]);
        continue;
      }

      needsDetail.push(candidate);
    }

    if (unbindableKeys.size > 0) {
      log.push(
        `[pipeline-guard] ${cfg.city}, ${cfg.province}: search candidates matched ${unbindableKeys.size} ` +
          `address|city|province identity(ies) held by more than one distinct stored row ` +
          `(${[...unbindableKeys].slice(0, 3).join("; ")}${unbindableKeys.size > 3 ? "; ..." : ""}) — bound to ` +
          `none of them, so no dom was refreshed and nothing new was acquired for those addresses; every ` +
          `stored row involved is retained`
      );
    }

    const kept = [...keptByKey.values()].flat();
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
  const orphanRetained: Listing[] = [];
  for (const [key, rows] of retainedGroups) {
    if (!seededKeys.has(key)) orphanRetained.push(...rows);
  }
  if (orphanRetained.length > 0) {
    const orphanCities = [...new Set(orphanRetained.map((l) => `${l.city}, ${l.province}`))].join("; ");
    log.push(
      `[pipeline-guard] ${orphanRetained.length} stored listing(s) match no configured city ` +
        `(${orphanCities}) — retained and freshness-checked`
    );
    freshnessQueue.push(...orphanRetained);
  }

  return { cityBuckets, orphanRetained, freshnessQueue, ambiguousIdentities, log };
}

export type FreshnessVerdict = "live" | "dead" | "unknown";

export interface FreshnessPassResult {
  /**
   * The exact ROW OBJECTS a "dead" verdict was issued for. THE removal
   * authority — nothing else may remove a row, and no key may stand in for
   * this set. Object identity, because two rows can share an identity and a
   * verdict belongs to the one that was checked; the queue hands the caller
   * back the very rows it will prune, so the match is exact.
   */
  deadRows: Set<Listing>;
  /**
   * listingKey() of every identity holding at least one dead row. REPORTING
   * ONLY — logs, the response payload, and tests that want to name what died.
   * It cannot remove anything: for an identity held by two distinct rows it
   * does not say which one the verdict was about.
   */
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
  const deadRows = new Set<Listing>();
  const deadKeys = new Set<string>();
  const log: string[] = [];
  if (opts.queue.length === 0) {
    return { deadRows, deadKeys, checked: 0, remaining: 0, errored: 0, log };
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
      if (status === "dead") {
        deadRows.add(l);
        deadKeys.add(listingKey(l));
      }
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

  return { deadRows, deadKeys, checked, remaining, errored, log };
}

/**
 * Drop exactly the ROWS a "dead" verdict was issued for, and nothing else.
 *
 * Matching is by object identity, not by key. A key cannot do this job: two
 * distinct stored rows can share one address|city|province (see IDENTITY IS
 * NOT A ROW), and a key-filter handed one of their verdicts would delete both
 * — the second with no verdict of its own, which is the whole class of bug
 * this module refuses. A namesake in another city is untouched for the same
 * reason it always was, only now the reason is stronger than its key.
 *
 * `deadRows` holds the very objects runFreshnessPass checked, and the queue is
 * built from the same arrays the caller prunes, so the match is exact. If a
 * row is somehow copied in between it will not match and will survive — that
 * is the safe direction of the two, and it is the direction this fails in.
 */
export function pruneDead(listings: Listing[], deadRows: ReadonlySet<Listing>): Listing[] {
  if (deadRows.size === 0) return listings;
  return listings.filter((l) => !deadRows.has(l));
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
 *
 * `ambiguousKeys` (planRetention's `ambiguousIdentities`) is the last gap in
 * that reasoning. An identity held by more than one distinct stored row does
 * not name a single row either, so "the city buckets published this identity"
 * stops implying "they published THIS row" — and suppression here is a
 * deletion with no verdict behind it. Those rows are therefore carried
 * forward regardless of the claim. The cost is a possible duplicate row at one
 * identity, which writeAllListings' isSameRecord dedup collapses when it is a
 * real duplicate and keeps when it is not; the alternative cost is a deleted
 * user listing. planRetention refuses to adopt an ambiguous identity into a
 * city bucket precisely so this stays a belt-and-braces guard rather than the
 * routine path. Omitting the argument means "no identity is ambiguous", which
 * is the truth for every store that has none.
 */
export function selectUserCarryForward(
  existingListings: Listing[],
  claimedKeys: Set<string>,
  ambiguousKeys: ReadonlySet<string> = new Set<string>()
): Listing[] {
  return existingListings.filter((l) => {
    if (l.source !== "user") return false;
    const key = listingKey(l);
    return !claimedKeys.has(key) || ambiguousKeys.has(key);
  });
}

export interface SlugCollision {
  slug: string;
  /** listingKey() of each distinct property claiming this slug. */
  identities: string[];
  /**
   * How many retained ROWS claim it. Can exceed `identities.length`: two rows
   * of one ambiguous identity share a slug too, and only one of them can own
   * listings:by-slug:{slug}.
   */
  rows: number;
}

/**
 * Retained rows that slugify to one URL — more than one row, whether or not
 * they are more than one property.
 *
 * This is the cost of refusing to collapse: the pre-fix Maps dropped the
 * loser of each collision (a property with no verdict), so the collision could
 * not be observed. Now every row survives and only one of them can own
 * listings:by-slug:{slug} — the others render the winner's snapshot at their
 * own URL until the listing-lifecycle work lands. It counts ROWS rather than
 * identities because both shapes produce the same defect: two properties at
 * one address string (distinct identities, one slug), and two rows at one
 * identity (one identity, still one slug). `identities` names the distinct
 * properties involved, so a caller can tell the two shapes apart.
 *
 * kv/listings.ts console.warns the same condition on the write path; this
 * surfaces it in the cron's own log[] and response, where the operator of
 * this route is actually looking.
 */
export function retainedSlugCollisions(retained: Listing[]): SlugCollision[] {
  const bySlug = new Map<string, { identities: Set<string>; rows: number }>();
  for (const l of retained) {
    const slug = slugify(l.address);
    const entry = bySlug.get(slug);
    if (entry) {
      entry.identities.add(listingKey(l));
      entry.rows++;
    } else {
      bySlug.set(slug, { identities: new Set([listingKey(l)]), rows: 1 });
    }
  }
  return [...bySlug.entries()]
    .filter(([, e]) => e.rows > 1)
    .map(([slug, e]) => ({ slug, identities: [...e.identities], rows: e.rows }));
}
