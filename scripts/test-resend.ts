// One-off: verify RESEND_API_KEY works locally (npx tsx scripts/test-resend.ts <to>)
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

const main = async () => {
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const to = process.argv[2] || "mfrancis45@gmail.com";
  const { data, error } = await resend.emails.send({
    from: "Property Insights <insights@mail.propertyinsights.xyz>",
    to,
    subject: "Resend local test — Property Insights",
    html: "<p>Local RESEND_API_KEY verification from the dev environment. If you're reading this, email sending works locally.</p>",
  });
  if (error) { console.error("SEND FAILED:", error); process.exit(1); }
  console.log("SENT OK, id:", data?.id);
};
main();
