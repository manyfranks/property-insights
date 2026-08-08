/**
 * Typed accessors over src/lib/data/us-counties.json (built by
 * scripts/build-us-county-registry.ts from regional_econ). This is the
 * registry every /us/[state]/[county] page and the sitemap draw from.
 */
import countiesData from "@/lib/data/us-counties.json";

export interface UsCounty {
  /** "US-SSCCC" — matches regional_econ.geo_fips / getCountyMarketPanel's input */
  fips: string;
  /** real county name, e.g. "Travis County" (not slugified) */
  county: string;
  /** USPS state code, e.g. "TX" */
  state: string;
  /** full state name, e.g. "Texas" */
  stateName: string;
  stateSlug: string;
  countySlug: string;
}

export const US_COUNTIES: UsCounty[] = countiesData as UsCounty[];

export function getCountyBySlug(stateSlug: string, countySlug: string): UsCounty | null {
  return (
    US_COUNTIES.find((c) => c.stateSlug === stateSlug && c.countySlug === countySlug) ?? null
  );
}

export function getCountiesByState(stateSlug: string): UsCounty[] {
  return US_COUNTIES.filter((c) => c.stateSlug === stateSlug).sort((a, b) =>
    a.county.localeCompare(b.county)
  );
}

export interface StateWithCounties {
  stateSlug: string;
  state: string; // USPS
  stateName: string;
  countyCount: number;
}

/** All states/DC that have at least one county in the registry, alphabetical by name. */
export function getAllStatesWithCounties(): StateWithCounties[] {
  const byState = new Map<string, StateWithCounties>();
  for (const c of US_COUNTIES) {
    const existing = byState.get(c.stateSlug);
    if (existing) {
      existing.countyCount++;
    } else {
      byState.set(c.stateSlug, {
        stateSlug: c.stateSlug,
        state: c.state,
        stateName: c.stateName,
        countyCount: 1,
      });
    }
  }
  return Array.from(byState.values()).sort((a, b) => a.stateName.localeCompare(b.stateName));
}

/**
 * Curated ~100 largest US metro counties by population, hardcoded so
 * generateStaticParams on /us/[state]/[county] can prebuild the highest-
 * traffic pages at build time (every other county still renders on-demand
 * via dynamicParams = true). Not a population-ranked API call — a fixed
 * editorial list, refreshed occasionally by hand.
 */
