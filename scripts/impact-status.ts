// Poll Impact Publisher API for program/application status.
// Prints each contracted campaign with its status and default tracking link —
// a campaign appearing here means the brand approved our application.
import { loadEnvLocal } from "./lib/ingest-shared";

loadEnvLocal();
const sid = process.env.IMPACT_API_KEY;
const token = process.env.IMPACT_AUTH_TOKEN;
if (!sid || !token) throw new Error("IMPACT_API_KEY / IMPACT_AUTH_TOKEN not found in .env.local");

const main = async () => {
  const res = await fetch(`https://api.impact.com/Mediapartners/${sid}/Campaigns`, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
  });
  if (!res.ok) throw new Error(`Impact API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const campaigns = data.Campaigns ?? [];
  console.log(`campaigns: ${campaigns.length}`);
  for (const c of campaigns) {
    console.log(
      [
        c.AdvertiserName,
        `campaign=${c.CampaignName}`,
        `id=${c.CampaignId}`,
        `contract=${c.ContractStatus}`,
        `trackingLink=${c.TrackingLink ?? "n/a"}`,
      ].join(" | ")
    );
  }
};
main();
