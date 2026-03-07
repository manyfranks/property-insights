/**
 * Batch scraper: populates BC assessment cache for all missing listings.
 *
 * Two-step approach:
 *   1. REST API autocomplete → get property IDs (fast, no browser)
 *   2. Puppeteer via Browserless → load property page, extract values
 *
 * Results are printed as TypeScript entries ready to paste into assessments.ts
 */

import { readFileSync } from "fs";

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { PRELOADED_LISTINGS } from "../src/lib/data/listings";
import { BC_ASSESSMENT_CACHE } from "../src/lib/data/assessments";
import { getBrowser } from "../src/lib/browser";

// ── Address normalization ────────────────────────────────────────────

const ABBREVS: [RegExp, string][] = [
  [/\bSTREET\b/gi, "ST"],
  [/\bAVENUE\b/gi, "AVE"],
  [/\bDRIVE\b/gi, "DR"],
  [/\bPLACE\b/gi, "PL"],
  [/\bCRESCENT\b/gi, "CRES"],
  [/\bTERRACE\b/gi, "TERR"],
  [/\bBOULEVARD\b/gi, "BLVD"],
  [/\bCOURT\b/gi, "CRT"],
  [/\bROAD\b/gi, "RD"],
];

function searchVariants(address: string, city: string): string[] {
  const variants: string[] = [address, address + " " + city];

  let abbreviated = address;
  for (const [pat, repl] of ABBREVS) abbreviated = abbreviated.replace(pat, repl);
  if (abbreviated !== address) {
    variants.push(abbreviated);
    variants.push(abbreviated + " " + city);
  }

  // Strip unit prefix: "210 1675 HORNBY ST" -> "1675 HORNBY ST"
  const unitMatch = address.match(/^(?:TH\d+|#?\d+[A-Z]?)\s+(\d+.+)$/i);
  if (unitMatch) {
    const base = unitMatch[1];
    variants.push(base);
    let abbr = base;
    for (const [pat, repl] of ABBREVS) abbr = abbr.replace(pat, repl);
    if (abbr !== base) variants.push(abbr);
  }

  // "4-203 4201 Tyndall Ave" -> "4201 Tyndall Ave"
  const complexMatch = address.match(/^\d+-\d+\s+(\d+.+)$/);
  if (complexMatch) variants.push(complexMatch[1]);

  return [...new Set(variants)];
}

// ── Step 1: REST API lookup ──────────────────────────────────────────

interface ApiResult {
  label: string;
  value: string;
  gid: string | null;
}

async function findPropertyId(address: string, city: string): Promise<{ id: string; label: string } | null> {
  const variants = searchVariants(address, city);

  for (const query of variants) {
    try {
      const url = `https://www.bcassessment.ca/Property/Search/GetByAddress?addr=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;

      const data = (await res.json()) as ApiResult[];
      if (!data?.length || data[0].label === "No results") continue;

      // Multi-unit: try to find specific unit
      if (data[0].label.includes("select to see all units")) {
        const unitNum = address.match(/^(?:TH)?(\d+[A-Z]?)\s/i)?.[1];
        if (unitNum) {
          const match = data.find(d => d.label.startsWith(unitNum + "-"));
          if (match) return { id: match.value, label: match.label };
        }
        // For multi-unit with gid, try the sub-unit endpoint
        if (data[0].gid) {
          try {
            const subRes = await fetch(
              `https://www.bcassessment.ca/Property/Search/GetSubUnits/${data[0].gid}`,
              { headers: { Accept: "application/json" } }
            );
            if (subRes.ok) {
              const subData = (await subRes.json()) as { Units: { Oa000_OID: string; Address: string }[]; TotalCount: number };
              const unitNum2 = address.match(/^(?:TH)?(\d+[A-Z]?)\s/i)?.[1];
              if (unitNum2 && subData.Units) {
                const unitMatch = subData.Units.find(u =>
                  u.Address.toLowerCase().startsWith(unitNum2.toLowerCase() + "-") ||
                  u.Address.toLowerCase().startsWith(unitNum2.toLowerCase() + " ")
                );
                if (unitMatch) return { id: unitMatch.Oa000_OID, label: unitMatch.Address };
              }
            }
          } catch {}
        }
        // Fall back to first non-header result
        const first = data.find(d => d.value && d.value !== "" && d.value !== "0");
        if (first) return { id: first.value, label: first.label };
        continue;
      }

      return { id: data[0].value, label: data[0].label };
    } catch {
      continue;
    }
  }

  return null;
}

