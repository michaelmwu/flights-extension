import { countryComparisonUrl } from "./countryComparison";
import {
  isSkyscannerFinalComparePageUrl,
  isSkyscannerSearchPageUrl,
  parseSkyscannerMatrixSearch,
  parseSkyscannerPricingOptions,
  parseSkyscannerSearchApiResponse,
  parseSkyscannerSponsoredSearchRows,
  skyscannerCountryCodeFromUrl,
  skyscannerCountryUrl,
  skyscannerPanelPageKey,
  skyscannerSearchResultRows,
} from "./skyscannerBooking";

describe("Skyscanner country comparison parser", () => {
  it("builds an ITA Matrix search from Skyscanner route URLs", () => {
    const result = parseSkyscannerMatrixSearch(
      "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/260627/config/example?cabinclass=business&currency=KRW",
    );

    expect(result).toMatchObject({
      tripType: "round-trip",
      cabin: "BUSINESS",
      currency: "KRW",
      slices: [
        { origin: "CJU", destination: "TYO", departureDate: "2026-06-24" },
        { origin: "TYO", destination: "CJU", departureDate: "2026-06-27" },
      ],
    });

    const matrixUrl = new URL(result?.matrixUrl || "");
    const payload = JSON.parse(atob(matrixUrl.searchParams.get("search") || ""));
    expect(payload).toMatchObject({
      type: "round-trip",
      mooFlightsAutoOpen: "1",
      mooFlightsAutoSearch: "1",
      slices: [
        {
          origin: ["CJU"],
          dest: ["TYO"],
          dates: { departureDate: "2026-06-24", returnDate: "2026-06-27" },
        },
      ],
      options: { cabin: "BUSINESS", currency: { code: "KRW" } },
    });
  });

  it("builds multi-city ITA Matrix searches from Skyscanner URLs", () => {
    const result = parseSkyscannerMatrixSearch(
      "https://www.skyscanner.com/transport/d/tpet/2026-06-24/tyoa/tyoa/2026-06-27/sela/?cabinclass=premiumeconomy",
      "TWD",
    );

    expect(result).toMatchObject({
      tripType: "multi-city",
      cabin: "PREMIUM-COACH",
      currency: "TWD",
      slices: [
        { origin: "TPE", destination: "TYO", departureDate: "2026-06-24" },
        { origin: "TYO", destination: "SEL", departureDate: "2026-06-27" },
      ],
    });
  });

  it("uses a supported fallback currency and rejects calendar-invalid route dates", () => {
    expect(
      parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/260624/?currency=ZZZ", "KRW"),
    ).toMatchObject({ currency: "KRW" });
    expect(
      parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/260624/?currency=ZZZ", "BAD"),
    ).toMatchObject({ currency: "USD" });
    expect(parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/260231/")).toBeNull();
    expect(parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/2026-02-31/")).toBeNull();
    expect(
      parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/2028-02-29/"),
    ).toMatchObject({ slices: [{ departureDate: "2028-02-29" }] });
  });

  it("rejects incomplete Skyscanner route components while allowing config termination", () => {
    expect(
      parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/260624/config/example"),
    ).toMatchObject({ tripType: "one-way" });
    expect(
      parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/flights/cju/nrt/260624/not-a-date/"),
    ).toBeNull();
    expect(parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/d/cju/2026-06-24/nrt/tyoa/")).toBeNull();
    expect(
      parseSkyscannerMatrixSearch("https://www.skyscanner.com/transport/d/cju/2026-06-24/nrt/config/example"),
    ).toMatchObject({ tripType: "one-way" });
  });

  it("recognizes final compare pages", () => {
    const url =
      "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy";

    expect(isSkyscannerFinalComparePageUrl(url)).toBe(true);
    expect(skyscannerPanelPageKey(url, "KR", true)).toBe(
      "/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&market=KR",
    );
    expect(skyscannerPanelPageKey(url, "KR", false)).toBe(
      "/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy",
    );
  });

  it("recognizes multi-city search and final compare pages", () => {
    const searchUrl =
      "https://www.skyscanner.com/transport/d/cju/2026-06-24/tyoa/tyoa/2026-06-27/sela/?adultsv2=1&cabinclass=economy&childrenv2=";
    const finalUrl =
      "https://www.skyscanner.com/transport/d/cju/2026-06-24/tyoa/tyoa/2026-06-27/sela/config/10562-2606241255--32128-0-14788-2606241525%7C14788-2606271400--32128-0-12409-2606271630?adultsv2=1&cabinclass=economy&childrenv2=";

    expect(isSkyscannerSearchPageUrl(searchUrl)).toBe(true);
    expect(isSkyscannerFinalComparePageUrl(finalUrl)).toBe(true);
    expect(skyscannerCountryUrl(finalUrl, "KR")).toContain("https://www.skyscanner.co.kr/transport/d/");
    expect(skyscannerCountryUrl(finalUrl, "KR")).toContain("market=KR");
    expect(skyscannerCountryUrl(finalUrl, "KR")).toContain("currency=USD");
  });

  it("builds Korea country URLs by switching hostnames and carrying currency", () => {
    const url =
      "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy";

    expect(skyscannerCountryUrl(url, "KR")).toBe(
      "https://www.skyscanner.co.kr/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&currency=USD&market=KR",
    );
    expect(countryComparisonUrl(url, "KR")).toContain("https://www.skyscanner.co.kr/");
    expect(
      skyscannerCountryCodeFromUrl("https://www.skyscanner.co.kr/transport/flights/cju/tyoa/260624/config/abc"),
    ).toBe("KR");
    expect(
      skyscannerCountryCodeFromUrl("https://WWW.SKYSCANNER.CO.KR/transport/flights/cju/tyoa/260624/config/abc"),
    ).toBe("KR");
    expect(skyscannerCountryCodeFromUrl("https://skyscanner.com/transport/flights/cju/tyoa/260624/config/abc")).toBe(
      "US",
    );
    expect(
      skyscannerCountryCodeFromUrl("https://www.skyscanner.evil.com/transport/flights/cju/tyoa/260624/config/abc"),
    ).toBe("");
  });

  it("builds Japan country URLs using the jp hostname", () => {
    const url =
      "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&locale=en-US&currency=USD";

    const japanUrl = skyscannerCountryUrl(url, "JP");

    expect(japanUrl).toBe(
      "https://www.skyscanner.jp/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&locale=en-US&currency=USD&market=JP",
    );
    expect(skyscannerCountryCodeFromUrl(japanUrl)).toBe("JP");
  });

  it("preserves Skyscanner locale while switching market and keeping USD currency", () => {
    const url =
      "https://www.skyscanner.com/transport/flights/cju/nrt/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&childrenv2=&ref=home&rtn=0&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD&locale=en-US&market=US&preferdirects=false";

    expect(skyscannerCountryUrl(url, "ZA", "USD")).toBe(
      "https://www.skyscanner.co.za/transport/flights/cju/nrt/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&childrenv2=&ref=home&rtn=0&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD&locale=en-US&market=ZA&preferdirects=false",
    );
  });

  it("parses final compare pricing rows", () => {
    document.body.innerHTML = `
      <ol role="list" class="PricingOptions_list__YTlkY">
        <li>
          <div data-testid="PricingItem" class="PricingItem_pricingItemContainer__Y2YwO">
            <div class="AgentDetails_agentDetails__MGEyM">
              <p class="BpkText_bpk-text__ZWFlO">Flightnetwork</p>
              <h3 class="AgentDetails_visuallyHidden__MmJhM">Option 1: Flightnetwork</h3>
            </div>
            <div data-testid="CtaSection">
              <div class="TotalPrice_totalPrice__ZGMwZ">
                <p class="TotalPrice_visuallyHidden__NmEzM">$210 total.</p>
                <div class="Price_pricingItemPrice__ZjBkZ" aria-hidden="true">
                  <span>$210</span>
                </div>
              </div>
              <a
                href="/transport_deeplink/4.0/JP/en-US/USD/fnjp/1/10562.14788.2026-06-24/air/trava/flights"
                aria-label="Select Flightnetwork."
                data-testid="pricing-item-redirect-button"
              >Select</a>
            </div>
          </div>
        </li>
        <li>
          <div data-testid="PricingItem" class="PricingItem_pricingItemContainer__Y2YwO">
            <div class="AgentDetails_agentDetails__MGEyM">
              <p>Booking.com</p>
              <h3>Option 2: Booking.com</h3>
            </div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">$211 total.</p>
              <a href="/transport_deeplink/booking" aria-label="Select Booking.com." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    `;

    const result = parseSkyscannerPricingOptions(
      document,
      "JP",
      "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/example",
    );

    expect(result.status).toBe("ready");
    expect(result.options.map((option) => `${option.provider}:${option.price}`)).toEqual([
      "Flightnetwork:210",
      "Booking.com:211",
    ]);
    expect(result.cheapest).toMatchObject({
      provider: "Flightnetwork",
      priceText: "$210",
      bookingUrl:
        "https://www.skyscanner.com/transport_deeplink/4.0/JP/en-US/USD/fnjp/1/10562.14788.2026-06-24/air/trava/flights",
    });
  });

  it("prefers Skyscanner URL currency over ambiguous dollar price text", () => {
    document.body.innerHTML = `
      <ol>
        <li>
          <div data-testid="PricingItem">
            <div class="AgentDetails_agentDetails__MGEyM"><p>Trip.com</p></div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">$210 total.</p>
              <a href="/transport_deeplink/booking" aria-label="Select Trip.com." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    `;

    const result = parseSkyscannerPricingOptions(
      document,
      "SG",
      "https://www.skyscanner.com.sg/transport/flights/cju/nrt/260624/config/example?currency=SGD",
    );

    expect(result.cheapest).toMatchObject({
      provider: "Trip.com",
      price: 210,
      currency: "SGD",
      priceText: "$210 total.",
    });
  });

  it("parses S$ Skyscanner prices as Singapore dollars", () => {
    document.body.innerHTML = `
      <ol>
        <li>
          <div data-testid="PricingItem">
            <div class="AgentDetails_agentDetails__MGEyM"><p>Trip.com</p></div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">S$ 210 total.</p>
              <a href="/transport_deeplink/booking" aria-label="Select Trip.com." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    `;

    const result = parseSkyscannerPricingOptions(
      document,
      "SG",
      "https://www.skyscanner.com.sg/transport/flights/cju/nrt/260624/config/example",
    );

    expect(result.cheapest).toMatchObject({
      provider: "Trip.com",
      price: 210,
      currency: "SGD",
      priceText: "S$ 210 total.",
    });
  });

  it.each([
    ["C$ 210 total.", "CAD", 210],
    ["A$ 210 total.", "AUD", 210],
    ["R$ 1.234 total.", "BRL", 1234],
    ["MX$ 4,200 total.", "MXN", 4200],
    ["4,200 Mexican pesos total.", "MXN", 4200],
    ["₱1,200 total.", "PHP", 1200],
    ["Rp 2.000.000 total.", "IDR", 2000000],
    ["₫3,000,000 total.", "VND", 3000000],
    ["ZAR 3,200 total.", "ZAR", 3200],
  ])("parses %s as a supported Skyscanner currency", (priceText, currency, price) => {
    document.body.innerHTML = `
      <ol>
        <li>
          <div data-testid="PricingItem">
            <div class="AgentDetails_agentDetails__MGEyM"><p>Trip.com</p></div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">${priceText}</p>
              <a href="/transport_deeplink/booking" aria-label="Select Trip.com." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    `;

    const result = parseSkyscannerPricingOptions(
      document,
      "US",
      "https://www.skyscanner.com/transport/flights/cju/nrt/260624/config/example",
    );

    expect(result.cheapest).toMatchObject({
      provider: "Trip.com",
      price,
      currency,
      priceText,
    });
  });

  it("uses China-market CNY for bare yen-symbol Skyscanner prices", () => {
    document.body.innerHTML = `
      <ol>
        <li>
          <div data-testid="PricingItem">
            <div class="AgentDetails_agentDetails__MGEyM"><p>Trip.com</p></div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">¥3,200 total.</p>
              <a href="/transport_deeplink/booking" aria-label="Select Trip.com." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    `;

    const result = parseSkyscannerPricingOptions(
      document,
      "CN",
      "https://cn.skyscanner.com/transport/flights/cju/nrt/260624/config/example",
    );

    expect(result.cheapest).toMatchObject({
      provider: "Trip.com",
      price: 3200,
      currency: "CNY",
      priceText: "¥3,200 total.",
    });
  });

  it("includes inferred currency in Skyscanner panel keys when the URL omits currency", () => {
    const url =
      "https://www.skyscanner.co.id/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&market=ID";

    expect(skyscannerPanelPageKey(url, "ID", false, "IDR")).toBe(
      "/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&currency=IDR",
    );
    expect(skyscannerPanelPageKey(`${url}&currency=USD`, "ID", false, "IDR")).toBe(
      "/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&currency=USD",
    );
  });

  it("parses RM-prefixed Skyscanner final-page prices", () => {
    document.body.innerHTML = `
      <ol>
        <li>
          <div data-testid="PricingItem">
            <div class="AgentDetails_agentDetails__MGEyM"><p>Trip.com</p></div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">RM 210 total.</p>
              <a href="/transport_deeplink/booking" aria-label="Select Trip.com." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    `;

    const result = parseSkyscannerPricingOptions(
      document,
      "MY",
      "https://www.skyscanner.com.my/transport/flights/cju/nrt/260624/config/example?currency=MYR",
    );

    expect(result.status).toBe("ready");
    expect(result.cheapest).toMatchObject({
      provider: "Trip.com",
      price: 210,
      currency: "MYR",
      priceText: "RM 210 total.",
    });
  });

  it("parses unified-search API itinerary rows", () => {
    const payload = {
      itineraries: {
        context: { status: "complete", totalResults: 1 },
        results: [
          {
            id: "10562-2606241255--32128-0-14788-2606241525",
            price: {
              raw: 212,
              formatted: "$212",
            },
            legs: [
              {
                id: "10562-2606241255--32128-0-14788-2606241525",
                durationInMinutes: 150,
                stopCount: 0,
                departure: "2026-06-24T12:55:00",
                arrival: "2026-06-24T15:25:00",
                carriers: {
                  marketing: [{ name: "Korean Air", alternateId: "KE" }],
                },
                segments: [
                  {
                    origin: { displayCode: "CJU" },
                    destination: { displayCode: "NRT" },
                    departure: "2026-06-24T12:55:00",
                    flightNumber: "2125",
                    marketingCarrier: {
                      name: "Korean Air",
                      alternateId: "KE",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const result = parseSkyscannerSearchApiResponse(
      payload,
      "US",
      "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/?currency=AUD",
    );

    expect(result.status).toBe("ready");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      price: 212,
      priceText: "$212",
      currency: "AUD",
      carrierText: "Korean Air, KE",
      timeText: "12:55-15:25",
      durationText: "2 hr 30 min",
      stopsText: "Nonstop",
      itineraryKey: "10562-2606241255--32128-0-14788-2606241525",
      matchConfidence: "high",
    });
  });

  it("finds Skyscanner result rows without treating sort/header containers as rows", () => {
    document.body.innerHTML = `
      <main>
        <section class="ItinerarySortHeader">
          <span>126 results sorted by Best</span>
          <button>Sort</button>
          <span>Cheapest $96</span>
        </section>
        <article data-testid="itinerary-card">
          <div>
            <p>Korean Air</p>
            <p>12:55 PM - 3:25 PM</p>
          </div>
          <div>
            <p>10 deals from</p>
            <strong>$204</strong>
            <a href="/transport/flights/cju/nrt/260624/config/example">Select</a>
          </div>
        </article>
      </main>
    `;

    const rows = skyscannerSearchResultRows(document);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Korean Air");
    expect(rows[0]?.textContent).not.toContain("126 results sorted by Best");
  });

  it("finds Skyscanner result rows with supported localized currency formats", () => {
    document.body.innerHTML = `
      <main>
        <article data-testid="itinerary-card">
          <p>Thai Airways</p>
          <p>1 deal from</p>
          <strong>THB 4,200</strong>
          <a href="/transport/flights/bkk/nrt/260624/config/example">Select</a>
        </article>
        <article data-testid="itinerary-card">
          <p>Malaysia Airlines</p>
          <p>1 deal from</p>
          <strong>RM 520</strong>
          <a href="/transport/flights/kul/nrt/260624/config/example">Select</a>
        </article>
      </main>
    `;

    const rows = skyscannerSearchResultRows(document);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Thai"),
      expect.stringContaining("Malaysia"),
    ]);
  });

  it("finds and parses sponsored inline-plus search rows", () => {
    document.body.innerHTML = `
      <main>
        <li id="dayview-first-result">
          <div class="ItineraryInlinePlus_container__ZGMxN">
            <a class="ItineraryInlinePlus_link__NTYwN" href="https://www.skyscanner.com/transport_deeplink/4.0/US/en-US/KRW/cust/1/17075.14788.2026-07-07/air/trava/inlineads" data-testid="inlineplus-link">
              <div data-testid="ticket">
                <div class="LogoImage_label__YzNiO">Jetstar Japan</div>
                <div class="FlightsTicketA11yDescriptor_visuallyHidden__ZGRhO">
                  <h3>Flight option 1: Sponsored by Trip.com. Total cost ₩317,400.</h3>
                  <ol>
                    <li>Flight with Jetstar Japan.</li>
                    <li>Departing from Taipei Taiwan Taoyuan at 2:40 AM, arriving in Tokyo Narita at 7:00 AM.</li>
                    <li>Direct flight taking 3 hours 20 minutes.</li>
                  </ol>
                </div>
                <div class="TicketStubContent_topContainer__YmQ5Z">
                  <span>Book with Trip.com from</span>
                  <div class="TicketStubContent_priceCluster__M2RlM">
                    <div class="TicketStubPrice_priceWrapper__OGEwZ">
                      <div class="Price_ticketStubPrice__Yzg5N">
                        <div class="Price_mainPriceContainer__NzBmO">
                          <span>₩317,400</span>
                        </div>
                      </div>
                    </div>
                    <button type="button">Select</button>
                  </div>
                </div>
              </div>
            </a>
          </div>
        </li>
      </main>
    `;

    const rows = skyscannerSearchResultRows(document);
    const parsed = parseSkyscannerSponsoredSearchRows(
      document,
      "US",
      "https://www.skyscanner.com/transport/flights/tpet/nrt/260707/?currency=KRW",
    );

    expect(rows).toHaveLength(1);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      carrierText: "Jetstar Japan",
      price: 317400,
      priceText: "₩317,400",
      currency: "KRW",
      durationText: "3 hr 20 min",
      stopsText: "Direct",
    });
  });

  it("parses visible sponsored row fare instead of earlier row numbers", () => {
    document.body.innerHTML = `
      <main>
        <li>
          <a data-testid="inlineplus-link" href="/transport/flights/cju/nrt/260624/config/example">
            <span>Flight with Korean Air.</span>
            <span>Departing from Jeju at 12:55 PM, arriving in Tokyo Narita at 3:25 PM.</span>
            <span>Direct flight taking 2 hours 30 minutes.</span>
            <span>17 deals from</span>
            <span>$208</span>
          </a>
        </li>
      </main>
    `;

    const parsed = parseSkyscannerSponsoredSearchRows(
      document,
      "US",
      "https://www.skyscanner.com/transport/flights/cju/nrt/260624/",
    );

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      carrierText: "Korean Air",
      price: 208,
      priceText: "$208",
      currency: "USD",
    });
  });
});
