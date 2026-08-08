/**
 * StatCan New Housing Price Index (NHPI), monthly, per CMA -> regional_econ.
 *
 * Table 18-10-0205-01 (productId 18100205) via StatCan's Web Data Service
 * (WDS) REST API — verified live before writing this script:
 *
 *   POST https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata
 *     body: [{"productId":18100205}]
 *   -> dimension[0] = Geography (40 members, each with a `classificationCode`
 *      that IS the Standard Geographical Classification CMA/CA code —
 *      confirmed by cross-checking Victoria=935, Vancouver=933, Calgary=825,
 *      Edmonton=835, Toronto=535, Hamilton=537, Winnipeg=602 against the
 *      well-known SGC codes; see src/lib/db/regional-econ.ts's CA_CMA_TARGETS
 *      doc comment for why these codes — not the cube's own memberId — are
 *      what we store as geo_fips).
 *   -> dimension[1] = "New housing price indexes" (3 members: 1=Total (house
 *      and land), 2=House only, 3=Land only). We use member 1 (Total).
 *
 *   POST https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods
 *     body: [{"productId":18100205,"coordinate":"<geoMemberId>.1.0.0.0.0.0.0.0.0","latestN":36}]
 *   -> object.vectorDataPoint[] = [{refPer:"YYYY-MM-01", value, ...}, ...]
 *
 *   This is the simplest reliable path (no cube-download/CSV parsing
 *   needed) — a single POST per CMA returns exactly the last N monthly
 *   observations already scoped to that geography.
 *
 * OTTAWA-GATINEAU GOTCHA: this cube splits the CMA into "Ottawa-Gatineau,
 * Quebec part" (geo memberId 16) and "..., Ontario part" (geo memberId 18)
 * rather than publishing one combined series. Our Ottawa listings are all
 * Ontario-side, so this script queries memberId 18 but writes the result
 * under the unified CMA code 505 (see regional-econ.ts) — the CMA those
 * listings actually belong to, not a synthetic province-split code.
 *
 * Metric: nhpi (index, base=100 in whatever month StatCan's series starts
 * from — NOT necessarily comparable in absolute level across CMAs, only
 * within one CMA's own time series, which is exactly what the Market
 * Momentum card's 12/36-month trend calculations use it for).
 * geo_level='cma', unit='index', source='statcan_nhpi', monthly grain.
 *
 * No API key required — StatCan's WDS is public. Default is DRY RUN.
 *
 *   npx tsx scripts/ingest-ca-nhpi.ts            # dry run (default)
 *   npx tsx scripts/ingest-ca-nhpi.ts --commit   # write (needs DATABASE_URL)
 */
import { loadEnvLocal, COMMIT, sleep, upsertRegionalEcon, RegionalEconRow } from "./lib/ingest-shared";
import { CA_CMA_TARGETS } from "../src/lib/db/regional-econ";

loadEnvLocal();

const WDS_BASE = "https://www150.statcan.gc.ca/t1/wds/rest";
const PRODUCT_ID = 18100205;
const TOTAL_HOUSE_AND_LAND_MEMBER = 1;
/** 37, not 36: getCmaMomentum's 36-month trend needs a data point exactly
 * 36 months before the latest one to compare against. "Latest N months"
 * from the WDS API returns the window [latest-(N-1), latest] — requesting
 * 36 would only reach 35 months back, one short of what the trend calc
 * needs. 37 gives the full [latest-36, latest] range while still matching
 * the spec's "last 36 months" of coverage in substance. */
const LATEST_N_MONTHS = 37;
const REGION_SOURCE = "statcan_nhpi";
const METRIC = "nhpi";
const UNIT = "index";
const DELAY_MS = Number(process.env.NHPI_INGEST_DELAY_MS || 300);

/** CMA code -> the WDS cube's own Geography dimension memberId for this
 * table (productId 18100205 only — memberIds are cube-specific, unlike the
 * classificationCode/SGC-code we actually store; see regional-econ.ts).
 * Verified live via getCubeMetadata on 2026-08-08. */
const WDS_GEO_MEMBER_ID: Record<number, number> = {
  935: 40, // Victoria
  933: 39, // Vancouver
  825: 35, // Calgary
  835: 36, // Edmonton
  535: 20, // Toronto
  537: 21, // Hamilton
  505: 18, // Ottawa-Gatineau — Ontario part (see module doc)
  602: 30, // Winnipeg
};

