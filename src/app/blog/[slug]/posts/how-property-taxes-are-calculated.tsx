import Link from "next/link";

export default function HowPropertyTaxesAreCalculated() {
  return (
    <>
      <p>
        Every property tax bill in the US comes from the same three-part formula: an
        assessed value, a tax rate (often expressed in mills), and whatever exemptions
        apply to your property. Multiply the first two together, subtract the third, and
        you get the number on your bill. The confusing part is that each of those three
        pieces is set by a different local authority, on a different schedule, using
        different rules, so the same market value can produce very different tax bills
        depending on where the property sits.
      </p>
      <p>
        This piece walks through each part of the formula, then shows what the numbers
        actually look like nationally using 2024 Census data covering 3,207 US counties.
        We use the effective rate (tax bill divided by market value) throughout, because
        it is the one number that lets you compare two counties fairly even when their
        assessment ratios and mill rates are completely different.
      </p>

      <h2>Assessed Value vs. Market Value</h2>
      <p>
        Market value is what a buyer would actually pay for your home today. Assessed
        value is a government estimate of that value, set by a county or municipal
        assessor, usually as of a fixed date each year rather than the current moment.
        The two numbers are related but rarely identical.
      </p>
      <p>
        Assessors typically use mass appraisal: statistical models built from recent
        comparable sales in your area, not a walk-through of your specific home. That
        makes assessments fast and consistent to produce across thousands of properties,
        but it also means they lag behind fast-moving markets and miss property-specific
        details like a recent renovation or a deferred-maintenance problem. In a rising
        market, assessed value often sits below current market value; in a falling
        market, the reverse can happen for a year or two until the next reassessment
        catches up.
      </p>
      <p>
        Some jurisdictions assess at 100% of market value. Others apply an assessment
        ratio, a fixed fraction (say, a percentage well under 100%) applied to market
        value before the tax rate is calculated. The assessment ratio itself does not
        change how much tax you owe, because the tax rate in that jurisdiction is set to
        produce the intended revenue against that fraction. What it does change is
        whether your assessed value looks close to your home&apos;s market value or far
        below it, which is why comparing raw assessed values across counties is
        misleading without knowing each one&apos;s assessment ratio.
      </p>

      <h2>Mill Rates: The Unit Most People Have Never Heard Of</h2>
      <p>
        Property tax rates are frequently expressed in mills. One mill equals $1 of tax
        per $1,000 of assessed value. A mill rate of 20 means you pay $20 for every
        $1,000 of assessed value, or 2% of assessed value.
      </p>
      <p>
        Mill rates get set by adding up the budgets of every taxing authority with a
        claim on your property: the county, the municipality, the school district, and
        often smaller entities like fire districts, library districts, or water
        authorities. Each one calculates the rate it needs to raise its share of revenue
        against the jurisdiction&apos;s total assessed value, and your bill is the sum of
        all of those individual rates applied to your assessment.
      </p>
      <p>
        This is also the most common reason your tax bill goes up even when your
        home&apos;s value hasn&apos;t changed: a school district passes a bond measure, a
        municipality raises its budget, or the total assessed value in the district
        shrinks (because of new exemptions or a reassessment cycle elsewhere), forcing
        the rate up to hit the same revenue target. Reassessment is the other common
        cause. If your county reassesses on a multi-year cycle and your home&apos;s value
        has risen since the last cycle, a new assessment notice can raise your bill even
        with no change in the mill rate.
      </p>

      <h2>Exemptions</h2>
      <p>
        Most jurisdictions reduce the taxable base before applying the rate. Homestead
        exemptions reduce the assessed value for a primary residence. Additional
        exemptions or reductions commonly exist for seniors, veterans, agricultural land,
        and disabled homeowners. Exemption rules, eligibility, and dollar amounts vary
        widely by state and even by county, so the only reliable way to know what applies
        to a specific property is to check that county assessor&apos;s office directly.
        Exemptions are also one of the few parts of this formula a homeowner can actively
        do something about: many require an application, and unclaimed exemptions are a
        common reason a bill is higher than it needs to be.
      </p>

      <h2>Why the Effective Rate Is the Number That Actually Compares</h2>
      <p>
        Because assessment ratios, mill rates, and exemptions all vary independently by
        jurisdiction, the assessed value and the mill rate on your bill are not
        comparable across county lines on their own. The effective rate strips all of
        that out: it is simply the annual tax bill divided by the property&apos;s market
        value, expressed as a percentage. Two homes worth the same amount, in two
        different counties, can be compared directly on effective rate even if one county
        assesses at a fraction of market value with a high mill rate and the other
        assesses at full value with a low mill rate.
      </p>
      <p>
        We calculated the effective rate for 3,207 US counties using 2024 American
        Community Survey data: median real estate taxes paid (Census table B25103)
        divided by median home value (Census table B25077), per county. The national
        median effective rate is <strong>0.79%</strong>, and the mean is{" "}
        <strong>0.90%</strong> (the mean sits above the median because a smaller number
        of high-rate counties, concentrated in the Northeast and Illinois, pull it up).
        The median annual property tax bill across those same counties is{" "}
        <strong>$1,595</strong>, and the mean is <strong>$1,961</strong>.
      </p>
      <p>
        For a full breakdown of which counties sit at the top and bottom of that range,
        see our companion piece,{" "}
        <Link href="/blog/property-tax-rates-by-county" className="text-foreground hover:opacity-70">
          US property tax rates by county
        </Link>
        .
      </p>

      <h2>A Worked Example</h2>
      <p>
        <Link
          href="/us/washington/yakima-county/property-tax"
          className="text-foreground hover:opacity-70"
        >
          Yakima County, Washington
        </Link>{" "}
        sits almost exactly at the national median: a 0.79% effective rate, a $310,100
        median home value, and a $2,463 median annual tax bill. Assuming (for
        illustration) a jurisdiction that assesses at 100% of market value, that 0.79%
        effective rate corresponds to a combined mill rate of roughly 7.94 mills, meaning
        $7.94 of tax for every $1,000 of assessed value:
      </p>
      <ul>
        <li>Assessed value: $310,100 (100% of market value, in this example)</li>
        <li>Mill rate: 7.94 mills, or $7.94 per $1,000 of assessed value</li>
        <li>
          Tax calculation: $310,100 ÷ 1,000 × 7.94 = $2,462, matching the county&apos;s
          actual $2,463 median bill to within a dollar of rounding
        </li>
      </ul>
      <p>
        Now compare that to a jurisdiction with a higher mill rate but a lower assessment
        ratio.{" "}
        <Link
          href="/us/new-jersey/salem-county/property-tax"
          className="text-foreground hover:opacity-70"
        >
          Salem County, New Jersey
        </Link>{" "}
        has a $239,500 median home value but a $7,018 median tax bill, a 2.93% effective
        rate, nearly four times Yakima County&apos;s. The mill rate and assessment
        practices behind that number differ from Washington&apos;s in ways a raw
        assessed-value comparison would never surface, but the effective rate makes the
        gap immediately obvious.
      </p>

      <h2>What This Means If Your Bill Went Up</h2>
      <p>
        A higher tax bill usually traces back to one of three things: a reassessment that
        raised your assessed value, a taxing authority raising its rate to meet a new
        budget, or a change to an exemption you were previously claiming. The first step
        in understanding a specific increase is separating those causes, since only one
        of them (a reassessment that overshoots current market value) is something you
        can typically challenge.
      </p>
      <ul>
        <li>
          <strong>If your assessed value looks too high relative to what your home
          would actually sell for</strong>, run the numbers through our{" "}
          <Link href="/tools/appeal-checker" className="text-foreground hover:opacity-70">
            appeal checker
          </Link>{" "}
          to see whether the gap is large enough to be worth appealing, plus a
          plain-language walkthrough of the appeal process.
        </li>
        <li>
          <strong>If you want to see how your assessed value compares to an
          asking or market price</strong>, our{" "}
          <Link href="/tools/assessment-gap" className="text-foreground hover:opacity-70">
            assessment-gap calculator
          </Link>{" "}
          shows the percentage gap and what it typically signals.
        </li>
        <li>
          <strong>If you want to see where your county&apos;s effective rate falls
          nationally</strong>, county-level property tax pages are available for every
          US county, including{" "}
          <Link
            href="/us/illinois/lake-county/property-tax"
            className="text-foreground hover:opacity-70"
          >
            Lake County, IL
          </Link>{" "}
          and{" "}
          <Link
            href="/us/alabama/bibb-county/property-tax"
            className="text-foreground hover:opacity-70"
          >
            Bibb County, AL
          </Link>
          , showing the local effective rate, median bill, and how it compares to the
          national figures above.
        </li>
      </ul>

      <h2>Methodology</h2>
      <p>
        <strong>Data sources.</strong> Median real estate taxes paid and median home
        value are from the US Census Bureau&apos;s American Community Survey (ACS)
        5-year estimates, 2024 vintage (Census tables B25103 and B25077 respectively).
        Both figures are stored in our regional-economics database, ingested directly
        from Census.
      </p>
      <p>
        <strong>Effective rate.</strong> Calculated as median annual real estate taxes
        paid, divided by median home value, per county. This is a county-level median
        computed from ACS survey responses, not a parcel-specific tax rate, and it
        reflects taxes actually being paid across existing households (including
        long-held properties with older assessments), not necessarily what a newly
        purchased home would be billed this year.
      </p>
      <p>
        <strong>Coverage.</strong> 3,207 of 3,209 US counties with ACS data reported both
        a non-null median tax figure and a non-null median home value for 2024 and are
        included in the national median and mean above.
      </p>
      <p>
        <strong>Snapshot date.</strong> This analysis was run on 2026-08-08 against the
        ACS 2024 5-year data held in our system as of that date.
      </p>
    </>
  );
}
