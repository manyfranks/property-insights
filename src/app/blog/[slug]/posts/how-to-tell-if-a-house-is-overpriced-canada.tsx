import Link from "next/link";

export default function HowToTellIfOverpriced() {
  return (
    <>
      <p>
        One of the hardest things about buying a home in Canada is figuring out whether the asking
        price is reasonable. Sellers set their own listing prices, and there is no rule that says
        those prices need to reflect reality. Some properties are priced to sell quickly. Others
        are priced on optimism.
      </p>
      <p>
        The good news is that there are concrete, publicly available signals that can help you
        figure out which category a listing falls into. Here are five things to look at before
        you make an offer.
      </p>

      <h2>1. The Assessment-to-Listing Ratio Is Unusually High</h2>
      <p>
        Every residential property in BC, Alberta, and Ontario has a government-assessed value.
        These assessments are not perfect market estimates, but they provide a useful baseline that
        is completely independent of the seller.
      </p>
      <p>
        When a property is listed at 1.5x or more of its assessed value, that is worth
        investigating. In some cases, the premium is justified by recent renovations, a desirable
        micro-location, or a rapidly appreciating neighbourhood. But if comparable properties nearby
        are trading at lower multiples, the listing may simply be overpriced.
      </p>
      <p>
        For example, if homes on the same street are listed at 1.1x to 1.3x their assessments
        and one is listed at 1.6x, that outlier deserves scrutiny. Either the seller knows something
        the market does not, or they are reaching.
      </p>
      <p>
        At{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          Property Insights
        </Link>
        , we calculate this ratio automatically for every listing in our system.
      </p>

      <h2>2. High Days on Market</h2>
      <p>
        Days on market (DOM) is one of the most underused signals available to buyers. It measures
        how long a property has been actively listed for sale.
      </p>
      <p>
        Every market has its own rhythm, but as a rough guide:
      </p>
      <ul>
        <li>
          <strong>Under 14 days:</strong> Fresh listing. Market has not had time to render a verdict.
        </li>
        <li>
          <strong>14 to 45 days:</strong> Normal range in balanced markets. The property is being
          tested by the market.
        </li>
        <li>
          <strong>45 to 90 days:</strong> Starting to age. Buyers and agents are asking why it has
          not sold. Could be pricing, could be condition, could be location.
        </li>
        <li>
          <strong>90+ days:</strong> Stale listing. The market has spoken. At this point, the
          property is almost certainly overpriced relative to what buyers are willing to pay.
        </li>
      </ul>
      <p>
        A high DOM count does not always mean the property is bad. Sometimes great homes sit because
        they are priced 5% to 10% above where the market would clear them. That is actually good
        news for a buyer, because it means the seller is likely getting more flexible with each
        passing week.
      </p>

      <h2>3. Price Reductions and Relists</h2>
      <p>
        When a seller drops their asking price, they are telling you something important: the
        original price did not work. Pay attention to the pattern.
      </p>
      <ul>
        <li>
          A single small reduction (1% to 3%) after 30+ days is normal market adjustment.
        </li>
        <li>
          Multiple reductions suggest the seller started too high and is gradually working
          their way down to reality.
        </li>
        <li>
          Delisting and relisting at a lower price (sometimes called &quot;cycling&quot;) is a
          common tactic to reset the DOM counter and make the property appear fresh. If you notice
          a listing with suspiciously low DOM but a price history showing previous higher prices,
          the seller has likely already been tested by the market.
        </li>
      </ul>
      <p>
        Price reduction history is not always visible on listing sites, which is why tools that
        track relisting patterns can be valuable for buyers.
      </p>

      <h2>4. The Listing Description Has Motivation Signals</h2>
      <p>
        Real estate listing descriptions follow conventions, and certain phrases are red flags for
        overpricing or seller desperation. Look for:
      </p>
      <ul>
        <li>
          <strong>&quot;Bring all offers&quot; or &quot;open to offers.&quot;</strong> This is the
          seller acknowledging that their asking price is negotiable. In a properly priced market,
          sellers do not need to invite negotiation.
        </li>
        <li>
          <strong>&quot;Must sell&quot; or &quot;estate sale.&quot;</strong> Indicates urgency that
          has nothing to do with property value. The seller may be more focused on closing quickly
          than on getting top dollar.
        </li>
        <li>
          <strong>&quot;Price improvement&quot; or &quot;new price.&quot;</strong> Polite ways of
          saying the price was cut after sitting on the market.
        </li>
        <li>
          <strong>Heavy emphasis on &quot;potential&quot; or &quot;opportunity.&quot;</strong> When
          a listing focuses on what the property could be rather than what it is, the current
          condition may not justify the asking price.
        </li>
      </ul>
      <p>
        These signals are subtle, but they are consistent. Our{" "}
        <Link href="/how-it-works" className="text-foreground hover:opacity-70">
          scoring system
        </Link>{" "}
        uses AI to detect motivation language automatically and factors it into every property&apos;s
        analysis.
      </p>

      <h2>5. Comparable Sales Tell a Different Story</h2>
      <p>
        The most reliable way to assess whether a property is overpriced is to look at what similar
        homes in the same area have actually sold for recently. These are called comparable sales, or
        &quot;comps.&quot;
      </p>
      <p>
        The key word is &quot;sold,&quot; not &quot;listed.&quot; Any homeowner can list their
        property at any price. What matters is what buyers actually paid.
      </p>
      <p>
        When looking at comps, try to match on:
      </p>
      <ul>
        <li>Same neighbourhood or within a few blocks.</li>
        <li>Similar size (square footage, number of bedrooms and bathrooms).</li>
        <li>Similar lot size and property type.</li>
        <li>Sold within the last 3 to 6 months.</li>
      </ul>
      <p>
        If comparable homes sold for $700K to $750K and the listing you are looking at is priced at
        $825K with no obvious differentiator (no renovation, no larger lot, no premium location),
        the property is likely overpriced.
      </p>
      <p>
        In most Canadian markets, sold price data is available through real estate boards, though
        access varies by province. Your agent should be able to pull recent comps for any property
        you are considering.
      </p>

      <h2>What to Do When You Think a Property Is Overpriced</h2>
      <p>
        Identifying overpricing is useful, but it does not mean you should walk away. An overpriced
        property with a motivated seller is actually one of the best buying opportunities in real
        estate.
      </p>
      <p>
        Here is how to approach it:
      </p>
      <ol>
        <li>
          <strong>Gather your evidence.</strong> Pull the assessed value, calculate the ratio, note
          the DOM, and check for price reductions. Build a fact-based picture of where the property
          should be priced.
        </li>
        <li>
          <strong>Make a reasonable offer below asking.</strong> Do not lowball for the sake of it,
          but offer what the data supports. A well-justified offer at 90% to 95% of asking on an
          overpriced listing is more likely to succeed than you might think, especially if the
          property has been sitting.
        </li>
        <li>
          <strong>Be patient.</strong> Overpriced listings tend to attract fewer offers, which means
          less competition for you. If your first offer is rejected, the seller may come back to you
          after another month with no takers.
        </li>
        <li>
          <strong>Use conditions wisely.</strong> A financing condition and inspection condition
          protect you if the appraisal comes in below the agreed price, which is a real risk with
          overpriced properties.
        </li>
      </ol>

      <h2>Let the Data Guide You</h2>
      <p>
        The Canadian real estate market has a long history of information asymmetry. Sellers and
        their agents have traditionally had access to better data than buyers. That is changing.
      </p>
      <p>
        Government assessment data is public. Days on market is visible on every listing platform.
        Price history and relisting patterns can be tracked. And tools like{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          Property Insights
        </Link>{" "}
        bring all of these signals together in one place, with a recommended offer price for every
        property.
      </p>
      <p>
        You do not need to be a real estate expert to spot an overpriced listing. You just need
        to look at the right numbers.{" "}
        <Link href="/dashboard" className="text-foreground hover:opacity-70">
          Start browsing our analyzed listings
        </Link>{" "}
        to see these signals in action.
      </p>
    </>
  );
}
