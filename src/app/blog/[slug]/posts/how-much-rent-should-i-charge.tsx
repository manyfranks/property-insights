import Link from "next/link";

export default function HowMuchRentShouldICharge() {
  return (
    <>
      <p>
        &quot;How much rent should I charge?&quot; is really three questions stacked on
        top of each other: what does this type of unit rent for in this county, what are
        tenants actually paying nearby right now, and what does this specific property
        justify given its condition and features. Skip any one of the three and you either
        leave money on the table or price yourself into a vacancy. This post walks through
        all three anchors using real 2026 county-level rent data, works a full example, and
        covers the actual cost of getting the number wrong.
      </p>

      <h2>Anchor 1: County and Bedroom-Size Baseline (FMR)</h2>
      <p>
        The first anchor is HUD&apos;s Fair Market Rent (FMR), published annually for every
        U.S. county and broken out by bedroom count. FMR targets the 40th percentile of
        local gross rent, so it sits below the market midpoint by design. It is the
        fastest way to get a defensible, current-year rent baseline for a county without
        assembling comps by hand.
      </p>
      <p>
        Our database holds 2026 FMR figures for <strong>3,077 U.S. counties</strong>. The
        national median 2-bedroom FMR is <strong>$1,019/mo</strong>, but county-level
        figures range from $776/mo in the lowest-cost rural counties to $4,214/mo in Santa
        Cruz County, California. There is no substitute for looking up your specific
        county. A national or state average will mislead you in either direction.
      </p>

      <h2>Anchor 2: What Tenants Are Actually Paying (ACS Median Gross Rent)</h2>
      <p>
        The second anchor is the Census Bureau&apos;s American Community Survey (ACS)
        median gross rent, which reports what renters in a county report actually paying
        today, averaged across every existing lease, including long-tenured tenants on
        older, below-market rents.
      </p>
      <p>
        This matters because FMR and ACS median rent are not the same number, and the gap
        between them tells you something useful. Across the{" "}
        <strong>3,069 counties</strong> in our database with both figures, the median
        county&apos;s 2-bedroom FMR runs <strong>19.2% above</strong> its ACS median gross
        rent, and FMR is the higher of the two figures in{" "}
        <strong>94.9% of counties</strong> (2,914 of 3,069). That is the expected direction:
        FMR is calibrated to current market activity, while ACS median rent blends in older
        tenancies that have not turned over in years. If you are pricing a unit for a{" "}
        <em>new</em> tenant, FMR is usually the more relevant of the two numbers. If you
        are checking whether your current rent roll is in line with the broader market,
        ACS median rent is the more relevant comparison.
      </p>
      <p>
        The gap between the two numbers is not uniform. In Santa Cruz County, CA, the
        2-bedroom FMR ($4,214) is nearly double the ACS median gross rent ($2,264), an
        86% gap, likely driven by a large base of long-tenured renters holding leases well
        below today&apos;s asking rents. In Travis County, TX, the gap is much narrower: a
        2-bedroom FMR of $1,852 against an ACS median gross rent of $1,744, only about 6%
        apart, meaning the county&apos;s existing rent roll is already close to current
        market pricing.
      </p>

      <h2>Anchor 3: The Specific Property (Comps)</h2>
      <p>
        County-level figures tell you the market. They do not tell you what your specific
        unit is worth. The third anchor is direct comparison: what similar units, same
        bedroom count, similar condition, similar location within the county, are actually
        listed for and renting at right now. This is where square footage, updated
        kitchens and bathrooms, in-unit laundry, parking, outdoor space, school zone, and
        walkability move the number up or down from the county baseline. No county-level
        dataset, including ours, can substitute for looking at what is actually on the
        market in your specific neighborhood this month.
      </p>

      <h2>Worked Example: A 2-Bedroom in Travis County, TX</h2>
      <p>
        Here is how the three anchors combine in practice, using real Travis County
        (Austin), Texas figures from our database:
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">Anchor</th>
              <th className="text-right py-2 font-medium text-foreground">
                2BR figure (Travis County, TX)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">HUD Fair Market Rent (2026)</td>
              <td className="text-right py-2">$1,852/mo</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">ACS median gross rent (2024)</td>
              <td className="text-right py-2">$1,744/mo</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">ACS median home value (2024), for context</td>
              <td className="text-right py-2">$523,000</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        A landlord with a standard, unrenovated 2-bedroom in Travis County starts with a
        range of roughly $1,744 to $1,852 as the county baseline, narrow enough here that
        either number is a reasonable starting point. From there, the third anchor takes
        over: a recently renovated unit with in-unit laundry and covered parking near
        downtown Austin should price above that range based on comps in that specific
        submarket. An older unit further from job centers, with shared laundry and no
        parking, should price at or below it. The county figures set the range; the comps
        set the exact number.
      </p>
      <p>
        For a specific address rather than a county average, our assessment tool surfaces a
        per-property rent estimate alongside the assessment-gap analysis when you{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          run an address through the site
        </Link>
        , which is the closer equivalent of the &quot;comps&quot; anchor for a property you
        are actually evaluating.
      </p>

      <h2>The Cost of Getting It Wrong</h2>
      <p>
        Rent pricing errors are asymmetric, and the vacancy math shows why. Take a unit
        that should rent at the Travis County 2-bedroom FMR of $1,852/mo.
      </p>
      <ul>
        <li>
          <strong>Overpricing by 10%</strong> (asking $2,037/mo instead of $1,852/mo) that
          costs you one extra month of vacancy while you find a tenant willing to pay it
          erases more than a full year&apos;s worth of the markup. One month vacant is
          $2,037 in lost income against roughly $2,220 in annual gain from the higher rent
          (12 × $185), the math is close to a wash in year one, and negative if the
          vacancy stretches past a month or the unit ultimately re-lets closer to market
          rate anyway.
        </li>
        <li>
          <strong>Underpricing by 10%</strong> (asking $1,667/mo instead of $1,852/mo) has
          no offsetting benefit unless it meaningfully shortens vacancy time you were
          already going to have. If the unit would have leased at market rent within a
          normal search window anyway, underpricing by 10% simply costs $185/mo, or
          roughly $2,220/year, for the life of that tenancy.
        </li>
      </ul>
      <p>
        The practical takeaway is that modest mispricing in either direction is
        forgiving as long as it does not create an extended vacancy. The real damage comes
        from pricing far enough above market that the unit sits empty for two or three
        months, or pricing so far below market that you are giving away hundreds of dollars
        a month for no reason. Anchoring to FMR and ACS data before listing narrows that
        range before you ever show the unit.
      </p>

      <h2>When to Check a Per-Address Estimate</h2>
      <p>
        County-level FMR and ACS figures are the right starting point for a first pass, or
        for comparing markets before you own a property in them. Once you have a specific
        address, especially one with unusual features, recent renovations, or a location
        that differs meaningfully from the county average, it is worth checking a
        per-property estimate rather than relying on the county number alone. That is true
        whether you are setting rent on a property you already own or estimating what a
        property you&apos;re considering buying could realistically bring in.
      </p>
      <p>
        Start with the county baseline for{" "}
        <Link href="/us/texas/travis-county/rent" className="text-foreground hover:opacity-70">
          Travis County, TX
        </Link>
        ,{" "}
        <Link href="/us/texas/harris-county/rent" className="text-foreground hover:opacity-70">
          Harris County, TX
        </Link>
        , or any other county on our{" "}
        <Link href="/us" className="text-foreground hover:opacity-70">
          US housing data hub
        </Link>
        , compare it against local comps, and cross-check your target market&apos;s
        rent-to-price economics against the rest of the country in our{" "}
        <Link href="/us/rankings/rent-to-price" className="text-foreground hover:opacity-70">
          rent-to-price ratio rankings
        </Link>
        .
      </p>
      <p>
        <strong>Data source and snapshot date.</strong> Figures above are HUD Fair Market
        Rent, 2026 vintage, and U.S. Census Bureau ACS 5-year estimates, 2024 vintage, held
        in our database as of 2026-08-08. The vacancy-cost illustration uses the real
        Travis County FMR figure with hypothetical, clearly labeled pricing and vacancy
        assumptions to show the mechanics, not a claim about actual vacancy rates.
      </p>
    </>
  );
}
