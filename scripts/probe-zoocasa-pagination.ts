export {}; // make this scratch probe a module so its consts do not collide with sibling probes at typecheck
/**
 * Probe Zoocasa for any way to get past the first 27 listings.
 *
 * Strategy:
 *   C. Pagination shapes the SSR page might honor (path-based, etc.)
 *   B. Internal JSON API discovery — sniff the HTML for API endpoints,
 *      then probe the most promising candidates with map-bounds-style params.
 *
 * Run: npx tsx scripts/probe-zoocasa-pagination.ts
 */

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const JSON_HEADERS = {
  ...FETCH_HEADERS,
  Accept: "application/json, text/plain, */*",
};

async function get(url: string, headers = FETCH_HEADERS): Promise<{ status: number; finalUrl: string; body: string }> {
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, finalUrl: res.url, body: await res.text() };
}

function countListings(html: string): { count: number; firstAddrs: string[] } {
  const m = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return { count: -1, firstAddrs: [] };
  try {
    const data = JSON.parse(m[1]) as Record<string, unknown>;
    const props = data.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    const innerProps = pageProps?.props as Record<string, unknown> | undefined;
    const listings = (innerProps?.listings || []) as Array<Record<string, unknown>>;
    return {
      count: listings.length,
      firstAddrs: listings.slice(0, 3).map((l) => String(l.address || "")),
    };
  } catch {
    return { count: -1, firstAddrs: [] };
  }
}

const BASE = "https://www.zoocasa.com/calgary-ab-real-estate";

// =====================================================================
// Step C — additional pagination shapes
// =====================================================================

async function probePagination() {
  console.log("\n=== C: extra pagination shapes ===");
  const candidates = [
    `${BASE}/page/2?saleOrRent=sale`,
    `${BASE}/2?saleOrRent=sale`,
    `${BASE}?saleOrRent=sale&pageNumber=2`,
    `${BASE}?saleOrRent=sale&pageIndex=1`,
    `${BASE}?saleOrRent=sale&start=27`,
    `${BASE}?saleOrRent=sale&from=27`,
    `${BASE}?saleOrRent=sale&skip=27`,
    `${BASE}?saleOrRent=sale&limit=200`,
    `${BASE}?saleOrRent=sale&pageSize=200`,
    `${BASE}?saleOrRent=sale&size=200`,
  ];
  // Capture baseline first to compare.
  const baseline = countListings((await get(`${BASE}?saleOrRent=sale`)).body);
  console.log(`baseline first 3: ${baseline.firstAddrs.join(" | ")}`);

  for (const url of candidates) {
    try {
      const r = await get(url);
      const c = countListings(r.body);
      const same =
        c.count === baseline.count &&
        c.firstAddrs[0] === baseline.firstAddrs[0];
      console.log(
        `${url.replace(BASE, "")}\n  status=${r.status} count=${c.count} sameAsBaseline=${same}` +
        (!same ? `\n  first 3: ${c.firstAddrs.join(" | ")}` : "")
      );
    } catch (err) {
      console.log(`${url} ERR ${err instanceof Error ? err.message : err}`);
    }
  }
}

// =====================================================================
// Step B — internal API discovery
// =====================================================================
//
// Sniff the HTML for hints: API hosts, fetch URLs, build IDs.
// Next.js SPAs typically expose a /_next/data/{buildId}/... route that
// returns the same JSON the SSR uses, often with the page query params honored.

async function discoverApi() {
  console.log("\n=== B: API discovery ===");
  const { body } = await get(`${BASE}?saleOrRent=sale`);

  // 1. Build ID — gives us /_next/data/{buildId}/...
  const buildIdMatch = body.match(/"buildId":"([^"]+)"/);
  console.log(`buildId: ${buildIdMatch?.[1] || "(not found)"}`);

  // 2. Look for any URL that looks like an API.
  const apiHints = new Set<string>();
  const hostHints = new Set<string>();
  const urlRe = /https?:\/\/[^"'\s<>]+/g;
  for (const m of body.matchAll(urlRe)) {
    const u = m[0];
    if (u.includes("api") || u.includes("/data/")) apiHints.add(u);
    try {
      const host = new URL(u).host;
      if (host.includes("zoocasa") || host.includes("api")) hostHints.add(host);
    } catch {}
  }
  console.log(`api-ish URLs (sample):`);
  for (const u of [...apiHints].slice(0, 10)) console.log(`  ${u}`);
  console.log(`hosts seen: ${[...hostHints].join(", ")}`);

  // 3. Probe the Next.js data route if we found a buildId.
  if (buildIdMatch) {
    const buildId = buildIdMatch[1];
    const dataUrl = `https://www.zoocasa.com/_next/data/${buildId}/calgary-ab-real-estate.json?saleOrRent=sale&page=2&city=calgary-ab-real-estate`;
    try {
      const r = await get(dataUrl, JSON_HEADERS);
      console.log(`\n_next/data probe (page=2):`);
      console.log(`  status=${r.status} bytes=${r.body.length}`);
      if (r.status === 200) {
        try {
          const j = JSON.parse(r.body) as Record<string, unknown>;
          const pageProps = j.pageProps as Record<string, unknown> | undefined;
          const innerProps = pageProps?.props as Record<string, unknown> | undefined;
          const listings = (innerProps?.listings || []) as Array<Record<string, unknown>>;
          console.log(`  listings=${listings.length}`);
          console.log(`  first 3: ${listings.slice(0, 3).map((l) => l.address).join(" | ")}`);
        } catch (e) {
          console.log(`  JSON parse failed: ${e instanceof Error ? e.message : e}`);
        }
      } else {
        console.log(`  body preview: ${r.body.slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`  ERR ${err instanceof Error ? err.message : err}`);
    }
  }

  // 4. Look for a JSON-shaped totalCount, pagination clue, or API root in __NEXT_DATA__.
  const nm = body.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (nm) {
    const txt = nm[1];
    for (const k of ["totalCount", "totalResults", "totalListings", "pageCount", "pageSize", "currentPage", "hasMore", "nextPage", "apiUrl", "graphql"]) {
      const m = txt.match(new RegExp(`"${k}"\\s*:\\s*[^,}]+`));
      if (m) console.log(`  __NEXT_DATA__ has ${m[0].slice(0, 80)}`);
    }
  }

  // 5. Try the public-looking API hosts that Zoocasa is known to use.
  const guessApis = [
    "https://api.zoocasa.com/listings?city=calgary&province=ab&saleOrRent=sale&page=2",
    "https://www.zoocasa.com/api/listings?city=calgary-ab-real-estate&page=2",
    "https://www.zoocasa.com/api/search?q=calgary",
  ];
  for (const url of guessApis) {
    try {
      const r = await get(url, JSON_HEADERS);
      console.log(`${url}\n  status=${r.status} bytes=${r.body.length}`);
      if (r.status >= 200 && r.status < 300) {
        console.log(`  body preview: ${r.body.slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`${url} ERR ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  await probePagination();
  await discoverApi();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
