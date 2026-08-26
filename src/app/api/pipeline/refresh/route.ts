/**
 * /api/pipeline/refresh
 *
 * Daily cron job that:
 * 1. Searches all cities in parallel
 * 2. Retains every stored listing it owns, refreshing matched ones from search
 * 3. Freshness-checks them all; only a positive "dead" verdict removes one
 * 3b. Backfills up to each city's target with new candidates
 * 4. Carries forward user-requested listings (source: "user")
 * 5. Enriches new + re-enriches stale user listings
 * 6. Writes enriched data to KV
 *
 * Vercel Cron: daily 2pm UTC (0 14 * * *)
 */

import { NextResponse } from "next/server";
import { searchListings, fetchDetail, checkFreshness, fetchSoldListings, ZoocasaSoldRaw } from "@/lib/zoocasa";
import { readListingsStore, writeAllListings } from "@/lib/kv/listings";
import { enrichListing } from "@/lib/pipeline/enrich";
import { refreshUSDiscover } from "@/lib/pipeline/us-discover";
import { slugify } from "@/lib/utils";
import { Listing } from "@/lib/types";
import { isUSState } from "@/lib/assessment/us";
import { CITIES, type CityConfig } from "@/lib/pipeline/ca-cities";
import { listingKey } from "@/lib/listing-identity";
import {
  planRetention,
  runFreshnessPass,
  pruneDead,
  acquisitionAllowance,
  selectNewListings,
  selectUserCarryForward,
  retainedSlugCollisions,
  type CitySearchOutcome,
} from "@/lib/pipeline/retention";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Fields to strip before re-enrichment
const PRE_FIELDS: (keyof Listing)[] = [
  "preScore", "preTier", "preSignals", "preNarrative", "preOffer", "assessmentNote",
  "preAssessment", "preComparables",
];

const STALE_DAYS = 7;

