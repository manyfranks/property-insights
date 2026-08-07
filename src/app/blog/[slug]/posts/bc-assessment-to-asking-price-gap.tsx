import Link from "next/link";

export default function BcAssessmentToAskingPriceGap() {
  return (
    <>
      <p>
        We matched 15 live BC listings in our system to their BC Assessment values and
        compared asking price to assessed value for each one. The median listing in our
        sample is priced <strong>7.4% above</strong> its government assessment. Eighty
        percent of matched listings (12 of 15) are priced above assessment; the remaining
        20% (3 of 15) are priced at or below it.
      </p>
      <p>
        This is a small, real sample — not a market-wide survey — and it skews almost
        entirely to Greater Victoria on Southern Vancouver Island. The methodology and
        limitations are laid out in full below. We are publishing the exact numbers rather
        than a bigger but fabricated headline because the underlying data is what makes
        this useful to cite.
      </p>

      <h2>The Headline Number</h2>
      <p>
        Across all 15 matched pairs, the asking-price-to-assessment gap ranged from{" "}
        <strong>-6.4%</strong> (a listing priced below its assessed value) to{" "}
        <strong>+35.7%</strong> (a listing priced well above it). The median gap was{" "}
        <strong>+7.4%</strong>, and the mean gap was <strong>+7.5%</strong> — close
        enough that the distribution is not being pulled hard by outliers.
      </p>
      <p>
        In practical terms: for every $1,000,000 in BC Assessment value, the typical
        matched listing in our sample was asking roughly $1,074,000.
      </p>

      <h2>City-by-City Breakdown</h2>
      <p>
        Only cities with at least 3 matched pairs are shown in the table below, since
        smaller counts are not reliable enough to summarize with a single number. (Langford
        had 2 matched pairs, with a 6.6% median gap — directionally consistent with
        Victoria, but too small a sample to report as a city figure.)
      </p>
      <div className="overflow-x-auto my-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-foreground">City</th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Matched listings (n)
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Median gap
              </th>
              <th className="text-right py-2 pr-4 font-medium text-foreground">
                Mean gap
              </th>
              <th className="text-right py-2 font-medium text-foreground">Range</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2 pr-4">
                <Link href="/discover/victoria" className="text-foreground hover:opacity-70">
                  Victoria
                </Link>
              </td>
              <td className="text-right py-2 pr-4">9</td>
              <td className="text-right py-2 pr-4">+9.0%</td>
              <td className="text-right py-2 pr-4">+11.7%</td>
              <td className="text-right py-2">+2.3% to +35.7%</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Link href="/discover/saanich" className="text-foreground hover:opacity-70">
                  Saanich
                </Link>
              </td>
              <td className="text-right py-2 pr-4">4</td>
              <td className="text-right py-2 pr-4">-3.1%</td>
              <td className="text-right py-2 pr-4">-1.5%</td>
              <td className="text-right py-2">-6.4% to +6.3%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The split is notable: Victoria listings in our sample skew well above assessment
        (median +9.0%), while Saanich listings skew slightly below (median -3.1%). With
        n=9 and n=4 respectively, neither number should be treated as a definitive
        municipal average — but the direction of the gap, and the fact that it differs
        between two adjacent municipalities, is a real signal about how differently
        sellers price relative to assessment even within the same metro area.
      </p>

      <h2>What This Means When You Make an Offer</h2>
      <p>
        A single-digit median gap does not mean every listing is fairly priced — it means
        the assessment-to-asking gap is a starting point, not a verdict. Three practical
        takeaways from this data:
      </p>
      <ul>
        <li>
          <strong>A listing at or below its assessed value is not automatically a deal,
          and one 30%+ above assessment is not automatically overpriced.</strong> Our
          matched sample spans $649,900 to $2,148,000 in asking price alone — everything
          from starter homes to acreage estates — and renovation status, lot size, and
          micro-location all move the fair gap up or down.
        </li>
        <li>
          <strong>Use the city median as your anchor, not the overall median.</strong>{" "}
          If you are bidding in Saanich, a listing priced 9% over assessment is running
          hotter than the local pattern in our sample. The same listing in Victoria would
          be running right at the local median.
        </li>
        <li>
          <strong>The gap is one input, not the whole offer.</strong> Combine it with days
          on market, price-reduction history, and listing language before deciding how
          far below asking to offer. Our{" "}
          <Link href="/" className="text-foreground hover:opacity-70">
            offer-analysis tool
          </Link>{" "}
          runs all of these signals together for any specific address.
        </li>
      </ul>

      <h2>Methodology</h2>
      <p>
        <strong>Data sources.</strong> Asking prices come from our live listing feed
        (Zoocasa-sourced, matching what buyers see on the market). Assessed values come
        from BC Assessment, the province&apos;s government property assessment authority.
      </p>
      <p>
        <strong>Snapshot date.</strong> This analysis was run on 2026-08-07 against the
        listings and assessment records held in our system as of that date.
      </p>
      <p>
        <strong>Matching process.</strong> We joined 250 preloaded listings in our system
        against our BC Assessment cache by normalized street address. Only pairs with an
        exact address match (after normalizing case, punctuation, street-suffix
        abbreviations, and unit-number prefixes) and a non-zero price and assessment on
        both sides were counted. This produced 15 matched pairs out of 250 listings — a
        6% match rate, because our assessment cache currently covers a specific set of ~41
        core BC properties plus a batch of scraped additions, not the full listing
        inventory. Alberta and Ontario assessment records exist in our cache but did not
        match any address in the current listing set, so this analysis is BC-only.
      </p>
      <p>
        <strong>Sample size and what it means.</strong> n=15 for the overall figures; n=9
        for Victoria and n=4 for Saanich for the city breakdown. This is a real but small
        sample, and it should be read as directional rather than a definitive market
        statistic. We are reporting the exact counts alongside every number so readers can
        judge the confidence themselves — we did not pad the sample or extrapolate beyond
        what the matched pairs actually show.
      </p>
      <p>
        <strong>Geographic coverage.</strong> All 15 matched pairs are in Greater Victoria,
        on Southern Vancouver Island (Victoria, Saanich, and Langford). This reflects where
        our assessment cache has the densest coverage, not necessarily where the
        assessment-to-asking gap is largest or smallest across BC generally.
      </p>
      <p>
        <strong>Known limitation: assessment lag.</strong> BC Assessment values reflect
        market value as of July 1 of the prior year, not the current date. In a rising
        market, this alone would push the measured gap upward even if sellers were pricing
        exactly at current fair value; in a falling market, it would do the opposite. The
        gap we measured should be read as &quot;asking price vs. a ~1-year-old valuation,&quot;
        not &quot;asking price vs. today&apos;s fair value.&quot;
      </p>
      <p>
        Curious how a specific address compares to its own assessment? Browse listings in{" "}
        <Link href="/discover/victoria" className="text-foreground hover:opacity-70">
          Victoria
        </Link>{" "}
        or{" "}
        <Link href="/discover/saanich" className="text-foreground hover:opacity-70">
          Saanich
        </Link>{" "}
        with assessment values shown alongside asking price, or run any address through our{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          offer-analysis tool
        </Link>{" "}
        on the home page.
      </p>
    </>
  );
}
