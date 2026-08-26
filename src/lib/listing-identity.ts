/**
 * listing-identity.ts
 *
 * ONE canonical answer to "are these two rows the same property?", shared by
 * every path that retains, matches, dedupes or overwrites a listing.
 *
 * WHY THIS EXISTS (2026-08 incident): retention, upsert and dedup each grew
 * their own notion of identity, and every one of them keyed on the bare
 * address string. `retainedStored` in the refresh cron, `upsertListing`'s
 * `findIndex`, and the dead-verdict filter all collapsed "123 Main St,
 * Victoria BC" and "123 Main St, Calgary AB" into a single entry — so one
 * dead verdict could delete both, and a user assessment in one city could
 * overwrite a cron listing in another. The live store happens to contain no
 * such CA cross-city pair today, but an invariant that holds only by luck
 * is not an invariant.
 *
 * DESIGN — why address+city+province and not MLS:
 *
 * The obvious move is to key on the provider's own record id (mlsNumber),
 * and for *equality* that is the better signal. It is the wrong PRIMARY key
 * here, because MLS numbers are only unique within the issuing board, and a
 * province can span several boards (BC alone has VREB, REBGV and FVREB).
 * Keying retention on province+MLS would therefore risk collapsing two real
 * properties from different boards — the exact class of bug this module was
 * written to remove, reintroduced from the other direction.
 *
 * So: the primary key is the full locality tuple, which cannot merge two
 * distinct properties. MLS is exposed separately as a SECONDARY key, for
 * callers that want to follow one property across an address-string change
 * ("123 Main Rd" -> "123 Main Road"). Match on the primary first and fall
 * back to the secondary — never the reverse, and never the secondary alone.
 *
 * Neither key is a safe basis for DELETING a row. See `isSameRecord` for
 * the deliberately stricter test the deduper uses.
 */

import { Listing } from "./types";

/** The fields identity depends on. Accepts a full Listing or a partial row. */
export type IdentifiableListing = Pick<Listing, "address" | "city" | "province"> &
  Partial<Pick<Listing, "mlsNumber">>;

/**
 * Casefold + collapse whitespace and punctuation. Deliberately conservative:
 * it does NOT expand or abbreviate street types ("Rd" stays distinct from
 * "Road"), because guessing there merges rows on a hunch. Following a
 * property across that kind of rename is what the MLS secondary key is for.
 */
function norm(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * PRIMARY identity. Two rows sharing this key are the same property.
 * Safe to use as a Map key for retention, and as the match key for upsert.
 */
export function listingKey(l: IdentifiableListing): string {
  return `${norm(l.address)}|${norm(l.city)}|${norm(l.province)}`;
}

/**
 * SECONDARY identity — the provider's record id, province-scoped. Null when
 * the row carries no MLS number (7 rows in the live store as of 2026-08).
 *
 * Province-scoped rather than global because a bare numeric id can collide
 * across provinces. It can still collide across BOARDS inside one province,
 * which is precisely why this is a fallback and never the primary key.
 */
export function listingMlsKey(l: IdentifiableListing): string | null {
  const mls = norm(l.mlsNumber);
  if (!mls) return null;
  return `${norm(l.province)}|${mls}`;
}

/**
 * Are these two rows PROVABLY the same stored record?
 *
 * This is the only test that may authorize dropping a row. It is stricter
 * than `listingKey` on purpose: it compares every own field, so it can only
 * ever remove a row that carries no information the survivor lacks.
 *
 * The 2026-08 store held 2,316 rows across 2,223 slugs — 93 excess. 92 of
 * those were byte-identical duplicates and one slug (Newark's
 * `105-107-broad-st`) held two genuinely different properties, with
 * different MLS numbers and prices. A looser rule keyed on MLS or address
 * would have deleted one of the Newark pair. Exact-equality removes all 92
 * with zero judgement calls, so there is no reason to reach for a rule that
 * can be wrong.
 */
export function isSameRecord(a: Listing, b: Listing): boolean {
  if (a === b) return true;
  return canonicalize(a) === canonicalize(b);
}

/**
 * Key-order-independent serialization, sorted recursively at EVERY depth.
 *
 * DO NOT "simplify" this back to `JSON.stringify(l, Object.keys(l).sort())`.
 * That was the original implementation and it was unsound. When
 * JSON.stringify's second argument is an ARRAY it is not a key ordering —
 * it is a property allow-list, and the spec applies it at every nesting
 * level. A Listing's nested objects (preAssessment, preOffer, preSignals'
 * members) have child keys like `found`, `totalValue`, `finalOffer`, none
 * of which are top-level Listing key names, so every nested object
 * serialized as `{}` and its contents vanished from the comparison:
 *
 *   {address:"1 A St", preAssessment:{found:true,  totalValue:100}}
 *   {address:"1 A St", preAssessment:{found:false, totalValue:999}}
 *     -> both '{"address":"1 A St","preAssessment":{}}'  -> "same record"
 *
 * isSameRecord() is the ONLY test in this codebase allowed to authorize
 * dropping a row, so that defect could have deleted a listing carrying
 * analysis the survivor did not have. Recursive explicit serialization is
 * the fix; it filters nothing.
 */
export function canonicalize(l: Listing): string {
  return stableStringify(l);
}

/**
 * Deterministic JSON: objects emit their keys in sorted order at every
 * depth, arrays keep their order (position is meaningful). Mirrors
 * JSON.stringify's own treatment of the values it cannot represent —
 * `undefined` and functions are omitted from objects and become `null`
 * inside arrays — so this agrees with JSON.stringify on everything except
 * key order, which is the entire point.
 */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") {
    if (typeof value === "undefined" || typeof value === "function") return "null";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const v = record[key];
    if (typeof v === "undefined" || typeof v === "function") continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
  }
  return `{${parts.join(",")}}`;
}
