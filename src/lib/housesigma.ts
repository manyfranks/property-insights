import { ListingHistory } from "./types";

const PROVINCE_CODES: Record<string, string> = {
  BC: "bc",
  ON: "on",
  AB: "ab",
};

export function buildHouseSigmaUrl(address: string, province: string): string {
  // HouseSigma is a SPA that ignores URL params on load.
  // Google site-search reliably finds the specific listing page.
  return `https://www.google.com/search?q=site:housesigma.com+${encodeURIComponent(address)}+${encodeURIComponent(province)}`;
}

export function getLinkOnlyHistory(address: string, province: string): ListingHistory {
  return {
    found: false,
    source: "link_only",
    houseSigmaUrl: buildHouseSigmaUrl(address, province),
  };
}