export const TOP_METRO_FIPS: string[] = [
  "US-06037", // Los Angeles County, CA
  "US-17031", // Cook County, IL
  "US-48201", // Harris County, TX
  "US-04013", // Maricopa County, AZ
  "US-06073", // San Diego County, CA
  "US-06059", // Orange County, CA
  "US-12086", // Miami-Dade County, FL
  "US-48113", // Dallas County, TX
  "US-36047", // Kings County, NY (Brooklyn)
  "US-06065", // Riverside County, CA
  "US-53033", // King County, WA (Seattle)
  "US-32003", // Clark County, NV (Las Vegas)
  "US-36081", // Queens County, NY
  "US-06071", // San Bernardino County, CA
  "US-48439", // Tarrant County, TX
  "US-06085", // Santa Clara County, CA
  "US-12011", // Broward County, FL
  "US-26163", // Wayne County, MI (Detroit)
  "US-48029", // Bexar County, TX (San Antonio)
  "US-25017", // Middlesex County, MA
  "US-36103", // Suffolk County, NY (Long Island)
  "US-06001", // Alameda County, CA
  "US-36061", // New York County, NY (Manhattan)
  "US-39035", // Cuyahoga County, OH (Cleveland)
  "US-36059", // Nassau County, NY
  "US-13121", // Fulton County, GA (Atlanta)
  "US-06067", // Sacramento County, CA
  "US-39049", // Franklin County, OH (Columbus)
  "US-27053", // Hennepin County, MN (Minneapolis)
  "US-12099", // Palm Beach County, FL
  "US-36005", // Bronx County, NY
  "US-48453", // Travis County, TX (Austin)
  "US-26125", // Oakland County, MI
  "US-06013", // Contra Costa County, CA
  "US-49035", // Salt Lake County, UT
  "US-12057", // Hillsborough County, FL (Tampa)
  "US-42003", // Allegheny County, PA (Pittsburgh)
  "US-12095", // Orange County, FL (Orlando)
  "US-51059", // Fairfax County, VA
  "US-24031", // Montgomery County, MD
  "US-37183", // Wake County, NC (Raleigh)
  "US-37119", // Mecklenburg County, NC (Charlotte)
  "US-08031", // Denver County, CO
  "US-06019", // Fresno County, CA
  "US-04019", // Pima County, AZ (Tucson)
  "US-55079", // Milwaukee County, WI
  "US-41051", // Multnomah County, OR (Portland)
  "US-18097", // Marion County, IN (Indianapolis)
  "US-47157", // Shelby County, TN (Memphis)
  "US-17043", // DuPage County, IL
  "US-36119", // Westchester County, NY
  "US-48215", // Hidalgo County, TX
  "US-48085", // Collin County, TX
  "US-13135", // Gwinnett County, GA
  "US-06111", // Ventura County, CA
  "US-24033", // Prince George's County, MD
  "US-06075", // San Francisco County, CA
  "US-48141", // El Paso County, TX
  "US-12103", // Pinellas County, FL
  "US-06029", // Kern County, CA (Bakersfield)
  "US-47037", // Davidson County, TN (Nashville)
  "US-34003", // Bergen County, NJ
  "US-40109", // Oklahoma County, OK
  "US-21111", // Jefferson County, KY (Louisville)
  "US-48121", // Denton County, TX
  "US-24005", // Baltimore County, MD
  "US-12031", // Duval County, FL (Jacksonville)
  "US-06077", // San Joaquin County, CA
  "US-42091", // Montgomery County, PA
  "US-34013", // Essex County, NJ
  "US-53061", // Snohomish County, WA
  "US-45019", // Charleston County, SC
  "US-39153", // Summit County, OH
  "US-49049", // Utah County, UT
  "US-10003", // New Castle County, DE
  "US-37081", // Guilford County, NC (Greensboro)
  "US-39061", // Hamilton County, OH (Cincinnati)
  "US-31055", // Douglas County, NE (Omaha)
  "US-19153", // Polk County, IA (Des Moines)
  "US-36029", // Erie County, NY (Buffalo)
  "US-15003", // Honolulu County, HI
  "US-08059", // Jefferson County, CO
  "US-08005", // Arapahoe County, CO
  "US-32031", // Washoe County, NV (Reno)
  "US-44007", // Providence County, RI
  "US-25021", // Norfolk County, MA
  "US-25025", // Suffolk County, MA (Boston)
  "US-29189", // St. Louis County, MO
  "US-29095", // Jackson County, MO (Kansas City)
  "US-20091", // Johnson County, KS
  "US-20173", // Sedgwick County, KS (Wichita)
  "US-40143", // Tulsa County, OK
  "US-12071", // Lee County, FL (Fort Myers)
  "US-12021", // Collier County, FL (Naples)
  "US-35001", // Bernalillo County, NM (Albuquerque)
  "US-08041", // El Paso County, CO (Colorado Springs)
  "US-53063", // Spokane County, WA
  "US-24003", // Anne Arundel County, MD
  "US-13067", // Cobb County, GA
  "US-13089", // DeKalb County, GA
  "US-45079", // Richland County, SC (Columbia)
  "US-37067", // Forsyth County, NC (Winston-Salem)
  "US-42071", // Lancaster County, PA
  "US-42133", // York County, PA
  "US-02020", // Anchorage Municipality, AK
];

export function isTopMetroCounty(fips: string): boolean {
  return TOP_METRO_FIPS.includes(fips);
}
