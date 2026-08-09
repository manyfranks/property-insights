import Link from "next/link";

export default function OnePercentRuleRealEstate() {
  return (
    <>
      <p>
        The &quot;1% rule&quot; is a quick screening test real estate investors use before
        digging into a specific deal: take the property&apos;s expected monthly rent, divide
        it by the purchase price, and see if the result is at least 1%. A $200,000 property
        renting for $2,000 a month clears it. A $200,000 property renting for $1,400 a month
        does not.
      </p>
      <p>
        We ran that exact test across every U.S. county in our rankings dataset, comparing
        HUD&apos;s 2026 Fair Market Rent for a 2-bedroom unit against each county&apos;s 2024
        Census median home value. Out of <strong>3,071 counties</strong>, just{" "}
        <strong>155 clear the 1% rule</strong>, about <strong>5.0%</strong>. The national
        median county sits at <strong>0.572%</strong> monthly, a{" "}
        <strong>6.86%</strong> annualized gross yield, well under the bar. Below is exactly
        which counties pass, why they pass, and what to check instead of chasing a single
        threshold.
      </p>

      <h2>What the 1% Rule Actually Measures</h2>
      <p>
        The math is simple on purpose. Monthly rent divided by purchase price, expressed as a
        percentage:
      </p>
      <p>
        <strong>Monthly rent-to-price ratio = Monthly rent &divide; Purchase price</strong>
      </p>
      <p>
        Multiply that ratio by 12 and you get an annualized gross yield, before taxes,
        insurance, vacancy, maintenance, or financing costs are subtracted out. It is not a
        cap rate and it is not a cash-flow projection. It is a filter, built to answer one
        narrow question fast: is this property&apos;s rent large enough relative to its price
        to be worth a closer look, or should you move on?
      </p>

      <h2>Where the Rule Came From, and Why It Is a Screen, Not a Verdict</h2>
      <p>
        The 1% rule (and its looser cousin, the 2% rule for smaller, higher-risk markets)
        emerged from landlord forums and investing books in the 2000s and 2010s, back when a
        much larger share of the country&apos;s housing stock actually cleared it. It was
        never meant to replace an underwrite. It was meant to save you the time of underwriting
        properties that had no realistic path to cash flow in the first place.
      </p>
      <p>
        That distinction matters more in 2026 than it did when the rule was popularized. Home
        prices have climbed faster than rents across most of the country for over a decade, so
        a rule calibrated to an earlier market now screens out the vast majority of U.S. real
        estate, including plenty of properties that are still perfectly reasonable
        buy-and-hold investments once you look at appreciation and risk alongside yield.
        Treating a failed 1% test as a hard &quot;no&quot; throws away that information.
      </p>

      <h2>The 2026 Reality: Only 1 County in 20 Clears It</h2>
      <p>
        Using HUD&apos;s 2026 Fair Market Rent (2-bedroom) against Census ACS 2024 median home
        value across 3,071 counties with both figures on record, <strong>155 counties
        (5.0%)</strong> meet or beat the 1% monthly threshold. A further{" "}
        <strong>818 counties (26.6%)</strong> clear a lower 0.7% bar, which is a more realistic
        screening line in most of today&apos;s market. The top 15 counties by ratio:
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">County</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Median home value
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                HUD FMR (2BR)/mo
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Monthly ratio
              </th>
              <th className="text-right py-2 font-medium text-foreground">
                Annualized yield
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Stonewall County, TX</td>
              <td className="text-right py-2 pr-4">$48,600</td>
              <td className="text-right py-2 pr-4">$1,015</td>
              <td className="text-right py-2 pr-4">2.088%</td>
              <td className="text-right py-2">25.06%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">King County, TX</td>
              <td className="text-right py-2 pr-4">$52,100</td>
              <td className="text-right py-2 pr-4">$1,015</td>
              <td className="text-right py-2 pr-4">1.948%</td>
              <td className="text-right py-2">23.38%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/arizona/apache-county" className="text-foreground hover:opacity-70">
                  Apache County, AZ
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$63,700</td>
              <td className="text-right py-2 pr-4">$1,175</td>
              <td className="text-right py-2 pr-4">1.845%</td>
              <td className="text-right py-2">22.14%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Cochran County, TX</td>
              <td className="text-right py-2 pr-4">$53,200</td>
              <td className="text-right py-2 pr-4">$973</td>
              <td className="text-right py-2 pr-4">1.829%</td>
              <td className="text-right py-2">21.95%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/south-dakota/oglala-lakota-county" className="text-foreground hover:opacity-70">
                  Oglala Lakota County, SD
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$52,900</td>
              <td className="text-right py-2 pr-4">$929</td>
              <td className="text-right py-2 pr-4">1.756%</td>
              <td className="text-right py-2">21.07%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/west-virginia/mcdowell-county" className="text-foreground hover:opacity-70">
                  McDowell County, WV
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$50,000</td>
              <td className="text-right py-2 pr-4">$869</td>
              <td className="text-right py-2 pr-4">1.738%</td>
              <td className="text-right py-2">20.86%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Todd County, SD</td>
              <td className="text-right py-2 pr-4">$53,900</td>
              <td className="text-right py-2 pr-4">$929</td>
              <td className="text-right py-2 pr-4">1.724%</td>
              <td className="text-right py-2">20.68%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Cottle County, TX</td>
              <td className="text-right py-2 pr-4">$59,300</td>
              <td className="text-right py-2 pr-4">$1,015</td>
              <td className="text-right py-2 pr-4">1.712%</td>
              <td className="text-right py-2">20.54%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Eureka County, NV</td>
              <td className="text-right py-2 pr-4">$82,600</td>
              <td className="text-right py-2 pr-4">$1,393</td>
              <td className="text-right py-2 pr-4">1.686%</td>
              <td className="text-right py-2">20.24%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Alexander County, IL</td>
              <td className="text-right py-2 pr-4">$59,800</td>
              <td className="text-right py-2 pr-4">$992</td>
              <td className="text-right py-2 pr-4">1.659%</td>
              <td className="text-right py-2">19.91%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Wibaux County, MT</td>
              <td className="text-right py-2 pr-4">$98,600</td>
              <td className="text-right py-2 pr-4">$1,548</td>
              <td className="text-right py-2 pr-4">1.570%</td>
              <td className="text-right py-2">18.84%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">St. Helena Parish, LA</td>
              <td className="text-right py-2 pr-4">$77,300</td>
              <td className="text-right py-2 pr-4">$1,204</td>
              <td className="text-right py-2 pr-4">1.558%</td>
              <td className="text-right py-2">18.69%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Hudspeth County, TX</td>
              <td className="text-right py-2 pr-4">$64,000</td>
              <td className="text-right py-2 pr-4">$973</td>
              <td className="text-right py-2 pr-4">1.520%</td>
              <td className="text-right py-2">18.24%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Stewart County, GA</td>
              <td className="text-right py-2 pr-4">$65,100</td>
              <td className="text-right py-2 pr-4">$973</td>
              <td className="text-right py-2 pr-4">1.495%</td>
              <td className="text-right py-2">17.94%</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Dickens County, TX</td>
              <td className="text-right py-2 pr-4">$65,300</td>
              <td className="text-right py-2 pr-4">$973</td>
              <td className="text-right py-2 pr-4">1.490%</td>
              <td className="text-right py-2">17.88%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        See the full ranked list, including every county below the top 15, on our{" "}
        <Link href="/us/rankings/rent-to-price" className="text-foreground hover:opacity-70">
          rent-to-price rankings page
        </Link>
        .
      </p>

      <h2>Why These Counties Pass: Cheap Homes, Not Hot Rents</h2>
      <p>
        Look closely at the table above and a pattern jumps out: every single county on it has
        a median home value under $100,000. Across all 155 counties that clear the 1% rule,{" "}
        <strong>149 (96.1%)</strong> have a median home value under $125,000, and the highest
        home value among all 155 passing counties is $174,800. That is the honest read on the
        1% rule in 2026: it is mostly finding cheap, thin housing markets, not markets with
        unusually strong rental demand pricing power. A county can pass the test with modest
        rent as long as the home price is low enough.
      </p>
      <p>
        These counties also cluster geographically. Of the 155 that pass, <strong>Texas
        alone has 43</strong>, followed by <strong>Georgia with 25</strong>, then Kansas and
        Kentucky with 12 each, and South Dakota with 7:
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">State</th>
              <th className="text-right py-2 font-medium text-foreground">
                Counties passing the 1% rule
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/rankings/rent-to-price/texas" className="text-foreground hover:opacity-70">
                  Texas
                </Link>
              </td>
              <td className="text-right py-2">43</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/rankings/rent-to-price/georgia" className="text-foreground hover:opacity-70">
                  Georgia
                </Link>
              </td>
              <td className="text-right py-2">25</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Kansas</td>
              <td className="text-right py-2">12</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Kentucky</td>
              <td className="text-right py-2">12</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Link href="/us/rankings/rent-to-price/south-dakota" className="text-foreground hover:opacity-70">
                  South Dakota
                </Link>
              </td>
              <td className="text-right py-2">7</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Rural West Texas, the Nevada mining belt, the Black Belt counties of Georgia and
        Alabama, and reservation counties in South Dakota make up most of the list. These are
        thin markets: small populations, limited buyer pools, and housing stock that has not
        appreciated the way coastal and Sun Belt metros have. A high ratio there reflects a
        cheap, illiquid market more than a thriving rental business, and a thin market can also
        mean fewer qualified tenants and a harder resale if you ever need to exit.
      </p>
      <p>
        We covered a related but distinct cut of this same question in an earlier analysis
        using Census ACS actual-rent data instead of HUD&apos;s Fair Market Rent estimate; see{" "}
        <Link href="/blog/us-rent-to-price-ratio-by-county" className="text-foreground hover:opacity-70">
          our rent-to-price ratio breakdown by county
        </Link>{" "}
        for that companion dataset. The two data sources produce different exact rankings
        (ACS reports rent actually being paid on existing leases, HUD FMR estimates what a new
        lease would cost today), but they tell the same underlying story: a small, low-cost
        slice of the country still clears the 1% bar, and it clears it mostly on price, not
        rent.
      </p>

      <h2>What to Use Instead of a Hard 1% Bar</h2>
      <p>
        If only 5% of counties pass a strict 1% screen, using it as a pass-or-fail gate cuts
        out 95% of the country, including plenty of counties with strong long-term
        fundamentals that simply do not have $60,000 homes. A more useful approach is to treat
        yield as one input among several, not the whole decision:
      </p>
      <ul>
        <li>
          <strong>Gross yield</strong> (what the 1% rule approximates) tells you how much cash
          flow a property could generate relative to its price, before expenses.
        </li>
        <li>
          <strong>5-year home price appreciation</strong> tells you whether the county has been
          gaining or losing value, which matters for your exit and your equity growth, not
          just your monthly cash flow.
        </li>
        <li>
          <strong>Disaster risk, vacancy, and typical days-on-market</strong> tell you how
          risky and how liquid the market actually is, factors a pure rent-to-price ratio
          ignores completely.
        </li>
      </ul>
      <p>
        We built a composite score that blends exactly those factors, weighted 35% yield, 25%
        appreciation, 20% risk, 10% vacancy, and 10% days-on-market, across 2,724 scored
        counties. Browse the results on our{" "}
        <Link href="/us/rankings/investment" className="text-foreground hover:opacity-70">
          investment scorecard
        </Link>
        , which surfaces counties that score well on the whole picture, not just on a single
        ratio.
      </p>

      <h2>How to Use This If You Are Actually Underwriting a Deal</h2>
      <p>
        A county-level pass on the 1% rule is a starting point, not a purchase decision. Once a
        county looks promising, the next steps are to check the actual rent range for the
        specific bedroom count you are considering on our{" "}
        <Link href="/us/texas/stonewall-county/rent" className="text-foreground hover:opacity-70">
          county rent pages
        </Link>
        , then run the specific address you are evaluating through a full assessment so you are
        working from a real purchase price and real comparable data instead of a county
        average.
      </p>

      <h2>Methodology</h2>
      <p>
        <strong>Data sources.</strong> Monthly rent is HUD&apos;s Fair Market Rent for a
        2-bedroom unit, 2026 vintage. Median home value is the U.S. Census Bureau&apos;s
        American Community Survey (ACS) 5-year estimate, 2024 vintage (variable B25077). Both
        are stored in our regional-economics database, the same dataset that backs our{" "}
        <Link href="/us/rankings/rent-to-price" className="text-foreground hover:opacity-70">
          rent-to-price rankings tool
        </Link>
        .
      </p>
      <p>
        <strong>Coverage.</strong> 3,071 counties have both a fmr_2br and a median_home_value
        figure on record and are included in this analysis. Counties missing either figure are
        excluded rather than estimated.
      </p>
      <p>
        <strong>The 1% rule.</strong> Monthly ratio = HUD FMR (2BR) &divide; median home value.
        A county &quot;passes&quot; when that ratio is 1.00% or higher. 155 of 3,071 counties
        (5.0%) pass. A secondary, more realistic 0.7% threshold is cleared by 818 counties
        (26.6%). The national median monthly ratio across all 3,071 counties is 0.572%, a 6.86%
        annualized gross yield.
      </p>
      <p>
        <strong>Honest cross-vintage caveat.</strong> HUD republishes Fair Market Rent every
        year and this analysis uses the 2026 figures. Census ACS median home values are a
        slower-moving 5-year-estimate series and this analysis uses 2024 data, typically a year
        or two behind the rent figure it is divided against. That gap means every ratio here is
        an approximation of today&apos;s true rent-to-price relationship, not a same-year
        snapshot. In a market where prices have risen quickly since 2024, the true current
        ratio is probably lower than shown; where prices have fallen or stalled, it is probably
        higher. Treat this as a screening signal, not a precise point-in-time yield calculation
        for a specific property.
      </p>
      <p>
        <strong>Snapshot date.</strong> This analysis was run on 2026-08-08 against the HUD FMR
        2026 and Census ACS 2024 data held in our system as of that date.
      </p>
      <p>
        Explore the full list on our{" "}
        <Link href="/us/rankings/rent-to-price" className="text-foreground hover:opacity-70">
          rent-to-price rankings
        </Link>
        , see how yield, appreciation, and risk combine on our{" "}
        <Link href="/us/rankings/investment" className="text-foreground hover:opacity-70">
          investment scorecard
        </Link>
        , or check the county profile for{" "}
        <Link href="/us/arizona/apache-county" className="text-foreground hover:opacity-70">
          Apache County, AZ
        </Link>
        ,{" "}
        <Link href="/us/south-dakota/oglala-lakota-county" className="text-foreground hover:opacity-70">
          Oglala Lakota County, SD
        </Link>
        , or{" "}
        <Link href="/us/west-virginia/mcdowell-county" className="text-foreground hover:opacity-70">
          McDowell County, WV
        </Link>
        .
      </p>
    </>
  );
}
