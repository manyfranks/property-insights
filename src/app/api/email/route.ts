import { NextResponse } from "next/server";

export async function POST() {
  // Stub endpoint for future Resend batch sending
  // Will be triggered by cron to send city digest emails
  const hasResend = !!process.env.RESEND_API_KEY;

  return NextResponse.json({
    ok: true,
    resendConfigured: hasResend,
    message: "Email endpoint ready. Cron-triggered digest coming soon.",
  });
}
