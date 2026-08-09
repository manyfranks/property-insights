import Link from "next/link";

export default function PropertyTaxRatesByCounty() {
  return (
    <>
      <p>
        We calculated the effective property tax rate, the annual tax bill divided by
        market value, for every US county with usable 2024 Census data: 3,207 counties
        in total. The national median effective rate is <strong>0.79%</strong>, and the
        median annual bill is <strong>$1,595</strong>. At the top of the range, several
        New York and New Jersey counties clear <strong>2.5% or more</strong>. At the
        bottom, a handful of counties in Alabama, Louisiana, and Colorado sit under{" "}
        <strong>0.25%</strong>, less than a third of the national median.
      </p>
      <p>
        This is county-level data from the American Community Survey, not a
        parcel-specific lookup, and the full methodology and limitations are below. We
        are publishing the exact figures and source vintage rather than a rounder
        headline number because the underlying data is what makes this citable.
      </p>

      <h2>The National Median</h2>
      <p>
        Across all 3,207 counties in our dataset, the median effective property tax rate
        is <strong>0.79%</strong> and the mean is <strong>0.90%</strong>. The mean sits
        meaningfully above the median because the distribution has a long right tail: a
        cluster of high-tax counties, concentrated in the Northeast and Illinois, pulls
        the average up without moving the midpoint nearly as much.
      </p>
      <p>
        In dollar terms, the median county-level annual property tax bill is{" "}
        <strong>$1,595</strong>, and the mean is <strong>$1,961</strong>. These are
        county medians built from household-reported figures, not average tax bills for
        every home nationally, so they should be read as &quot;half of US counties have
        a typical bill below this,&quot; not as a national average across all
        households.
      </p>

      <h2>Top 10 Counties by Effective Property Tax Rate</h2>
      <p>
        These are the ten counties with the highest ratio of annual property tax to home
        value, filtered to counties where the Census margin of error is small enough
        (under 30% of the estimate) to trust the ranking. New York and New Jersey account
        for nine of the ten spots.
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">County</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Effective rate
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Median home value
              </th>
              <th className="text-right py-2 font-medium text-foreground">
                Median annual bill
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/wisconsin/menominee-county/property-tax" className="text-foreground hover:opacity-70">
                  Menominee County, WI
                </Link>
              </td>
              <td className="text-right py-2 pr-4">3.56%</td>
              <td className="text-right py-2 pr-4">$110,200</td>
              <td className="text-right py-2">$3,926</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-jersey/salem-county/property-tax" className="text-foreground hover:opacity-70">
                  Salem County, NJ
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.93%</td>
              <td className="text-right py-2 pr-4">$239,500</td>
              <td className="text-right py-2">$7,018</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-york/allegany-county/property-tax" className="text-foreground hover:opacity-70">
                  Allegany County, NY
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.92%</td>
              <td className="text-right py-2 pr-4">$101,700</td>
              <td className="text-right py-2">$2,968</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-jersey/camden-county/property-tax" className="text-foreground hover:opacity-70">
                  Camden County, NJ
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.83%</td>
              <td className="text-right py-2 pr-4">$287,100</td>
              <td className="text-right py-2">$8,134</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-york/orleans-county/property-tax" className="text-foreground hover:opacity-70">
                  Orleans County, NY
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.72%</td>
              <td className="text-right py-2 pr-4">$140,800</td>
              <td className="text-right py-2">$3,823</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-york/cattaraugus-county/property-tax" className="text-foreground hover:opacity-70">
                  Cattaraugus County, NY
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.64%</td>
              <td className="text-right py-2 pr-4">$113,100</td>
              <td className="text-right py-2">$2,991</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-york/monroe-county/property-tax" className="text-foreground hover:opacity-70">
                  Monroe County, NY
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.63%</td>
              <td className="text-right py-2 pr-4">$213,700</td>
              <td className="text-right py-2">$5,616</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/new-jersey/gloucester-county/property-tax" className="text-foreground hover:opacity-70">
                  Gloucester County, NJ
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.60%</td>
              <td className="text-right py-2 pr-4">$310,400</td>
              <td className="text-right py-2">$8,055</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/illinois/lake-county/property-tax" className="text-foreground hover:opacity-70">
                  Lake County, IL
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.58%</td>
              <td className="text-right py-2 pr-4">$345,700</td>
              <td className="text-right py-2">$8,923</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Link href="/us/new-york/cortland-county/property-tax" className="text-foreground hover:opacity-70">
                  Cortland County, NY
                </Link>
              </td>
              <td className="text-right py-2 pr-4">2.56%</td>
              <td className="text-right py-2 pr-4">$162,100</td>
              <td className="text-right py-2">$4,149</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Notice the pattern in the dollar column: several of these counties have below-
        or near-national-median home values ($182,300 nationally), yet above-median tax
        bills. Menominee County, WI is the clearest case: a $110,200 median home value,
        well below the national figure, paired with a $3,926 median bill, roughly two
        and a half times the national median bill. A high effective rate does not require
        an expensive home to produce a large bill.
      </p>

      <h2>Bottom 10 Counties by Effective Property Tax Rate</h2>
      <p>
        These are the ten lowest reliable effective rates in the dataset (excluding
        counties where the Census margin of error is too wide to trust the estimate).
        Alabama, Louisiana, and Colorado each place multiple counties here, alongside
        two high-value Hawaii counties whose low rate reflects state tax policy rather
        than low home prices.
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">County</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Effective rate
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Median home value
              </th>
              <th className="text-right py-2 font-medium text-foreground">
                Median annual bill
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/louisiana/east-feliciana-parish/property-tax" className="text-foreground hover:opacity-70">
                  East Feliciana Parish, LA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.15%</td>
              <td className="text-right py-2 pr-4">$228,100</td>
              <td className="text-right py-2">$339</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/hawaii/maui-county/property-tax" className="text-foreground hover:opacity-70">
                  Maui County, HI
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.16%</td>
              <td className="text-right py-2 pr-4">$904,700</td>
              <td className="text-right py-2">$1,466</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/alabama/choctaw-county/property-tax" className="text-foreground hover:opacity-70">
                  Choctaw County, AL
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.17%</td>
              <td className="text-right py-2 pr-4">$123,400</td>
              <td className="text-right py-2">$207</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/colorado/jackson-county/property-tax" className="text-foreground hover:opacity-70">
                  Jackson County, CO
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.17%</td>
              <td className="text-right py-2 pr-4">$239,600</td>
              <td className="text-right py-2">$416</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/louisiana/avoyelles-parish/property-tax" className="text-foreground hover:opacity-70">
                  Avoyelles Parish, LA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.20%</td>
              <td className="text-right py-2 pr-4">$122,400</td>
              <td className="text-right py-2">$249</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/alabama/bibb-county/property-tax" className="text-foreground hover:opacity-70">
                  Bibb County, AL
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.20%</td>
              <td className="text-right py-2 pr-4">$145,700</td>
              <td className="text-right py-2">$298</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/alabama/clay-county/property-tax" className="text-foreground hover:opacity-70">
                  Clay County, AL
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.21%</td>
              <td className="text-right py-2 pr-4">$156,700</td>
              <td className="text-right py-2">$331</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/hawaii/kauai-county/property-tax" className="text-foreground hover:opacity-70">
                  Kauai County, HI
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.21%</td>
              <td className="text-right py-2 pr-4">$873,200</td>
              <td className="text-right py-2">$1,866</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/colorado/las-animas-county/property-tax" className="text-foreground hover:opacity-70">
                  Las Animas County, CO
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.23%</td>
              <td className="text-right py-2 pr-4">$237,600</td>
              <td className="text-right py-2">$535</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Link href="/us/north-dakota/slope-county/property-tax" className="text-foreground hover:opacity-70">
                  Slope County, ND
                </Link>
              </td>
              <td className="text-right py-2 pr-4">0.23%</td>
              <td className="text-right py-2 pr-4">$170,000</td>
              <td className="text-right py-2">$387</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The two Hawaii counties are the interesting outliers here. Maui and Kauai have
        median home values well above $850,000, roughly five times the national median,
        yet their effective rates are among the ten lowest in the country. That is a
        function of Hawaii&apos;s state property tax structure, which keeps rates low
        even on expensive homes, not a sign of an undervalued housing market. Everywhere
        else on this list, the low rate pairs with a below-median home value.
      </p>

      <h2>Regional Patterns</h2>
      <p>
        Looking at state-level medians (states with at least 3 counties reporting)
        confirms the same regional pattern the county tables suggest. The five states
        with the highest median county effective rate are New Jersey (2.10%), New York
        (2.04%), Illinois (1.81%), New Hampshire (1.78%), and Connecticut (1.67%). All
        five are Northeast or Midwest states with a heavy reliance on local property tax
        to fund schools and municipal services.
      </p>
      <p>
        The five states with the lowest median county effective rate are Hawaii (0.25%),
        Alabama (0.32%), Colorado (0.39%), Delaware (0.43%), and Louisiana (0.44%). Three
        of those five (Alabama, Colorado, and Louisiana) also placed counties in our
        bottom-10 table above, which is the same signal showing up at two different
        levels of aggregation rather than two independent findings.
      </p>
      <p>
        We are not claiming every county in these states follows the state median. Within
        any state, effective rates vary by county depending on local school funding
        formulas, municipal budgets, and assessment practices. The state-level figures
        describe where the center of the distribution sits, not a rate that applies
        uniformly to every county in that state.
      </p>

      <h2>What This Means for Buyers and Investors</h2>
      <ul>
        <li>
          <strong>A cheap home is not automatically a cheap-to-hold home.</strong>{" "}
          Menominee County, WI has one of the lowest median home values in our top-10
          table and one of the highest tax bills. When comparing markets, run the
          effective rate, not just the purchase price, especially for buy-and-hold
          investment analysis.
        </li>
        <li>
          <strong>An expensive home is not automatically an expensive-to-hold
          home.</strong> Maui and Kauai counties have some of the highest home values
          in the country and some of the lowest effective rates, which materially
          changes the holding-cost math for anyone comparing a Hawaii property to a
          similarly priced property in a high-rate state.
        </li>
        <li>
          <strong>If you are screening markets for investment,</strong> pair effective
          property tax rate with rental yield and appreciation trends rather than
          looking at any one number alone. Our{" "}
          <Link href="/us/rankings/investment" className="text-foreground hover:opacity-70">
            county investment rankings
          </Link>{" "}
          combine multiple signals, including property tax burden, into a single
          comparison across US counties.
        </li>
        <li>
          <strong>If your own bill looks out of line with these figures,</strong> the
          most common cause is a reassessment that overshot current market value. Our{" "}
          <Link href="/tools/appeal-checker" className="text-foreground hover:opacity-70">
            appeal checker
          </Link>{" "}
          walks through whether the gap is large enough to be worth challenging.
        </li>
      </ul>

      <h2>Methodology</h2>
      <p>
        <strong>Data sources.</strong> Median real estate taxes paid and median home
        value are from the US Census Bureau&apos;s American Community Survey (ACS)
        5-year estimates, 2024 vintage (Census tables B25103 and B25077 respectively).
        Both are stored in our regional-economics database, ingested directly from
        Census.
      </p>
      <p>
        <strong>Effective rate.</strong> Calculated as median annual real estate taxes
        paid, divided by median home value, per county. This is a county-level statistic
        built from ACS survey responses, not a parcel-specific tax calculation, and it
        reflects taxes currently being paid across existing households, not necessarily
        the rate a newly purchased home would be billed this year.
      </p>
      <p>
        <strong>Coverage.</strong> 3,207 of 3,209 US counties with ACS data reported both
        a non-null median tax figure and a non-null median home value for 2024 and are
        included in the national median and mean.
      </p>
      <p>
        <strong>Reliability filter for the top-10 and bottom-10 tables.</strong> ACS
        5-year estimates for small counties can carry wide margins of error. We excluded
        any county from the ranked tables where the coefficient of variation on the
        median tax figure (margin of error, divided by 1.645, divided by the estimate)
        exceeded 30%, the Census Bureau&apos;s own threshold for an unreliable estimate.
        This removed a number of very low-tax counties, mostly in Alaska and Puerto
        Rico, where the underlying ACS bracket data could not support a precise rate.
        The remaining ranked counties all have a coefficient of variation of 20% or
        lower.
      </p>
      <p>
        <strong>State medians.</strong> Calculated as the median of each state&apos;s
        county-level effective rates, limited to states with at least 3 counties
        reporting both metrics for 2024.
      </p>
      <p>
        <strong>Snapshot date.</strong> This analysis was run on 2026-08-08 against the
        ACS 2024 5-year data held in our system as of that date.
      </p>
      <p>
        Want the full picture for how these numbers get calculated from an assessed
        value and a mill rate? Read{" "}
        <Link href="/blog/how-property-taxes-are-calculated" className="text-foreground hover:opacity-70">
          how property taxes are calculated
        </Link>
        , or check a specific county&apos;s property tax page, like{" "}
        <Link href="/us/new-york/monroe-county/property-tax" className="text-foreground hover:opacity-70">
          Monroe County, NY
        </Link>{" "}
        or{" "}
        <Link href="/us/hawaii/maui-county/property-tax" className="text-foreground hover:opacity-70">
          Maui County, HI
        </Link>
        , for the local effective rate and median bill.
      </p>
    </>
  );
}
