export {}; // make this scratch probe a module so its consts do not collide with sibling probes at typecheck
/**
 * Probe Zoocasa search query parameters.
 *
 * Question: can we pass an address-like query to narrow the result set,
 * so we don't have to paginate hundreds of city listings to find one?
 *
 * Method: fetch the same Calgary search page with different candidate
 * params and check how many listings come back. If a param works,
 * the candidate count drops from "all of Calgary" toward 1.
 *
 * Run: npx tsx scripts/probe-zoocasa-search.ts
 */

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function fetchAndCount(url: string): Promise<{
  status: number;
  finalUrl: string;
  listingCount: number;
  totalCount: number | null;
  firstAddresses: string[];
}> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404 || res.url.includes("missingAddress")) {
    return { status: res.status, finalUrl: res.url, listingCount: 0, totalCount: null, firstAddresses: [] };
  }
  const html = await res.text();
  const m = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return { status: res.status, finalUrl: res.url, listingCount: -1, totalCount: null, firstAddresses: [] };

  let total: number | null = null;
  try {
    const data = JSON.parse(m[1]) as Record<string, unknown>;
    const props = data.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    const innerProps = pageProps?.props as Record<string, unknown> | undefined;
    const listings = (innerProps?.listings || []) as Array<Record<string, unknown>>;
    // Try to find a totals field — Zoocasa often exposes one alongside listings.
    const candidates = ["count", "totalCount", "total", "totalResults", "listingsCount"];
    for (const k of candidates) {
      const v = innerProps?.[k];
      if (typeof v === "number") { total = v; break; }
    }
    return {
      status: res.status,
      finalUrl: res.url,
      listingCount: listings.length,
      totalCount: total,
      firstAddresses: listings.slice(0, 3).map((l) => String(l.address || "")),
    };
  } catch {
    return { status: res.status, finalUrl: res.url, listingCount: -1, totalCount: null, firstAddresses: [] };
  }
}

const BASE = "https://www.zoocasa.com/calgary-ab-real-estate";
// Use a real, current Calgary listing as the target for "did the filter find it" checks.
const TARGET_STREET_NUMBER = "1727";
const TARGET_QUERY = "1727 24a st sw";

const PROBES: Array<{ label: string; url: string }> = [
  // Baseline — no filter, just sale type.
  { label: "baseline (saleOrRent=sale)", url: `${BASE}?saleOrRent=sale` },

  // Page param: does pagination exist?
  { label: "page=2", url: `${BASE}?saleOrRent=sale&page=2` },
  { label: "p=2", url: `${BASE}?saleOrRent=sale&p=2` },
  { label: "offset=27", url: `${BASE}?saleOrRent=sale&offset=27` },

  // Address-style query params worth trying.
  { label: "q=<address>", url: `${BASE}?saleOrRent=sale&q=${encodeURIComponent(TARGET_QUERY)}` },
  { label: "keywords=<address>", url: `${BASE}?saleOrRent=sale&keywords=${encodeURIComponent(TARGET_QUERY)}` },
  { label: "search=<address>", url: `${BASE}?saleOrRent=sale&search=${encodeURIComponent(TARGET_QUERY)}` },
  { label: "address=<address>", url: `${BASE}?saleOrRent=sale&address=${encodeURIComponent(TARGET_QUERY)}` },
  { label: "street=<num+name>", url: `${BASE}?saleOrRent=sale&street=${encodeURIComponent(TARGET_QUERY)}` },

  // Neighbourhood narrowing — confirmed in URL structure.
  { label: "neighbourhood path /shaganappi", url: `${BASE}/shaganappi?saleOrRent=sale` },

  // Combine a neighbourhood path with a query param to see if both layers work.
  { label: "/shaganappi + q=", url: `${BASE}/shaganappi?saleOrRent=sale&q=${encodeURIComponent(TARGET_QUERY)}` },
];

async function main() {
  console.log(`Target listing: ${TARGET_QUERY}`);
  console.log(`(real Calgary listing per user — neighbourhood: shaganappi)`);
  console.log();

  for (const p of PROBES) {
    try {
      const r = await fetchAndCount(p.url);
      const targetHit = r.firstAddresses.some((a) =>
        a.toLowerCase().includes(TARGET_STREET_NUMBER)
      );
      console.log(
        `${p.label.padEnd(36)}` +
        ` count=${String(r.listingCount).padStart(4)}` +
        (r.totalCount !== null ? ` total=${r.totalCount}` : "") +
        ` targetInTop3=${targetHit}` +
        (r.finalUrl !== p.url ? ` (redirected)` : "")
      );
      if (targetHit) {
        console.log(`   first 3: ${r.firstAddresses.join(" | ")}`);
      }
    } catch (err) {
      console.log(`${p.label.padEnd(36)} ERR ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
