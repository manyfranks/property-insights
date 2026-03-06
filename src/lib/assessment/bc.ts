import { Assessment } from "../types";
import { BC_ASSESSMENT_CACHE } from "../data/assessments";
import { getBrowser } from "../browser";

/**
 * Look up BC Assessment value. Tries cache first, then live scrape via Browserless.
 */
export async function lookupBC(address: string): Promise<Assessment | null> {
  // 1. Try cache first (instant)
  const cached = BC_ASSESSMENT_CACHE[address];
  if (cached) {
    return {
      totalValue: cached.total,
      landValue: cached.land,
      buildingValue: cached.building,
      assessmentYear: "2026",
      found: true,
    };
  }

  // 2. Try live scrape
  try {
    return await scrapeBCAssessment(address);
  } catch {
    return null;
  }
}

/**
 * Synchronous cache-only lookup (used in preloaded data path where we don't want async).
 */
export function lookupBCSync(address: string): Assessment | null {
  const cached = BC_ASSESSMENT_CACHE[address];
  if (!cached) return null;
  return {
    totalValue: cached.total,
    landValue: cached.land,
    buildingValue: cached.building,
    assessmentYear: "2026",
    found: true,
  };
}

async function scrapeBCAssessment(address: string): Promise<Assessment | null> {
  const browserlessKey = process.env.BROWSERLESS_API_KEY;
  if (!browserlessKey) return null;

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto("https://www.bcassessment.ca/", {
      waitUntil: "networkidle2",
      timeout: 15000,
    });

    // Type address using React-compatible input setter
    await page.evaluate((addr: string) => {
      const input = document.querySelector(
        'input[placeholder="Search for an address or PID/Jurisdiction"]'
      ) as HTMLInputElement | null;
      // Try alternate selectors if primary doesn't match
      const el =
        input ||
        (document.querySelector('input[type="text"]') as HTMLInputElement | null);
      if (!el) throw new Error("Search input not found");

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      if (!nativeSetter) throw new Error("Cannot set input value");

      nativeSetter.call(el, addr);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    }, address);

    // Wait for autocomplete dropdown
    await page.waitForSelector(".suggestions-list li, .tt-suggestion, [class*='suggestion']", {
      timeout: 5000,
    });

    // Small delay for React render
    await new Promise((r) => setTimeout(r, 500));

    // Click first suggestion
    await page.evaluate(() => {
      const suggestion = document.querySelector(
        ".suggestions-list li, .tt-suggestion, [class*='suggestion']"
      ) as HTMLElement | null;
      if (suggestion) suggestion.click();
    });

    // Wait for property page to load
    await page.waitForFunction(
      () => document.body.innerText.includes("Total value"),
      { timeout: 8000 }
    );

    // Extract values
    const result = await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, " ");
      const totalMatch = text.match(/Total value[:\s]*\$([\d,]+)/i);
      const landMatch = text.match(/Land[:\s]*\$([\d,]+)/i);
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

    if (!result) return null;

    return {
      totalValue: result.total,
      landValue: result.land,
      buildingValue: result.building,
      assessmentYear: "2026",
      found: true,
    };
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
