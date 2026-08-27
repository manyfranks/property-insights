# Production Runbook

Traces how Property Insights behaves under failure — every external
dependency, every fallback, every silent degradation — so a symptom in
production can be traced to a cause without reading source. File:line
citations are to the state of the repo as of this writing; re-verify line
numbers after future edits. (This repo had active concurrent development
during this document's own research pass — line numbers in `route.ts` and
`regional-econ.ts` in particular may already have drifted by a handful of
lines; the described *behavior* was re-verified against the current
working tree before publishing.)

This document describes what the code **does**, not what it should do.
Section 8 (Known Gaps) lists places where behavior is missing, inconsistent,
or worth hardening.

---

## Contents

1. [US assessment request flow](#1-us-assessment-request-flow)
2. [Canadian flow failure modes](#2-canadian-flow-failure-modes)
3. [Data-store guards](#3-data-store-guards)
4. [Batch/ingest jobs inventory](#4-batchingest-jobs-inventory)
5. [Cron surface](#5-cron-surface)
6. [External dependency matrix](#6-external-dependency-matrix)
7. [Monitoring quick-reference](#7-monitoring-quick-reference)
8. [Known gaps](#8-known-gaps)

---

## 1. US assessment request flow

Entry point: `POST /api/assess` → `src/app/api/assess/route.ts`. US routing
happens after address parsing determines `country === "US"`
(`route.ts:614-616`), which calls `handleUSAssessment()` (`route.ts:222-531`).

### 1.1 Decision tree

```
POST /api/assess
 │
 ├─ auth() no userId ─────────────────────────────► 401 "Sign in to request an assessment" (route.ts:539-541)
 │
 ├─ isPro(userId) — Stripe check, fails soft to false on any error (billing.ts:49)
 │
 ├─ rate limit PRE-CHECK (assessLimiter, skipped if pro or Upstash unconfigured)
 │   remaining <= 0 ────────────────────────────────► 429 RATE_LIMIT (route.ts:550-555)
 │
 ├─ body parse / address validation ────────────────► 400 on bad JSON or invalid address (route.ts:558-570)
 │
 ├─ parseAddress() country === "US" → handleUSAssessment()
 │   │
 │   ├─ geocodeUSAddress() [Census geocoder, 8s timeout, no cache, no API key]
 │   │   ├─ throws (network/non-200) ────────────────► 502 "Failed to look up this address" (route.ts:244-250)
 │   │   └─ returns null (no match) ─────────────────► 404 "We couldn't locate this address" (route.ts:252-262)
 │   │
 │   ├─ rate limit CONSUMED here (only after a confirmed real address) (route.ts:269-274)
 │   │   limiter.limit() fails ───────────────────────► 429 RATE_LIMIT
 │   │
 │   ├─ Promise.all([ getUSProperty() , getCountyMarketPanel(), lookupCountyLive() ])
 │   │   getUSProperty() is .catch()-guarded → null on any failure, logged "rentcast error"
 │   │   getCountyMarketPanel() is NOT .catch()-guarded (see §8 Known Gaps — Neon-down gap)
 │   │
 │   ├─ hasUsableRentcastData = bundle && (record || avm || activeListing)  (route.ts:299)
 │   │
 │   ├─ NOT usable (quota exhausted / RentCast down / no record at all)
 │   │   └─► FALLBACK TIER: property-specific live county value when available,
 │   │       otherwise lookupAssessment() (county-level ACS median via assessment/us.ts)
 │   │       response: offerAvailable:false, offerUnavailableReason:"no_listing_data" (route.ts:320-333)
 │   │
 │   ├─ usable AND bundle.activeListing present
 │   │   └─► LISTED TIER: full offer cascade + US Advantage + narrative (route.ts:346-486)
 │   │
 │   └─ usable BUT no activeListing (RentCast has record/AVM, not on market)
 │       └─► OFF-MARKET TIER: offerAvailable:false, offerUnavailableReason:"not_listed",
 │           avm + rent + US Advantage still computed (route.ts:488-537)
```

### 1.2 RentCast bundle — cache, quota, per-field tolerance

`src/lib/rentcast.ts`. Each configured credential includes **50 successful
requests/month**. Production consumes remaining allowance on keys 2 and 3
before the primary credential. Secondary credentials are limited by
`RENTCAST_SECONDARY_MONTHLY_QUOTA` (default **50**, no overage); the primary
is limited by `RENTCAST_MONTHLY_QUOTA` (default **50**, operator-overridable).
Each credential has its own KV counter.

- **Cache layer** (`cachedRentcastCall`, `rentcast.ts:262-291`): checked
  first, zero quota cost on a hit. TTLs (`rentcast.ts:395-398`): property
  30d, AVM 30d, rent 30d, active-listing 24h (or a longer TTL matching the
  Discover sweep cadence when primed by `discoverActiveListingsByCity`,
  `rentcast.ts:796-807`).
- **Quota guard**: on a cache miss, an atomic KV `INCR` reserves a slot
  *before* the network call; if the increment pushes past the limit it is
  immediately decremented back and the call is **never made**
  (`rentcast.ts:271-277`). KV unavailable → falls back to an in-process
  `Map` counter (non-persistent across cold starts — degrades the
  guarantee, doesn't disable the guard, `rentcast.ts:104-109`).
- **Successful-request accounting**: HTTP 404s, timeouts, and other errors
  release the reserved slot. Only successful HTTP 200 responses remain in
  the counter, matching RentCast billing.
- **Per-endpoint fetch**: `rentcastRequest()` (`rentcast.ts:53-79`) — 8s
  timeout (`FETCH_TIMEOUT_MS`, `rentcast.ts:36`), HTTP 404 → `null` (a
  normal "no record" outcome, not an error), any other non-2xx → throw.
- **`getUSProperty()`** resolves `/properties` first using the complete
  input address (including ZIP), then uses the property record's canonical
  address for `/listings/sale` next (the product branch point), then
  `/avm/value` and `/avm/rent/long-term` in parallel. This ordering protects
  listing status when only one quota slot remains. Each field remains
  cached/quota-guarded **independently**. Bundle
  `meta.quotaExhausted` is true if *any* of the 4 was blocked;
  `meta.errors[]` collects per-field error strings, logged in the route's
  `[assess] rentcast done` line (`route.ts:286-293`).
- **`getUSPropertyLite()`** (`rentcast.ts:937-981`) — record + AVM only, no
  rent/listing calls — used by the Discover enrichment path
  (`us-enrich.ts`) to conserve quota (2 requests/listing vs. 4).

### 1.3 Anchor plausibility gate

`assessAnchorPlausibility()` (`src/lib/pipeline/us-assess.ts:249-436`) runs
**before** `offerModel()` for the listed tier. It exists because a county
assessed value can be real but catastrophically decoupled from market value
(agricultural exemptions, AZ's Limited Property Value, FL's Save-Our-Homes
cap, partial-parcel records — flagship case documented at
`us-assess.ts:120-129`, a $9.9M asking / $452k assessed Austin property).

Verdict is `"anchor"` (trust the assessed value) or `"context_only"`
(demote it — display only, don't drive the offer). Demotion triggers a
re-anchor in `route.ts:401-418`:
- `anchorDecision.anchorSource === "avm"` and RentCast has an AVM value →
  offer re-anchors on the AVM via a synthetic `Assessment` fed through the
  same `offerModel()` (not a bespoke formula).
- Otherwise → `offerModelLanguage()` (DOM/language-based, no assessed
  anchor at all — CA's own 85% floor equivalent).

### 1.4 Narrative generation ("THE SIGNAL")

`src/lib/pipeline/us-narrative.ts`. Only computed for the **listed** tier
(and Discover's enrichment path, `us-enrich.ts`).

| Stage | Detail |
|---|---|
| Model | `qwen/qwen3.7-flash` via OpenRouter (`us-narrative.ts:351`), `reasoning: {enabled: false}` (Qwen defaults to reasoning-on, which burns `max_tokens` on hidden chain-of-thought and returns empty content otherwise) |
| Missing API key | `OPENROUTER_API_KEY` unset → immediate `EMPTY_RESULT`, no network call (`us-narrative.ts:424-426`) |
| Timeout | `generateUsNarrative()` races the LLM call against `DEFAULT_TIMEOUT_MS = 12_000` (`us-narrative.ts:352,432-436`) — independent of the route's 60s `maxDuration`, so a hung OpenRouter call can't eat the rest of the request budget |
| Retry | One retry with a 1s backoff on parse/JSON failure (`callLlmWithRetry`, `us-narrative.ts:397-410`) |
| Total failure | Both attempts fail, or timeout fires first → `EMPTY_RESULT` (`{signals:[], confidence:0, narrative:""}`), never throws |
| Fallback | Caller (`route.ts:431-443`) checks `llmResult.narrative` truthiness; empty → `deterministicUsNarrative()` (`us-narrative.ts:105-153`), a template built from the same structured data (triangulation, equity signal, DOM, offer, over-assessment) — "THE SIGNAL" never renders empty |
| Post-hoc QA (log-only) | After either the LLM or deterministic narrative is chosen, `logNarrativeLint()` (`src/lib/pipeline/narrative-lint.ts`, called at `route.ts:450` and in `us-seed-analysis.ts`) runs two informational checks — number-tracing (does every number in the narrative trace back to a value that was actually in the prompt context, within tolerance) and banned-word-stem detection (denied/negated forms of "insulting"/"lowball"/etc. still count). **Never blocks, retries, or rewrites** — purely logs `[narrative-lint]` and persists the result on `Listing.preNarrativeLint` for monitoring. |

### 1.5 What the user sees, per failure mode

| Failure | HTTP status | Response shape | User-visible message |
|---|---|---|---|
| Not authenticated | 401 | `{error}` | "Sign in to request an assessment" |
| Daily cap hit (pre-check) | 429 | `{error, code:"RATE_LIMIT"}` | "Daily assessment limit reached (15/day)..." |
| Invalid JSON / address | 400 | `{error}` | "Invalid address" / parse-failure message |
| Census geocoder network error | 502 | `{error}` | "Failed to look up this address. Please try again." |
| Census geocoder no match | 404 | `{error}` | "We couldn't locate this address..." |
| RentCast fully down / quota exhausted / no record | 200 | `offerAvailable:false, offerUnavailableReason:"no_listing_data"` | County-median assessment only, no offer, no narrative — page renders sparse |
| RentCast has data, not listed | 200 | `offerAvailable:false, offerUnavailableReason:"not_listed"` | AVM + rent + US Advantage shown, "This property is not currently listed for sale." |
| RentCast listed + narrative LLM fails | 200 | `offerAvailable:true` | Full offer/signals/comparables render; narrative is the deterministic template instead of LLM prose (visually identical placement, terser text) |
| Neon down (configured but unreachable) | **500** (unhandled) | generic Next.js error | See §8 — `getCountyMarketPanel`/`getAcsCountyMedian` calls in the US path are not all `.catch()`-guarded |

---

## 2. Canadian flow failure modes

### 2.1 Zoocasa (`src/lib/zoocasa.ts`)

- **Shape assertions at the extraction boundary**: `mapDetailListing()`
  throws `ZoocasaShapeError` (`zoocasa.ts:465-480, 534-539`) when
  `address`/`city`/`price`/`dom` come back missing or malformed — a single
  bad detail page fails loud instead of letting `|| 0` / `""` defaults
  flow into scoring. Batch callers (`searchListings`, `zoocasa.ts:584-609`)
  filter+log instead of throwing (`[zoocasa-shape]`), so one bad listing in
  a batch doesn't sink the page.
- **City-scope filter** (`citiesMatch()`, `zoocasa.ts:819-827`): defends
  against a live Zoocasa regression (documented 2026-08) where
  subdivision-scoped search/sold URLs silently widen to a province-wide
  feed. Listings whose returned city doesn't match the request (or a known
  metro sibling, `CITY_SIBLINGS`) are dropped and logged `[zoocasa-scope]`
  with a drop percentage.
- **404 / not-found**: `fetchPage()` throws `ZoocasaNotFoundError` on HTTP
  404 or an SSR redirect containing `missingAddress`
  (`zoocasa.ts:499-505`).
- **`findAndFetchDetail()`** (`zoocasa.ts:898-930`): two-phase lookup —
  flat-URL fan-out across the typed city + metro siblings first, then
  falls back to search-and-match scoring (Jaccard token overlap, threshold
  0.7). Throws `ZoocasaNotFoundError` only if **both** phases miss →
  route.ts surfaces "paste the Zoocasa listing URL instead" (`route.ts:623-631`).

### 2.2 Province assessment adapters (`src/lib/assessment/`)

Registry: `src/lib/assessment/index.ts:45-57`, one entry per region code
(`BC`, `ON`, `AB`, `MB`); US states dispatch to a single shared adapter via
`isUSState()`. Fallthrough order (`index.ts:111-130`): province adapter →
StatCan area median (`getStatCanMedian`, CA-only — US is explicitly skipped
since the US adapter already resolves its own county-level ACS median).

| Province | Live source | Cache | Failure behavior |
|---|---|---|---|
| BC | `bcassessment.ca` REST autocomplete + Puppeteer scrape via Browserless | `BC_ASSESSMENT_CACHE` (41 static properties, `assessments.ts`) | `BcAssessmentShapeError` logged (`[bc-assessment-shape]`) on unexpected REST shape but swallowed to `null` by the outer try/catch (`bc.ts:296-301`); scrape hard-capped at 15s (`SCRAPE_TIMEOUT_MS`, `bc.ts:259`) raced against a timeout promise; `BROWSERLESS_API_KEY` unset → `scrapeValues()` returns `null` immediately, live scrape silently disabled, cache-only mode (`bc.ts:201-202`) |
| AB | Calgary/Edmonton SODA APIs (data.calgary.ca, data.edmonton.ca), Lethbridge ArcGIS | `AB_ASSESSMENT_CACHE` | `SodaShapeError` (`[soda-shape]`) thrown on non-array response or missing `assessed_value` field, caught by the outer try/catch → `null` (`ab.ts:175-177, 290-292`); unknown AB city tries Calgary then Edmonton in sequence (`ab.ts:145`) |
| MB (Winnipeg only) | Winnipeg SODA (`data.winnipeg.ca`, dataset d4mq-wa44) | **None** — `lookupMBSync` always returns `null` (`mb.ts:180-182`) | `MbSodaShapeError` (`[mb-soda-shape]`) on shape drift, caught to `null` (`mb.ts:223-226`); addresses outside Winnipeg simply miss (dataset scope) |
| ON | None — cache + tax-reverse-engineering only | `ON_ASSESSMENT_CACHE` | No network call at all. If cache misses, reverse-engineers assessed value from `annual_tax / municipal_rate` (`on.ts:32-52`), sanity-bounded to $50K-$50M; returns `null` if no tax/rate available. Cannot fail on network — purely synchronous. |

### 2.3 Assessment adapter registry fallthrough

Any province adapter miss → `areaMedianFallback()` (`index.ts:89-101`)
looks up `getStatCanMedian(city)` (city-level Census of Housing/StatCan
median, not property-specific). If that also misses (unknown city), the
final result is `null` and the pipeline falls to `offerModelLanguage()`
(the CA "85% floor," DOM/language-only offer with no assessed anchor).

### 2.4 Canary cron (`/api/canary`)

`src/app/api/canary/route.ts`, daily 19:00 UTC (`vercel.json`). Three
checks, run in parallel where possible:

1. **`checkZoocasaSearch()`** (`canary.ts:40-64`) — live `searchListings("Victoria","BC")`, asserts non-empty + shape-valid results.
2. **`checkBcCache()`** (`canary.ts:66-80`) — cache-only, no network; confirms `BC_ASSESSMENT_CACHE` loads and `lookupBCSync()` returns a well-formed `Assessment`. **Does not exercise the live BC scrape path.**
3. **`calgarySodaHealthCheck()`** (`ab.ts:190-203`) — live, broad SODA query (`assessment_class='RE'`, no address filter) confirming `assessed_value` is still present/numeric on the dataset.

Any failure → `200`→`500` response (Vercel's cron dashboard marks the run
failed) plus a `console.error("[canary]", ...)` line. Auth: `CRON_SECRET`
Bearer token if set, otherwise open (Vercel cron infra handles security).
**No probe covers**: Edmonton/Lethbridge/Winnipeg live lookups, Census
geocoder, RentCast, Neon, OpenRouter, KV/Upstash reachability, or the US
assessment path at all (see §8).

---

## 3. Data-store guards

### 3.1 KV listings store: read states, write states, identity (`src/lib/kv/listings.ts`)

**This section was rewritten 2026-08 after an audit. The previous version
described `getAllListings()` as falling back to static `PRELOADED_LISTINGS`
on a failed read, and as "the read path every other listings function funnels
through." Both statements are now false — do not act on a cached memory of
them.**

#### Read states

Every whole-store read resolves to one of three states, and the distinction
is load-bearing: collapsing "the store is empty" into "the store could not be
read" is what turned KV blips into 404s and empty sitemaps.

| State | Means | Produced when |
|---|---|---|
| `ok` | These are the listings. | Manifest + chunks (or the legacy `listings:all` blob) read and validated. |
| `absent` | The store verifiably holds nothing. | `listings:index` AND `listings:all` are both missing, over a healthy connection. |
| `unavailable` | We do not know what the store holds. | Fetch failure, non-2xx, unparseable value, a chunk the manifest promised that isn't there, a reassembly that isn't `Listing[]`, or a row count that disagrees with the manifest's `total` (torn write). |

Functions, and which of the three they expose:

- **`readListingsStore(opts?)`** — the authoritative typed read. Sharded form
  first, legacy `listings:all` second, three-state result either way. Every
  write path size-checks through this (`writeAllListings`' floor guard,
  `upsertListing`, `removeListings`) so a degraded read can never become a
  write baseline. Does *not* substitute the static seed — a writer handed a
  seed would write it over the real store.
- **`readAllListings(opts?)`** — the render-path version: same three states,
  plus the static `PRELOADED_LISTINGS` seed (as `ok`, with a `[kv-fallback]`
  warning) when KV is **not configured at all**, plus a health stamp. **This
  is what every bulk consumer should call.**
- **`requireAllListings(opts?)`** — `readAllListings` for surfaces whose only
  honest degraded behaviour is to fail. Returns rows on `ok`, `[]` on
  `absent`, throws `ListingsStoreUnavailableError` on `unavailable`.
- **`getAllListings(opts?)`** — legacy flattening wrapper, `Promise<Listing[]>`.
  Returns `[]` for both `absent` and `unavailable`; the difference is only in
  the log. Still used by render-path callers that predate the distinction.
  **Do not add new bulk consumers to it.**
- **`getListingBySlug(slug, opts?)`** — three-state `ListingLookup`
  (`found` / `absent` / `unavailable`). `absent` is the only one a caller may
  render as a 404.

Guards inside the read, in order:

1. `kvAvailable()` false (no `KV_REST_API_URL`/`TOKEN`) → static
   `PRELOADED_LISTINGS` from `readAllListings`/`getAllListings` only. This is
   the local-dev case, where there is no live store to be stale against. A
   *configured* KV that fails is never masked with the seed.
2. **Double-encoding tolerance**: `unwrapJson()` unwraps up to 3 string
   layers (a raw REST `SET` once stored a JSON-string-of-JSON and took the
   site down).
3. **Shape validation**: must be an array whose every element has a string
   `address`. Failure → `[kv-shape]` and `unavailable`, never static data.
4. **Manifest/chunk cross-check**: `listings:index.total` must equal the row
   count the chunks reassemble to, or the read is `unavailable` (see "Write
   states" below).

#### Degraded-mode behaviour, per consumer

Every bulk consumer answers an `unavailable` read explicitly. None of them
renders an empty result as data.

| Surface | On `unavailable` |
|---|---|
| `GET /api/sitemap` | **503** + `Retry-After`, `no-store`, plain-text body. A 5xx makes Google retry; a 200 with no property URLs tells it to drop them. Legacy/unadvertised — see the two dynamic routes below for the surface robots.ts actually points at. |
| `GET /sitemap-property.xml`, `GET /sitemap-discover.xml` | **503** + `Retry-After`, `no-store` — same contract as `GET /api/sitemap`, on purpose (src/app/sitemap-{property,discover}.xml/route.ts). These are the two children of `sitemap-main.xml` (the URL robots.ts advertises) that are dynamic routes rather than static files, reading KV fresh on every crawl (2026-08-27 split — see scripts/generate-sitemap.ts's header). |
| `scripts/generate-sitemap.ts` (prebuild) | As of 2026-08-27, **no longer reads KV listings at all** — property/discover moved to the two dynamic routes above, so bad/unset KV credentials no longer affect this script. Its only remaining external dependency is `DATABASE_URL` (regional_econ, for the `us` surface's county lastmod/rent/tax gating) — that read is fail-soft (try/catch, logs and continues with empty lastmod data), it does NOT fail the build either. The old `SITEMAP_ALLOW_STATIC_SEED`/`SITEMAP_MIN_PROPERTY_URLS` KV-floor guards were removed along with the KV read — see scripts/test-listings-degraded.ts section 3 for the regression test proving KV creds no longer matter to it. |
| `GET /api/search` | **503** + `Retry-After`. An empty array is indistinguishable from "no match". |
| `POST /api/discover` | Falls through to the live Zoocasa search — **disclosed** via `degraded: true` + `degradedReason` in the 200 body. If live also yields nothing: **503**. |
| `GET /api/insurance/address-lookup` | **502** (pre-existing behaviour, previously unreachable). The empty index is *not* written to the 5-minute cache. |
| `/discover/[city]` | **Throws → 500.** Previously reached `notFound()`, i.e. a 404 on every indexed discover URL for the duration of an outage. `generateStaticParams` throws too, failing the build. |
| `/discover/[city]/opengraph-image` | Neutral fallback image + `[discover-og]` log. Never the "City not found" card, which would misreport an outage as a missing city. |
| `/` (homepage) | Visible degraded notice replacing the example card, province explorer and city CTA. The address search — the primary action — keeps working. |
| `/dashboard` | Whole page replaced by an explicit "we couldn't load the listings" panel. Previously rendered "0 properties analyzed". |
| `components/insurance/landing/data-moat.tsx` | The section's existing `kvError` copy ("we couldn't load a sample property"), which was unreachable before. Not the "no tracked listing in this region yet" copy, which is a false coverage claim. |
| `lib/realtor-ca.ts` `searchListingsWithFallback` | Live search, disclosed via a `[realtor-ca]` log and an optional `degradedReason` on the result. |
| `/property/[slug]` | Throws → 500 (pre-existing; not changed by this audit). |

`getListingsStoreHealth()` is a **disclosure channel, not a decision
signal**: it is process-global mutable state, so a concurrent request on the
same instance can overwrite the stamp between a caller's read and its check.
Use it for canary/ops reporting; use the typed read for anything that acts
on the answer.

#### Write states

`kvSet()` and `kvPipeline()` **throw** (`KvWriteError`) on a rejected write —
including the case Upstash reports as HTTP 200 with a per-command `error`
slot inside a pipeline result. Previously both returned `false` and every
caller discarded it, so a half-applied write returned a full success count
with nothing logged. The throw propagates out of `writeAllListings`,
`upsertListing` and `setMetaValue` to the cron or request that asked for it.

`kvDel()` still returns a boolean and its failures are still ignored — those
call sites are documented best-effort hygiene (orphaned trailing chunk keys,
stale slug keys) and a failed delete cannot corrupt a read.

`writeShardedStorage()` orders its work: **write all chunks → publish the
manifest → only then delete trailing chunk keys the new manifest no longer
claims.** The manifest SET is the closest thing this key schema has to a
commit point. This is not atomic: if a chunk write fails partway, some chunk
keys hold new rows under an unchanged manifest, which is logged as
`[kv-torn-write]` and detected on read via the manifest's `total`
cross-check. A genuinely atomic swap needs generation-scoped chunk keys; that
is deliberately **not** implemented, because the manifest is read through
Next's 300s fetch cache, so GC'ing the previous generation would 503 every
render still holding a cached manifest for up to five minutes after each
write. The full requirements for landing it are in `ListingsIndex`'s doc
comment in `kv/listings.ts`.

**Floor guard**: `writeAllListings` refuses any write below
`FLOOR_GUARD_MIN_RATIO` (40%) of the currently stored count, unless
`{ force: true }`. An `unavailable` baseline read refuses the write outright.

#### Identity — one shared contract

`src/lib/listing-identity.ts` is the single answer to "are these the same
property?", used by retention, upsert and dedup. Three functions, three
different jobs:

- `listingKey()` — normalized address + city + province. **Primary** match
  key. Cannot merge two distinct properties.
- `listingMlsKey()` — province-scoped MLS number. **Secondary only.** MLS
  numbers are unique per issuing *board*, and a province spans several (BC:
  VREB, REBGV, FVREB), so it may follow a property across an address-string
  change but must never be matched on alone.
- `isSameRecord()` — full-record equality. The **only** test allowed to
  authorize dropping a row.

Applied:

- `upsertListing` matches `listingKey` first, `listingMlsKey` second. It used
  to match on the bare address string, so a user assessment of "123 Main St,
  Calgary" could overwrite the stored "123 Main St, Victoria".
- `dedupeListingsByIdentity` drops a row only when it is provably identical
  to a survivor. It used to key on province + MLS with an address fallback,
  either of which can merge two real properties. Of the live store's 93
  excess rows, 92 are byte-identical copies and one slug
  (`105-107-broad-st`, Newark NJ) holds two genuinely different properties —
  exact equality removes all 92 and keeps both Newark rows.
- `logSlugCollisions` still warns on every write about distinct records that
  share one `/property/{slug}` URL, since only one of them can own the
  by-slug key.

**Known defect in the shared contract**: `canonicalize()` in
`listing-identity.ts` is `JSON.stringify(l, Object.keys(l).sort())`, and
JSON.stringify treats an array replacer as a property allow-list applied at
*every* nesting depth — so nested objects (`preAssessment`, `preOffer`)
serialize as `{}` and two rows differing only inside them compare equal under
`isSameRecord`. `kv/listings.ts` compensates with a local full-depth
`deepCanonical` comparison AND-ed with `isSameRecord`, so dedup is safe; the
underlying contract is not yet fixed. See `deepCanonical`'s doc comment.

`writeAllListings()`/`upsertListing()` always go through this module (never
a raw REST `SET`) — `reseed-us-discover.ts`'s doc comment explicitly calls
this out as the convention going forward (§4.7).

### 3.2 Neon `regional_econ` readers (`src/lib/db/regional-econ.ts`)

`dbAvailable()` (`src/lib/db/index.ts:22-24`) checks **only whether
`DATABASE_URL` is set** — it does not verify connectivity.

- `getCountyMarketPanel()` (`regional-econ.ts:113-190`) and
  `getAcsCountyMedian()` (`regional-econ.ts:200-221`) both return `null`
  immediately if `dbAvailable()` is false (soft — "no US county data
  available," not an error).
- **If `DATABASE_URL` is set but Neon is actually unreachable**, the tagged
  `sql\`...\`` query throws, and **neither function catches it** — the
  exception propagates to the caller. See §8 for the specific call sites
  that don't guard this.
- **US county pages** (`src/app/us/[state]/[county]/page.tsx`): `panel ===
  null` (Neon unconfigured) → `notFound()` → clean 404
  (`page.tsx:154-155`). Neon configured-but-down → the page component
  throws unhandled → generic Next.js error page, **not** a 404. These are
  different failure modes with the same root symptom ("county page
  broken").
- `enrichUSCityListings()` (`us-enrich.ts:237`) is the one caller that
  **does** guard this: `getCountyMarketPanel(cfg.countyFips).catch(() =>
  null)`.

### 3.3 Round-trip verification convention

Maintenance scripts that mutate KV/Neon state verify the write landed by
re-reading immediately after: `scripts/reseed-us-discover.ts` (module doc,
steps 2 and 5) purges via `writeAllListings()` then round-trip-verifies via
`getAllListings()`, both before and after the refresh. `scripts/dedupe-us-kv.ts`
reads via raw REST for diagnosis only, then writes through the app's own
store. This is a convention, not an enforced framework — individual scripts
opt in.

---

## 4. Batch/ingest jobs inventory

All scripts live in `scripts/`, run via `npx tsx scripts/<name>.ts`. None
are wired into Vercel cron — every one is a manual/local operation.

### 4.1 `regional_econ` ingest (Neon) — feeds US county market panels

| Script | Feeds | Cadence | Convention |
|---|---|---|---|
| `ingest-us-acs.ts` | `median_home_value`, `median_gross_rent`, `vacancy_rate`, `median_household_income` (+ MOE siblings) | Manual, annual (ACS 5-year release cycle) | Dry-run default, `--commit` to write. Requires `CENSUS_API_KEY` always; `DATABASE_URL` only for `--commit`. One API call covers all ~3,221 counties. |
| `ingest-us-fhfa.ts` | `hpi` (FHFA All-Transactions HPI) | Manual, annual | Same dry-run/`--commit`. XLSX bulk file, no API key. Col F ("HPI", not rebased to a common year across counties) is intentionally used, not the 1990/2000-base columns. |
| `ingest-us-fema.ts` | `fema_risk_score`, `fema_eal_score`, 18 per-hazard `fema_<hazard>_score` | Manual, as FEMA updates NRI | Same convention. Shells out to `curl`/`unzip` — Node's fetch gets a 403 from FEMA's bulk URL (TLS/connection fingerprint check, confirmed live, not header-based). |
| `ingest-us-hud-fmr.ts` | `fmr_studio`, `fmr_1br`, `fmr_2br`, `fmr_3br`, `fmr_4br` | Manual, annual (HUD FMR release) | Same convention. Requires `HUD_API_KEY` always (bulk-file route is WAF-blocked, keyed API is the only path). **The chunked-run lesson**: a full 51-state run is ~3,200 API calls against an undocumented rate-limit window; the script self-throttles from the live `x-ratelimit-remaining` response header and cools down 65s when the buffer runs low (`ingest-us-hud-fmr.ts:41-52`). `--states=CA,NY,WY` samples a subset for a fast smoke test instead of the full run. Fails loud (throws, non-zero exit) if fetch completion rate drops below 50% or more than half the sampled states fail to list (`ingest-us-hud-fmr.ts:157-165`) — refuses to silently report a degraded run as success. |

All four upsert via `upsertRegionalEcon()` (`scripts/lib/ingest-shared.ts:99-134`),
a batched `UNNEST` + `ON CONFLICT (geo_level, geo_fips, metric, year) DO
UPDATE` — idempotent, safe to re-run.

**Downstream effect of staleness/missing rows**: `getCountyMarketPanel()`
returns whatever metrics exist per-county; missing metrics are `null`
fields, not a missing panel. US county pages (`page.tsx`) gate whole
sections on presence (`hasFmr`, `hasHpi`, `hasFema` booleans,
`page.tsx:122-129`) — a missing HUD ingest means the FMR section simply
doesn't render for that county, not an error. `computeInvestorYield()`
(`us-advantage.ts:422-447`) degrades `fmr2brDeltaPct` to `null` the same
way.

### 4.2 County-assessor enrichment — feeds cached US Discover listings

| Script | Feeds | Cadence | Convention |
|---|---|---|---|
| `enrich-us-from-assessors.ts` | `assessedValue`/`marketValue`/`yearBuilt`/`lotSize` on cached KV listings, via `src/lib/assessment/us-county/{maricopa,miami-dade,travis}.ts` | Manual, ad hoc (re-run after a reseed) | Dry-run default, `--commit` to write. **Additive-only**: never overwrites a field that already has a value — re-reads each listing fresh from KV immediately before every write to minimize (not eliminate) a race window against concurrent writers (module doc, `enrich-us-from-assessors.ts:190-196`). |

Three county adapters, each free/unauthenticated but structurally
different, and — critically — **never invoked by any live user request
path**, only by this batch script:

| County | Source | Note |
|---|---|---|
| Maricopa (Phoenix, AZ) | Public ArcGIS parcel layer (`gis.mcassessor.maricopa.gov`) — the official documented REST API requires a manually-issued auth token with no self-serve signup, so this hits the same roll via the public map's feature layer instead | `LPV_CUR` (Limited Property Value, capped) → assessed; `FCV_CUR` (Full Cash Value) → market |
| Miami-Dade (Miami, FL) | Two-step: Miami-Dade ArcGIS layer 24 (address → FOLIO, values always null) then FL DOR statewide cadastral FeatureServer (FOLIO → value, not address-indexed) | Layer 26 looked equivalent but is missing every condo unit — confirmed live, do not use |
| Travis (Austin, TX) | TCAD's bulk certified-appraisal-roll ZIP (~530MB compressed), **not** a live API — no per-address endpoint exists for free | Downloaded once per process, cached to disk (`os.tmpdir()`), re-downloaded if >30 days old. First Austin lookup in a run takes minutes, not milliseconds — acceptable only because this is a local batch script, never a live serverless request. |

**Downstream effect when this hasn't run / is stale**: listings without a
`preAssessment` fall back to `offerModelLanguage()` (DOM/language-anchored
offer, no assessed value) exactly like the "no assessment found" case
anywhere else in the pipeline.

### 4.3 Listing enrichment (LLM narrative + scoring)

| Script | Feeds | Cadence |
|---|---|---|
| `enrich-listings.ts` | One-time full-KV re-enrichment (preScore/preTier/preSignals/preNarrative/preOffer), Claude Sonnet 4.5 | One-off / manual |
| `bootstrap-enrich.ts` | Same, using the production `enrichListing()` pipeline, no timeout constraint (runs locally) | One-off / manual, `--skip-enriched` / `--city=` flags |
| `enrich-us-listings.ts` | Top-N US Discover listings per city via `enrichUSCityListings()` | Manual re-run; `--dry-run` skips the KV write but still spends RentCast quota (record/AVM calls happen either way and get cached) |
| `analyze-us-seeds.ts` | Free-data-only full US Advantage analysis (offer/narrative/triangulation) for seeded listings that haven't gone through RentCast top-N enrichment — **zero RentCast calls** | Manual, idempotent/re-runnable; `--commit`, `--only-missing`, `--only-changed` flags |

### 4.4 One-off / diagnostic scripts

`diag-cedar.ts`, `diag-staleness.ts` — read-only KV diagnostics, zero
quota. `dedupe-us-kv.ts` — one-off dedup cleanup by normalized address key.
`audit-rentcast-quality.ts` — cross-references RentCast against ground
truth, spends against `RENTCAST_API_KEY_2` / the isolated `quota2` KV
namespace via `auditRentcastCall()` (`rentcast.ts:337-367`) so it **cannot
touch production's quota counter even by accident**. `verify-e2e.ts`,
`verify-seeds.ts`, `golden-canada.ts` — health-check harnesses (not wired
to any cron; run manually).

### 4.5 Seeding / KV maintenance

`seed-kv.ts`, `seed-zoocasa.ts`, `flush-city.ts`, `reseed-us-discover.ts`,
`build-us-county-registry.ts` (writes the static `us-counties.json`
registry, dry-run default), `migrate-regional-econ.ts` /
`migrate-track2-tables.ts` (idempotent `CREATE TABLE IF NOT EXISTS`,
one-time schema setup).

### 4.6 Dry-run / `--commit` convention

Every ingest and most mutation scripts default to a **dry run** (fetch +
parse + print counts, no write) and require an explicit `--commit` flag to
persist. This is consistent across all four `ingest-us-*.ts` scripts,
`enrich-us-from-assessors.ts`, `analyze-us-seeds.ts`, and
`build-us-county-registry.ts`.

---

## 5. The cron surface

`vercel.json`:

```json
"crons": [
  { "path": "/api/pipeline/refresh", "schedule": "0 14 * * *" },
  { "path": "/api/canary",           "schedule": "0 19 * * *" }
]
```

### 5.1 `/api/pipeline/refresh` (daily 14:00 UTC, `maxDuration: 300`)

`src/app/api/pipeline/refresh/route.ts`. 9 phases against a fixed
`CITIES` list (`route.ts:34-45`, BC/AB/ON):

1. Load existing KV listings.
2. Search all cities in parallel (`Promise.allSettled` — one city's
   rejected search doesn't block the others, `route.ts:103-121`).
3. Match existing listings, build a global freshness-check queue.
4. Batch freshness check (20 parallel workers) — dead listings pruned.
5. Per-city detail fetch + assembly, time-budget gated
   (`elapsed() < 180_000` to attempt detail fetches at all,
   `route.ts:221`).
6. Carry forward user-requested listings not already claimed by a city
   bucket.
7. Fetch sold-comp pools per city, time-budget gated (`< 200_000`,
   `route.ts:308`).
8. Enrich new / re-enrich stale listings, with a hard time-budget escape
   hatch at `elapsed() > 240_000` that switches remaining listings to a
   fast deterministic (no-LLM) enrichment instead of aborting the run
   (`route.ts:352-366`).
9. Write to KV (`purgeStaleSlugKeys` + `writeAllListings`).

**Phase 9 — US Discover refresh, isolated failure boundary**
(`route.ts:428-446`): runs `refreshUSDiscover()` **after** the CA refresh
has already written to KV, in its own `try/catch`, specifically so a
RentCast outage or quota exhaustion here can never undo or block the CA
update. Confirmed: the `catch` block sets `usDiscover = { error: message
}` and the function still returns `success: true` for the overall run
(`route.ts:442-457`) — a US Discover failure does **not** fail the cron.

Within `refreshUSDiscover()` itself (`src/lib/pipeline/us-discover.ts:333-423`),
each city is **also** wrapped in its own `try/catch`
(`us-discover.ts:354-398`) — one city's RentCast error doesn't stop the
others from refreshing. Cities are skipped (not fetched) if refreshed
within `US_DISCOVER_REFRESH_DAYS` (default 3, tracked via KV meta key
`us-discover:last-refresh:{slug}`).

If the outer CA pipeline itself throws unhandled (not per-phase, but a true
crash), the route returns `success: false` with a 500 and the accumulated
`log[]` (`route.ts:458-468`).

### 5.2 `/api/canary` (daily 19:00 UTC, `maxDuration: 60`)

See §2.4. Returns HTTP 500 on any check failure (not 200) specifically so
Vercel's cron dashboard flags the run as failed — this is the primary
failure-surfacing mechanism, since there's no external alerting layer (see
§8).

---

## 6. External dependency matrix

| Dependency | Used by | Cached / Live | Blast radius when down | Detection |
|---|---|---|---|---|
| **Zoocasa** (scrape, no auth) | CA search/detail/sold (`zoocasa.ts`), `/api/assess` CA path, `/api/pipeline/refresh` | Live every call, no cache | CA `/api/assess` returns 404/502 per-listing; cron search failures isolated per-city (`Promise.allSettled`) | `[zoocasa-shape]`, `[zoocasa-scope]` logs; canary `checkZoocasaSearch` (daily) |
| **BC Assessment** (REST autocomplete + Browserless Puppeteer scrape) | `lookupBC()` (BC adapter) | `BC_ASSESSMENT_CACHE` (41 static entries); live scrape only if `BROWSERLESS_API_KEY` set | Live scrape unavailable → BC assessments beyond the cached 41 return `null` → offer falls to `offerModelLanguage()`; no user-facing error | `[bc-assessment-shape]` logs; canary `checkBcCache` (cache-only, **doesn't test live scrape**) |
| **Calgary SODA** (data.calgary.ca) | `lookupAB()` for Calgary addresses | Live, no cache beyond `AB_ASSESSMENT_CACHE` | Calgary AB assessments miss → `offerModelLanguage()` fallback | `[soda-shape]`; canary `calgarySodaHealthCheck` (daily) |
| **Edmonton SODA** (data.edmonton.ca) | `lookupAB()` for Edmonton addresses | Live | Same as above | `[soda-shape]`; **no canary probe** |
| **Lethbridge ArcGIS** (gis.lethbridge.ca) | `lookupAB()` for Lethbridge | Live | Same as above | Swallowed by outer try/catch, no shape-error class, no dedicated log line |
| **Winnipeg SODA** (data.winnipeg.ca, d4mq-wa44) | `lookupMB()` | Live only, no cache | MB (Winnipeg) assessments miss entirely on outage | `[mb-soda-shape]`; **no canary probe** |
| **Census Geocoder** (geocoding.geo.census.gov) | US `/api/assess` path, `assessment/us.ts` fallback | Live every call, no cache | US `/api/assess` returns 502 (network error) or 404 (no match) — **the entire US assessment flow is blocked**, no fallback exists for this step | `[assess] geocode error` / `geocode no match` logs; **no canary probe covers the US path at all** |
| **RentCast** (api.rentcast.io) | US property/AVM/rent/listing (`rentcast.ts`) | Cached 24h (listing) – 30d (property/AVM/rent); per-key guarded pool, 50 included calls/key by default | Degrades to property-specific county evidence when available, otherwise county median — **never fails the request** | `getRentcastQuotaPoolStatus()`; `bundle.meta.errors[]` in `[assess] rentcast done` log |
| **Census ACS** (batch, via `ingest-us-acs.ts`) | `regional_econ.median_home_value/gross_rent/vacancy/income` | Ingested to Neon; not live at request time | Stale/missing county rows → those `CountyMarketPanel` fields are `null`; irrelevant to live availability | Ingest script console output only |
| **FHFA HPI** (batch, via `ingest-us-fhfa.ts`) | `regional_econ.hpi` | Ingested; not live | Missing HPI → `hpiTrend5y` null → equity/tenure HPI corroboration and risk/momentum "momentum" both degrade to `"no_hpi_data"`/`"unknown"` | Ingest script console output |
| **HUD FMR** (batch, via `ingest-us-hud-fmr.ts`) | `regional_econ.fmr_*` | Ingested; not live | Missing FMR → investor-yield's `fmr2brDeltaPct` null; county page FMR section hidden | Ingest script console output |
| **FEMA NRI** (batch, via `ingest-us-fema.ts`) | `regional_econ.fema_*` | Ingested; not live | Missing → risk/momentum has no peril data, county page FEMA section hidden | Ingest script console output |
| **Neon Postgres** (`regional_econ`, `user_events`, `subscriptions`, `partner_clicks`) | County market panels, US assessment fallback, event tracking, billing | Read live per-request; `dbAvailable()` checks env presence only, **not connectivity** | Unconfigured → soft null/empty everywhere (guarded). **Configured but unreachable → unguarded `await sql\`...\`` calls throw**, surfacing as an uncaught 500 in `handleUSAssessment`'s `Promise.all` and in `assessment/us.ts`'s `lookupUS()` fallback (see §8) | No canary probe; would show as `[assess]` route erroring with a DB connection message in logs |
| **Upstash KV/Redis** (`KV_REST_API_URL/TOKEN`) | Listings store, RentCast cache+quota, rate limiters, US Discover refresh timestamps | Falls back per-consumer: listings → static `PRELOADED_LISTINGS`; RentCast cache/quota → in-process `Map` (non-persistent); rate limiters → `null` (**rate limiting silently disabled**, not blocked) | Site stays up on stale/static data; rate limiting silently off; RentCast quota guard resets every cold start (can overspend across instances) | `[kv-shape]` logs; no canary probe for Upstash reachability itself |
| **OpenRouter** (LLM, both CA `llm.ts` and US `us-narrative.ts`) | Narrative generation | Live, no cache; 12s timebox (US) + 1 retry | Narrative falls back to the deterministic template — never blocks the response | `[us-narrative]` logs (timeout / attempt-failed lines) |
| **Clerk** (auth) | Every `/api/assess` request | Live | Auth failure/outage not explicitly guarded beyond the standard `auth()` call — see §8 | No dedicated logging |
| **Resend** (email) | Post-assessment email (CA flow only) | Live, wrapped in try/catch | `emailSent:false`, response still returns 200 — fails soft | `[assess] email error` log |
| **Google Places** (client-side autocomplete) | Address input UX (not server-traced here) | Live, client-side | Address parsing on the server is unaffected — this only degrades the input UX | Not covered by any server-side logging |
| **Stripe** | `isPro()` billing check | Live, wrapped in try/catch | Fails soft to `false` (treated as non-pro — user still gets normal rate limits, not blocked) | No dedicated logging |
| **Maricopa Assessor ArcGIS**, **Miami-Dade GIS + FL DOR**, **TCAD bulk export** | `enrich-us-from-assessors.ts` only | Batch script, **never in the live request path** | Zero blast radius on production traffic — only affects the freshness of `preAssessment` on the ~144 seeded US Discover listings until the script is next re-run | Script console output only |
| **Browserless** (headless Chrome for BC scrape) | `lookupBC()` live scrape, `golden-canada.ts` | Live | `BROWSERLESS_API_KEY` unset → scrape path disabled, cache-only BC lookups (see BC row above) | No dedicated log line — silent `null` return |

---

## 7. Monitoring quick-reference

### 7.1 Grep-able log prefixes

| Prefix | Emitted by | Meaning |
|---|---|---|
| `[assess]` | `route.ts` (both CA and US paths) | Step-by-step trace of a single `/api/assess` request, with elapsed-ms timing (`route.ts:535-536`) |
| `[zoocasa-shape]` | `zoocasa.ts` | A Zoocasa response was missing/malformed a required field — batch calls drop+log, single-detail calls throw |
| `[zoocasa-scope]` | `zoocasa.ts` | Zoocasa's province-wide-fallback regression — returned listings whose city didn't match the request |
| `[bc-assessment-shape]` | `bc.ts` | BC Assessment REST/scrape response drift |
| `[soda-shape]` | `ab.ts` | Calgary/Edmonton SODA response drift (non-array, missing `assessed_value`) |
| `[mb-soda-shape]` | `mb.ts` | Winnipeg SODA response drift |
| `[kv-shape]` | `kv/listings.ts` | A stored value failed shape validation (sharded chunks, `listings:all`, or a by-slug key). The read moves to the next form or reports `unavailable` — it never falls back to static data. |
| `[kv-degraded]` | `kv/listings.ts` | A whole-store read could not be completed. Any empty page/sitemap/digest from that request is an outage, not data. |
| `[kv-torn-write]` | `kv/listings.ts` | A chunk write failed partway; the manifest was not updated and the store may be internally inconsistent. Re-run the write. |
| `[kv-fallback]` | `kv/listings.ts` | KV is not configured at all — the static `PRELOADED_LISTINGS` dev seed is being served. Should never appear in production. |
| `[dup-rows]` | `kv/listings.ts` | Byte-identical duplicate rows dropped on write, or distinct records sharing one `/property/{slug}` URL. |
| `[listing-upsert]` | `kv/listings.ts` | An upsert matched a stored row on MLS number rather than address (address string changed). |
| `[canary]` | `api/canary/route.ts` | Daily health-probe failure summary |
| `[us-narrative]` | `us-narrative.ts` | LLM call attempt failure, timeout, or truncation warning |
| `[us-discover]` | `pipeline/refresh/route.ts` | Per-city US Discover refresh result/skip-reason |
| `[us-enrich]` | `us-enrich.ts` | Per-listing enrichment step trace |
| `[narrative-lint]` | `src/lib/pipeline/narrative-lint.ts`, called from `route.ts` and `us-seed-analysis.ts` | Log-only narrative QA — untraced-number and banned-word-stem counts for a just-generated "THE SIGNAL" narrative. Informational only, never blocks/rejects/retries (see §1.4) |
| `[affiliate-health]` | `affiliate-vendors.ts` | A revenue-critical vendor is enabled but its affiliate env URL didn't resolve (production-only check, logs and continues — never throws) |

### 7.2 Quota / usage counters (KV)

| Key | Meaning | Read via |
|---|---|---|
| `rentcast:quota:YYYY-MM` | Primary-key successful RentCast responses; may include explicitly capped overage | `getRentcastQuotaStatus()` / `getRentcastQuotaPoolStatus()` |
| `rentcast:quota2:YYYY-MM` | Key 2 successful responses; shared by audit and production rotation | `getRentcastQuotaPoolStatus()` |
| `rentcast:quota-rentcast-api-key-3:YYYY-MM` | Key 3 successful responses | `getRentcastQuotaPoolStatus()` |
| `us-discover:last-refresh:{citySlug}` | Last time a Discover metro was swept — gates the `US_DISCOVER_REFRESH_DAYS` cadence | `getMetaValue()` (`kv/listings.ts:311-322`) |

### 7.3 Symptom → diagnosis table

| Symptom | Check first | Then check | Notes |
|---|---|---|---|
| US `/api/assess` always returns `offerAvailable:false, no_listing_data` | All rows from `getRentcastQuotaPoolStatus()` | `[assess] rentcast done` log line for `bundle.meta.errors` and `propertyDataUnavailableReason` in the response | Quota exhaustion, provider errors, and clean misses are machine-distinguishable; the UI still degrades safely |
| US `/api/assess` 500s | Recent deploy touching `route.ts`/`rentcast.ts` | Is `DATABASE_URL` set but Neon unreachable? (`getCountyMarketPanel`/`lookupUS`'s `getAcsCountyMedian` are unguarded — §8) | Not a RentCast issue if the failure is a hard 500 rather than a graceful `no_listing_data` |
| CA site 500s / listings look wrong | `[kv-degraded]` / `[kv-shape]` / `[kv-torn-write]` logs | `listings:meta` KV key for `updatedAt` staleness | KV unreachable no longer serves static data. `/property/*` and `/discover/*` 500, `/api/sitemap`, `/sitemap-property.xml` and `/sitemap-discover.xml` 503, `/api/search` 503, the homepage and dashboard show a degraded notice. That is the intended behaviour, not a second bug — see §3.1 |
| `GET /sitemap-property.xml` or `/sitemap-discover.xml` returns 503 | `[sitemap-property]`/`[sitemap-discover]` logs naming the KV reason | Is KV actually reachable from where the request is served? | Deliberate — same contract as `/api/sitemap` (src/app/sitemap-{property,discover}.xml/route.ts). Google retries a 5xx; a 200 with an empty/partial urlset would tell it those pages are gone. Self-heals once KV recovers, no redeploy needed. |
| Prebuild sitemap generation looks stale for property/discover URLs | Is this actually a static-file staleness question? | `scripts/generate-sitemap.ts` no longer writes property/discover at all (2026-08-27) — those two are the dynamic routes above, always live. Only static/blog/us can be build-stale, and only until the next deploy. | If `sitemap-property.xml`/`sitemap-discover.xml` exist as files in `public/` at all, that's the bug — a stray static file there SHADOWS the dynamic route; delete it. |
| A cron reports a KV write error where it used to report success | `[kv-torn-write]` / `KvWriteError` in the logs | `listings:index` vs. actual chunk keys | `kvSet`/`kvPipeline` now throw instead of returning `false` into a caller that discards it. The write genuinely was failing before; only the reporting changed |
| County pages (`/us/[state]/[county]`) 404ing | Is `DATABASE_URL` set at all? | If set, is Neon actually reachable? | Unset → clean `notFound()`. Set-but-down → unhandled 500, not a 404 — different code path, same user complaint |
| County pages missing FMR/HPI/FEMA sections | Which ingest script last ran (`ingest-us-hud-fmr.ts` / `ingest-us-fhfa.ts` / `ingest-us-fema.ts`) | `regional_econ` row count for that county/metric | Sections gate on presence per-metric (`hasFmr`/`hasHpi`/`hasFema`), not on panel-level failure |
| "THE SIGNAL" narrative reads generic/template-like | `[us-narrative]` logs for timeout/attempt-failed lines | `OPENROUTER_API_KEY` set? | Deterministic fallback is working as designed — check whether the LLM path is actually failing or just slow enough to hit the 12s timebox routinely |
| Daily cron (`/api/pipeline/refresh`) reports `usDiscover: {error: ...}` but CA listings still updated | RentCast quota / API status | `US_DISCOVER_REFRESH_DAYS` cadence — maybe every configured city was just skipped, not failed | Phase 9 is isolated by design; this is not a whole-pipeline failure |
| Canary (`/api/canary`) failing | Response body's `failures[]` array (names the specific check) | Zoocasa/BC-cache/Calgary-SODA individually, per §2.4 | Canary does not cover MB, Edmonton, Lethbridge, US path, Neon, KV, or OpenRouter — a canary pass does not mean those are healthy |
| Rate limiting appears to not be working | `KV_REST_API_URL`/`TOKEN` configured? | — | `assessLimiter()`/`apiLimiter()`/`authApiLimiter()` all return `null` (limiter disabled, not blocked) when Upstash is unconfigured — this fails silently, no log line |

---

## 8. Known gaps

Honest list of what this trace found unguarded, missing, or worth
hardening. Not fixed here per task scope (read-only on `src/`).

1. **`getCountyMarketPanel()` unguarded in the US `/api/assess` hot path.**
   `route.ts:278-284`'s `Promise.all` wraps `getUSProperty()` in `.catch()`
   but **not** `getCountyMarketPanel()`. If `DATABASE_URL` is set but Neon
   is unreachable (not just unconfigured), the tagged-template query in
   `regional-econ.ts:119-124` throws, the `Promise.all` rejects, and the
   whole `handleUSAssessment()` call throws — an uncaught exception →
   generic Next.js 500 for every US assessment request, even though
   RentCast/geocoding are both fine. Contrast with `us-enrich.ts:237`,
   which does guard the identical call with `.catch(() => null)`.

2. **`assessment/us.ts`'s fallback path has the same gap.** `lookupUS()`
   (`us.ts:39-68`) guards `geocodeUSAddress()` with try/catch but calls
   `getAcsCountyMedian()` unguarded. This is reached from
   `handleUSAssessment()`'s fallback tier (`route.ts:305`,
   `lookupAssessment()` with no surrounding try/catch) — meaning the
   "county-median fallback," the path specifically designed to be the safe
   degrade-to option when RentCast is unusable, itself has an unguarded
   Neon dependency. A simultaneous RentCast outage + Neon connectivity
   blip turns a graceful degradation into a hard 500.

3. **No canary coverage for the US assessment path at all.** `/api/canary`
   checks three CA-only signals (Zoocasa search, BC cache, Calgary SODA).
   Census geocoder, RentCast, Neon, and OpenRouter — every dependency the
   US flow relies on — have zero automated health probing. A silent US-path
   outage (e.g. RentCast API key revoked, Census geocoder schema change)
   would not surface until a user complains or someone reads application
   logs.

4. **No canary coverage for Edmonton, Lethbridge, or Winnipeg (MB) live
   assessment lookups.** Only Calgary has a dedicated health check
   (`calgarySodaHealthCheck()`). The other three SODA/ArcGIS sources can
   drift silently.

5. **Rate limiting silently disables itself when Upstash is unconfigured.**
   `assessLimiter()`/`apiLimiter()`/`authApiLimiter()` (`rate-limit.ts`)
   return `null` rather than failing loud when `KV_REST_API_URL`/`TOKEN`
   are unset — every route checks `if (limiter && ...)` and simply skips
   the check. This is the correct behavior for local dev, but in
   production it means a KV misconfiguration silently removes abuse
   protection with no log line anywhere.

6. **Investor-yield rent estimate is never primed for cron-enriched
   listings.** `us-enrich.ts` uses `getUSPropertyLite()`
   (`rentcast.ts:937-981`), which deliberately skips the rent-estimate call
   to conserve RentCast quota. `computeInvestorYield()`
   (`us-advantage.ts:422-447`) requires `monthlyRent`, which is `null` for
   every Discover-sourced listing — the investor-yield signal only ever
   populates on a live, on-demand `/assess` lookup (which does call the
   full `getUSProperty()`), never on cron-refreshed Discover listings. This
   is documented in `us-enrich.ts`'s module comment as an intentional
   budget tradeoff, but it means the "US Advantage" investor-yield feature
   is silently absent from the majority of pages users actually browse via
   Discover.

7. **No alerting beyond Vercel's own cron-failure dashboard status.** Both
   crons (`/api/pipeline/refresh`, `/api/canary`) surface failure only via
   HTTP status code (500) and `console.error` lines. There is no
   configured external alert (email/Slack/PagerDuty) wired to either —
   discovering a failed run requires someone to check the Vercel dashboard
   or search logs.

8. **KV/Upstash reachability has no dedicated health check.** Every
   consumer (`listings.ts`, `rentcast.ts`, `rate-limit.ts`) independently
   falls back gracefully when KV calls fail, but there's no single
   canary-style probe that answers "is Upstash actually up right now" —
   diagnosis relies on noticing `[kv-shape]` logs or static-looking listing
   data.

9. **RentCast in-process quota/cache fallback is non-persistent and
   per-instance.** When KV is unavailable, `rentcast.ts`'s quota counter
   and cache fall back to an in-process `Map` (`rentcast.ts:107-108`). On
   Vercel's serverless model, every cold start resets this — the 50/month
   guard is only real when KV is actually configured and reachable; if KV
   silently degrades in production, RentCast spend could overshoot the
   free-tier cap without any single counter catching it.

10. **Single points of failure with no fallback at all**: the Census
    Geocoder step (§6) has no cache and no alternate provider — its
    failure fully blocks the US assessment flow (both the primary listed
    path and the county-median fallback path both need a successful
    geocode first). Similarly, Clerk auth failure is not explicitly
    handled in `route.ts` — an outage there would surface as whatever
    `auth()` throws, uncaught.

11. **BC live-scrape canary gap.** The canary's `checkBcCache()` only
    exercises the static 41-entry cache, never the live Browserless/Puppeteer
    scrape path — a `BROWSERLESS_API_KEY` expiry or Browserless outage would
    not be caught by the daily canary at all.

12. **No shape-error class for the Lethbridge ArcGIS adapter.** Unlike
    BC/AB(Calgary/Edmonton)/MB, `lookupLethbridgeArcGIS()`
    (`ab.ts:338-381`) has a bare try/catch with no equivalent of
    `SodaShapeError`/`BcAssessmentShapeError` — a schema change on that
    endpoint would silently degrade to "no result" with zero log signal.

---

*Doc scope: `/api/assess` (both flows), assessment adapters, KV/Neon
readers, `scripts/`, cron routes, and the external dependencies they touch.
Not covered: `/api/discover`, `/api/analyze`, billing/Stripe webhooks,
Clerk webhook handlers, or frontend rendering — trace those separately if
needed.*
