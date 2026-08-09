import Link from "next/link";

export default function WhatIsFairMarketRent() {
  return (
    <>
      <p>
        Fair Market Rent (FMR) is a number the U.S. Department of Housing and Urban
        Development publishes every year for every county in the country. It is the
        government&apos;s estimate of what a typical, standard-quality rental unit costs to
        rent right now, including utilities, at roughly the 40th percentile of the local
        market. Its original job is narrow: setting payment caps for Section 8 housing
        vouchers. Its actual use is much wider, because it is one of the only rent
        benchmarks that exists for every county at once, updated annually, and free to
        query.
      </p>
      <p>
        We pulled the full 2026 FMR dataset from our database, which covers{" "}
        <strong>3,077 U.S. counties</strong> across all five HUD bedroom sizes (studio
        through 4-bedroom). This post explains what FMR actually measures, how HUD builds
        it, where it is useful for landlords and investors, where it breaks down, and the
        real national numbers behind it.
      </p>

      <h2>What FMR Actually Measures</h2>
      <p>
        FMR is defined as the 40th percentile of gross rent for standard-quality rental
        units in a given area, where &quot;gross rent&quot; means rent plus a utility
        allowance for tenant-paid utilities like electricity and heat. The 40th percentile
        cutoff is deliberate: HUD sets it below the market median so vouchers can compete
        for a meaningful share of available units without simply funding the top half of
        the rental stock. It is not the average rent, not the cheapest rent, and not the
        rent on luxury or substandard units. It is meant to represent a decent, modest
        apartment that a voucher holder could realistically rent.
      </p>
      <p>
        HUD publishes five FMR figures per county, one for each bedroom count: studio
        (efficiency), 1-bedroom, 2-bedroom, 3-bedroom, and 4-bedroom. The 2-bedroom figure
        is the one most commonly cited as &quot;the&quot; FMR for an area, since it is the
        anchor HUD uses to derive the other bedroom sizes.
      </p>

      <h2>How HUD Calculates It</h2>
      <p>
        HUD builds FMRs mostly from the Census Bureau&apos;s American Community Survey
        (ACS), which asks renters what they actually pay. Because ACS data lags by a year
        or two and can be thin in low-population counties, HUD trends it forward using
        recent Consumer Price Index rent inflation data, and in many rural counties groups
        several counties into a single &quot;FMR area&quot; to get a large enough sample.
        That is why you will sometimes see identical FMR figures across several neighboring
        rural counties, rather than a unique number for each one.
      </p>
      <p>
        The result is republished every October for the following federal fiscal year. Our
        database holds the 2026 vintage, current as of this writing.
      </p>

      <h2>What FMR Is Used For</h2>
      <ul>
        <li>
          <strong>Section 8 / Housing Choice Vouchers.</strong> FMR sets the payment
          standard a local housing authority uses to calculate how much rent subsidy a
          voucher household receives. This is the program FMR was built for.
        </li>
        <li>
          <strong>Small Area FMRs.</strong> In many metro areas, HUD also publishes
          ZIP-code-level Small Area FMRs, which adjust the county figure up or down for
          neighborhood-level rent differences, mainly to prevent voucher holders from being
          concentrated in the cheapest ZIP codes of a metro.
        </li>
        <li>
          <strong>A national, standardized rent baseline.</strong> Outside of housing
          assistance, FMR is useful precisely because it is consistent methodology, updated
          every year, for every county. Investors and landlords use it to sanity-check
          asking rent for a property, or to compare markets without needing a paid rent
          comp service.
        </li>
      </ul>

      <h2>Why It&apos;s a Useful Baseline for Landlords and Investors</h2>
      <p>
        If you are pricing a rental or screening a market you don&apos;t know well, FMR
        gives you a defensible starting point before you ever look at individual comps.
        It is bedroom-size specific, current-year, and covers almost every county with
        meaningful rental stock in the country. For a quick gut check on whether a rent
        estimate for a property is in the right neighborhood, or whether a market&apos;s
        rents can plausibly support a purchase price, FMR is faster to pull than assembling
        comps by hand.
      </p>
      <p>
        It is also, in most counties, closer to what a landlord could charge a{" "}
        <em>new</em> tenant today than the more commonly cited Census ACS &quot;median
        gross rent&quot; figure is. ACS median gross rent averages in every existing lease
        in the county, including tenants who have lived somewhere for years at a rent well
        below today&apos;s market. FMR, by contrast, is calibrated off recent market
        activity. Across the{" "}
        <strong>3,069 counties in our database with both figures</strong>, the median
        county&apos;s 2-bedroom FMR runs <strong>19.2% above</strong> its ACS median gross
        rent, and FMR is higher than ACS rent in <strong>94.9% of counties</strong> (2,914
        of 3,069). If you are pricing a unit for a new lease rather than asking what
        existing tenants pay on average, FMR is usually the more relevant of the two
        numbers.
      </p>

      <h2>2026 National Numbers</h2>
      <p>
        Across the 3,077 counties in our 2026 FMR dataset, the national median rent by
        bedroom size is:
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">
                Bedroom size
              </th>
              <th className="text-right py-2 font-medium text-foreground">
                National median FMR (2026)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">Studio</td>
              <td className="text-right py-2">$774/mo</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">1-bedroom</td>
              <td className="text-right py-2">$831/mo</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">2-bedroom</td>
              <td className="text-right py-2">$1,019/mo</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">3-bedroom</td>
              <td className="text-right py-2">$1,345/mo</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">4-bedroom</td>
              <td className="text-right py-2">$1,552/mo</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The 2-bedroom figure is the one worth remembering: <strong>$1,019/mo</strong>{" "}
        nationally in 2026. But that single number hides an enormous range. The cheapest
        2-bedroom FMR in the country is <strong>$776/mo</strong>, a figure shared by several
        rural Alabama counties including{" "}
        <Link href="/us/alabama/barbour-county" className="text-foreground hover:opacity-70">
          Barbour County
        </Link>
        , Bullock, Clay, Conecuh, Coosa, Covington, Crenshaw, and Dale. The most expensive
        is <strong>$4,214/mo</strong>, in Santa Cruz County, California, more than 5.4 times
        the national floor.
      </p>

      <h2>Six Counties, Six Very Different Markets</h2>
      <p>
        To show how much FMR varies by both geography and bedroom size, here is the full
        2026 schedule for six counties spanning the range, from the national low to the
        national high:
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">County</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">Studio</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">1BR</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">2BR</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">3BR</th>
              <th className="text-right py-2 font-medium text-foreground">4BR</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/alabama/barbour-county" className="text-foreground hover:opacity-70">
                  Barbour County, AL
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$576</td>
              <td className="text-right py-2 pr-4">$693</td>
              <td className="text-right py-2 pr-4">$776</td>
              <td className="text-right py-2 pr-4">$1,017</td>
              <td className="text-right py-2">$1,068</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/texas/harris-county" className="text-foreground hover:opacity-70">
                  Harris County, TX
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,280</td>
              <td className="text-right py-2 pr-4">$1,323</td>
              <td className="text-right py-2 pr-4">$1,573</td>
              <td className="text-right py-2 pr-4">$2,116</td>
              <td className="text-right py-2">$2,639</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/georgia/fulton-county" className="text-foreground hover:opacity-70">
                  Fulton County, GA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,585</td>
              <td className="text-right py-2 pr-4">$1,660</td>
              <td className="text-right py-2 pr-4">$1,820</td>
              <td className="text-right py-2 pr-4">$2,182</td>
              <td className="text-right py-2">$2,605</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/texas/travis-county" className="text-foreground hover:opacity-70">
                  Travis County, TX
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,474</td>
              <td className="text-right py-2 pr-4">$1,562</td>
              <td className="text-right py-2 pr-4">$1,852</td>
              <td className="text-right py-2 pr-4">$2,347</td>
              <td className="text-right py-2">$2,760</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/us/illinois/cook-county" className="text-foreground hover:opacity-70">
                  Cook County, IL
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$1,480</td>
              <td className="text-right py-2 pr-4">$1,581</td>
              <td className="text-right py-2 pr-4">$1,781</td>
              <td className="text-right py-2 pr-4">$2,294</td>
              <td className="text-right py-2">$2,653</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Link href="/us/california/santa-cruz-county" className="text-foreground hover:opacity-70">
                  Santa Cruz County, CA
                </Link>
              </td>
              <td className="text-right py-2 pr-4">$3,179</td>
              <td className="text-right py-2 pr-4">$3,298</td>
              <td className="text-right py-2 pr-4">$4,214</td>
              <td className="text-right py-2 pr-4">$5,377</td>
              <td className="text-right py-2">$5,659</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Santa Cruz County is the most expensive FMR county in the country at every bedroom
        size, driven by its coastal California location and proximity to the Bay Area job
        market. It is also a useful illustration of the FMR-versus-ACS gap above: Santa Cruz
        County&apos;s ACS median gross rent is $2,264, well under half its $4,214 2-bedroom
        FMR. That is not a data error. A large share of Santa Cruz County renters are on
        long-tenured leases signed years ago, which pulls the ACS average down, while FMR
        reflects what a unit would rent for on the open market today.
      </p>

      <h2>Where FMR Falls Short</h2>
      <ul>
        <li>
          <strong>County-level FMR can hide neighborhood variation.</strong> A single
          county figure blends downtown high-demand rentals with cheaper outlying areas.
          HUD&apos;s ZIP-level Small Area FMRs address this in many metros, but our dataset
          tracks the county-level figure, which is the more commonly cited and broadly
          available version.
        </li>
        <li>
          <strong>It targets the 40th percentile, not the median.</strong> FMR is
          deliberately set below the market midpoint. A well-maintained, updated, or
          amenity-rich unit will often rent above FMR even in a normal market. FMR is a
          floor-ish reference point, not a market-rate ceiling.
        </li>
        <li>
          <strong>Rural counties get grouped and smoothed.</strong> Where ACS sample sizes
          are too small for a reliable county-level estimate, HUD groups counties into
          shared FMR areas. That is why identical figures, like the $776 2-bedroom FMR
          shared by eight Alabama counties above, show up across multiple counties at
          once. The number is real, but it represents a region, not a single county&apos;s
          unique market.
        </li>
        <li>
          <strong>It lags real-time market moves.</strong> FMR is set annually using
          trended historical data. In a fast-moving market, actual asking rents can run
          ahead of or behind the published FMR for months before the next annual update
          catches up.
        </li>
      </ul>

      <h2>Using FMR as a Landlord</h2>
      <p>
        FMR by itself is not a rent estimate for a specific property. It is a county-level,
        bedroom-size baseline. To price an actual rental, start with the FMR for the
        bedroom count and county, then adjust up or down for the specific unit: condition,
        amenities, square footage, parking, school zone, and how it compares to nearby
        listings. It is a starting anchor, not a finished number, the same role a
        government assessment plays when pricing a home for sale.
      </p>
      <p>
        For a closer look at what FMR means for a given market, browse the full bedroom
        breakdown for{" "}
        <Link href="/us/texas/travis-county/rent" className="text-foreground hover:opacity-70">
          Travis County, TX
        </Link>
        ,{" "}
        <Link href="/us/illinois/cook-county/rent" className="text-foreground hover:opacity-70">
          Cook County, IL
        </Link>
        , or{" "}
        <Link href="/us/california/santa-cruz-county/rent" className="text-foreground hover:opacity-70">
          Santa Cruz County, CA
        </Link>
        , or see how rent stacks up against home prices nationally in our{" "}
        <Link href="/us/rankings/rent-to-price" className="text-foreground hover:opacity-70">
          rent-to-price ratio rankings
        </Link>
        . Every U.S. county with FMR data is browsable from the{" "}
        <Link href="/us" className="text-foreground hover:opacity-70">
          US housing data hub
        </Link>
        .
      </p>
      <p>
        <strong>Data source and snapshot date.</strong> All figures above are HUD Fair
        Market Rent, 2026 vintage, and U.S. Census Bureau ACS 5-year median gross rent,
        2024 vintage, held in our database as of 2026-08-08. Coverage: 3,077 of 3,232
        tracked counties have a 2026 FMR figure; 3,069 of those also have an ACS median
        gross rent figure for the FMR-versus-ACS comparison.
      </p>
    </>
  );
}
