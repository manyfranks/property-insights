import Link from "next/link";

export default function UsRentToPriceRatioByCounty() {
  return (
    <>
      <p>
        We computed the rent-to-price ratio — monthly median rent divided by median home
        value — for 3,212 U.S. counties using Census Bureau data, then checked which ones
        clear the classic real-estate &quot;1% rule&quot; (monthly rent at least 1% of purchase
        price). The national median county sits at just <strong>0.467%</strong> — well
        short of the 1% threshold. But <strong>29 counties</strong> clear it, led by{" "}
        <strong>Kinney County, Texas</strong> at 1.551% (an 18.6% annualized gross yield on
        an $82,000 median home). At the other end, in <strong>Dukes County,
        Massachusetts</strong> — Martha&apos;s Vineyard — monthly rent is worth just{" "}
        <strong>0.110%</strong> of the $1.17 million median home value, a 1.3% gross yield
        that only makes sense if you&apos;re underwriting on appreciation, not cash flow.
      </p>
      <p>
        This is a snapshot ratio, not a race between rent growth and price growth — we are
        not claiming rents are rising faster than prices in these counties, only that
        current rent is unusually large or unusually small relative to current price. The
        full methodology, filter criteria, and known limitations are below. We are
        publishing exact figures and source vintages rather than a rounder headline number
        because the underlying data is what makes this citable.
      </p>

      <h2>The National Anchor</h2>
      <p>
        Across all 3,212 counties in our filtered dataset, the median monthly rent-to-price
        ratio is <strong>0.467%</strong>, which annualizes to a <strong>5.60% gross rental
        yield</strong> before taxes, insurance, vacancy, or maintenance. That is the
        baseline against which every county below should be read: a ratio meaningfully
        above 0.467% is a cash-flow-tilted market relative to the rest of the country; a
        ratio meaningfully below it is an appreciation-tilted one.
      </p>

      <h2>Top 15 Cash-Flow Counties (Highest Rent-to-Price Ratio)</h2>
      <p>
        These are the counties where rent is largest relative to home price — the markets
        an investor running the 1% rule would flag first. Every county below clears
        1.10%/month; the top eight clear the 1% rule outright.
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
                Median rent/mo
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
              <td className="py-2 pr-4">
                <Link href="/us/texas/kinney-county" className="text-foreground hover:opacity-70">
                  Kinney County, TX
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$82,000</td>
              <td className="text-right py-2 pr-4">$1,272</td>
              <td className="text-right py-2 pr-4">1.551%</td>
              <td className="text-right py-2">18.61%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Harding County, NM</td>
              <td className="text-right py-2 pr-4">$70,000</td>
              <td className="text-right py-2 pr-4">$1,038</td>
              <td className="text-right py-2 pr-4">1.483%</td>
              <td className="text-right py-2">17.79%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Culberson County, TX</td>
              <td className="text-right py-2 pr-4">$79,300</td>
              <td className="text-right py-2 pr-4">$1,043</td>
              <td className="text-right py-2 pr-4">1.315%</td>
              <td className="text-right py-2">15.78%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/georgia/chattahoochee-county" className="text-foreground hover:opacity-70">
                  Chattahoochee County, GA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$102,700</td>
              <td className="text-right py-2 pr-4">$1,348</td>
              <td className="text-right py-2 pr-4">1.313%</td>
              <td className="text-right py-2">15.75%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Cochran County, TX</td>
              <td className="text-right py-2 pr-4">$53,200</td>
              <td className="text-right py-2 pr-4">$697</td>
              <td className="text-right py-2 pr-4">1.310%</td>
              <td className="text-right py-2">15.72%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/west-virginia/mcdowell-county" className="text-foreground hover:opacity-70">
                  McDowell County, WV
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$50,000</td>
              <td className="text-right py-2 pr-4">$643</td>
              <td className="text-right py-2 pr-4">1.286%</td>
              <td className="text-right py-2">15.43%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Stonewall County, TX</td>
              <td className="text-right py-2 pr-4">$48,600</td>
              <td className="text-right py-2 pr-4">$613</td>
              <td className="text-right py-2 pr-4">1.261%</td>
              <td className="text-right py-2">15.14%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Esmeralda County, NV</td>
              <td className="text-right py-2 pr-4">$108,900</td>
              <td className="text-right py-2 pr-4">$1,320</td>
              <td className="text-right py-2 pr-4">1.212%</td>
              <td className="text-right py-2">14.55%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Lamb County, TX</td>
              <td className="text-right py-2 pr-4">$82,400</td>
              <td className="text-right py-2 pr-4">$968</td>
              <td className="text-right py-2 pr-4">1.175%</td>
              <td className="text-right py-2">14.10%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Eureka County, NV</td>
              <td className="text-right py-2 pr-4">$82,600</td>
              <td className="text-right py-2 pr-4">$969</td>
              <td className="text-right py-2 pr-4">1.173%</td>
              <td className="text-right py-2">14.08%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Dickens County, TX</td>
              <td className="text-right py-2 pr-4">$65,300</td>
              <td className="text-right py-2 pr-4">$758</td>
              <td className="text-right py-2 pr-4">1.161%</td>
              <td className="text-right py-2">13.93%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">St. Helena Parish, LA</td>
              <td className="text-right py-2 pr-4">$77,300</td>
              <td className="text-right py-2 pr-4">$870</td>
              <td className="text-right py-2 pr-4">1.125%</td>
              <td className="text-right py-2">13.51%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Oglala Lakota County, SD</td>
              <td className="text-right py-2 pr-4">$52,900</td>
              <td className="text-right py-2 pr-4">$584</td>
              <td className="text-right py-2 pr-4">1.104%</td>
              <td className="text-right py-2">13.25%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Hudspeth County, TX</td>
              <td className="text-right py-2 pr-4">$64,000</td>
              <td className="text-right py-2 pr-4">$705</td>
              <td className="text-right py-2 pr-4">1.102%</td>
              <td className="text-right py-2">13.22%</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Yukon-Koyukuk Census Area, AK</td>
              <td className="text-right py-2 pr-4">$98,500</td>
              <td className="text-right py-2 pr-4">$1,084</td>
              <td className="text-right py-2 pr-4">1.101%</td>
              <td className="text-right py-2">13.21%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Beyond these 15, a further 14 counties also clear the 1% rule — 29 in total,
        concentrated in rural Texas, the Nevada mining belt, Kansas, and Appalachia. All 29
        share a pattern: very low absolute home values (all under $125,000) rather than
        unusually high rents. A 1%+ ratio here is a function of a thin, cheap housing stock,
        not strong rental demand pricing power.
      </p>

      <h2>Top 15 Appreciation-Tilted Counties (Lowest Rent-to-Price Ratio)</h2>
      <p>
        These are the counties where a dollar of rent buys the least relative to home
        price — almost entirely coastal, mountain-resort, and gateway-city counties where
        buyers are pricing in scarcity and appreciation, not yield. Five-year home price
        appreciation (FHFA HPI, most recent year available vs. five years prior) is shown
        where the county has enough transaction volume for FHFA to publish an index.
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
                Median rent/mo
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Monthly ratio
              </th>
              <th className="text-right py-2 font-medium text-foreground">
                5-yr HPI appreciation
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Dukes County, MA (Martha&apos;s Vineyard)</td>
              <td className="text-right py-2 pr-4">$1,165,800</td>
              <td className="text-right py-2 pr-4">$1,277</td>
              <td className="text-right py-2 pr-4">0.110%</td>
              <td className="text-right py-2">+75.6%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/wyoming/teton-county" className="text-foreground hover:opacity-70">
                  Teton County, WY (Jackson Hole)
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,633,900</td>
              <td className="text-right py-2 pr-4">$1,904</td>
              <td className="text-right py-2 pr-4">0.117%</td>
              <td className="text-right py-2">+25.1%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/massachusetts/nantucket-county" className="text-foreground hover:opacity-70">
                  Nantucket County, MA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,593,800</td>
              <td className="text-right py-2 pr-4">$2,213</td>
              <td className="text-right py-2 pr-4">0.139%</td>
              <td className="text-right py-2">+15.4%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">San Miguel County, CO (Telluride)</td>
              <td className="text-right py-2 pr-4">$720,700</td>
              <td className="text-right py-2 pr-4">$1,149</td>
              <td className="text-right py-2 pr-4">0.159%</td>
              <td className="text-right py-2">+56.5%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Valley County, ID</td>
              <td className="text-right py-2 pr-4">$657,000</td>
              <td className="text-right py-2 pr-4">$1,117</td>
              <td className="text-right py-2 pr-4">0.170%</td>
              <td className="text-right py-2">+79.1%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Pitkin County, CO (Aspen)</td>
              <td className="text-right py-2 pr-4">$1,139,100</td>
              <td className="text-right py-2 pr-4">$2,004</td>
              <td className="text-right py-2 pr-4">0.176%</td>
              <td className="text-right py-2">+66.5%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Marin County, CA</td>
              <td className="text-right py-2 pr-4">$1,507,300</td>
              <td className="text-right py-2 pr-4">$2,668</td>
              <td className="text-right py-2 pr-4">0.177%</td>
              <td className="text-right py-2">+25.4%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/california/san-francisco-county" className="text-foreground hover:opacity-70">
                  San Francisco County, CA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,394,500</td>
              <td className="text-right py-2 pr-4">$2,476</td>
              <td className="text-right py-2 pr-4">0.178%</td>
              <td className="text-right py-2">+13.7%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Boise County, ID</td>
              <td className="text-right py-2 pr-4">$476,100</td>
              <td className="text-right py-2 pr-4">$850</td>
              <td className="text-right py-2 pr-4">0.179%</td>
              <td className="text-right py-2">+62.8%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Custer County, ID</td>
              <td className="text-right py-2 pr-4">$381,700</td>
              <td className="text-right py-2 pr-4">$691</td>
              <td className="text-right py-2 pr-4">0.181%</td>
              <td className="text-right py-2">+65.7%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Blaine County, ID (Sun Valley)</td>
              <td className="text-right py-2 pr-4">$735,300</td>
              <td className="text-right py-2 pr-4">$1,338</td>
              <td className="text-right py-2 pr-4">0.182%</td>
              <td className="text-right py-2">+71.6%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Elbert County, CO</td>
              <td className="text-right py-2 pr-4">$709,800</td>
              <td className="text-right py-2 pr-4">$1,311</td>
              <td className="text-right py-2 pr-4">0.185%</td>
              <td className="text-right py-2">+39.1%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Summit County, UT (Park City)</td>
              <td className="text-right py-2 pr-4">$1,067,700</td>
              <td className="text-right py-2 pr-4">$1,987</td>
              <td className="text-right py-2 pr-4">0.186%</td>
              <td className="text-right py-2">+59.8%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">San Mateo County, CA</td>
              <td className="text-right py-2 pr-4">$1,559,600</td>
              <td className="text-right py-2 pr-4">$2,922</td>
              <td className="text-right py-2 pr-4">0.187%</td>
              <td className="text-right py-2">+22.5%</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Billings County, ND</td>
              <td className="text-right py-2 pr-4">$331,000</td>
              <td className="text-right py-2 pr-4">$621</td>
              <td className="text-right py-2 pr-4">0.188%</td>
              <td className="text-right py-2">n/a (no FHFA index)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Twelve of these 15 counties still posted double-digit five-year home-price
        appreciation — several over 60% — despite gross rental yields under 2.3%. That is
        the appreciation-tilted thesis in one line: buyers in these counties are not being
        compensated with cash flow, they are betting the price keeps climbing.
      </p>

      <h2>What This Means for Investors vs. Homebuyers</h2>
      <ul>
        <li>
          <strong>For cash-flow investors, the 1% rule points at rural and
          low-cost counties, not necessarily good rental businesses.</strong> All 29
          counties that clear 1% monthly have median home values under $125,000 and thin
          populations. A high ratio here usually reflects a cheap, illiquid housing stock —
          harder to finance, harder to exit, and with fewer renters to choose from — not a
          hot rental market. The ratio is a screen, not a verdict.
        </li>
        <li>
          <strong>For appreciation-focused buyers, the lowest-ratio counties confirm
          what the headlines already say about coastal and resort markets</strong> —
          Martha&apos;s Vineyard, Jackson Hole, Aspen, Telluride, Nantucket, Sun Valley, and
          the Bay Area all cluster at the bottom. If you are buying there, you are pricing in
          scarcity and long-run appreciation; the numbers show renting is structurally
          cheaper than owning on a pure cash-flow basis in every one of these counties.
        </li>
        <li>
          <strong>For homebuyers anywhere, the national median (0.467% monthly, 5.6%
          annualized) is a useful sanity check.</strong> If a specific address&apos;s rent
          would clear roughly double the local county&apos;s ratio, that is worth asking why
          — either the county figure is stale, or the property is unusual for its market.
        </li>
      </ul>

      <h2>Methodology</h2>
      <p>
        <strong>Data sources.</strong> Median home value and median gross rent are from the
        U.S. Census Bureau&apos;s American Community Survey (ACS) 5-year estimates, 2024
        vintage (variables B25077 and B25064). Five-year home price appreciation is from the
        Federal Housing Finance Agency&apos;s county-level House Price Index (HPI),
        annual series. All figures are stored in our regional-economics database, ingested
        directly from Census and FHFA.
      </p>
      <p>
        <strong>Rent-to-price ratio.</strong> Calculated as median monthly gross rent ÷
        median home value, per county. Annualized gross yield is this monthly ratio × 12.
        Neither figure nets out property taxes, insurance, vacancy, maintenance, or
        financing costs — it is a gross screening ratio, not a net-yield or cap-rate
        calculation.
      </p>
      <p>
        <strong>Filter criteria and national coverage.</strong> We started from every county
        in our database with regional economic data (3,232 distinct counties) and kept only
        the 3,212 counties where the ACS reports a non-null, non-zero value for{" "}
        <em>both</em> median_home_value and median_gross_rent for the 2024 5-year estimate.
        The ACS suppresses one or both figures for a small number of the lowest-population
        counties, which this filter excludes — those counties simply have no rent-to-price
        ratio in our dataset. 3,212 of 3,232 (99.4%) of tracked counties passed the filter.
      </p>
      <p>
        <strong>The 1% rule.</strong> A widely used real-estate investing heuristic:
        monthly rent at or above 1% of purchase price is treated as a rough cash-flow-positive
        threshold before expenses. 29 of the 3,212 filtered counties (0.9%) meet or exceed
        it.
      </p>
      <p>
        <strong>Margin-of-error caveat on the top cash-flow counties.</strong> Several
        counties at the top of the cash-flow table are very low-population, and ACS 5-year
        estimates for small counties carry wide margins of error. For example, Harding
        County, NM (#2 on our list) reports a median home value of $70,000 with a published
        margin of error of ±$45,240 — nearly two-thirds of the estimate itself. Treat the
        exact rank ordering among the smallest counties as indicative, not precise; the
        broader pattern (very low-cost, rural counties dominating the top of the ratio
        table) is robust even if individual rankings shift within a normal margin of error.
      </p>
      <p>
        <strong>5-year appreciation coverage gap.</strong> FHFA&apos;s county HPI requires
        enough repeat-sales transaction volume to publish an index, so it is unavailable for
        many of the smallest counties — including most of the top cash-flow counties in the
        first table above. Of the 3,212 filtered counties, 2,793 (87%) have a usable 5-year
        HPI series; the gap skews toward the same low-population counties that dominate the
        cash-flow table, which is why most of that table shows no appreciation figure while
        the appreciation-tilted table (all higher-population counties) is fully populated.
      </p>
      <p>
        <strong>HUD Fair Market Rent, used only as a secondary check.</strong> We also
        checked HUD Fair Market Rent (FMR) 2-bedroom figures, which cover 1,193 of the 3,212
        filtered counties. Where both exist, ACS median gross rent and HUD FMR sometimes
        diverge meaningfully — for example, San Francisco County shows $2,476 (ACS) vs.
        $3,604 (HUD FMR), and Marin County shows $2,668 (ACS) vs. $3,604 (HUD FMR). This is
        expected: ACS gross rent measures rent actually being paid across all existing
        tenancies (including long-tenured, below-market leases), while HUD FMR is set off
        current-market rents for new leases. In fast-appreciating high-cost counties, ACS
        rent likely understates what a new tenant would pay today — meaning our
        appreciation-tilted table, if anything, understates how low the true current-market
        rent-to-price ratio is in those counties. We report ACS uniformly across all 3,212
        counties for consistency and note FMR only where it is available, per the above.
      </p>
      <p>
        <strong>Snapshot date.</strong> This analysis was run on 2026-08-08 against the ACS
        2024 5-year and FHFA HPI data held in our system as of that date.
      </p>
      <p>
        Want to check a specific market? Browse{" "}
        <Link href="/us/texas/kinney-county" className="text-foreground hover:opacity-70">
          Kinney County, TX
        </Link>
        ,{" "}
        <Link href="/us/west-virginia/mcdowell-county" className="text-foreground hover:opacity-70">
          McDowell County, WV
        </Link>
        ,{" "}
        <Link href="/us/georgia/chattahoochee-county" className="text-foreground hover:opacity-70">
          Chattahoochee County, GA
        </Link>
        ,{" "}
        <Link href="/us/california/san-francisco-county" className="text-foreground hover:opacity-70">
          San Francisco County, CA
        </Link>
        ,{" "}
        <Link href="/us/wyoming/teton-county" className="text-foreground hover:opacity-70">
          Teton County, WY
        </Link>
        , or{" "}
        <Link href="/us/massachusetts/nantucket-county" className="text-foreground hover:opacity-70">
          Nantucket County, MA
        </Link>{" "}
        for the full economic profile behind these numbers, or run any address through our{" "}
        <Link href="/tools/assessment-gap" className="text-foreground hover:opacity-70">
          assessment-gap tool
        </Link>{" "}
        to see how a specific listing compares to its assessed value.
      </p>
    </>
  );
}
