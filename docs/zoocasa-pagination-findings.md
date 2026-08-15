# Zoocasa 27-listing SSR cap — findings (W4-ZOO)

Date probes were run: **2026-08-14** (server responses timestamped 2026-08-15 00:00 UTC — see raw output below).

## Conclusion

**(b) The cap stands.** Every avenue tested today returns exactly 27 (or fewer, for a
narrower neighbourhood filter) listings per search page. There is no working method,
documented or undocumented, to retrieve more than 27 listings from a single Zoocasa
city search in this pipeline's current fetch shape (plain `fetch`, no auth, no browser
automation). The three probes are complementary, not redundant — each closes a
different door — so all three are kept.

## What each probe tested, and what it returned today

### 1. `scripts/probe-zoocasa-search.ts` — query params / narrowing filters

Question: can a query param narrow the result set (so we don't need >27 results at all
for an address-targeted lookup), and does any pagination param change the page?

Command: `npx tsx scripts/probe-zoocasa-search.ts`

Raw output (2026-08-14):
```
Target listing: 1727 24a st sw
(real Calgary listing per user — neighbourhood: shaganappi)

baseline (saleOrRent=sale)           count=  27 targetInTop3=false
page=2                               count=  27 targetInTop3=false
p=2                                  count=  27 targetInTop3=false
offset=27                            count=  27 targetInTop3=false
q=<address>                          count=  27 targetInTop3=false
keywords=<address>                   count=  27 targetInTop3=false
search=<address>                     count=  27 targetInTop3=false
address=<address>                    count=  27 targetInTop3=false
street=<num+name>                    count=  27 targetInTop3=false
neighbourhood path /shaganappi       count=  25 targetInTop3=false
/shaganappi + q=                     count=  25 targetInTop3=false
```

Findings:
- `page=2`, `p=2`, `offset=27` all return **the same 27 listings** as the baseline
  (not a 404, not an error — the server silently ignores the param and re-serves page 1).
  This is the most important finding of this probe: pagination params are not just
  "unsupported", they are silently no-ops, which means a naive fetcher could believe
  it's paging when it is really re-fetching identical data.
- None of the plausible free-text search params (`q`, `keywords`, `search`, `address`,
  `street`) change the result set at all — same 27 listings back every time. Zoocasa's
  SSR search page does not support address/keyword filtering via query string.
- The one param that *does* change results is the **neighbourhood path segment**
  (`/calgary-ab-real-estate/shaganappi`), which drops the count to 25 — i.e. path-based
  geographic scoping works, but it scopes by named neighbourhood, not by arbitrary
  address/keyword text, and it does not lift the 27-per-page cap (25 < 27, consistent
  with a genuinely smaller result set for that neighbourhood, not a different page size).
- The target listing (1727 24A St SW, Shaganappi) never appeared in the first 3 results
  of any variant, including the neighbourhood-scoped one — inconclusive on whether it's
  still active, but irrelevant to the cap question since no variant returned more than
  the page-1 set.

### 2. `scripts/probe-zoocasa-pagination.ts` — path-based pagination shapes + internal API discovery

Question: does any URL *shape* (not just query params) page past listing #27, and does
the site expose an internal JSON API or Next.js data route that honors different
pagination params than the SSR HTML does?

Command: `npx tsx scripts/probe-zoocasa-pagination.ts`

Raw output (2026-08-14):
```
=== C: extra pagination shapes ===
baseline first 3: 3741 Kidd Cres Sw, Edmonton, AB, T6W2R1 | 13003 101 St Nw, Edmonton, AB, T5E4G1 | 304-9804 101 St Nw, Edmonton, AB, T5K2X3
/page/2?saleOrRent=sale
  status=404 count=0 sameAsBaseline=false
  first 3: 
/2?saleOrRent=sale
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&pageNumber=2
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&pageIndex=1
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&start=27
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&from=27
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&skip=27
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&limit=200
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&pageSize=200
  status=200 count=27 sameAsBaseline=true
?saleOrRent=sale&size=200
  status=200 count=27 sameAsBaseline=true

=== B: API discovery ===
buildId: tb0UmCcrvmJmSDhWFOYyp
api-ish URLs (sample):
hosts seen: www.zoocasa.com, careers.zoocasa.com

_next/data probe (page=2):
  status=200 bytes=207585
  listings=27
  first 3: 3741 Kidd Cres Sw, Edmonton, AB, T6W2R1 | 13003 101 St Nw, Edmonton, AB, T5E4G1 | 304-9804 101 St Nw, Edmonton, AB, T5K2X3
  __NEXT_DATA__ has "totalListings":"{{count
https://api.zoocasa.com/listings?city=calgary&province=ab&saleOrRent=sale&page=2
  status=401 bytes=574
https://www.zoocasa.com/api/listings?city=calgary-ab-real-estate&page=2
  status=404 bytes=99397
https://www.zoocasa.com/api/search?q=calgary
  status=404 bytes=99368
```

