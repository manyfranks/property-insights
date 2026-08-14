/**
 * components/insurance/landing/no-lead-auction.tsx
 *
 * "One match, not a lead auction" (mint section) — the design's old-way /
 * new-way diagram. Rendered ONLY when at least one enabled insurance vendor
 * exists for the visitor's country (getVendorsForSurface), since the "one
 * licensed broker" promise is false wherever the actual handoff is a plain
 * mailto/consultation rather than a real vendor match.
 */

const SPAM_AGENT_ROTATIONS = ["-4deg", "3deg", "-2deg", "5deg", "-3deg", "2deg"];

export default function NoLeadAuction({ vendorCount }: { vendorCount: number }) {
  if (vendorCount < 1) return null;

  return (
    <section style={{ background: "#eef6f4" }}>
      <div className="max-w-[1200px] mx-auto px-8 py-24 grid gap-16 lg:grid-cols-[0.9fr_1.1fr] items-center">
        <div>
          <span className="font-mono text-xs" style={{ letterSpacing: "0.08em", color: "#0f766e" }}>
            No lead auction
          </span>
          <h2
            className="mt-4 text-3xl sm:text-[52px] font-semibold text-balance"
            style={{ lineHeight: 1.02, letterSpacing: "-0.03em" }}
          >
            One match. Not a phone that won&apos;t stop ringing.
          </h2>
          <p className="mt-[22px] text-[18px] max-w-md" style={{ lineHeight: 1.6, color: "#4b5563" }}>
            Type your address into most quote sites and you&apos;ll hear from a dozen agents for a week. Not here.
            Your profile goes to a single licensed broker for your region —{" "}
            <strong className="font-semibold" style={{ color: "#1a1a2e" }}>
              never resold to a room of cold-callers.
            </strong>
          </p>
        </div>

        <div className="flex flex-col" style={{ gap: "16px" }}>
          {/* The old way */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "20px", padding: "22px 24px", opacity: 0.92 }}>
            <div
              className="font-mono uppercase"
              style={{ fontSize: "10px", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: "16px" }}
            >
              The old way
            </div>
            {/* Single flex row, no-wrap — matches the design's outer
                `display:flex;align-items:center;gap:14px` exactly (no
                flex-wrap here). Only the chip cluster below wraps
                internally, so the address chip and arrow always stay on
                the same horizontal band as the chips instead of the whole
                cluster dropping to its own line. */}
            <div className="flex items-center" style={{ gap: "14px" }}>
              <span
                className="shrink-0 font-semibold"
                style={{ fontSize: "13px", background: "#f3f4f6", borderRadius: "12px", padding: "12px 14px", color: "#6b7280" }}
              >
                Your address
              </span>
              <svg width="30" height="16" viewBox="0 0 30 16" fill="none" className="shrink-0" aria-hidden="true">
                <path d="M2 8h22M20 3l5 5-5 5" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="flex flex-wrap" style={{ gap: "6px" }}>
                {SPAM_AGENT_ROTATIONS.map((rot, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center"
                    style={{
                      gap: "5px",
                      fontSize: "11.5px",
                      color: "#9ca3af",
                      background: "#f7f7f8",
                      border: "1px solid #eceef0",
                      borderRadius: 9999,
                      padding: "4px 9px",
                      transform: `rotate(${rot})`,
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M4 4h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 2 6a2 2 0 0 1 2-2Z"
                        stroke="#b8bcc4"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Agent
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* With Property Insights */}
          <div
            style={{
              background: "#1a1a2e",
              borderRadius: "20px",
              padding: "22px 24px",
              boxShadow: "0 24px 60px -26px rgba(20,20,31,.6)",
            }}
          >
            <div
              className="font-mono uppercase"
              style={{ fontSize: "10px", letterSpacing: "0.08em", marginBottom: "16px", color: "#7fd8cc" }}
            >
              With Property Insights
            </div>
            <div className="flex items-center" style={{ gap: "14px" }}>
              <span
                className="shrink-0 font-semibold"
                style={{ fontSize: "13px", background: "rgba(255,255,255,.1)", borderRadius: "12px", padding: "12px 14px", color: "#fff" }}
              >
                Your profile
              </span>
              <svg width="30" height="16" viewBox="0 0 30 16" fill="none" className="shrink-0" aria-hidden="true">
                <path d="M2 8h22M20 3l5 5-5 5" stroke="#7fd8cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span
                className="inline-flex items-center font-semibold"
                style={{ gap: "8px", fontSize: "13.5px", borderRadius: 9999, padding: "10px 16px", background: "#7fd8cc", color: "#1a1a2e" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#1a1a2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                1 licensed broker
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
