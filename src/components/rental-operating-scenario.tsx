"use client";

import { useMemo, useState } from "react";
import {
  buildFinancingScenario,
  buildOperatingScenario,
} from "@/lib/property-intelligence/operating-scenario";

type ExpenseKey =
  | "vacancy"
  | "taxes"
  | "insurance"
  | "maintenance"
  | "management"
  | "utilities"
  | "other";

type FinancingKey = "downPayment" | "interest" | "amortization";

const EXPENSE_FIELDS: Array<{
  key: ExpenseKey;
  label: string;
  suffix: string;
  max?: number;
}> = [
  { key: "vacancy", label: "Vacancy", suffix: "%", max: 100 },
  { key: "taxes", label: "Property taxes", suffix: "/mo" },
  { key: "insurance", label: "Insurance", suffix: "/mo" },
  { key: "maintenance", label: "Maintenance", suffix: "/mo" },
  { key: "management", label: "Management", suffix: "/mo" },
  { key: "utilities", label: "Owner-paid utilities", suffix: "/mo" },
  { key: "other", label: "Other operating costs", suffix: "/mo" },
];

function parseInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "CAD" ? "en-CA" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function ScenarioField({
  id,
  label,
  suffix,
  value,
  onChange,
  max,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
}) {
  return (
    <label htmlFor={id} className="block border border-border rounded-lg p-3 bg-white">
      <span className="block text-xs text-muted mb-1.5">{label}</span>
      <span className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          max={max}
          step="any"
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 12))}
          placeholder="0"
          className="min-w-0 w-full rounded-md border border-border bg-gray-50 px-2.5 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />
        <span className="shrink-0 text-xs text-muted">{suffix}</span>
      </span>
    </label>
  );
}

export default function RentalOperatingScenario({
  purchasePrice,
  monthlyRent,
  currency,
}: {
  purchasePrice: number;
  monthlyRent: number | null;
  currency: "CAD" | "USD";
}) {
  const [expenses, setExpenses] = useState<Record<ExpenseKey, string>>({
    vacancy: "",
    taxes: "",
    insurance: "",
    maintenance: "",
    management: "",
    utilities: "",
    other: "",
  });
  const [includeFinancing, setIncludeFinancing] = useState(false);
  const [financingInputs, setFinancingInputs] = useState<Record<FinancingKey, string>>({
    downPayment: "",
    interest: "",
    amortization: "",
  });

  const operating = useMemo(() => buildOperatingScenario({
    purchasePrice,
    monthlyRent: monthlyRent ?? 0,
    vacancyRatePct: parseInput(expenses.vacancy),
    monthlyPropertyTaxes: parseInput(expenses.taxes),
    monthlyInsurance: parseInput(expenses.insurance),
    monthlyMaintenance: parseInput(expenses.maintenance),
    monthlyManagement: parseInput(expenses.management),
    monthlyUtilities: parseInput(expenses.utilities),
    monthlyOtherCosts: parseInput(expenses.other),
  }), [expenses, monthlyRent, purchasePrice]);

  const financing = useMemo(() => operating && includeFinancing
    ? buildFinancingScenario(purchasePrice, operating, {
        downPaymentPct: parseInput(financingInputs.downPayment),
        annualInterestRatePct: parseInput(financingInputs.interest),
        amortizationYears: parseInput(financingInputs.amortization),
      })
    : null, [financingInputs, includeFinancing, operating, purchasePrice]);

  const setExpense = (key: ExpenseKey, value: string) => {
    setExpenses((current) => ({ ...current, [key]: value }));
  };
  const setFinancing = (key: FinancingKey, value: string) => {
    setFinancingInputs((current) => ({ ...current, [key]: value }));
  };

  return (
    <details className="group border border-border rounded-lg overflow-hidden mb-5" data-p5-operating-scenario="collapsed">
      <summary className="cursor-pointer list-none px-4 py-3.5 bg-gray-50 flex items-center justify-between gap-4 hover:bg-gray-100">
        <span>
          <span className="block text-xs uppercase tracking-widest text-muted">Optional operating scenario</span>
          <span className="block text-sm font-medium mt-0.5">Add costs, NOI, cap rate, and financing</span>
        </span>
        <span className="flex items-center gap-2 text-sm text-muted">
          <span>Expand</span>
          <span aria-hidden="true" className="text-lg transition-transform group-open:rotate-45">+</span>
        </span>
      </summary>

      <div className="border-t border-border p-4 sm:p-5">
        <p className="text-sm text-muted mb-4">
          Every field below is your assumption. Complete every operating cost—even when the value is zero—before
          we calculate NOI or cap rate. Blank means unknown, not zero.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {EXPENSE_FIELDS.map((field) => (
            <ScenarioField
              key={field.key}
              id={`rental-operating-${field.key}`}
              label={field.label}
              suffix={field.suffix}
              max={field.max}
              value={expenses[field.key]}
              onChange={(value) => setExpense(field.key, value)}
            />
          ))}
        </div>

        {operating ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-p5-operating-result="complete">
            <ResultCard label="Effective annual income" value={money(operating.annualEffectiveIncome, currency)} />
            <ResultCard label="Annual operating costs" value={money(operating.annualOperatingExpenses, currency)} />
            <ResultCard label="Scenario NOI" value={money(operating.netOperatingIncome, currency)} />
            <ResultCard label="Scenario cap rate" value={`${(operating.capRatePct * 100).toFixed(2)}%`} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted mb-5">
            {monthlyRent
              ? "Complete all seven operating assumptions to calculate NOI and cap rate. Enter 0 when a cost does not apply."
              : "Enter your monthly rent scenario above, then complete all seven operating assumptions."}
          </div>
        )}

        <label className="flex items-start gap-3 border-t border-border pt-4">
          <input
            type="checkbox"
            checked={includeFinancing}
            onChange={(event) => setIncludeFinancing(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">Include a financing scenario</span>
            <span className="block text-xs text-muted mt-0.5">Optional · principal-and-interest only</span>
          </span>
        </label>

        {includeFinancing && (
          <div className="mt-4" data-p5-financing-scenario="enabled">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <ScenarioField
                id="rental-financing-down-payment"
                label="Down payment"
                suffix="%"
                max={100}
                value={financingInputs.downPayment}
                onChange={(value) => setFinancing("downPayment", value)}
              />
              <ScenarioField
                id="rental-financing-interest"
                label="Annual interest rate"
                suffix="%"
                max={100}
                value={financingInputs.interest}
                onChange={(value) => setFinancing("interest", value)}
              />
              <ScenarioField
                id="rental-financing-amortization"
                label="Amortization"
                suffix="years"
                max={100}
                value={financingInputs.amortization}
                onChange={(value) => setFinancing("amortization", value)}
              />
            </div>

            {financing ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-p5-financing-result="complete">
                <ResultCard label="Scenario loan" value={money(financing.loanAmount, currency)} />
                <ResultCard label="Monthly debt service" value={money(financing.monthlyDebtService, currency)} />
                <ResultCard label="Annual cash flow" value={money(financing.annualCashFlow, currency)} />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">
                Complete the operating scenario and all three financing assumptions to calculate debt service and cash flow.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted/80 mt-5">
          Scenario only—not a property fact, appraisal, lease forecast, cap-rate opinion, or cash-flow guarantee.
          Debt service excludes lender fees, mortgage insurance, and variable-rate changes.
        </p>
      </div>
    </details>
  );
}

function ResultCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-gray-50/50">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="font-mono text-lg font-semibold break-words">{value}</div>
    </div>
  );
}
