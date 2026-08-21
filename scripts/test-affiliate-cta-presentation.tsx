import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

let providerCalls = 0;
globalThis.fetch = async () => {
  providerCalls += 1;
  throw new Error("Affiliate presentation fixtures must not call a provider");
};

async function main() {
  Object.assign(process.env, {
    NEXT_PUBLIC_NESTO_URL: "https://www.nesto.ca/?ref=YOUR_ID",
    NODE_ENV: "production",
  });

  const config = await import("../src/config/affiliate-vendors");
  const { default: PartnerCta } = await import("../src/components/partner-cta");
  const { default: PartnerCtaRow } = await import("../src/components/partner-cta-row");
  const squareOne = config.AFFILIATE_VENDORS.find((vendor) => vendor.id === "squareone");
  const apollo = config.AFFILIATE_VENDORS.find((vendor) => vendor.id === "apollo");
  assert.ok(squareOne);
  assert.ok(apollo);

  for (const vendor of [squareOne, apollo]) {
    const presentation = config.affiliateVendorPresentation(vendor, "investor");
    assert.match(presentation.ctaLabel, /landlord/i);
    assert.match(presentation.description, /rental property/i);
  }
  assert.equal(config.affiliateVendorPresentation(squareOne, "buyer").ctaLabel, squareOne.ctaLabel);

  const investorBlock = renderToStaticMarkup(
    <PartnerCta country="CA" state="BC" mode="investor" source="property-page" surface="result-investor" />
  );
  assert.match(investorBlock, /Explore landlord insurance/);
  assert.match(investorBlock, /Explore coverage for your rental property/);
  assert.match(investorBlock, /APOLLO Insurance coverage options for a rental property/);
  assert.doesNotMatch(investorBlock, /Get home insurance/);

  const investorRow = renderToStaticMarkup(
    <PartnerCtaRow country="CA" state="BC" mode="investor" source="property-page" surface="result-investor" />
  );
  assert.match(investorRow, /Square One coverage options for a rental property/);
  assert.match(investorRow, /APOLLO Insurance coverage options for a rental property/);
  assert.equal((investorRow.match(/Rental coverage/g) ?? []).length, 2);

  assert.deepEqual(config.getAffiliateUrl("nesto", "property-page"), {
    url: "https://www.nesto.ca",
    isAffiliate: false,
  });
  const buyerRow = renderToStaticMarkup(
    <PartnerCtaRow country="CA" state="BC" mode="buyer" source="property-page" surface="result-buyer" />
  );
  assert.doesNotMatch(buyerRow, /Sponsored/);
  assert.doesNotMatch(buyerRow, /We may receive compensation/);
  assert.doesNotMatch(buyerRow, /rel="[^"]*sponsored/);

  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    config.assertAffiliateHealth();
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some((message) => /nesto.*PLACEHOLDER affiliate URL/i.test(message)));
  assert.equal(providerCalls, 0);
  console.log("\nAffiliate CTA presentation fixtures passed; provider calls: 0\n");
}

void main();
