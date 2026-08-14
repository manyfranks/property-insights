export {}; // make this scratch probe a module so its consts do not collide with sibling probes at typecheck
/**
 * Probe api.zoocasa.com — the SPA's real backend.
 *
 * Findings so far:
 *   - api.zoocasa.com/listings → 401 (auth required, but small body suggests real JSON error)
 *   - the /api/* paths on www.zoocasa.com return 404 fallback pages
 *
 * This script:
 *   1. Reads the 401 body to see what auth is required.
 *   2. Walks the HTML's JS chunks looking for embedded auth tokens or
 *      API base URLs.
 *   3. Tries to call the API with whatever auth shape we discover.
 *
 * Run: npx tsx scripts/probe-zoocasa-api.ts
 */

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.zoocasa.com",
  Referer: "https://www.zoocasa.com/calgary-ab-real-estate?saleOrRent=sale",
};

async function main() {
  console.log("=== 1. Read the 401 body ===");
  {
    const r = await fetch("https://api.zoocasa.com/listings?city=calgary&province=ab&saleOrRent=sale", {
      headers: FETCH_HEADERS,
    });
    console.log(`status=${r.status}`);
    for (const [k, v] of r.headers) console.log(`  ${k}: ${v}`);
    const body = await r.text();
    console.log(`body: ${body.slice(0, 1000)}`);
  }

  console.log("\n=== 2. Find JS chunks ===");
  const html = await (await fetch("https://www.zoocasa.com/calgary-ab-real-estate?saleOrRent=sale", {
    headers: { ...FETCH_HEADERS, Accept: "text/html" },
  })).text();

  const scriptUrls = new Set<string>();
  const scriptRe = /<script[^>]+src="([^"]+)"/g;
  for (const m of html.matchAll(scriptRe)) {
    let u = m[1];
    if (u.startsWith("/")) u = `https://www.zoocasa.com${u}`;
    scriptUrls.add(u);
  }
  console.log(`found ${scriptUrls.size} script URLs`);

  // Look at the main app bundle for auth-related strings.
  const appBundles = [...scriptUrls].filter((u) =>
    /(_app|main|webpack|chunk|listings|search)/i.test(u)
  );
  console.log(`scanning ${appBundles.length} likely-relevant bundles`);

  const interestingPatterns = [
    /api\.zoocasa\.com[^"'\s]*/g,
    /Bearer\s+[A-Za-z0-9._-]+/g,
    /["']x-api-key["']\s*:\s*["'][^"']+["']/gi,
    /["']authorization["']\s*:\s*["'][^"']+["']/gi,
    /apiKey\s*[:=]\s*["'][^"']{8,}["']/g,
    /API_KEY[^a-z]?[:=][^,;]{8,}/gi,
    /token\s*[:=]\s*["'][a-zA-Z0-9._-]{20,}["']/gi,
    /NEXT_PUBLIC_[A-Z_]+/g,
  ];

  const seen = new Set<string>();
  for (const url of appBundles.slice(0, 30)) {
    try {
      const body = await (await fetch(url, { headers: FETCH_HEADERS })).text();
      for (const pat of interestingPatterns) {
        for (const m of body.matchAll(pat)) {
          const hit = m[0].slice(0, 200);
          if (seen.has(hit)) continue;
          seen.add(hit);
          console.log(`[${url.split("/").pop()}] ${hit}`);
        }
      }
    } catch {}
  }

  console.log("\n=== 3. Try common public-API auth shapes ===");
  // Some real estate sites use a static public key shipped in the bundle.
  // First try with no auth but full browser-like headers — sometimes the 401
  // is just from a missing Origin/Referer.
  const variants: Array<{ label: string; init: RequestInit }> = [
    { label: "no auth, browser headers", init: { headers: FETCH_HEADERS } },
    { label: "with credentials cookie probe", init: { headers: FETCH_HEADERS, credentials: "include" } },
  ];
  for (const v of variants) {
    const r = await fetch(
      "https://api.zoocasa.com/listings?city=calgary&province=ab&saleOrRent=sale&page=2&pageSize=50",
      v.init
    );
    console.log(`${v.label}: status=${r.status}`);
    if (r.status === 200) {
      const body = await r.text();
      console.log(`  body preview: ${body.slice(0, 400)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