function stripPrecomputed(listing: Listing): Listing {
  const clean = { ...listing };
  for (const f of PRE_FIELDS) {
    delete (clean as unknown as Record<string, unknown>)[f];
  }
  return clean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isStale(listing: Listing): boolean {
  if (!listing.enrichedAt) return true;
  const age = Date.now() - new Date(listing.enrichedAt).getTime();
  return age > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export async function GET(request: Request) {
  // Verify cron secret if configured; skip auth if not set (Vercel cron infra handles security)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  const log: string[] = [];
  const summary: { city: string; province: string; existing: number; new: number; total: number }[] = [];

  try {
    // -----------------------------------------------------------------------
    // [pipeline-guard] Degraded-read abort.
    //
    // Every listing in this run's write payload derives from this one read:
    // Phase 2 seeds retention from it, Phase 5 carries user listings from
    // it, Phase 8 carries US listings from it. It is therefore the single
    // place where a silent read failure becomes a mass deletion, and it is
    // checked before any provider work happens.
    //
    // readListingsStore() rather than getAllListings():
    //
    //  - getAllListings() flattens all three outcomes into a Listing[] and
    //    reports degradation out-of-band through getListingsStoreHealth().
    //    That stamp is process-global mutable state, so on a warm lambda a
    //    concurrent request can overwrite it between our read and our check
    //    — in either direction. A guard this load-bearing cannot depend on
    //    a value another request can move.
    //  - readAllListings() is race-free but still resolves the local-dev
    //    static seed as `ok`, which is exactly the 250-row array that must
    //    never seed a retention decision.
    //
    // readListingsStore() has neither property: it returns the store's real
    // state, with no seed path, and `unavailable` carries its reason.
    // `absent` means no manifest AND no legacy blob — a genuinely fresh
    // namespace, which is safe to build on but loud enough to be worth
    // saying out loud.
    //
    // writeAllListings()'s floor guard is the backstop, not the fix: it now
    // refuses a write it cannot size-check, so this state cannot silently
    // wipe the store even if this abort were removed. But by then the run
    // has already spent its Zoocasa search budget, its detail fetches and
    // its LLM enrichment calls on a payload that gets thrown away. Refuse
    // here instead — loudly, and before any spend.
    // -----------------------------------------------------------------------
    const storeRead = await readListingsStore();
    if (storeRead.status === "unavailable") {
      log.push(
        `[pipeline-guard] ABORT: listings store unreadable (${storeRead.reason}). Refusing to run: ` +
          `every retention decision below would be made against a store this run cannot see, and ` +
          `absence from an unreadable store is not evidence a listing is gone.`
      );
      return NextResponse.json(
        {
          success: false,
          error: `listings store unavailable — refresh aborted before any provider work or write`,
          reason: storeRead.reason,
          log,
          totalTimeMs: elapsed(),
        },
        { status: 503 }
      );
    }
    const existingListings = storeRead.status === "ok" ? storeRead.listings : [];
    if (storeRead.status === "absent") {
      log.push(
        `[pipeline-guard] listings store is genuinely EMPTY (no manifest, no legacy blob) — ` +
          `treating this as a fresh namespace and seeding from search. If this is production, stop and ` +
          `investigate before trusting the write.`
      );
    }

    log.push(`Loaded ${existingListings.length} existing listings (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 1: Search ALL cities in parallel
    // -----------------------------------------------------------------------
    const searchResults = await Promise.allSettled(
      CITIES.map(async (cfg): Promise<CitySearchOutcome<CityConfig>> => {
        const [defaultResults, oldestResults] = await Promise.all([
          searchListings(cfg.city, cfg.province, {
            type: "house", beds: 3, minPrice: cfg.minPrice, maxPrice: cfg.maxPrice,
          }),
          searchListings(cfg.city, cfg.province, {
            type: "house", beds: 3, minPrice: cfg.minPrice, maxPrice: cfg.maxPrice, sortBy: "days-desc",
          }),
        ]);
        const seen = new Set<string>();
        const candidates: Listing[] = [];
        for (const l of [...defaultResults, ...oldestResults]) {
          const key = l.mlsNumber || l.address;
          if (!seen.has(key)) { seen.add(key); candidates.push(l); }
        }
        return { cfg, candidates };
      })
    );

    log.push(`Phase 1 search done (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 2: Seed retention from STORED listings, then let this run's
    //          search candidates refresh or extend that set.
    //
    // The algorithm, the retention invariant it enforces, the identity rule
    // it keys on and the 2026-08 incidents behind all three now live in
    // src/lib/pipeline/retention.ts — where they can be driven from fixtures
    // (scripts/test-listing-retention.ts) instead of only by running this
    // cron against the live store, which is the one thing nobody may do to
    // check a retention change. What stays here is the wiring: which stored
    // rows this pipeline owns, and folding the planner's log lines into this
    // run's log so a degraded search is still visible in the cron output.
    //
    // Ownership: source:"user" rows belong to Phase 5 (own freshness pass),
    // US rows to Phase 8 (carried unconditionally). Everything else is this
    // pipeline's to retain — including legacy rows carrying no `source` at
    // all, which are CA cron listings predating the field.
    // -----------------------------------------------------------------------
    const retention = planRetention<CityConfig>({
      cities: CITIES,
      searchResults,
      existingListings,
      isOwned: (l) => l.source !== "user" && !isUSState(l.province),
    });
    const { cityBuckets, freshnessQueue } = retention;
    let orphanRetained = retention.orphanRetained;
    log.push(...retention.log);

    log.push(
      `Phase 2 retention: ${freshnessQueue.length} stored listing(s) retained and queued for freshness ` +
        `(${orphanRetained.length} orphaned), ${cityBuckets.reduce((s, b) => s + b.needsDetail.length, 0)} candidate(s) need detail (${elapsed()}ms)`
    );

    // -----------------------------------------------------------------------
    // Phase 3: Batch freshness check ALL retained listings. This is the ONLY
    //          removal authority in the route, and it removes exactly the
    //          ROWS it issued a "dead" verdict for — a namesake at the same
    //          street address in another city is untouched, and so is a
    //          second stored row sharing one address|city|province with a
    //          row that died. See runFreshnessPass in pipeline/retention.ts.
    //
    //          The deadline sits well ahead of Phase 4's 180s detail-fetch
    //          cutoff and Phase 7's 240s enrich cutoff so a slow provider
    //          cannot starve the rest of the run. Phase 2 queues the whole
    //          stored set rather than the candidate-matched slice, so this
    //          budget is a routine limiter rather than an edge case; every
    //          row it leaves unchecked stays retained and says so in the log.
    // -----------------------------------------------------------------------
    const FRESHNESS_DEADLINE_MS = 150_000;
    const freshness = await runFreshnessPass({
      queue: freshnessQueue,
      elapsed,
      deadlineMs: FRESHNESS_DEADLINE_MS,
      maxWorkers: 20,
      check: (l) => {
        const slug = l.url?.replace("https://www.zoocasa.com", "").split("/").pop() || "";
        return checkFreshness(l.address, l.city, l.province, slug || undefined);
      },
    });
    log.push(...freshness.log);
    // deadRows is the removal authority (the row objects that got a verdict);
    // deadKeys is the identity-level summary and is reported, never applied.
    const deadRows = freshness.deadRows;
    const deadKeys = freshness.deadKeys;
    const uncheckedFreshness = freshness.remaining + freshness.errored;

    if (deadRows.size > 0) {
      for (const bucket of cityBuckets) {
        bucket.kept = pruneDead(bucket.kept, deadRows);
      }
      orphanRetained = pruneDead(orphanRetained, deadRows);
    }

    log.push(
      `Phase 3 freshness done: ${freshness.checked} checked, ${deadRows.size} row(s) pruned across ` +
        `${deadKeys.size} identity(ies) (${elapsed()}ms)`
    );

    // -----------------------------------------------------------------------
    // Phase 4: Detail fetches + assembly per city
    // -----------------------------------------------------------------------
    const allListings: Listing[] = [];
    // Identities (address|city|province) this phase has published. Phase 5
    // reads it to avoid carrying a user listing a city bucket already
    // adopted. It is an identity set, not an address set: an address set
    // let a Victoria listing suppress a Calgary user listing that merely
    // shared a street address, which is a removal with no verdict behind it.
    const citiesClaimedKeys = new Set<string>();

    // -------------------------------------------------------------------
    // [pipeline-guard] Slug identity is NOT property identity, and this is
    // the seam where the difference bites. listings:by-slug:* is keyed by
    // slugify(address) alone — no city — so two retained rows that are
    // provably different properties (different listingKey) can still want
    // one URL — as can two distinct rows of ONE identity. Neither pair could
    // be produced by the Maps this replaced: they silently dropped the loser,
    // which is the deletion-without-a-verdict this route exists to prevent.
    //
    // Resolution, in the two cases that can arise:
    //  - RETAINED vs RETAINED: both are kept. Retention outranks index
    //    tidiness — one row renders the other's snapshot at its URL, which
    //    is recoverable; deleting a live listing is not. Reported below and
    //    in the response so it is never silent.
    //  - RETAINED vs NEW: the retained, already-published row wins and the
    //    newcomer is skipped (selectNewListings). The set is built once for
    //    ALL buckets and the orphans, because a Calgary newcomer can
    //    collide with a Victoria retained row it never meets in its bucket.
    // -------------------------------------------------------------------
    const allRetained = [...cityBuckets.flatMap((b) => b.kept), ...orphanRetained];
    const claimedSlugs = new Set(allRetained.map((l) => slugify(l.address)));
    const slugCollisions = retainedSlugCollisions(allRetained);
    if (slugCollisions.length > 0) {
      const sample = slugCollisions
        .slice(0, 5)
        .map((c) => `${c.slug} (${c.rows} row(s), ${c.identities.length} identity(ies))`)
        .join(", ");
      log.push(
        `[pipeline-guard] ${slugCollisions.length} slug(s) claimed by more than one retained row — ` +
          `all rows retained, but only the last written owns /property/{slug}: ${sample}` +
          `${slugCollisions.length > 5 ? ", ..." : ""}`
      );
    }

    for (const bucket of cityBuckets) {
      const { cfg, kept, needsDetail } = bucket;

      // cfg.target is an ACQUISITION cap, never a retention cap — it bounds
      // only how much of `needsDetail` this run may take. See
      // acquisitionAllowance in pipeline/retention.ts for the eviction bug
      // that rule replaced.
      const newAllowance = acquisitionAllowance(cfg.target, kept.length);
      const toFetch = newAllowance > 0 ? needsDetail.slice(0, Math.min(newAllowance + 5, 30)) : [];

      const detailed: Listing[] = [];

      // Skip detail fetches if time is very tight
      if (toFetch.length > 0 && elapsed() < 180_000) {
        for (const candidate of toFetch) {
          if (detailed.length >= newAllowance) break;
          try {
            const urlPath = candidate.url?.replace("https://www.zoocasa.com", "") || "";
            const slug = urlPath.split("/").pop() || "";
            if (!slug) continue;
            const detail = await fetchDetail(candidate.address, cfg.city, cfg.province, slug);
            const listing = stripPrecomputed(detail.listing);
            if (!listing.url && candidate.url) listing.url = candidate.url;
            if (!listing.mlsNumber && candidate.mlsNumber) listing.mlsNumber = candidate.mlsNumber;
            if (!listing.address && candidate.address) listing.address = candidate.address;
            detailed.push(listing);
            await sleep(500);
          } catch {
            // Skip failed detail fetches
          }
        }
      } else if (toFetch.length > 0) {
        log.push(`${cfg.city}: skipping detail fetches — time budget (${elapsed()}ms)`);
      }

      // sqft preference, acquisition cap and the slug guard, in one place —
      // `claimedSlugs` is the run-wide set built above and is mutated here.
      const { newListings, slugSkipped } = selectNewListings({
        kept,
        detailed,
        target: cfg.target,
        claimedSlugs,
      });
      if (slugSkipped.length > 0) {
        log.push(
          `[pipeline-guard] ${cfg.city}: ${slugSkipped.length} new candidate(s) skipped — their address slug ` +
            `is already owned by a published listing (${slugSkipped.slice(0, 3).map((l) => slugify(l.address)).join(", ")})`
        );
      }

      const cityListings = [...kept, ...newListings];
      cityListings.sort((a, b) => b.dom - a.dom);

      for (const p of cityListings) {
        citiesClaimedKeys.add(listingKey(p));
      }

      allListings.push(...cityListings);
      const newCount = cityListings.filter(p => !p.preNarrative).length;
      summary.push({
        city: cfg.city, province: cfg.province,
        existing: cityListings.length - newCount, new: newCount, total: cityListings.length,
      });
      log.push(`${cfg.city}: ${cityListings.length} (${kept.length} retained, ${newCount} new)`);
    }

    // [pipeline-guard] Fold in retained listings that belong to no
    // configured city (see the orphan comment in Phase 2). They have
    // already been through Phase 3's freshness gate.
    if (orphanRetained.length > 0) {
      allListings.push(...orphanRetained);
      for (const p of orphanRetained) citiesClaimedKeys.add(listingKey(p));
      log.push(`[pipeline-guard] folded in ${orphanRetained.length} retained listing(s) from unconfigured cities`);
    }

    log.push(`Phase 4 detail done: ${allListings.length} CITIES listings (${elapsed()}ms)`);

    // -----------------------------------------------------------------------
    // Phase 5: Carry forward user-sourced listings
    // -----------------------------------------------------------------------
    // Every user listing no city bucket already adopted. Suppression keys on
    // property identity and nothing coarser — and is withheld entirely for an
    // identity held by more than one distinct stored row, where "this identity
    // was published" no longer implies "this row was". See
    // selectUserCarryForward: dropping a row here is a deletion with no
    // freshness verdict behind it, so it takes an unambiguous claim.
    const userListings = selectUserCarryForward(
      existingListings,
      citiesClaimedKeys,
      retention.ambiguousIdentities
    );

    if (userListings.length > 0) {
      // Freshness check user listings
      // Same removal authority and same identity rule as Phase 3, on its own
      // (unbounded) budget: a "dead" verdict removes the one identity it was
      // issued for and nothing else.
      const userFreshness = await runFreshnessPass({
        queue: userListings,
        elapsed,
        deadlineMs: Number.POSITIVE_INFINITY,
        maxWorkers: 6,
        check: (l) => {
          const slug = l.url?.replace("https://www.zoocasa.com", "").split("/").pop() || "";
          return checkFreshness(l.address, l.city, l.province, slug || undefined);
        },
      });
      log.push(...userFreshness.log);

      const alive = pruneDead(userListings, userFreshness.deadRows);
      allListings.push(...alive);
      log.push(`User listings: ${userListings.length} found, ${userFreshness.deadRows.size} dead, ${alive.length} carried forward (${elapsed()}ms)`);
    } else {
      log.push("User listings: none to carry forward");
    }

    // -----------------------------------------------------------------------
    // Phase 6: Fetch sold pools (parallel, skip if tight)
    // -----------------------------------------------------------------------
    const soldPools = new Map<string, ZoocasaSoldRaw[]>();

    if (elapsed() < 200_000) {
      const allCityKeys = new Set<string>();
      for (const cfg of CITIES) {
        allCityKeys.add(`${cfg.city.toLowerCase()}|${cfg.province.toLowerCase()}`);
      }
      for (const l of allListings) {
        if (l.source === "user") {
          allCityKeys.add(`${l.city.toLowerCase()}|${l.province.toLowerCase()}`);
        }
      }

      const poolEntries = await Promise.allSettled(
        [...allCityKeys].map(async (key) => {
          const [city, province] = key.split("|");
          const pool = await fetchSoldListings(city, province);
          return { key, city, pool };
        })
      );

      for (const entry of poolEntries) {
        if (entry.status === "fulfilled") {
          soldPools.set(entry.value.key, entry.value.pool);
        }
      }
      log.push(`Sold pools: ${soldPools.size} fetched (${elapsed()}ms)`);
    } else {
      log.push(`Sold pools: skipped — time budget (${elapsed()}ms)`);
    }

    // -----------------------------------------------------------------------
    // Phase 7: Enrich new + re-enrich stale user listings
    // -----------------------------------------------------------------------
    const enrichStart = Date.now();
    let enrichedCount = 0;
    let reEnrichedCount = 0;

    for (let i = 0; i < allListings.length; i++) {
      const listing = allListings[i];
      const isUserStale = listing.source === "user" && isStale(listing);
      const needsEnrich = !listing.preNarrative || isUserStale;

      if (!needsEnrich) continue;

      // Check time budget: leave 40s for KV write + purge
      if (elapsed() > 240_000) {
        log.push(`Time budget reached at ${elapsed()}ms, deterministic fallback for remaining`);
        for (let j = i; j < allListings.length; j++) {
          const jListing = allListings[j];
          const jNeedsEnrich = !jListing.preNarrative || (jListing.source === "user" && isStale(jListing));
          if (jNeedsEnrich) {
            const pool = soldPools.get(`${jListing.city.toLowerCase()}|${jListing.province.toLowerCase()}`);
            allListings[j] = await enrichListing(stripPrecomputed(jListing), { skipLlm: true, soldPool: pool, syncAssessmentOnly: true });
            allListings[j].source = jListing.source || "cron";
            allListings[j].enrichedAt = new Date().toISOString();
            enrichedCount++;
          }
        }
        break;
      }

      const pool = soldPools.get(`${listing.city.toLowerCase()}|${listing.province.toLowerCase()}`);
      const listingToEnrich = isUserStale ? stripPrecomputed(listing) : listing;
      const useForceLlm = listing.source === "user";

      try {
        allListings[i] = await enrichListing(listingToEnrich, {
          soldPool: pool,
          ...(useForceLlm ? { forceLlm: true } : {}),
        });
        allListings[i].source = listing.source || "cron";
        allListings[i].enrichedAt = new Date().toISOString();
        enrichedCount++;
        if (isUserStale) reEnrichedCount++;
        if (allListings[i].preTier !== "WATCH" || useForceLlm) {
          await sleep(1500);
        }
      } catch (err) {
        log.push(`Enrich failed for ${listing.address}: ${err}`);
        allListings[i] = await enrichListing(listingToEnrich, { skipLlm: true, soldPool: pool });
        allListings[i].source = listing.source || "cron";
        allListings[i].enrichedAt = new Date().toISOString();
        enrichedCount++;
      }
    }

    // Tag legacy listings
    const now = new Date().toISOString();
    for (let i = 0; i < allListings.length; i++) {
      if (!allListings[i].enrichedAt) allListings[i].enrichedAt = now;
      if (!allListings[i].source) allListings[i].source = "cron";
    }

    log.push(`Enriched ${enrichedCount} (${reEnrichedCount} user re-enriched) in ${Date.now() - enrichStart}ms (${elapsed()}ms total)`);

    // -----------------------------------------------------------------------
    // Phase 8: Write to KV
    //
    // ROOT CAUSE OF THE 2026-08-09 US-LISTING WIPE (proven via live KV
    // inspection): this used to be `writeAllListings(allListings)` —
    // `allListings` at this point is built ENTIRELY from Phase 1-4's fresh
    // CA search results plus Phase 5's `source === "user"` carry-forward.
    // It structurally cannot contain a previously-stored US listing: US
    // Discover listings are tagged `source: "cron"` (see
    // pipeline/us-discover.ts), not "user", so Phase 5's carry-forward
    // filter always excludes them. A bare `writeAllListings(allListings)`
    // is therefore a full replace of listings:all with a CA-only array —
    // it silently discarded every US listing on every single run,
    // regardless of whether Phase 9 (refreshUSDiscover, below) went on to
    // repair it that cycle. On 2026-08-09 Phase 9 could NOT repair it
    // (RentCast quota was already exhausted before this run — see that
    // phase's comment) so the wipe was never undone: listings:all went
    // from ~280 (136 CA + 144 US) to 53 (0 US) in one cron tick.
    //
    // FIX: country-aware merge-write. CA listings are fully rebuilt by this
    // run (that's this pipeline's whole job); everything else (US listings,
    // any future third country) is untouched data this pipeline has no
    // business overwriting, so carry it forward unconditionally.
    // -----------------------------------------------------------------------
    const writeStart = Date.now();
    const nonCaExisting = existingListings.filter((l) => isUSState(l.province));
    const writePayload = [...nonCaExisting, ...allListings];

    // -----------------------------------------------------------------------
    // [pipeline-guard] STALE-SLUG PURGE IS INTENTIONALLY DISABLED HERE.
    // This is a deliberate omission, not an oversight — do not "restore" it.
    //
    // This route used to call purgeStaleSlugKeys(validSlugs) on the line
    // above, and that call is what converted a recoverable pipeline bug
    // into 409 permanently-404ing property URLs in 2026-08. Two distinct
    // problems, both fatal:
    //
    //  (a) ORDERING. It ran BEFORE writeAllListings(). If the floor guard
    //      refused the write (kv/listings.ts returns { refused: true } when
    //      the new array is under FLOOR_GUARD_MIN_RATIO of the stored
    //      count — exactly the shape a truncated search produces), or the
    //      write simply threw, the by-slug keys were already gone. The
    //      guard that exists to make a bad run a no-op instead made it a
    //      half-destroyed store: listings:all intact, every dropped
    //      listing's page 404.
    //
    //  (b) PREMISE. Purging at all treats "absent from this run's payload"
    //      as "should not exist" — the same false inference this whole
    //      commit exists to remove from Phase 2. Even with the retention
    //      invariant in place, an automated path that DELETES on every tick
    //      has no safety margin: one future bug upstream of it becomes
    //      permanent data loss on the next cron tick, unattended, at 2pm
    //      UTC. An orphaned by-slug key, by contrast, costs a few KB and
    //      is recoverable; a deleted one is a deindexed URL and is not.
    //
    // KNOWN INTERIM CONSEQUENCE — read this before changing anything here.
    // listings:by-slug:* is NOT a secondary index. getListingBySlug()
    // (kv/listings.ts) reads that key FIRST and only falls back to
    // scanning the sharded chunks if it misses, so an orphaned key is the
    // PRIMARY read path for /property/[slug], not dead weight. With the
    // purge disabled, a listing that Phase 3 positively confirms "dead"
    // leaves listings:all (so it drops out of the sitemap, /discover and
    // search) while its by-slug key survives — its property page keeps
    // rendering the last-written snapshot, indefinitely, with no
    // indication that the listing is off-market. That is undisclosed
    // staleness and it violates this repo's fail-loud rule.
    //
    // It is nonetheless the deliberately chosen interim state: a stale
    // page for a sold house is recoverable, a 404 on an indexed URL is
    // not, and the alternative (a targeted delete on a "dead" verdict) is
    // exactly the automated-DELETE pattern (a) and (b) above rule out.
    // The real fix is the listing-lifecycle work — persist an
    // active/inactive/unknown status, keep serving the page, and label it
    // with its last-verified date — which is tracked separately. Do not
    // close this gap by re-enabling the purge.
    //
    // Purging remains available for supervised, intentional bulk changes:
    // purgeStaleSlugKeys() is still exported from kv/listings.ts and is
    // still called by scripts/seed-zoocasa.ts and
    // scripts/run-city-pipeline.ts, where a human is watching the output.
    // -----------------------------------------------------------------------
    log.push("[pipeline-guard] stale-slug purge disabled in this route by design — see Phase 8 comment; purge via scripts/seed-zoocasa.ts or scripts/run-city-pipeline.ts under supervision");

    const result = await writeAllListings(writePayload);
    if (result.refused) {
      log.push(`[pipeline-guard] KV write REFUSED: ${result.refusedReason} — listings:all left untouched this run`);
    } else {
      log.push(
        // result.written is the truthful post-dedup count and can be lower
        // than the submitted total — writeAllListings drops rows it can
        // prove are the same record (same MLS, or same address+city+
        // province where no MLS exists). Report both so a growing gap
        // between them is visible rather than looking like a lost write.
        `KV write: ${result.written} listings written of ${writePayload.length} submitted ` +
          `(${allListings.length} CA + ${nonCaExisting.length} preserved non-CA` +
          `${writePayload.length - result.written > 0 ? `, ${writePayload.length - result.written} duplicate row(s) deduped` : ""}), ` +
          `${result.slugs} slugs in ${Date.now() - writeStart}ms (${elapsed()}ms total)`
      );
    }

    const reportedListings = result.refused ? existingListings : writePayload;
    const totalListings = reportedListings.length;
    const byProvince = new Map<string, number>();
    const bySource = { cron: 0, user: 0 };
    for (const l of reportedListings) {
      byProvince.set(l.province, (byProvince.get(l.province) || 0) + 1);
      if (l.source === "user") bySource.user++;
      else bySource.cron++;
    }

    // -----------------------------------------------------------------------
    // Phase 9: US Discover refresh (RentCast, quota-guarded — see
    // src/lib/pipeline/us-discover.ts). Runs after the CA refresh has
    // already written its results to KV so a US failure can never undo or
    // block the CA update; isolated in its own try/catch for the same
    // reason — a RentCast outage or quota exhaustion here must not turn
    // this whole cron run into a 500.
    //
    // 2026-08-09 INCIDENT NOTE: before the Phase 8 fix above, this ordering
    // guarantee was false in practice — Phase 8's old full-replace write
    // ALREADY discarded every US listing before this phase ran, and
    // refreshUSDiscover()'s own merge-write only fires when it fetches at
    // least one new US listing (see its `if (allNew.length > 0)` guard in
    // us-discover.ts). On 2026-08-09, RentCast quota was already at 45/45
    // before this phase ran (verified: the `rentcast:discover:*` sweep
    // caches for all 3 configured metros are absent from KV even though
    // their `us-discover:last-refresh:*` meta got stamped at this exact
    // cron's run time — see us-discover.ts's setLastRefresh fix below for
    // why a quota-blocked attempt used to stamp anyway), so every city's
    // fetch returned zero listings, `allNew` stayed empty, and Phase 9
    // silently did nothing to repair Phase 8's damage. With Phase 8 now
    // preserving non-CA listings unconditionally, this phase is back to
    // being a pure enrichment/backfill on top of an already-intact store —
    // its own failure or quota exhaustion no longer has any destructive
    // potential regardless of this phase's outcome.
    // -----------------------------------------------------------------------
    let usDiscover: Awaited<ReturnType<typeof refreshUSDiscover>> | { error: string } | null = null;
    try {
      usDiscover = await refreshUSDiscover();
      log.push(
        `[us-discover] ${usDiscover.totalListings} listings across ${usDiscover.cities.length} cities, ` +
          `quota ${usDiscover.quotaAfter.used}/${usDiscover.quotaAfter.limit} (${elapsed()}ms total)`
      );
      for (const c of usDiscover.cities) {
        log.push(
          `[us-discover] ${c.city}, ${c.state}: ${
            c.skipped ? `skipped (${c.skipReason})` : `${c.scored} scored (${c.skipReason ?? "ok"})`
          }`
        );
      }
      if (usDiscover.activatedMetro) {
        log.push(`[us-discover] slow-fill activated: ${usDiscover.activatedMetro.city}, ${usDiscover.activatedMetro.state}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      usDiscover = { error: message };
      log.push(`[us-discover] failed: ${message}`);
    }

    return NextResponse.json({
      success: true,
      totalListings,
      totalTimeMs: elapsed(),
      byProvince: Object.fromEntries(byProvince),
      bySource,
      cities: summary,
      // Additive — existing consumers read summary/log/counts only.
      retention: {
        storedRetained: freshnessQueue.length,
        freshnessChecked: freshness.checked,
        freshnessUnchecked: uncheckedFreshness,
        // Rows actually removed, and the identities they belonged to. These
        // differ when one row of an ambiguous identity dies and its namesake
        // lives — the case that used to be a silent drop.
        deadPruned: deadRows.size,
        deadIdentities: deadKeys.size,
        orphansCarriedForward: orphanRetained.length,
        // Identities held by more than one distinct stored row. Every one of
        // those rows is retained; the number is a data-quality signal for the
        // listing-lifecycle work, not a retention outcome.
        ambiguousIdentities: retention.ambiguousIdentities.size,
        // Retained rows sharing one /property URL — kept, not collapsed.
        // See the Phase 4 slug-identity block.
        slugCollisions: slugCollisions.length,
        slugPurge: "disabled",
      },
      usDiscover,
      log,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: String(err),
        log,
        totalTimeMs: elapsed(),
      },
      { status: 500 }
    );
  }
}
