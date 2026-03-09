import { Assessment } from "../types";
import { BC_ASSESSMENT_CACHE } from "../data/assessments";
import { getBrowser } from "../browser";

// Street type abbreviations for BC Assessment search API
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

/**
 * Generate search variants to improve hit rate on BC Assessment's API.
 */
function searchVariants(address: string, city?: string): string[] {
  const variants: string[] = [address];
  if (city) variants.push(address + " " + city);

  let abbreviated = address;
  for (const [pat, repl] of ABBREVS) abbreviated = abbreviated.replace(pat, repl);
  if (abbreviated !== address) {
    variants.push(abbreviated);
    if (city) variants.push(abbreviated + " " + city);
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

  // "106-1987 Kaltasin Rd" -> "1987 Kaltasin Rd" (dash-separated unit prefix)
  const dashUnit = address.match(/^\d+[A-Z]?-(\d+\s+.+)$/i);
  if (dashUnit) {
    const base = dashUnit[1];
    variants.push(base);
    let abbr = base;
    for (const [pat, repl] of ABBREVS) abbr = abbr.replace(pat, repl);
    if (abbr !== base) variants.push(abbr);
    if (city) {
      variants.push(base + " " + city);
      if (abbr !== base) variants.push(abbr + " " + city);
    }
  }

  // "4-203 4201 Tyndall Ave" -> "4201 Tyndall Ave"
  const complexMatch = address.match(/^\d+-\d+\s+(\d+.+)$/);
  if (complexMatch) variants.push(complexMatch[1]);

  return [...new Set(variants)];
}

// ── Step 1: REST API search (no browser needed) ────────────────────

interface ApiResult {
  label: string;
  value: string;
  gid: string | null;
}

/**
 * Use BC Assessment's autocomplete REST API to find a property ID.
 * Fast (~200ms), no browser required.
 */
async function findPropertyId(
  address: string,
  city?: string,
  unit?: string
): Promise<{ id: string; label: string } | null> {
  const variants = searchVariants(address, city);

  for (const query of variants) {
    try {
      const url = `https://www.bcassessment.ca/Property/Search/GetByAddress?addr=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as ApiResult[];
      if (!data?.length || data[0].label === "No results") continue;

      // Multi-unit: try to find specific unit
      if (data[0].label.includes("select to see all units")) {
        // Prefer explicit unit param, fall back to address prefix extraction
        const unitNum = unit || address.match(/^(?:TH)?(\d+[A-Z]?)\s/i)?.[1];

        // Try sub-unit endpoint if gid available
        if (data[0].gid) {
          try {
            const subRes = await fetch(
              `https://www.bcassessment.ca/Property/Search/GetSubUnits/${data[0].gid}`,
              {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(5000),
              }
            );
            if (subRes.ok) {
              const subData = (await subRes.json()) as {
                Units: { Oa000_OID: string; Address: string }[];
              };
              if (unitNum && subData.Units) {
                const match = subData.Units.find(
                  (u) =>
                    u.Address.toLowerCase().startsWith(unitNum.toLowerCase() + "-") ||
                    u.Address.toLowerCase().startsWith(unitNum.toLowerCase() + " ")
                );
                if (match) return { id: match.Oa000_OID, label: match.Address };
              }
            }
          } catch {
            // Fall through to other heuristics
          }
        }

        if (unitNum) {
          const match = data.find((d) => d.label.startsWith(unitNum + "-"));
          if (match) return { id: match.value, label: match.label };
        }

        // Fall back to first non-header result
        const first = data.find((d) => d.value && d.value !== "" && d.value !== "0");
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

// ── Step 2: Puppeteer direct page load (no search interaction) ─────

/**
 * Navigate directly to the property page by ID and extract values.
 * Much faster/more reliable than the old approach of typing into
 * the search box and clicking autocomplete suggestions.
 */
async function scrapeValues(
  propertyId: string
): Promise<{ total: number; land: number; building: number } | null> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessKey) return null;

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(
      `https://www.bcassessment.ca/Property/Info/${propertyId}`,
      { waitUntil: "domcontentloaded", timeout: 12000 }
    );

    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return (
          t.includes("Total value") ||
          t.includes("TOTAL VALUE") ||
          t.includes("Total Value")
        );
      },
      { timeout: 10000 }
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
        building: buildingMatch
          ? parseInt(buildingMatch[1].replace(/,/g, ""), 10)
          : 0,
      };
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────

