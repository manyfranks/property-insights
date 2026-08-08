// Verification harness: pick N random seeded US listings and assert each
// property page renders the full assessment UX (offer, narrative, valuation,
// county context, CTAs) against a running local server. Content-level checks:
// the narrative assertion matches the listing's own persisted preNarrative
// text, not just a heading.
// Usage: npx tsx scripts/verify-seeds.ts [count=20] [port=3905] [seed]
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

const COUNT = Number(process.argv[2]) || 20;
const PORT = Number(process.argv[3]) || 3905;
const SEED = Number(process.argv[4]) || Date.now();

// Deterministic PRNG so a run is reproducible by seed
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slugify = (addr: string) => addr.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

(async () => {
  const url = process.env.KV_REST_API_URL!;
  const headers = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
  const quotaBefore = ((await (await fetch(`${url}/GET/${encodeURIComponent("rentcast:quota:2026-08")}`, { headers })).json()) as { result: string }).result;

  const r = (await (await fetch(`${url}/GET/listings:all`, { headers })).json()) as { result: string };
  const all = JSON.parse(r.result) as Array<{ address: string; city: string; province: string; price: number; preNarrative?: string; preAssessment?: { found?: boolean; source?: string } }>;
  const us = all.filter((l) => ["TX", "FL", "AZ"].includes(l.province));

  const rand = mulberry32(SEED);
  const pool = [...us];
  const picks: typeof us = [];
  while (picks.length < Math.min(COUNT, pool.length)) {
    picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }

  console.log(`seed=${SEED} | pool=${us.length} US listings | picked=${picks.length} | port=${PORT}`);
  console.log("slug | status | offer | signal-narrative | valuation | county-ctx | CTA | verdict");
  console.log("-".repeat(110));

  let pass = 0;
  for (const l of picks) {
    const slug = slugify(l.address);
    const res = await fetch(`http://localhost:${PORT}/property/${slug}`);
    const html = await res.text();
    const checks = {
      status: res.status === 200,
      offer: /Recommended Offer|Estimated Offer/.test(html),
      // content-level: first 40 chars of the listing's own persisted narrative,
      // HTML-escaped comparison on a distinctive substring
      narrative: !!l.preNarrative && html.includes(l.preNarrative.slice(0, 40).replace(/&/g, "&amp;").replace(/'/g, "&#x27;")),
      valuation: /The Signal/.test(html) && /[Aa]ssess|[Tt]riangulation|anchor/.test(html),
      county: /County|market/i.test(html),
      cta: /rentcast\.io|dealcheck\.io/.test(html),
      noJunk: !/Limited Data|Generating analysis/.test(html),
    };
    const ok = Object.values(checks).every(Boolean);
    if (ok) pass++;
    console.log(
      `${slug.slice(0, 34).padEnd(34)} | ${res.status} | ${checks.offer ? "Y" : "N"} | ${checks.narrative ? "Y" : "N"} | ${checks.valuation ? "Y" : "N"} | ${checks.county ? "Y" : "N"} | ${checks.cta ? "Y" : "N"} | ${ok ? "PASS" : "FAIL" + (checks.noJunk ? "" : " (junk-state!)")}`
    );
  }

  const quotaAfter = ((await (await fetch(`${url}/GET/${encodeURIComponent("rentcast:quota:2026-08")}`, { headers })).json()) as { result: string }).result;
  console.log("-".repeat(110));
  console.log(`RESULT: ${pass}/${picks.length} PASS | rentcast quota before=${quotaBefore} after=${quotaAfter} (must be equal)`);
  process.exit(pass === picks.length && quotaBefore === quotaAfter ? 0 : 1);
})();
