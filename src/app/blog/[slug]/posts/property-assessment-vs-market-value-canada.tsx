import Link from "next/link";

export default function AssessmentVsMarketValue() {
  return (
    <>
      <p>
        If you are shopping for a home in Canada, you have probably seen two very different numbers
        attached to the same property: the listing price and the assessed value. These numbers can
        be tens or even hundreds of thousands of dollars apart, and understanding why is one of the
        most useful things a buyer can learn.
      </p>
      <p>
        This guide breaks down how property assessments work in BC, Alberta, and Ontario, explains
        why they differ from market prices, and shows how buyers can use the gap between the two
        to make better offers.
      </p>

      <h2>What Is a Property Assessment?</h2>
      <p>
        A property assessment is an estimate of a property&apos;s value produced by a government
        authority. Its primary purpose is to determine how much property tax the owner should pay.
        Assessments are typically conducted annually, though the methodology and timing vary by
        province.
      </p>
      <p>
        The assessed value is based on a combination of factors: the property&apos;s location, lot
        size, building size, age, condition, and recent sales of comparable properties in the area.
        Assessors use mass appraisal techniques, meaning they evaluate thousands of properties at
        once using statistical models rather than inspecting each home individually.
      </p>

      <h2>How Assessments Work in Each Province</h2>

      <h3>British Columbia</h3>
      <p>
        BC Assessment is an independent Crown corporation that assesses every property in the
        province annually. Assessment notices are mailed each January, reflecting the property&apos;s
        estimated market value as of July 1 of the previous year.
      </p>
      <p>
        This means a BC assessment is always at least six months old when you receive it, and
        potentially 18 months old by the time you are looking at a listing later in the year. In a
        market that is moving quickly in either direction, that lag matters.
      </p>
      <p>
        BC Assessment values are publicly accessible online. You can search any address and see the
        total assessed value, broken down into land and building components.
      </p>

      <h3>Alberta</h3>
      <p>
        In Alberta, property assessment is handled at the municipal level. Calgary and Edmonton
        each maintain their own assessment rolls, and both make their data freely available through
        open data portals.
      </p>
      <p>
        Calgary&apos;s assessments reflect estimated market value as of July 1 of the prior year,
        similar to BC. Edmonton follows a comparable timeline. Alberta assessments are updated
        annually and are used to calculate municipal property taxes.
      </p>
      <p>
        One advantage for Alberta buyers is that both Calgary and Edmonton publish their assessment
        data through SODA-compatible APIs, making it straightforward to look up any address
        programmatically.
      </p>

      <h3>Ontario</h3>
      <p>
        Ontario assessments are managed by the Municipal Property Assessment Corporation (MPAC).
        Here is where things get unusual: MPAC has not conducted a province-wide reassessment since
        2016. While they were originally on a four-year cycle, reassessments have been postponed
        repeatedly.
      </p>
      <p>
        This means Ontario assessed values are based on an estimated market value from January 1,
        2016, which is now a decade old. In markets like Toronto where prices have moved
        significantly since 2016, the gap between assessed value and current market value can be
        very large.
      </p>
      <p>
        Ontario assessments are still useful for comparing properties relative to each other (since
        they were all valued at the same point in time), but they are less reliable as absolute
        indicators of current worth.
      </p>

      <h2>Why Assessed Values Differ From Listing Prices</h2>
      <p>
        There are several reasons the number on an assessment notice almost never matches the number
        on a listing:
      </p>
      <ul>
        <li>
          <strong>Time lag.</strong> Assessments reflect a past valuation date. In a rising market,
          listings will be priced above assessments. In a declining market, the opposite can occur.
        </li>
        <li>
          <strong>Mass appraisal vs. individual pricing.</strong> Assessors use statistical models
          across thousands of properties. A seller and their agent price a specific home based on
          its unique features, upgrades, staging, and the competitive landscape at that moment.
        </li>
        <li>
          <strong>Renovations and improvements.</strong> If the owner has renovated the kitchen,
          added a suite, or finished the basement since the last assessment, those improvements may
          not be reflected in the assessed value.
        </li>
        <li>
          <strong>Seller psychology.</strong> Some sellers price high hoping for a lucky buyer.
          Others price low to drive multiple offers. The listing price is a strategy, not a fact.
        </li>
        <li>
          <strong>Local micro-markets.</strong> Assessment models work well at a neighbourhood level
          but can miss block-by-block variation. A home on a quiet cul-de-sac and one on a busy
          arterial road may have similar assessments but very different market appeal.
        </li>
      </ul>

      <h2>The Assessment-to-Listing Ratio</h2>
      <p>
        One of the most useful metrics for a buyer is the ratio of listing price to assessed value.
        We call this the assessment-to-listing ratio, and it tells you how the seller&apos;s asking
        price relates to what a government authority thinks the property is worth.
      </p>
      <ul>
        <li>
          <strong>Ratio close to 1.0.</strong> The listing price roughly matches the assessed value.
          The property is priced conservatively, which may indicate a realistic seller.
        </li>
        <li>
          <strong>Ratio of 1.2 to 1.4.</strong> A moderate premium over assessed value. Common in
          stable markets, especially for well-maintained or recently renovated homes.
        </li>
        <li>
          <strong>Ratio above 1.5.</strong> The seller is asking significantly more than the assessed
          value. This could be justified by recent upgrades or a hot micro-market, but it could also
          signal overpricing.
        </li>
        <li>
          <strong>Ratio below 1.0.</strong> The property is listed below its assessed value. This is
          rare and usually indicates strong seller motivation, a declining market, or a property with
          significant issues.
        </li>
      </ul>
      <p>
        This ratio is not a magic number, but it gives you a fast read on whether a property is
        priced aggressively or conservatively relative to its assessed value. At{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          Property Insights
        </Link>
        , we calculate this ratio automatically for every listing and use it as the foundation of
        our offer model.
      </p>

      <h2>How Buyers Can Use Assessment Data</h2>
      <p>
        Here are practical ways to work assessment data into your home buying process:
      </p>

      <h3>1. Screening Overpriced Listings</h3>
      <p>
        If a property has a high assessment-to-listing ratio relative to similar homes in the same
        area, it may be overpriced. This does not mean you should skip it, but it does mean you
        should investigate further before offering close to asking.
      </p>

      <h3>2. Strengthening Your Offer Negotiation</h3>
      <p>
        When you present an offer below asking price, having the assessed value as a reference point
        adds credibility. You are not just throwing out a lower number. You are pointing to an
        independent, government-backed valuation that supports your position.
      </p>

      <h3>3. Comparing Properties Objectively</h3>
      <p>
        When you are deciding between two homes at similar listing prices, comparing their assessed
        values and ratios can reveal which one offers better relative value. A home listed at $800K
        with a $750K assessment is positioned differently than one listed at $800K with a $550K
        assessment.
      </p>

      <h3>4. Estimating Property Taxes</h3>
      <p>
        Since property taxes are based on assessed values, looking up the assessment gives you a
        good estimate of your annual tax bill. This is especially important for budgeting your
        total monthly housing cost, which is what matters for mortgage qualification.
      </p>

      <h2>Limitations to Keep in Mind</h2>
      <p>
        Assessment data is a powerful tool, but it has blind spots:
      </p>
      <ul>
        <li>
          Assessments do not account for the interior condition of a home. A property that has been
          gutted and fully renovated may be worth far more than its assessed value suggests.
        </li>
        <li>
          In Ontario, where assessments are based on 2016 values, the absolute numbers are less
          meaningful. Focus on relative comparisons between similar properties rather than the raw
          assessed value.
        </li>
        <li>
          Assessment appeals can change values. If a property owner successfully appealed their
          assessment, the current value may not reflect the original model output.
        </li>
        <li>
          Assessments do not capture market sentiment, urgency, or competition. A property in a
          bidding war will sell above assessed value regardless of what the numbers say.
        </li>
      </ul>

      <h2>Using Property Insights to See the Full Picture</h2>
      <p>
        We built{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          Property Insights
        </Link>{" "}
        to bring assessment data, market signals, and offer modeling together in one place. For
        every property we analyze, you see:
      </p>
      <ul>
        <li>The government assessed value (land and building breakdown).</li>
        <li>The listing-to-assessment ratio.</li>
        <li>Days on market and any price reductions.</li>
        <li>A recommended offer price that accounts for all of these factors.</li>
        <li>An AI-generated analysis explaining what the data means for that specific property.</li>
      </ul>
      <p>
        It is free to use.{" "}
        <Link href="/dashboard" className="text-foreground hover:opacity-70">
          Browse our analyzed listings
        </Link>{" "}
        or search any address to get started.
      </p>

      <h2>Key Takeaway</h2>
      <p>
        The assessed value is not the final word on what a property is worth. But it is one of the
        few data points available to buyers that is not influenced by the seller. In a market
        where information asymmetry still favours sellers and their agents, having an independent
        reference point gives you a real edge.
      </p>
      <p>
        Look up the assessment before you fall in love with the listing price. It takes two
        minutes and could save you tens of thousands of dollars.
      </p>
    </>
  );
}
