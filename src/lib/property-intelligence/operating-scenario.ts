export interface OperatingScenarioInputs {
  purchasePrice: number;
  monthlyRent: number;
  vacancyRatePct: number | null;
  monthlyPropertyTaxes: number | null;
  monthlyInsurance: number | null;
  monthlyMaintenance: number | null;
  monthlyManagement: number | null;
  monthlyUtilities: number | null;
  monthlyOtherCosts: number | null;
}

export interface OperatingScenarioResult {
  annualScheduledRent: number;
  annualVacancyLoss: number;
  annualEffectiveIncome: number;
  annualOperatingExpenses: number;
  netOperatingIncome: number;
  capRatePct: number;
}

export interface FinancingScenarioInputs {
  downPaymentPct: number | null;
  annualInterestRatePct: number | null;
  amortizationYears: number | null;
}

export interface FinancingScenarioResult {
  downPayment: number;
  loanAmount: number;
  monthlyDebtService: number;
  annualCashFlow: number;
}

function isNonNegative(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

/**
 * Calculates an operating scenario only when every expense assumption is
 * explicit. Zero means "none"; null means "unknown" and withholds NOI/cap
 * rate instead of silently treating a missing cost as zero.
 */
export function buildOperatingScenario(
  inputs: OperatingScenarioInputs
): OperatingScenarioResult | null {
  if (!Number.isFinite(inputs.purchasePrice) || inputs.purchasePrice <= 0) return null;
  if (!Number.isFinite(inputs.monthlyRent) || inputs.monthlyRent <= 0) return null;
  if (!isNonNegative(inputs.vacancyRatePct) || inputs.vacancyRatePct > 100) return null;

  const monthlyCosts = [
    inputs.monthlyPropertyTaxes,
    inputs.monthlyInsurance,
    inputs.monthlyMaintenance,
    inputs.monthlyManagement,
    inputs.monthlyUtilities,
    inputs.monthlyOtherCosts,
  ];
  if (!monthlyCosts.every(isNonNegative)) return null;

  const annualScheduledRent = inputs.monthlyRent * 12;
  const annualVacancyLoss = annualScheduledRent * (inputs.vacancyRatePct / 100);
  const annualEffectiveIncome = annualScheduledRent - annualVacancyLoss;
  const annualOperatingExpenses = monthlyCosts.reduce<number>((total, cost) => total + cost, 0) * 12;
  const netOperatingIncome = annualEffectiveIncome - annualOperatingExpenses;

  return {
    annualScheduledRent,
    annualVacancyLoss,
    annualEffectiveIncome,
    annualOperatingExpenses,
    netOperatingIncome,
    capRatePct: netOperatingIncome / inputs.purchasePrice,
  };
}

export function monthlyMortgagePayment(
  principal: number,
  annualInterestRatePct: number,
  amortizationYears: number
): number | null {
  if (!Number.isFinite(principal) || principal < 0) return null;
  if (!Number.isFinite(annualInterestRatePct) || annualInterestRatePct < 0 || annualInterestRatePct > 100) return null;
  if (!Number.isFinite(amortizationYears) || amortizationYears <= 0 || amortizationYears > 100) return null;
  if (principal === 0) return 0;

  const paymentCount = amortizationYears * 12;
  const monthlyRate = annualInterestRatePct / 100 / 12;
  if (monthlyRate === 0) return principal / paymentCount;

  const growth = (1 + monthlyRate) ** paymentCount;
  return principal * (monthlyRate * growth) / (growth - 1);
}

/** Financing is supplemental: incomplete financing never invalidates NOI. */
export function buildFinancingScenario(
  purchasePrice: number,
  operating: OperatingScenarioResult,
  inputs: FinancingScenarioInputs
): FinancingScenarioResult | null {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  if (!isNonNegative(inputs.downPaymentPct) || inputs.downPaymentPct > 100) return null;
  if (!isNonNegative(inputs.annualInterestRatePct) || inputs.annualInterestRatePct > 100) return null;
  if (inputs.amortizationYears == null) return null;

  const downPayment = purchasePrice * (inputs.downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const monthlyDebtService = monthlyMortgagePayment(
    loanAmount,
    inputs.annualInterestRatePct,
    inputs.amortizationYears
  );
  if (monthlyDebtService == null) return null;

  return {
    downPayment,
    loanAmount,
    monthlyDebtService,
    annualCashFlow: operating.netOperatingIncome - monthlyDebtService * 12,
  };
}
