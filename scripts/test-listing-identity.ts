/**
 * scripts/test-listing-identity.ts
 *
 * Guards src/lib/listing-identity.ts — the one module allowed to answer
 * "are these two rows the same property?", and therefore the one whose
 * defects can delete a listing.
 *
 * Most of these assertions exist because of a real defect: canonicalize()
 * originally used JSON.stringify's array replacer, which is a property
 * allow-list applied at EVERY nesting depth, not a key ordering. Nested
 * objects serialized as {} and two listings differing only in
 * preAssessment/preOffer compared EQUAL — inside isSameRecord(), the test
 * the deduper relies on to authorize dropping a row. Run with:
 *   npx tsx scripts/test-listing-identity.ts
 */
import { isSameRecord } from "@/lib/listing-identity";
import type { Listing } from "@/lib/types";
const mk = (o: Record<string, unknown>) => ({ address:"1 A St", city:"X", province:"BC", ...o } as unknown as Listing);
let fail = 0;
const t = (name: string, cond: boolean) => { console.log((cond?"  OK   ":"  FAIL ")+name); if(!cond) fail++; };
t("nested field difference is NOT same record", !isSameRecord(mk({preAssessment:{found:true,totalValue:100}}), mk({preAssessment:{found:false,totalValue:999}})));
t("deeply nested difference detected",          !isSameRecord(mk({preOffer:{a:{b:{c:1}}}}), mk({preOffer:{a:{b:{c:2}}}})));
t("array order is significant",                 !isSameRecord(mk({preSignals:["a","b"]}), mk({preSignals:["b","a"]})));
t("array content difference detected",          !isSameRecord(mk({preSignals:["a"]}), mk({preSignals:["a","b"]})));
t("identical nested objects ARE same record",    isSameRecord(mk({preAssessment:{found:true,totalValue:100}}), mk({preAssessment:{found:true,totalValue:100}})));
t("top-level key order irrelevant",              isSameRecord(mk({preOffer:{x:1},dom:3} as Record<string,unknown>), JSON.parse(JSON.stringify({dom:3,province:"BC",city:"X",address:"1 A St",preOffer:{x:1}}))));
t("nested key order irrelevant",                 isSameRecord(mk({preOffer:{x:1,y:2}}), mk({preOffer:{y:2,x:1}})));
t("null vs missing distinguished",              !isSameRecord(mk({preAssessment:null}), mk({})));
t("Newark pair still distinct",                 !isSameRecord(mk({mlsNumber:"4016139",price:224900}), mk({mlsNumber:"26010654",price:254900})));
console.log(fail===0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail===0?0:1);