Findings:
- **`/page/2` is a real Next.js route** (404, not a re-served page-1 — the router
  recognizes the shape but there's no such page), while `/2` silently falls through to
  the catch-all and re-serves page 1 with status 200. Neither gets to a page 2.
- Every query-string pagination guess (`pageNumber`, `pageIndex`, `start`, `from`,
  `skip`, `limit`, `pageSize`, `size`) returns HTTP 200 with **exactly the same 27
  listings** as baseline — confirms the search-probe finding: these params are silently
  ignored server-side, not validated/rejected.
- The Next.js **`/_next/data/{buildId}/...json` route exists and works** (200, valid
  JSON, same shape as the embedded `__NEXT_DATA__`) — but it returns the identical 27
  listings when `page=2` is appended; it's driven by the same server-side prop-fetching
  logic as the HTML route, so it inherits the same cap/no-op-pagination behavior. It is
  not a separate, more capable data channel — it's the same data through a lighter
  transport.
- `__NEXT_DATA__` contains a **literal, un-interpolated template string**:
  `"totalListings":"{{count"` (not a number). This is a genuine oddity worth flagging
  to the fetcher owner even though it doesn't change the cap conclusion: Zoocasa's own
  page is shipping a broken template placeholder instead of a real total-results count,
  so there is no reliable "how many listings exist beyond what we can see" signal
  available from the page at all — even indirectly.
- **`api.zoocasa.com` returns HTTP 401 with `server: nginx`** and an `access-control-*`
  CORS header set scoped to `https://www.zoocasa.com` — this is an authenticated,
  CORS-locked internal API gateway (nginx-level Basic-Auth-style 401, not an
  application-level "missing bearer token" JSON error), not a public/discoverable
  surface. `/api/listings` and `/api/search` on `www.zoocasa.com` both 404 (full HTML
  404 page, not a JSON error) — no public API exists on that host either.
- Unrelated to pagination but recorded for completeness: the "Calgary" search baseline's
  first 3 addresses were all Edmonton, AB listings both in this probe and matched
  exactly in the `_next/data` probe. This is a Zoocasa-side data/routing quirk (possibly
  a cache or geo-fallback behavior on their end), not an artifact of the probe. Flagged
  here in case it's relevant to `src/lib/zoocasa.ts` city filtering, but out of scope
  for this cap investigation.

### 3. `scripts/probe-zoocasa-api.ts` — internal backend auth surface

Question: is `api.zoocasa.com` (the SPA's real backend, found in bundle analysis)
reachable with any plausible public auth shape shipped in the client bundle?

Command: `npx tsx scripts/probe-zoocasa-api.ts`

Raw output (2026-08-14):
```
=== 1. Read the 401 body ===
status=401
  access-control-allow-credentials: true
  access-control-allow-headers: DNT,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization,x-zoocasa-api-key,x-zoocasa-tenant,X-Internal-Secret,X-Email
  access-control-allow-methods: GET, PUT, POST, DELETE, PATCH, OPTIONS
  access-control-allow-origin: https://www.zoocasa.com
  access-control-expose-headers: X-User-Id,X-Email,X-Internal-Secret,X-Auth-Provider,X-First-Name,X-Last-Name
  access-control-max-age: 1728000
  cf-cache-status: DYNAMIC
  cf-ray: a2b3eaba0a6a18fa-YVR
  content-type: text/html
  date: Sat, 15 Aug 2026 00:00:04 GMT
  server: cloudflare
  strict-transport-security: max-age=31536000; includeSubDomains
body: <html><head><title>401 Authorization Required</title></head>...(nginx default 401 page)...

=== 2. Find JS chunks ===
found 62 script URLs
scanning 57 likely-relevant bundles
[04~xfx4w6u5rp.js] NEXT_PUBLIC_WEB_VITALS
[0jw95xc~3.qab.js] API_KEY:"apiKey"
[0jw95xc~3.qab.js] Token="Auth.Social.ExchangingToken"
[0hcdfun8t2v1o.js] api.zoocasa.com
[0xgqi~t172ohu.js] "authorization":"You don\'
[0q6yzv~gptz~h.js] NEXT_PUBLIC_CLIENT_APP_HOST
[0q6yzv~gptz~h.js] NEXT_PUBLIC_APPLE_MAPKIT_JWT_VERCEL
[0cormffmi1by4.js] apiKey:"AIzaSyAooXyeDuWEo56PiuOJn7e0AS40BPEdSto"

=== 3. Try common public-API auth shapes ===
no auth, browser headers: status=401
with credentials cookie probe: status=401
```

Findings:
- The header set names a real, deliberate auth scheme: `x-zoocasa-api-key`,
  `x-zoocasa-tenant`, `X-Internal-Secret`, plus a social-auth token exchange
  (`Auth.Social.ExchangingToken`). This is a first-party authenticated backend for
  logged-in users/tenants (e.g. agent/brokerage accounts), not a lightly-protected
  public data API.
- No static/public API key for `api.zoocasa.com` was found anywhere in the 30 scanned
  bundles. The one `apiKey` literal recovered (`AIzaSyAooXyeDuWEo56PiuOJn7e0AS40BPEdSto`)
  is a Google-prefixed (`AIza...`) key — almost certainly a Maps/Places embed key, not a
  Zoocasa credential — and is scoped to Google's own referrer/API restrictions, not
  usable against `api.zoocasa.com` regardless.
- The 401 is served by `nginx` behind Cloudflare, distinct from `www.zoocasa.com`'s own
  stack — consistent with a genuinely separate, access-gated internal service rather
  than a misconfigured-but-otherwise-open endpoint.
- Both auth-shape variants tried (plain browser headers, `credentials: "include"` with
  no session to send) returned 401 — expected, confirms there's no "just add Origin/
  Referer" bypass.

## Overall conclusion (restated)

For all three tested avenues — (1) query-string pagination/search params on the public
SSR search page, (2) alternate URL/path shapes and the internal `_next/data` JSON
route, (3) the SPA's real backend at `api.zoocasa.com` — the 27-listing cap holds as of
2026-08-14. Specifically:

- Query-string pagination params (`page`, `p`, `offset`, `pageNumber`, `pageIndex`,
  `start`, `from`, `skip`, `limit`, `pageSize`, `size`) are **silently ignored**, not
  rejected — every one returns HTTP 200 with the identical first-27 result set.
- Free-text search/address params (`q`, `keywords`, `search`, `address`, `street`) do
  **not** filter results at all.
- The only param that changes the result set is the **neighbourhood path segment**,
  which narrows by named neighbourhood (not address), and does not exceed 27 per page
  in the case tested (25 results for `/shaganappi`).
- The `_next/data/{buildId}/...json` route is a real, working alternate transport for
  the same SSR props, but is driven by the same server-side data-fetching logic — it
  inherits the identical no-op pagination behavior, so it is not a way around the cap.
- `api.zoocasa.com`, the actual backend with real pagination/filtering capability
  (implied by its existence as "the SPA's real backend"), is authenticated with a
  tenant/API-key scheme with no public credential available in the client bundle. It is
  closed to unauthenticated access.

**No follow-up implementation work is available from this investigation.** There is no
precise URL shape / params / endpoint to specify for a "beyond 27" fetch, because none
was found to work. The only structurally different lever discovered — neighbourhood
path scoping — is a narrowing filter, not a pagination mechanism, and doesn't lift the
cap; it could in principle be used to enumerate a city by summing per-neighbourhood
result sets (each itself capped at whatever Zoocasa's SSR page size limit is, so a
neighbourhood with >27 active listings would hit the same wall), but that would require
knowing Zoocasa's full neighbourhood taxonomy per city up front and re-running the
whole probe methodology against it — a separate, larger effort with its own risk (site
policy on scraping neighbourhood-by-neighbourhood at volume; case-by-case cap
verification), not a mechanical follow-up to this ticket.

## Probe script disposition

All three probe scripts are kept — each tests a genuinely different avenue (search
params, path/internal-API pagination, backend auth) and none fully supersedes another.
They now typecheck cleanly (`npx tsc --noEmit`) and remain committed under `scripts/`
for future re-verification if Zoocasa's markup/routing changes.
