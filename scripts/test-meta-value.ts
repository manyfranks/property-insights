/**
 * scripts/test-meta-value.ts
 *
 * Guards getMetaValue/setMetaValue round-tripping.
 *
 * setMetaValue passes an already-string value to kvSet, which JSON.stringifies
 * everything — so the value came back with an extra JSON layer and every
 * caller parsed one layer too few. It broke the canary's drop detector
 * (permanently NaN, could never fire), us-discover's refresh cadence gate
 * (every metro always "due", burning RentCast quota) and city-metadata's
 * slow-fill activation (never persisted). All three degraded silently.
 *
 * Run with: npx tsx scripts/test-meta-value.ts
 */
import { getMetaValue, setMetaValue } from "@/lib/kv/listings";

const NS = `test-meta-${Date.now()}`;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log((cond ? "  OK    " : "  FAIL  ") + name + (cond ? "" : ` — ${extra}`));
  if (!cond) failed++;
}

async function main() {
  const plain = `${NS}:plain`;
  await setMetaValue(plain, "hello");
  check('plain string round-trips', (await getMetaValue(plain)) === "hello", `got ${JSON.stringify(await getMetaValue(plain))}`);

  const numKey = `${NS}:num`;
  const now = Date.now();
  await setMetaValue(numKey, String(now));
  const rawNum = await getMetaValue(numKey);
  check("numeric string is Number()-able (us-discover cadence gate)", Number.isFinite(Number(rawNum)) && Number(rawNum) === now, `got ${JSON.stringify(rawNum)} -> ${Number(rawNum)}`);

  const objKey = `${NS}:obj`;
  const state = { ema: 12.5, streak: 0, samples: 3, updatedAt: new Date(0).toISOString() };
  await setMetaValue(objKey, JSON.stringify(state));
  const rawObj = await getMetaValue(objKey);
  const parsed = rawObj ? JSON.parse(rawObj) : null;
  check("JSON object round-trips to an OBJECT, not a string (canary baseline)", parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), `typeof ${typeof parsed}`);
  check("  ...and its fields survive", parsed?.samples === 3 && parsed?.ema === 12.5, JSON.stringify(parsed));
  check("  ...so the cold-start guard sees a real sample count", (parsed?.samples < 3) === false && Number.isFinite(parsed?.ema * 0.5), `samples=${parsed?.samples} ema=${parsed?.ema}`);

  const arrKey = `${NS}:arr`;
  await setMetaValue(arrKey, JSON.stringify(["austin-tx", "miami-fl"]));
  const rawArr = await getMetaValue(arrKey);
  const arr = rawArr ? JSON.parse(rawArr) : null;
  check("JSON array round-trips to an ARRAY (city-metadata slow-fill)", Array.isArray(arr) && arr.length === 2, `got ${typeof arr} ${JSON.stringify(arr)}`);

  check("missing key returns null", (await getMetaValue(`${NS}:nope`)) === null);

  // Legacy NaN-poisoned canary shape must still resolve and land in cold-start.
  const legacy = `${NS}:legacy`;
  await setMetaValue(legacy, JSON.stringify({ ema: null, streak: 0, samples: null, updatedAt: new Date(0).toISOString() }));
  const legacyParsed = JSON.parse((await getMetaValue(legacy))!);
  check("NaN-poisoned production state resolves and reads as cold-start", (legacyParsed.samples ?? 0) < 3, JSON.stringify(legacyParsed));

  // Clean up every key this run created — it writes to the real store.
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    for (const suffix of ["plain", "num", "obj", "arr", "legacy"]) {
      await fetch(`${url}/del/${encodeURIComponent(`${NS}:${suffix}`)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    console.log(`  (cleaned up ${NS}:* test keys)`);
  }

  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
