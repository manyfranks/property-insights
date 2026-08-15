import Link from "next/link";

export default function AssessmentVsMarketValue() {
  return (
    <>
      <p>
        <strong>Assessed value</strong> and <strong>market value</strong> answer two
        different questions. Assessed value is a government estimate of what your
        property was worth on a fixed date in the past, used mainly to calculate
        property tax. Market value is what a buyer would actually pay for the
        property today. They are rarely the same number, and the gap between them
        is not a mistake — it is a byproduct of how each number is produced.
      </p>
      <p>
        If you are shopping for a home in Canada, you have probably seen both numbers
        attached to the same property: the assessed value on file with the province or
        municipality, and the listing price your agent shows you. These can be tens or
        even hundreds of thousands of dollars apart. This guide explains why, how the
        rules differ by province, which value is used for what, and how to use the gap
        without over-relying on it.
      </p>

      <h2>What Is a Property Assessment?</h2>
      <p>
        A property assessment is an estimate of a property&apos;s value produced by a
        government authority, primarily to determine how much property tax the owner
        should pay. Assessors use mass appraisal: they evaluate thousands of properties
        at once using statistical models built on location, lot size, building size,
        age, condition, and recent comparable sales, rather than inspecting each home
        individually.
      </p>

      <h2>What Is Market Value?</h2>
      <p>
        Market value is what a willing buyer would pay a willing seller for a property
        today, under normal conditions. Nobody assigns this number in advance — it is
        discovered through the listing and negotiation process, shaped by current
        comparable sales, the specific home&apos;s condition and features, how long it
        has been on the market, and how many other buyers are competing for it at that
        moment. Unlike an assessment, market value has no fixed valuation date. It
        moves in real time with the market.
      </p>

      <h2>How Assessment Cycles Vary by Province</h2>
      <p>
        This is where a lot of confusion starts, because the rules are genuinely
        different in each province. There is no single Canadian assessment system.
      </p>

      <h3>British Columbia</h3>
      <p>
        BC Assessment, an independent Crown corporation, assesses every property in
        the province annually. Assessment notices go out at the very end of December
        or in early January each year, and they reflect the property&apos;s estimated
        market value as of <strong>July 1 of the prior year</strong>. The most recent
        roll, for example, reflects values as of July 1, 2025.
      </p>
      <p>
        That means a BC assessment is at least six months old the day it lands in your
        mailbox, and it can be well over a year old by the time you are comparing it to
        a listing later in the year. In a market moving quickly in either direction,
        that lag matters. BC Assessment values are searchable for free by address.
      </p>

      <h3>Alberta</h3>
      <p>
        In Alberta, assessment is handled at the municipal level rather than
        provincially. Calgary and Edmonton each maintain their own assessment rolls,
        both reflecting an estimated market value as of <strong>July 1 of the prior
        year</strong> — the same valuation-date convention as BC, just administered
        locally. Notices typically go out in January, with a customer review period
        that runs into March. Assessments are updated annually and are the basis for
        each city&apos;s municipal property tax.
      </p>
      <p>
        Both cities publish their assessment rolls through free, open-data (SODA) APIs,
        which makes it possible to look up any address programmatically rather than
        searching a portal by hand.
      </p>

      <h3>Ontario</h3>
      <p>
        Ontario is the outlier, and it is important to get this right: assessments here
        are managed by the Municipal Property Assessment Corporation (MPAC), and MPAC
        has <strong>not conducted a province-wide reassessment since a valuation date
        of January 1, 2016</strong>. A 2020 update was postponed because of the
        pandemic, and every proposed update since has been postponed again by the
        Ontario government. As of the 2026 property tax year, assessments are still
        based on those fully phased-in 2016 values, and no firm date has been set for
        the next province-wide reassessment.
      </p>
      <p>
        In a city like Toronto, where prices have moved substantially since 2016, this
        means the gap between an assessed value and current market value can be very
        large — and that gap tells you almost nothing about whether a specific listing
        is priced fairly today. MPAC does still update individual assessments between
        province-wide cycles when a property is newly built, renovated, demolished, or
        changes use, but the underlying 2016 valuation date has not moved.
      </p>
      <p>
        Ontario assessments remain useful for comparing properties <em>relative to each
        other</em>, since they were all valued at the same point in time. They are far
        less useful as an absolute read on what a property is worth right now.
      </p>

      <h2>Why Assessed Value Lags or Differs From Current Market Value</h2>
      <p>
        Even in provinces that reassess annually, the assessed value and the market
        value diverge for reasons that have nothing to do with either number being
        wrong:
      </p>
      <ul>
        <li>
          <strong>Time lag.</strong> Every assessment reflects a past valuation date —
          six to eighteen months old even in BC and Alberta, and a decade or more old in
          Ontario. In a rising market, current listings will typically price above the
          assessment. In a falling market, the opposite can happen.
        </li>
        <li>
          <strong>Mass appraisal vs. individual pricing.</strong> Assessors model
          thousands of properties at once with standardized inputs. A seller and their
          agent price one specific home based on its unique features, staging,
          upgrades, and the competitive listings around it right now.
        </li>
        <li>
          <strong>Renovations and improvements.</strong> If an owner has renovated the
          kitchen, added a suite, or finished the basement since the last assessment (or
          since 2016 in Ontario), that work may not be reflected in the assessed value
          at all.
        </li>
        <li>
          <strong>Seller psychology.</strong> Some sellers price high hoping for a lucky
          buyer. Others price low to drive multiple offers. The listing price is a
          strategy, not a fact — and it has no obligation to relate to the assessment.
        </li>
        <li>
          <strong>Local micro-markets.</strong> Assessment models work at a
          neighbourhood level but can miss block-by-block variation. A home on a quiet
          cul-de-sac and one on a busy arterial road can carry near-identical
          assessments with very different real buyer appeal.
        </li>
      </ul>

      <h2>Which Value Is Used for What</h2>
      <p>
        Assessed value and market value are not interchangeable, and mixing them up
        leads to bad decisions. Here is what each one is actually for:
      </p>
      <ul>
        <li>
          <strong>Property tax.</strong> This is the assessed value&apos;s real job. Your
          municipality multiplies the assessed value by a tax or mill rate to produce
          your annual bill. This is the one place the assessed value is the authoritative
          number, not an estimate to be second-guessed.
        </li>
        <li>
          <strong>Listing price decisions.</strong> Sellers and their agents set the
          asking price from a comparative market analysis — recent closed sales of
          similar nearby homes — not from the assessment. In Ontario in particular, using
          a 2016-vintage assessment to set a 2026 asking price would make no sense, and
          agents don&apos;t do it.
        </li>
        <li>
          <strong>Appraisal.</strong> If you finance the purchase, your lender will
          usually order an independent appraisal from a licensed appraiser. That
          appraisal is its own opinion of current market value, based on recent
          comparable sales and a physical inspection — it is not the assessed value, and
          it is not the same exercise as pricing a listing.
        </li>
        <li>
          <strong>Offer decisions.</strong> This is where buyers should use assessed
          value as one input among several, alongside comparable sales, days on market,
          and the property&apos;s actual condition — not as a stand-alone target price.
        </li>
      </ul>

      <h2>The Assessment-to-Listing Ratio</h2>
      <p>
        One useful metric for a buyer is the ratio of listing price to assessed value.
        We call this the assessment-to-listing ratio, and it tells you how the
        seller&apos;s asking price relates to what a government authority estimated the
        property was worth as of its valuation date.
      </p>
      <ul>
        <li>
          <strong>Ratio close to 1.0.</strong> The listing price roughly matches the
          assessed value. This may indicate a conservatively priced listing, though in
          Ontario it can just as easily mean the assessment is a decade stale.
        </li>
        <li>
          <strong>Ratio of 1.2 to 1.4.</strong> A moderate premium over assessed value.
          Common in stable or appreciating markets, especially for well-maintained or
          recently renovated homes.
        </li>
        <li>
          <strong>Ratio above 1.5.</strong> The seller is asking significantly more than
          the assessed value. This could be justified by upgrades or a hot micro-market,
          or it could signal an aggressively priced listing worth scrutinizing further.
        </li>
        <li>
          <strong>Ratio below 1.0.</strong> The property is listed below its assessed
          value — rare, and usually a sign of strong seller motivation, a declining local
          market, or a property with real issues.
        </li>
      </ul>
      <p>
        This ratio is a starting signal, not a verdict. What counts as a &quot;normal&quot;
        ratio varies by city, property type, and how recently that province updated its
        roll — a ratio that looks aggressive in Calgary can be entirely ordinary in
        Toronto once you account for the 2016 valuation date.
      </p>

      <h2>A Hypothetical Example (Not a Real Property)</h2>
      <p>
        To make this concrete, here is a made-up scenario with round numbers — no real
        address, no real listing.
      </p>
      <p>
        Imagine a detached home in a mid-size BC city. BC Assessment lists it at
        $780,000, reflecting its estimated value as of July 1 of last year. It is
        listed for sale today at $895,000, an assessment-to-listing ratio of about 1.15.
        The listing has been active for 40 days with no price change, and three nearby
        comparable homes closed in the past two months at 96% to 98% of their own
        asking prices.
      </p>
      <p>
        A buyer looking at this hypothetical property should not conclude &quot;the
        assessment says $780,000, so I&apos;ll offer $780,000.&quot; The $115,000 gap is
        context: it tells you the asking price has not been validated by an independent
        source, and it is one input to weigh against the comparable sales, the 40 days
        on market, and the home&apos;s actual condition. It is not, on its own, a
        formula for the right offer.
      </p>

      <h2>How Buyers Can Use Assessment Data</h2>
      <p>Here are practical ways to fold assessment data into your home buying process:</p>

      <h3>1. Screening Potentially Overpriced Listings</h3>
      <p>
        If a property has a high assessment-to-listing ratio relative to similar homes
        in the same area, it may be overpriced. That does not mean you should skip it —
        it means you should investigate further (comparable sales, condition, DOM)
        before offering close to asking.
      </p>

      <h3>2. Adding Credibility to a Below-Asking Offer</h3>
      <p>
        When you offer below asking price, citing the assessed value as a reference
        point adds weight to your position. You are pointing to an independent,
        government-produced valuation rather than an arbitrary number — even though it
        is one data point among several, not proof of the &quot;right&quot; price.
      </p>

      <h3>3. Comparing Properties Objectively</h3>
      <p>
        When choosing between two homes at similar listing prices, comparing their
        assessed values and ratios can reveal relative positioning. A home listed at
        $800K with a $750K assessment sits differently than one listed at $800K with a
        $550K assessment — though in Ontario, remember both numbers may be equally
        stale.
      </p>

      <h3>4. Estimating Property Taxes</h3>
      <p>
        Since property tax is calculated from the assessed value, looking it up gives
        you a reasonable estimate of your annual bill — important for budgeting your
        total monthly housing cost, which is what actually matters for mortgage
        qualification.
      </p>

      <h2>Limitations to Keep in Mind</h2>
      <p>Assessment data is a useful tool, but it has real blind spots:</p>
      <ul>
        <li>
          Assessments do not account for interior condition. A gutted, fully renovated
          property can be worth far more than its assessed value suggests, and a
          neglected one far less.
        </li>
        <li>
          In Ontario, where assessments are still anchored to 2016 values, the absolute
          number is not a meaningful current-market figure. Use it for relative
          comparisons between similar Ontario properties, not as a dollar estimate of
          today&apos;s worth.
        </li>
        <li>
          Assessment appeals can change values. If an owner successfully appealed their
          assessment, the number on file may differ from what the original model
          produced.
        </li>
        <li>
          Assessments do not capture market sentiment, urgency, or competition. A
          property in a bidding war will sell above assessed value regardless of what
          the assessment says.
        </li>
      </ul>

      <h2>How Property Insights Uses Assessment Data</h2>
      <p>
        We built{" "}
        <Link href="/" className="text-foreground hover:opacity-70">
          Property Insights
        </Link>{" "}
        to surface assessed values, market signals, and offer modeling in one place —
        and we want to be specific about where that assessment data actually comes
        from, because freshness and coverage are not the same in every province.
      </p>
      <ul>
        <li>
          <strong>British Columbia:</strong> pulled from BC Assessment, so values are as
          current as BC Assessment&apos;s own annual roll and carry the same July 1
          valuation-date lag described above.
        </li>
        <li>
          <strong>Alberta (Calgary and Edmonton):</strong> pulled live from each
          city&apos;s open-data (SODA) API, so these values are as current as the city&apos;s
          own published assessment roll at the time of lookup.
        </li>
        <li>
          <strong>Ontario:</strong> served from a cached table of previously looked-up
          MPAC values, since MPAC does not offer a comparable public API and its
          underlying valuations are themselves frozen at 2016. Coverage here is
          partial — not every Ontario address we check will have a cached match, and
          when we don&apos;t have a reliable value, we say so rather than estimating one.
        </li>
      </ul>
      <p>
        For every property we can match, you see the government assessed value, the
        assessment-to-listing ratio, days on market and any price history, and an
        AI-generated read of what the combination means for that specific listing.
      </p>

      <h2>See Your Own Assessment Gap</h2>
      <p>
        If you already have a property&apos;s assessed value and its asking price, run
        them through our free{" "}
        <Link href="/tools/assessment-gap" className="text-foreground hover:opacity-70">
          assessment-gap calculator
        </Link>
        . It will show you the spread in dollars and percent and what that size
        typically signals — but the gap is context, not an automatic discount. Use it
        alongside comparable sales, days on market, and the property&apos;s condition
        before you decide what to actually offer.
      </p>

      <h2>Frequently Asked Questions</h2>

      <h3>What is the difference between assessed value and market value in Canada?</h3>
      <p>
        Assessed value is a government estimate set on a fixed valuation date, used
        mainly to calculate property tax. Market value is what a buyer would actually
        pay for the property today. They diverge because assessments update on a fixed
        cycle using mass-appraisal models, while market value moves in real time with
        comparable sales, condition, and buyer competition.
      </p>

      <h3>How often are property assessments updated in Canada?</h3>
      <p>
        It varies by province. BC Assessment and Alberta&apos;s municipal assessors
        (Calgary and Edmonton) update annually, each reflecting a July 1 valuation date
        from the prior year. Ontario is the exception: MPAC has not conducted a
        province-wide reassessment since a January 1, 2016 valuation date, and that
        update has been postponed repeatedly, with no new date confirmed as of the 2026
        tax year.
      </p>

      <h3>Can you look up a property&apos;s assessed value for free?</h3>
      <p>
        Yes, in all three provinces. BC Assessment values are searchable at
        bcassessment.ca. Calgary and Edmonton publish theirs through free, no-login
        open-data (SODA) APIs. Ontario homeowners can view their own property through
        MPAC&apos;s AboutMyProperty portal, though broader public look-ups of other
        addresses are more limited.
      </p>

      <h3>Does a big assessment gap mean I should offer less?</h3>
      <p>
        Not automatically. A large gap between assessed value and asking price is
        useful context — it tells you the asking price hasn&apos;t been validated by an
        independent source — but it should be weighed alongside comparable sales, days
        on market, and the property&apos;s condition, not treated as an automatic
        discount.
      </p>

      <h2>Key Takeaway</h2>
      <p>
        The assessed value is not the final word on what a property is worth, and in
        Ontario in particular, it may be measuring a market that no longer exists. But
        it remains one of the few data points available to buyers that the seller did
        not set. Treat the gap between assessed value and asking price as context for
        your offer, not an automatic discount — combine it with comparable sales, days
        on market, and the property&apos;s condition before you decide on a number.
      </p>
    </>
  );
}