// ── Step 2: Puppeteer value extraction ───────────────────────────────

async function scrapeValues(propertyId: string): Promise<{
  total: number;
  land: number;
  building: number;
} | null> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(`https://www.bcassessment.ca/Property/Info/${propertyId}`, {
      waitUntil: "networkidle2",
      timeout: 20000,
    });

    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return t.includes("Total value") || t.includes("TOTAL VALUE") || t.includes("Total Value");
      },
      { timeout: 15000 }
    );

    return await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, " ");
      const totalMatch = text.match(/Total value[:\s]*\$([\d,]+)/i);
      const landMatch = text.match(/(?:^|\s)Land[:\s]*\$([\d,]+)/i);
      const buildingMatch = text.match(
        /Buildings?\s*(?:&|and)\s*other\s*improvements?[:\s]*\$([\d,]+)/i
      );
      if (!totalMatch) return null;
      return {
        total: parseInt(totalMatch[1].replace(/,/g, ""), 10),
        land: landMatch ? parseInt(landMatch[1].replace(/,/g, ""), 10) : 0,
        building: buildingMatch ? parseInt(buildingMatch[1].replace(/,/g, ""), 10) : 0,
      };
    });
  } finally {
    try { await browser.close(); } catch {}
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const missing = PRELOADED_LISTINGS.filter(
    l => l.province === "BC" && l.preOffer == null && !BC_ASSESSMENT_CACHE[l.address]
  );

  console.log("BC listings needing assessment:", missing.length);
  console.log("");

  // Phase 1: REST API lookups (fast)
  console.log("=== PHASE 1: REST API Lookups ===");
  const lookups: { address: string; city: string; id: string; label: string }[] = [];
  const noMatch: string[] = [];

  for (let i = 0; i < missing.length; i++) {
    const l = missing[i];
    const result = await findPropertyId(l.address, l.city);
    if (result && result.id && result.id !== "0") {
      lookups.push({ address: l.address, city: l.city, id: result.id, label: result.label });
    } else {
      noMatch.push(l.address);
    }
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 300));
  }

  console.log("Found:", lookups.length);
  console.log("Not found:", noMatch.length);
  if (noMatch.length > 0) {
    console.log("Not found addresses:");
    noMatch.forEach(a => console.log("  " + a));
  }
  console.log("");

  // Phase 2: Puppeteer scrapes (slow, throttled)
  console.log("=== PHASE 2: Puppeteer Value Extraction ===");
  const results: { address: string; total: number; land: number; building: number }[] = [];
  const failures: string[] = [];

  for (let i = 0; i < lookups.length; i++) {
    const { address, id, label } = lookups[i];
    process.stdout.write(`[${i + 1}/${lookups.length}] ${address} ... `);

    try {
      const values = await scrapeValues(id);
      if (values) {
        results.push({ address, ...values });
        console.log(`$${values.total.toLocaleString()}`);
      } else {
        failures.push(address);
        console.log("FAILED (no values in page)");
      }
    } catch (err) {
      failures.push(address);
      console.log("FAILED (" + (err instanceof Error ? err.message : "unknown") + ")");
    }

    // Throttle: 3s between requests
    if (i < lookups.length - 1) await new Promise(r => setTimeout(r, 3000));
  }

  // Output results as TypeScript
  console.log("\n=== RESULTS ===");
  console.log("Scraped successfully:", results.length);
  console.log("Failed:", failures.length);

  console.log("\n=== PASTE INTO assessments.ts (BC_ASSESSMENT_CACHE) ===\n");
  for (const r of results) {
    console.log(`  "${r.address}": { total: ${r.total}, land: ${r.land}, building: ${r.building} },`);
  }

  if (noMatch.length > 0) {
    console.log("\n=== NO BC ASSESSMENT DATA (new construction / not yet assessed) ===");
    noMatch.forEach(a => console.log("  " + a));
  }
}

main().catch(console.error);