interface WdsVectorDataPoint {
  refPer: string; // "YYYY-MM-01"
  value: number | null;
}
interface WdsGetDataResponse {
  status: string;
  object?: { vectorDataPoint?: WdsVectorDataPoint[] };
}

async function fetchCmaNhpi(wdsMemberId: number): Promise<WdsVectorDataPoint[]> {
  const coordinate = `${wdsMemberId}.${TOTAL_HOUSE_AND_LAND_MEMBER}.0.0.0.0.0.0.0.0`;
  const res = await fetch(`${WDS_BASE}/getDataFromCubePidCoordAndLatestNPeriods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ productId: PRODUCT_ID, coordinate, latestN: LATEST_N_MONTHS }]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for coordinate ${coordinate}`);

  const json = (await res.json()) as WdsGetDataResponse[];
  const entry = json[0];
  if (!entry || entry.status !== "SUCCESS" || !entry.object?.vectorDataPoint) {
    throw new Error(`Unexpected WDS response shape for coordinate ${coordinate}: ${JSON.stringify(entry).slice(0, 300)}`);
  }
  return entry.object.vectorDataPoint;
}

function toRows(target: (typeof CA_CMA_TARGETS)[number], points: WdsVectorDataPoint[]): RegionalEconRow[] {
  const rows: RegionalEconRow[] = [];
  for (const p of points) {
    if (p.value == null) continue; // StatCan leaves genuinely missing months null, not 0
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(p.refPer);
    if (!m) throw new Error(`Unexpected refPer shape "${p.refPer}" — aborting rather than guessing.`);
    rows.push({
      geo_fips: `CA-CMA-${target.code}`,
      geo_name: `${target.name} CMA`,
      metric: METRIC,
      year: Number(m[1]),
      month: Number(m[2]),
      value: p.value,
      unit: UNIT,
      source: REGION_SOURCE,
    });
  }
  return rows;
}

async function main() {
  console.log(`StatCan NHPI ingest (table 18-10-0205-01)${COMMIT ? "" : " [DRY RUN — no DB writes]"}`);
  console.log(`target CMAs: ${CA_CMA_TARGETS.length}`);

  let totalRows = 0;
  let cmaOk = 0;
  let cmaFailed = 0;
  const sample: RegionalEconRow[] = [];

  for (const target of CA_CMA_TARGETS) {
    const wdsMemberId = WDS_GEO_MEMBER_ID[target.code];
    if (wdsMemberId == null) {
      console.warn(`  [skip] ${target.name} CMA (${target.code}): no WDS geo memberId mapped`);
      cmaFailed++;
      continue;
    }
    try {
      const points = await fetchCmaNhpi(wdsMemberId);
      const rows = toRows(target, points);
      totalRows += rows.length;
      if (sample.length < 3 && rows.length > 0) sample.push(rows[0]);

      if (COMMIT && rows.length > 0) {
        // Commit PER CMA, immediately — an interruption after this point has
        // already durably saved every CMA processed so far (mirrors
        // scripts/ingest-us-dom.ts's chunked/resumable pattern).
        await upsertRegionalEcon(rows);
      }
      console.log(`  [ok] ${target.name} CMA (${target.code}, wds member ${wdsMemberId}): ${rows.length} months` + (COMMIT ? " — committed" : ""));
      cmaOk++;
    } catch (err) {
      cmaFailed++;
      console.error(`  [error] ${target.name} CMA (${target.code}): ${err instanceof Error ? err.message : err}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n=== Summary ===`);
  console.log(`CMAs ok: ${cmaOk}/${CA_CMA_TARGETS.length}`);
  console.log(`CMAs failed: ${cmaFailed}`);
  console.log(`total month-rows collected: ${totalRows.toLocaleString()}`);
  if (sample.length > 0) {
    console.log(`\nSample rows:`);
    for (const r of sample) console.log(`  ${r.geo_name}: ${r.year}-${String(r.month).padStart(2, "0")} = ${r.value}`);
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN OK — would upsert ~${totalRows.toLocaleString()} rows into regional_econ (metric='${METRIC}', source='${REGION_SOURCE}'). No DB writes. Pass --commit to write.`);
    return;
  }
  console.log(`\nStatCan NHPI ingest complete: ${totalRows.toLocaleString()} rows upserted across ${cmaOk} CMAs.`);
}

main().catch((e) => {
  console.error("ingest-ca-nhpi failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