/** Hard ceiling so a slow scrape never blocks the request. */
const SCRAPE_TIMEOUT_MS = 15_000;

/**
 * Look up BC Assessment value.
 * 1. Check cache (instant)
 * 2. REST API search for property ID (fast, no browser)
 * 3. Puppeteer direct page load to extract values (15s ceiling)
 *
 * If Puppeteer fails or times out, returns null gracefully →
 * pipeline falls back to offerModelLanguage() (85% floor).
 */
export async function lookupBC(
  address: string,
  city?: string,
  unit?: string
): Promise<Assessment | null> {
  // 1. Cache — try address as-is, unit-prefixed variants, and bare (unit stripped)
  // Address may arrive as "106-1987 Kaltasin Rd" (unit baked in) or "1987 Kaltasin Rd" (bare)
  const bare = address.replace(/^\d+[A-Z]?-/i, "");
  const cacheKeys = unit
    ? [address, `${unit} ${bare}`, bare, `${unit}-${bare}`]
    : [address, bare];
  for (const key of cacheKeys) {
    const cached = BC_ASSESSMENT_CACHE[key];
    if (cached) {
      return {
        totalValue: cached.total,
        landValue: cached.land,
        buildingValue: cached.building,
        assessmentYear: "2026",
        found: true,
      };
    }
  }

  // 2. REST API search → property ID
  let property: { id: string; label: string } | null = null;
  try {
    property = await findPropertyId(address, city, unit);
  } catch {
    return null;
  }
  if (!property) return null;

  // 3. Puppeteer scrape with hard timeout — if it hangs, bail gracefully
  try {
    const result = await Promise.race([
      scrapeValues(property.id),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SCRAPE_TIMEOUT_MS)),
    ]);
    if (!result) return null;
    return {
      totalValue: result.total,
      landValue: result.land,
      buildingValue: result.building,
      assessmentYear: "2026",
      found: true,
    };
  } catch {
    return null;
  }
}

/**
 * Full lookup with Puppeteer scrape — for batch scripts (longer timeout).
 */
export async function lookupBCWithScrape(
  address: string,
  city?: string,
  unit?: string
): Promise<Assessment | null> {
  // Cache
  const bare = address.replace(/^\d+[A-Z]?-/i, "");
  const cacheKeys = unit
    ? [address, `${unit} ${bare}`, bare, `${unit}-${bare}`]
    : [address, bare];
  for (const key of cacheKeys) {
    const cached = BC_ASSESSMENT_CACHE[key];
    if (cached) {
      return {
        totalValue: cached.total,
        landValue: cached.land,
        buildingValue: cached.building,
        assessmentYear: "2026",
        found: true,
      };
    }
  }

  // REST API search → property ID
  const property = await findPropertyId(address, city, unit);
  if (!property) return null;

  // Puppeteer scrape
  const values = await scrapeValues(property.id);
  if (!values) return null;

  return {
    totalValue: values.total,
    landValue: values.land,
    buildingValue: values.building,
    assessmentYear: "2026",
    found: true,
  };
}

/**
 * Synchronous cache-only lookup (used in preloaded data path).
 */
export function lookupBCSync(address: string, unit?: string): Assessment | null {
  const bare = address.replace(/^\d+[A-Z]?-/i, "");
  const cacheKeys = unit
    ? [address, `${unit} ${bare}`, bare, `${unit}-${bare}`]
    : [address, bare];
  for (const key of cacheKeys) {
    const cached = BC_ASSESSMENT_CACHE[key];
    if (cached) {
      return {
        totalValue: cached.total,
        landValue: cached.land,
        buildingValue: cached.building,
        assessmentYear: "2026",
        found: true,
      };
    }
  }
  return null;
}
