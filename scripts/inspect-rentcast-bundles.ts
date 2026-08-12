/**
 * Read RentCast's production KV cache directly and print only identity/status
 * fields. It cannot issue a provider call. Accepts repeating triples.
 */
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();
import { normalizeAddressKey } from "../src/lib/rentcast";

const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;
if (!kvUrl || !kvToken) throw new Error("KV is not configured");

async function cacheGet<T>(key: string): Promise<{ hit: boolean; value: T | null }> {
  const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  if (!response.ok) throw new Error(`KV returned ${response.status}`);
  const body = await response.json() as { result?: string | null };
  if (body.result == null) return { hit: false, value: null };
  const parsed = JSON.parse(body.result) as { v: T | null };
  return { hit: true, value: parsed.v };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.length % 3 !== 0) {
    throw new Error('Usage: npx tsx scripts/inspect-rentcast-bundles.ts "<address>" "<city>" "<state>" [...]');
  }
  for (let index = 0; index < args.length; index += 3) {
    const [address, city, state] = args.slice(index, index + 3);
    const inputKey = normalizeAddressKey(address, city, state);
    const propertyCache = await cacheGet<Array<Record<string, unknown>>>(`rentcast:property:${inputKey}`);
    const record = Array.isArray(propertyCache.value) ? propertyCache.value[0] : null;
    const canonicalKey = normalizeAddressKey(
      typeof record?.addressLine1 === "string" ? record.addressLine1 : address,
      typeof record?.city === "string" ? record.city : city,
      typeof record?.state === "string" ? record.state : state
    );
    const listingCache = await cacheGet<Array<Record<string, unknown>>>(`rentcast:listing:${canonicalKey}`);
    const listing = Array.isArray(listingCache.value) ? listingCache.value[0] : null;
    console.log(JSON.stringify({
      input: `${address}, ${city}, ${state}`,
      inputKey,
      propertyCacheHit: propertyCache.hit,
      canonicalKey,
      listingCacheHit: listingCache.hit,
      record: record ? {
        formattedAddress: record.formattedAddress,
        addressLine1: record.addressLine1,
        city: record.city,
        state: record.state,
        zipCode: record.zipCode,
        propertyType: record.propertyType,
        bedrooms: record.bedrooms,
        bathrooms: record.bathrooms,
        squareFootage: record.squareFootage,
      } : null,
      listing: listing ? {
        formattedAddress: listing.formattedAddress,
        addressLine1: listing.addressLine1,
        city: listing.city,
        state: listing.state,
        zipCode: listing.zipCode,
        propertyType: listing.propertyType,
        price: listing.price,
        status: listing.status,
      } : null,
    }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
