import { readFileSync } from "node:fs";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  MOOFLIGHTS_GOOGLE_FLIGHTS_RESULTS_STORAGE_KEY,
  MOOFLIGHTS_SETTINGS_STORAGE_KEY,
  setGoogleFlightsCountries,
  waitForComparisonTab,
} from "./helpers";

const itaFixtureJson = readFileSync("src/shared/fixtures/itaRoundTrip.json", "utf8");

test.beforeEach(async ({ context }) => {
  await routeOptionalExtensionNetwork(context);
});

test("injects the ITA Matrix airport helper on routed search pages", async ({ page }) => {
  await routeItaFixture(page, matrixSearchFixture());

  await page.goto("https://matrix.itasoftware.com/search");

  const panel = page.locator("#mooflights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Airport helper")).toBeVisible();
  await expect(panel.getByLabel("Area")).toBeVisible();

  await panel.locator("summary[aria-label='Panel actions']").click();
  await panel.getByRole("button", { name: "Minimize" }).click();
  await expect(panel.getByLabel("Expand MooFlights panel")).toBeVisible();

  await panel.getByLabel("Expand MooFlights panel").click();
  await expect(panel.getByText("Airport helper")).toBeVisible();
});

test("parses pasted ITA itinerary JSON on routed itinerary pages", async ({ page }) => {
  await routeItaFixture(page, matrixItineraryFixture());

  await page.goto("https://matrix.itasoftware.com/itinerary");

  const panel = page.locator("#mooflights-panel");
  await expect(panel.getByText("Itinerary", { exact: true })).toBeVisible();

  await panel.getByText("Itinerary", { exact: true }).click();
  await expect(panel.getByText("Advanced fallback")).toBeVisible();
  await panel.getByText("Advanced fallback").click();
  await panel.getByPlaceholder("Paste ITA Matrix Copy as JSON output here").fill(itaFixtureJson);
  await panel.getByRole("button", { name: "Parse pasted JSON" }).click();

  await expect(panel.getByText("JFK-LHR AA100 I // LHR-JFK BA117 R")).toBeVisible();
  await expect(panel.getByText("round-trip")).toBeVisible();
  await expect(panel.getByText("USD 1234.56")).toBeVisible();
  await expect(panel.getByRole("link", { name: /Where to Credit/i })).toBeVisible();
});

test("opens Google Flights country comparison tabs from a routed US booking page", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.google.com/travel/flights/booking?tfs=CDIQAho_EgoyMDI2LTA4LTI3Ih8KA0hLRxIKMjAyNi0wOC0yNxoDVFBFKgJKWDIDMjM2agcIARIDSEtHcgcIARIDVFBFQAFIAZgBAg&curr=USD&gl=US";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "CA", "ZA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare country pricing")).toBeVisible();
  const skyscannerSearchLink = panel.getByRole("link", { name: "Search Skyscanner" });
  await expect(skyscannerSearchLink).toBeVisible();
  const skyscannerSearchHref = await skyscannerSearchLink.getAttribute("href");
  expect(skyscannerSearchHref).toEqual(expect.any(String));
  const skyscannerSearchUrl = new URL(skyscannerSearchHref as string);
  expect(skyscannerSearchUrl.hostname).toBe("www.skyscanner.com");
  expect(skyscannerSearchUrl.searchParams.get("currency")).toBe("USD");
  expect(skyscannerSearchUrl.searchParams.get("market")).toBe("US");
  await expect(panel.getByText("3 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (3)" })).toBeEnabled();

  const comparisonTabsPromise = Promise.all(["CA", "ZA"].map((country) => waitForComparisonTab(context, country)));
  await panel.getByRole("button", { name: "Compare (3)" }).click();

  const comparisonTabs = await comparisonTabsPromise;
  expect(comparisonTabs.map((comparisonPage) => new URL(comparisonPage.url()).searchParams.get("gl")).sort()).toEqual([
    "CA",
    "ZA",
  ]);
});

test("shows the current Google Flights country in the selector comparison count", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US";
  await setGoogleFlightsCountries(extensionServiceWorker, ["CA", "ZA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("3 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (3)" })).toBeEnabled();

  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(panel.getByText("0 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (0)" })).toBeDisabled();
});

test("does not count the current country when currency is unavailable", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&gl=US&barePriceFixture=1";
  await setGoogleFlightsCountries(extensionServiceWorker, ["CA", "ZA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("2 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (2)" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Compare (3)" })).not.toBeAttached();
});

test("does not count a non-country baseline when currency is available", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD";
  await setGoogleFlightsCountries(extensionServiceWorker, ["CA", "ZA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("2 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (2)" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Compare (3)" })).not.toBeAttached();
});

test("orders the current Google Flights country before tied comparison countries", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US&tieFixture=1";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "ZA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel.getByRole("button", { name: "Compare (2)" })).toBeEnabled();

  const comparisonTabPromise = waitForComparisonTab(context, "ZA");
  await panel.getByRole("button", { name: "Compare (2)" }).click();
  await comparisonTabPromise;

  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible({ timeout: 20_000 });
  const resultHeadings = await panel.locator(".result strong").allTextContents();
  expect(resultHeadings[0]).toContain("United States");
  expect(resultHeadings[0]).toContain("current");
  expect(resultHeadings[1]).toContain("South Africa");
});

test("keeps Google Flights comparison state through transient unresolved URLs", async ({
  context,
  extensionServiceWorker,
  page,
}, testInfo) => {
  testInfo.setTimeout(45_000);
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US";
  const transientUrl = "https://www.google.com/travel/flights?tfs=e2e-fixture&curr=USD&gl=US";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "CA", "ZA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);
  await enableGoogleFlightsDebugLog(page);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel.getByRole("button", { name: "Compare (3)" })).toBeEnabled();
  await page.waitForTimeout(10_100);

  const comparisonTabsPromise = Promise.all(["CA", "ZA"].map((country) => waitForComparisonTab(context, country)));
  await panel.getByRole("button", { name: "Compare (3)" }).click();
  await replaceGoogleFlightsHistory(page, transientUrl);
  await waitForGoogleFlightsDebugEvent(page, "keep-state-during-transient-empty-page-key");
  await expect(panel.getByRole("button", { name: "Checking..." })).toBeVisible();
  await replaceGoogleFlightsHistory(page, pageUrl);

  await comparisonTabsPromise;
  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("Canada", { exact: true })).toBeVisible();
  await expect(panel.getByText(/United States/)).toBeVisible();
  await expect(panel.getByText("Cached country comparison from just now.")).toBeVisible();
});

test("keeps Google Flights completed results through transient unresolved URLs", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US";
  const transientUrl = "https://www.google.com/travel/flights?tfs=e2e-fixture&curr=USD&gl=US";
  await setGoogleFlightsCachedResults(extensionServiceWorker, pageUrl);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);
  await enableGoogleFlightsDebugLog(page);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel.getByText("Cached country comparison from just now.")).toBeVisible();
  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible({ timeout: 20_000 });
  await replaceGoogleFlightsHistory(page, transientUrl);
  await waitForGoogleFlightsDebugEvent(page, "keep-state-during-transient-empty-page-key");

  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible();
  await expect(panel.getByText("Canada", { exact: true })).toBeVisible();
  await expect(panel.getByText("Cached country comparison from just now.")).toBeVisible();
});

test("uses newly rendered Google Flights JPY prices when booking URL omits currency", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.google.com/travel/flights/booking?tfs=CDIQAho_EgoyMDI2LTA4LTI3Ih8KA0hLRxIKMjAyNi0wOC0yNxoDVFBFKgJKWDIDMjM2agcIARIDSEtHcgcIARIDVFBFQAFIAZgBAg&gl=JP&noPriceFixture=1";
  await setGoogleFlightsCountries(extensionServiceWorker, ["CA"]);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await panel.getByRole("button", { name: /Compare/ }).click();
  await expect(panel.getByText("Google Flights prices are still loading. Try again when prices appear.")).toBeVisible();
  await page.evaluate(() => {
    const prices = [
      { label: "21,000 Japanese yen", text: "¥21,000" },
      { label: "24,000 Japanese yen", text: "¥24,000" },
    ];
    document.querySelectorAll(".gN1nAc").forEach((anchor, index) => {
      const price = prices[index] || prices[0];
      const span = document.createElement("span");
      span.setAttribute("aria-label", price.label);
      span.setAttribute("role", "text");
      span.textContent = price.text;
      anchor.append(span);
    });
  });

  const skyscannerSearchLink = panel.getByRole("link", { name: "Search Skyscanner" });
  await expect(skyscannerSearchLink).toHaveAttribute("href", /currency=JPY/);
  const comparisonTabPromise = waitForComparisonTab(context, "CA");
  await panel.getByRole("button", { name: /Compare/ }).click();

  const comparisonTab = await comparisonTabPromise;
  expect(new URL(comparisonTab.url()).searchParams.get("curr")).toBe("JPY");
});

test("resets Google Flights comparison state for explicit currency changes", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US";
  const nextCurrencyUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=JPY&gl=US";
  await setGoogleFlightsCachedResults(extensionServiceWorker, pageUrl);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel.getByText("Cached country comparison from just now.")).toBeVisible();
  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible();
  await replaceGoogleFlightsHistory(page, nextCurrencyUrl);

  await expect(panel.getByText("Cached country comparison from just now.")).not.toBeVisible();
  await expect(panel.getByText("South Africa", { exact: true })).not.toBeVisible();
});

test("does not show the Google Flights comparison panel on unresolved top-level tfs pages", async ({
  context,
  page,
}) => {
  const pageUrl =
    "https://www.google.com/travel/flights?tfs=CBwQARoeEgoyMDI2LTA2LTI0agcIARIDQ0pVcgcIARIDTlJUGh4SCjIwMjYtMDYtMzBqBwgBEgNOUlRyBwgBEgNDSlVAAUgBcAGCAQsI____________AZgBAQ&tfu=KgIIAw";
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  await expect(page.locator("#mooflights-google-flights-panel")).not.toBeAttached();
});

test("explains when Search Skyscanner cannot open a Google city search", async ({ context, page }) => {
  const pageUrl =
    "https://www.google.com/travel/flights/search?tfs=CBwQAhojEgoyMDI2LTA3LTA4agwIAhIIL20venp6enp6BwgBEgNOUlRAAUgBcAGCAQsI____________AZgBAg&tfu=EgoIABAAGAAgAigB";
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByRole("link", { name: "Search Skyscanner" })).not.toBeVisible();
  await expect(panel.getByRole("button", { name: "Search Skyscanner" })).toBeDisabled();
  await expect(panel.getByText("Unsupported route.")).toBeVisible();
});

test("opens Search Skyscanner for mapped Google city searches", async ({ context, page }) => {
  const pageUrl =
    "https://www.google.com/travel/flights/search?tfs=CBwQAhojEgoyMDI2LTA3LTA4agwIAhIIL20vMGZ0a3hyBwgBEgNOUlRAAUgBcAGCAQsI____________AZgBAg&tfu=EgoIABAAGAAgAigB&curr=TWD&gl=TW&hl=en-US";
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  const skyscannerSearchLink = panel.getByRole("link", { name: "Search Skyscanner" });
  await expect(skyscannerSearchLink).toBeVisible();
  const skyscannerSearchHref = await skyscannerSearchLink.getAttribute("href");
  expect(skyscannerSearchHref).toEqual(expect.any(String));
  const skyscannerSearchUrl = new URL(skyscannerSearchHref as string);
  expect(skyscannerSearchUrl.hostname).toBe("www.skyscanner.com.tw");
  expect(skyscannerSearchUrl.pathname).toBe("/transport/flights/tpet/nrt/260708/");
  expect(skyscannerSearchUrl.searchParams.get("currency")).toBe("TWD");
  expect(skyscannerSearchUrl.searchParams.get("market")).toBe("TW");
});

test("opens Skyscanner country comparison tabs from a routed final compare page", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "KR"]);
  await routeSkyscannerPricingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare country pricing")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (2)" })).toBeEnabled();

  const comparisonTabPromise = waitForSkyscannerComparisonTab(context, "KR");
  await panel.getByRole("button", { name: "Compare (2)" }).click();

  const comparisonTab = await comparisonTabPromise;
  const comparisonUrl = skyscannerTargetUrl(new URL(comparisonTab.url()));
  expect(comparisonUrl.hostname).toBe("www.skyscanner.co.kr");
  expect(comparisonUrl.searchParams.get("currency")).toBe("USD");
});

test("shows Skyscanner country comparison on routed multi-city final compare pages", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.skyscanner.com/transport/d/cju/2026-06-24/tyoa/tyoa/2026-06-27/sela/config/10562-2606241255--32128-0-14788-2606241525%7C14788-2606271400--32128-0-12409-2606271630?adultsv2=1&cabinclass=economy&childrenv2=";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "KR"]);
  await routeSkyscannerPricingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare country pricing")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (2)" })).toBeEnabled();
});

test("carries localized Skyscanner display currency into country comparison tabs", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&locale=ja-JP";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "KR"]);
  await routeSkyscannerPricingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare country pricing")).toBeVisible();

  const comparisonTabPromise = waitForSkyscannerComparisonTab(context, "KR");
  await panel.getByRole("button", { name: "Compare (2)" }).click();

  const comparisonUrl = skyscannerTargetUrl(new URL((await comparisonTabPromise).url()));
  expect(comparisonUrl.searchParams.get("currency")).toBe("JPY");
  expect(comparisonUrl.searchParams.get("locale")).toBe("ja-JP");
});

test("infers Skyscanner display currency from RM fare text", async ({ context, page }) => {
  const pageUrl =
    "https://www.skyscanner.com.my/transport/flights/cju/nrt/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&locale=en-US&market=MY";
  await routeSkyscannerPricingFixtures(context, {
    currencyLabel: null,
    hiddenCurrencyName: null,
    pricePrefix: "RM ",
  });

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  const googleFlightsSearchLink = panel.getByRole("link", { name: "Search Google Flights" });
  await expect(googleFlightsSearchLink).toBeVisible();
  const googleFlightsSearchHref = await googleFlightsSearchLink.getAttribute("href");
  expect(googleFlightsSearchHref).toEqual(expect.any(String));
  expect(new URL(googleFlightsSearchHref as string).searchParams.get("curr")).toBe("MYR");
});

test("infers Skyscanner display currency from R$ fare text", async ({ context, page }) => {
  const pageUrl =
    "https://www.skyscanner.com.br/transport/flights/cju/nrt/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&locale=en-US&market=BR";
  await routeSkyscannerPricingFixtures(context, {
    currencyLabel: null,
    hiddenCurrencyName: null,
    pricePrefix: "R$ ",
  });

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  const googleFlightsSearchLink = panel.getByRole("link", { name: "Search Google Flights" });
  await expect(googleFlightsSearchLink).toBeVisible();
  const googleFlightsSearchHref = await googleFlightsSearchLink.getAttribute("href");
  expect(googleFlightsSearchHref).toEqual(expect.any(String));
  expect(new URL(googleFlightsSearchHref as string).searchParams.get("curr")).toBe("BRL");
});

test("infers Skyscanner display currency from MX$ fare text", async ({ context, page }) => {
  const pageUrl =
    "https://www.skyscanner.com.mx/transport/flights/cju/nrt/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy&locale=en-US&market=MX";
  await routeSkyscannerPricingFixtures(context, {
    currencyLabel: null,
    hiddenCurrencyName: null,
    pricePrefix: "MX$ ",
  });

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  const googleFlightsSearchLink = panel.getByRole("link", { name: "Search Google Flights" });
  await expect(googleFlightsSearchLink).toBeVisible();
  const googleFlightsSearchHref = await googleFlightsSearchLink.getAttribute("href");
  expect(googleFlightsSearchHref).toEqual(expect.any(String));
  expect(new URL(googleFlightsSearchHref as string).searchParams.get("curr")).toBe("MXN");
});

test("keeps the current Skyscanner price visible when comparing other countries", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.skyscanner.com/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525?adultsv2=1&cabinclass=economy";
  await setGoogleFlightsCountries(extensionServiceWorker, ["KR"]);
  await routeSkyscannerPricingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("2 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare (2)" })).toBeEnabled();

  await panel.getByRole("button", { name: "Compare (2)" }).click();

  await expect(panel.getByText("United States")).toBeVisible();
  await expect(panel.getByText("current", { exact: true })).toBeVisible();
  await expect(panel.getByText("$210")).toBeVisible();
  await expect(panel.getByText("South Korea", { exact: true })).toBeVisible({ timeout: 25_000 });
});

test("renders Skyscanner search row comparison badges from captured API responses", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.skyscanner.co.za/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&childrenv2=&rtn=0&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD&locale=en-US&market=ZA&userSessionDataId=37a758a6-28c6-4733-ab8d-4501a8b360e8&preferdirects=false";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "KR"]);
  await routeSkyscannerSearchFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare visible flight rows")).toBeVisible();
  const googleFlightsSearchLink = panel.getByRole("link", { name: "Search Google Flights" });
  await expect(googleFlightsSearchLink).toBeVisible();
  const googleFlightsSearchHref = await googleFlightsSearchLink.getAttribute("href");
  expect(googleFlightsSearchHref).toEqual(expect.any(String));
  const googleFlightsSearchUrl = new URL(googleFlightsSearchHref as string);
  expect(googleFlightsSearchUrl.hostname).toBe("www.google.com");
  expect(googleFlightsSearchUrl.searchParams.get("curr")).toBe("USD");
  expect(googleFlightsSearchUrl.searchParams.get("gl")).toBe("ZA");
  expect(googleFlightsSearchUrl.searchParams.get("hl")).toBe("en-US");
  expect(googleFlightsSearchUrl.searchParams.get("q")).toBe("Flights from CJU to NRT on 2026-06-24 one way");
  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(panel.getByText("0 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare rows (0)" })).toBeDisabled();
  const countrySearch = panel.locator('[data-role="country-search"]');
  await countrySearch.fill("US");
  await countrySearch.press("Enter");
  await countrySearch.fill("KR");
  await countrySearch.press("Enter");
  await expect(panel.getByText("3 compared")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Compare rows (3)" })).toBeEnabled();

  await panel.getByRole("button", { name: "Compare rows (3)" }).click();
  await expect(page.locator("[data-moo-flights-search-badge]", { hasText: "South Korea $180" })).toBeVisible();

  const koreanAirCard = page.locator('[data-testid="itinerary-card"]', { hasText: "Korean Air" });
  const twayCard = page.locator('[data-testid="itinerary-card"]', { hasText: "Tway" });
  await expect(koreanAirCard.locator("[data-moo-flights-search-badge]", { hasText: "South Korea $180" })).toBeVisible();
  await expect(twayCard.locator("[data-moo-flights-search-badge]", { hasText: "Cheapest" })).toBeVisible();

  await page.locator('[data-action="sort-cheapest"]').click();
  await expect(page.locator('[data-testid="itinerary-card"]').first()).toContainText("Tway");
  await expect(koreanAirCard.locator("[data-moo-flights-search-badge]", { hasText: "South Korea $180" })).toBeVisible();
  await expect(twayCard.locator("[data-moo-flights-search-badge]", { hasText: "Cheapest" })).toBeVisible();

  const directPagePromise = context.waitForEvent("page");
  await koreanAirCard.locator("button[data-moo-flights-search-badge]").click();
  const directPage = await directPagePromise;
  await directPage.waitForURL(/\/transport\/flights\/cju\/nrt\/260624\/config\//);
  const directUrl = skyscannerTargetUrl(new URL(directPage.url()));
  expect(directUrl.hostname).toBe("www.skyscanner.co.kr");
  expect(directUrl.pathname).toBe(
    "/transport/flights/cju/nrt/260624/config/10562-2606241255--32128-0-14788-2606241525",
  );
  await directPage.close();
});

test("shows the Skyscanner search panel before an API response is captured", async ({ context, page }) => {
  const pageUrl =
    "https://www.skyscanner.co.za/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&childrenv2=&rtn=0&outboundaltsenabled=false&inboundaltsenabled=false&currency=USD&locale=en-US&market=ZA&userSessionDataId=37a758a6-28c6-4733-ab8d-4501a8b360e8&preferdirects=false";
  await routeSkyscannerSearchFixtures(context, { includeApiFetch: false });

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare visible flight rows")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Compare rows/ })).toBeDisabled();
});

test("updates Skyscanner search links after delayed currency text appears", async ({ context, page }) => {
  const pageUrl =
    "https://www.skyscanner.com/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&locale=ja-JP&market=US";
  await routeSkyscannerSearchFixtures(context, {
    includeApiFetch: false,
    delayedCurrencyLabel: "JPYでの価格",
  });

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  const googleFlightsSearchLink = panel.getByRole("link", { name: "Search Google Flights" });
  await expect(googleFlightsSearchLink).toBeVisible();
  await expect
    .poll(async () => new URL((await googleFlightsSearchLink.getAttribute("href")) || "").searchParams.get("curr"), {
      timeout: 4_000,
    })
    .toBe("JPY");
});

test("ignores stale Skyscanner search captures from the previous route", async ({ context, page }) => {
  const firstUrl =
    "https://www.skyscanner.co.za/transport/flights/cju/nrt/260624/?adultsv2=1&cabinclass=economy&currency=USD&locale=en-US&market=ZA";
  const secondUrl =
    "https://www.skyscanner.co.za/transport/flights/tpe/nrt/260707/?adultsv2=1&cabinclass=economy&currency=USD&locale=en-US&market=ZA";
  await routeSkyscannerSearchFixtures(context, {
    apiDelayMs: 800,
    includeApiFetchForUrl: (url) => url.includes("/transport/flights/cju/nrt/260624/"),
  });

  await page.goto(firstUrl);
  await page.goto(secondUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByRole("button", { name: /Compare rows/ })).toBeDisabled({ timeout: 2_000 });
});

test("renders Skyscanner row comparison on routed multi-city search pages", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl =
    "https://www.skyscanner.com/transport/d/cju/2026-06-24/tyoa/tyoa/2026-06-27/sela/?adultsv2=1&cabinclass=economy&childrenv2=";
  await setGoogleFlightsCountries(extensionServiceWorker, ["US", "KR"]);
  await routeSkyscannerSearchFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare visible flight rows")).toBeVisible();
  await panel.getByRole("button", { name: "Clear" }).click();
  const countrySearch = panel.locator('[data-role="country-search"]');
  await countrySearch.fill("US");
  await countrySearch.press("Enter");
  await countrySearch.fill("KR");
  await countrySearch.press("Enter");
  await expect(panel.getByRole("button", { name: "Compare rows (2)" })).toBeEnabled();

  await panel.getByRole("button", { name: "Compare rows (2)" }).click();
  await expect(page.locator("[data-moo-flights-search-badge]", { hasText: "South Korea $180" })).toBeVisible();
});

test("renders Google Flights cached country comparison prices on routed booking pages", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US";
  await setGoogleFlightsCachedResults(extensionServiceWorker, pageUrl);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel).toBeAttached();
  await expect(panel.getByText("Compare country pricing")).toBeVisible();

  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible();
  await expect(panel.getByText("$870")).toBeVisible();
  await expect(panel.getByText("Canada", { exact: true })).toBeVisible();
  await expect(panel.getByText("$900")).toBeVisible();
  await expect(panel.getByText(/United States/)).toBeVisible();
  await expect(panel.getByText("$950")).toBeVisible();
  await expect(panel.getByText(/2 option\(s\)/)).toHaveCount(3);
});

test("keeps the Google Flights panel scroll position while comparison results arrive", async ({
  context,
  extensionServiceWorker,
  page,
}) => {
  const pageUrl = "https://www.google.com/travel/flights/booking?tfs=e2e-fixture&curr=USD&gl=US";
  await setGoogleFlightsCachedResults(extensionServiceWorker, pageUrl);
  await routeGoogleFlightsBookingFixtures(context);

  await page.goto(pageUrl);

  const panel = page.locator("#mooflights-google-flights-panel");
  await expect(panel.getByText("South Africa", { exact: true })).toBeVisible();
  const comparisonTabsPromise = Promise.all(["CA", "ZA"].map((country) => waitForComparisonTab(context, country)));
  await panel.getByRole("button", { name: "Compare (3)" }).click();
  await expect(panel.getByRole("button", { name: "Checking..." })).toBeVisible();

  const initialScroll = await panel.evaluate((host) => {
    const shadow = host.shadowRoot;
    const panelElement = shadow?.querySelector<HTMLElement>(".panel");
    const anchor = panelElement?.querySelector<HTMLElement>(".country-chip");
    if (!shadow || !panelElement || !anchor) throw new Error("MooFlights panel was not rendered.");

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(".panel { max-height: 140px !important; }");
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
    panelElement.scrollTop = 80;
    return {
      anchorTop: anchor.getBoundingClientRect().top - panelElement.getBoundingClientRect().top,
      clientHeight: panelElement.clientHeight,
      scrollHeight: panelElement.scrollHeight,
      scrollTop: panelElement.scrollTop,
    };
  });
  expect(initialScroll.scrollHeight).toBeGreaterThan(initialScroll.clientHeight);
  expect(initialScroll.scrollTop).toBeGreaterThan(0);

  await comparisonTabsPromise;
  await expect(panel.getByText("Cached country comparison from just now.")).toBeVisible({ timeout: 20_000 });

  const finalScroll = await panel.evaluate((host) => {
    const panelElement = host.shadowRoot?.querySelector<HTMLElement>(".panel");
    const anchor = panelElement?.querySelector<HTMLElement>(".country-chip");
    if (!panelElement || !anchor) throw new Error("MooFlights panel was not rendered.");
    return {
      anchorTop: anchor.getBoundingClientRect().top - panelElement.getBoundingClientRect().top,
      scrollTop: panelElement.scrollTop,
    };
  });
  expect(finalScroll.anchorTop).toBeCloseTo(initialScroll.anchorTop, 0);
  expect(finalScroll.scrollTop).toBe(initialScroll.scrollTop);
});

async function routeOptionalExtensionNetwork(context: BrowserContext): Promise<void> {
  const fixtureDate = new Date().toISOString().slice(0, 10);
  await context.route("https://cdn.jsdelivr.net/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ date: fixtureDate, usd: { eur: 0.92, gbp: 0.78, jpy: 156, usd: 1 } }),
    });
  });
  await context.route("https://api.fxratesapi.com/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ date: fixtureDate, rates: { EUR: 0.92, GBP: 0.78, JPY: 156, USD: 1 } }),
    });
  });
}

async function routeItaFixture(page: Page, body: string): Promise<void> {
  await page.route("https://matrix.itasoftware.com/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body,
    });
  });
}

async function routeGoogleFlightsBookingFixtures(context: BrowserContext): Promise<void> {
  await context.route("https://www.google.com/travel/flights**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: googleFlightsBookingFixture(route.request().url()),
    });
  });
}

async function routeSkyscannerPricingFixtures(
  context: BrowserContext,
  options: { currencyLabel?: string | null; hiddenCurrencyName?: string | null; pricePrefix?: string } = {},
): Promise<void> {
  await context.route(/https:\/\/(?:[^/]+\.)?skyscanner\.[^/]+(?:\.[^/]+)?\/.*/, async (route) => {
    const url = new URL(route.request().url());
    if (!isSkyscannerTransportPath(url.pathname)) {
      await route.continue();
      return;
    }
    await route.fulfill({ contentType: "text/html", body: skyscannerPricingFixture(url.toString(), options) });
  });
}

async function routeSkyscannerSearchFixtures(
  context: BrowserContext,
  options: {
    includeApiFetch?: boolean;
    includeApiFetchForUrl?: (url: string) => boolean;
    apiDelayMs?: number;
    delayedCurrencyLabel?: string;
  } = {},
): Promise<void> {
  await context.route(/https:\/\/(?:[^/]+\.)?skyscanner\.[^/]+(?:\.[^/]+)?\/.*/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/g/radar/api/v2/web-unified-search/") {
      if (options.apiDelayMs) await new Promise((resolve) => setTimeout(resolve, options.apiDelayMs));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          skyscannerSearchApiFixture(
            url.toString(),
            route.request().headers()["x-skyscanner-market"],
            route.request().postData() || "",
          ),
        ),
      });
      return;
    }
    if (!isSkyscannerTransportPath(url.pathname)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: skyscannerSearchFixture(url.toString(), options),
    });
  });
}

async function setGoogleFlightsCachedResults(extensionServiceWorker: Worker, pageUrl: string): Promise<void> {
  const cacheKey = "/travel/flights/booking?tfs=e2e-fixture&curr=USD";
  await extensionServiceWorker.evaluate(
    async (fixtureState) => {
      await chrome.storage.local.set({
        [fixtureState.settingsStorageKey]: {
          googleFlights: {
            countryCodes: ["US", "CA", "ZA"],
          },
        },
        [fixtureState.googleFlightsResultsStorageKey]: {
          [fixtureState.cacheKey]: {
            cachedAt: Date.now(),
            results: ["US", "CA", "ZA"].map((country) => {
              const countryFixture = fixtureState.fixtures[country];
              return {
                country,
                url: fixtureState.urls[country],
                status: "ready",
                options: [
                  {
                    provider: countryFixture.provider,
                    price: countryFixture.cheapest,
                    currency: "USD",
                    priceText: `$${countryFixture.cheapest.toLocaleString()}`,
                    isDirect: false,
                    bookingUrl: `https://book.example/${country.toLowerCase()}/cheap`,
                  },
                  {
                    provider: "American",
                    price: countryFixture.direct,
                    currency: "USD",
                    priceText: `$${countryFixture.direct.toLocaleString()}`,
                    isDirect: true,
                    bookingUrl: `https://airline.example/${country.toLowerCase()}`,
                  },
                ],
              };
            }),
          },
        },
      });
    },
    {
      cacheKey,
      googleFlightsResultsStorageKey: MOOFLIGHTS_GOOGLE_FLIGHTS_RESULTS_STORAGE_KEY,
      settingsStorageKey: MOOFLIGHTS_SETTINGS_STORAGE_KEY,
      fixtures: {
        US: googleFlightsCountryFixture("US"),
        CA: googleFlightsCountryFixture("CA"),
        ZA: googleFlightsCountryFixture("ZA"),
      },
      urls: {
        US: countryUrl(pageUrl, "US"),
        CA: countryUrl(pageUrl, "CA"),
        ZA: countryUrl(pageUrl, "ZA"),
      },
    },
  );
}

async function enableGoogleFlightsDebugLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("mooFlightsDebug", "1");
    sessionStorage.removeItem("mooFlightsGoogleFlightsDebugLog");
  });
}

async function replaceGoogleFlightsHistory(page: Page, url: string): Promise<void> {
  await page.evaluate((nextUrl) => {
    history.replaceState(null, "", nextUrl);
    // Playwright runs this in the page world, while the content script wraps history in its isolated world.
    // Emit the event the content script observes so the test exercises the debounced navigation path.
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, url);
}

async function waitForGoogleFlightsDebugEvent(page: Page, eventName: string): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate((event) => {
        try {
          const log = JSON.parse(sessionStorage.getItem("mooFlightsGoogleFlightsDebugLog") || "[]");
          return Array.isArray(log) && log.some((entry) => entry?.event === event);
        } catch {
          return false;
        }
      }, eventName);
    })
    .toBe(true);
}

function countryUrl(pageUrl: string, country: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set("gl", country);
  return url.toString();
}

function matrixSearchFixture(): string {
  return htmlFixture(`
    <main>
      <h1>ITA Matrix search</h1>
      <form aria-label="Search flights">
        <input aria-label="Origin" value="">
        <input aria-label="Destination" value="">
      </form>
    </main>
  `);
}

function matrixItineraryFixture(): string {
  return htmlFixture(`
    <main>
      <h1>ITA Matrix itinerary</h1>
      <button type="button">Share & Export</button>
    </main>
  `);
}

function googleFlightsBookingFixture(url: string): string {
  const parsedUrl = new URL(url);
  const country = parsedUrl.searchParams.get("gl") || "US";
  const countryFixture = googleFlightsCountryFixture(country, parsedUrl.searchParams.get("tieFixture") === "1");
  const barePriceFixture = parsedUrl.searchParams.get("barePriceFixture") === "1";
  const noPriceFixture = parsedUrl.searchParams.get("noPriceFixture") === "1";
  const priceText = (value: number): string =>
    noPriceFixture
      ? ""
      : barePriceFixture
        ? `<span role="text">${value.toLocaleString()}</span>`
        : `<span aria-label="${value} US dollars">$${value.toLocaleString()}</span>`;

  return htmlFixture(`
    <main>
      <h1>Google Flights booking fixture</h1>
      <a class="gN1nAc" href="https://book.example/${country.toLowerCase()}/cheap">
        <span class="ogfYpf">Book with ${countryFixture.provider}</span>
        ${priceText(countryFixture.cheapest)}
      </a>
      <a class="gN1nAc" href="https://airline.example/${country.toLowerCase()}">
        <span class="ogfYpf">Book with American</span>
        <span class="EA71Tc">Direct</span>
        ${priceText(countryFixture.direct)}
      </a>
    </main>
  `);
}

function googleFlightsCountryFixture(
  country: string,
  tieFixture = false,
): { cheapest: number; direct: number; provider: string } {
  if (country === "CA") return { cheapest: 900, direct: 1120, provider: "Canada Deals" };
  if (tieFixture && country === "ZA") return { cheapest: 950, direct: 1300, provider: "South Africa Deals" };
  if (country === "ZA") return { cheapest: 870, direct: 1300, provider: "South Africa Deals" };
  return { cheapest: 950, direct: 1050, provider: "Example Travel" };
}

function isSkyscannerTransportPath(pathname: string): boolean {
  return pathname.startsWith("/transport/flights") || pathname.startsWith("/transport/d/");
}

function skyscannerPricingFixture(
  url: string,
  options: { currencyLabel?: string | null; hiddenCurrencyName?: string | null; pricePrefix?: string } = {},
): string {
  const parsedUrl = new URL(url);
  const country =
    parsedUrl.hostname === "www.skyscanner.co.kr" || parsedUrl.searchParams.get("market") === "KR"
      ? "KR"
      : parsedUrl.hostname === "www.skyscanner.com.my" || parsedUrl.searchParams.get("market") === "MY"
        ? "MY"
        : parsedUrl.hostname === "www.skyscanner.com.br" || parsedUrl.searchParams.get("market") === "BR"
          ? "BR"
          : "US";
  const displayCurrency = skyscannerFixtureDisplayCurrency(parsedUrl);
  const cheapest = country === "KR" ? 180 : 210;
  const second = cheapest + 12;
  const currency =
    options.hiddenCurrencyName === undefined
      ? country === "KR"
        ? "Korean won"
        : "US dollars"
      : options.hiddenCurrencyName;
  const symbol = options.pricePrefix ?? (country === "KR" ? "KRW " : "$");
  const currencyLabel =
    options.currencyLabel === undefined
      ? skyscannerFixtureCurrencyLabel(displayCurrency, parsedUrl)
      : options.currencyLabel;
  const hiddenPriceText = (price: number): string =>
    currency === null ? `${symbol}${price.toLocaleString()} total.` : `${price} ${currency} total.`;
  return htmlFixture(`
    <main>
      <h1>Skyscanner pricing fixture</h1>
      ${
        currencyLabel === null
          ? ""
          : `<div class="ProviderListTitle_header__N2IzY">
              <span class="ProviderListTitle_visuallyHidden__Mzg5M">${currencyLabel}</span>
              <p class="ProviderListTitle_subHeaderContainer__OGY4N">
                <span class="ProviderListTitle_subHeaderText__MmM2O">${currencyLabel}</span>
              </p>
            </div>`
      }
      <ol role="list" class="PricingOptions_list__YTlkY">
        <li>
          <div data-testid="PricingItem" class="PricingItem_pricingItemContainer__Y2YwO">
            <div class="AgentDetails_agentDetails__MGEyM">
              <p class="BpkText_bpk-text__ZWFlO">Flightnetwork ${country}</p>
              <h3 class="AgentDetails_visuallyHidden__MmJhM">Option 1: Flightnetwork ${country}</h3>
            </div>
            <div data-testid="CtaSection">
              <div class="TotalPrice_totalPrice__ZGMwZ">
                <p class="TotalPrice_visuallyHidden__NmEzM">${hiddenPriceText(cheapest)}</p>
                <div class="Price_pricingItemPrice__ZjBkZ" aria-hidden="true">
                  <span>${symbol}${cheapest.toLocaleString()}</span>
                </div>
              </div>
              <a href="/transport_deeplink/${country.toLowerCase()}/cheap" aria-label="Select Flightnetwork ${country}." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
        <li>
          <div data-testid="PricingItem" class="PricingItem_pricingItemContainer__Y2YwO">
            <div class="AgentDetails_agentDetails__MGEyM">
              <p>Booking.com ${country}</p>
              <h3>Option 2: Booking.com ${country}</h3>
            </div>
            <div data-testid="CtaSection">
              <p class="TotalPrice_visuallyHidden__NmEzM">${hiddenPriceText(second)}</p>
              <a href="/transport_deeplink/${country.toLowerCase()}/booking" aria-label="Select Booking.com ${country}." data-testid="pricing-item-redirect-button">Select</a>
            </div>
          </div>
        </li>
      </ol>
    </main>
  `);
}

function skyscannerFixtureDisplayCurrency(url: URL): string {
  return url.searchParams.get("currency") || (url.searchParams.get("locale") === "ja-JP" ? "JPY" : "USD");
}

function skyscannerFixtureCurrencyLabel(currency: string, url: URL): string {
  return url.searchParams.get("locale") === "ja-JP" ? `${currency}での価格` : `Prices in ${currency}`;
}

function skyscannerSearchFixture(
  url: string,
  options: {
    includeApiFetch?: boolean;
    includeApiFetchForUrl?: (url: string) => boolean;
    delayedCurrencyLabel?: string;
  } = {},
): string {
  const parsedUrl = new URL(url);
  const country =
    parsedUrl.hostname === "www.skyscanner.co.kr" || parsedUrl.searchParams.get("market") === "KR" ? "KR" : "US";
  const firstPrice = country === "KR" ? 180 : 210;
  const secondPrice = country === "KR" ? 220 : 170;
  const includeApiFetch =
    options.includeApiFetch !== false && (options.includeApiFetchForUrl ? options.includeApiFetchForUrl(url) : true);
  return htmlFixture(`
    <main>
      <h1>Skyscanner search fixture</h1>
      <nav aria-label="Sort results">
        <button type="button" data-action="sort-best">Best</button>
        <button type="button" data-action="sort-cheapest">Cheapest</button>
        <button type="button" data-action="sort-fastest">Fastest</button>
      </nav>
      <section>
        <div data-testid="itinerary-card" class="ItineraryCard" data-sort-price="${firstPrice}" data-sort-best="1">
          <h2>Korean Air</h2>
          <p>12:55 - 15:25</p>
          <p>Nonstop · 2 hr 30 min</p>
          <div class="PriceSection"><span>$${firstPrice}</span></div>
          <a href="/transport/flights/cju/tyoa/260624/config/10562-2606241255--32128-0-14788-2606241525">Select</a>
        </div>
        <div data-testid="itinerary-card" class="ItineraryCard" data-sort-price="${secondPrice}" data-sort-best="2">
          <h2>Tway</h2>
          <p>8:30 - 11:10</p>
          <p>Nonstop · 2 hr 40 min</p>
          <div class="PriceSection"><span>$${secondPrice}</span></div>
          <a href="/transport/flights/cju/tyoa/260624/config/10562-2606240830--12345-0-14788-2606241110">Select</a>
        </div>
      </section>
      <script>
        const resultSection = document.querySelector("section");
        function sortCards(compare) {
          const cards = Array.from(document.querySelectorAll('[data-testid="itinerary-card"]'));
          cards.sort(compare).forEach((card) => resultSection.append(card));
        }
        document.querySelector('[data-action="sort-best"]').addEventListener("click", () => {
          sortCards((left, right) => Number(left.dataset.sortBest) - Number(right.dataset.sortBest));
        });
        document.querySelector('[data-action="sort-cheapest"]').addEventListener("click", () => {
          sortCards((left, right) => Number(left.dataset.sortPrice) - Number(right.dataset.sortPrice));
        });
        document.querySelector('[data-action="sort-fastest"]').addEventListener("click", () => {
          sortCards((left, right) => Number(left.dataset.sortBest) - Number(right.dataset.sortBest));
        });
      </script>
      ${
        includeApiFetch
          ? `<script>
              fetch("/g/radar/api/v2/web-unified-search/", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  fixture: true,
                  market: "${country}",
                  query: {
                    originPlace: { id: "CJU", countryCode: "KR" },
                    destinationPlace: { id: "NRT", countryCode: "JP" },
                    passengerMetadata: { country: "ZA" }
                  }
                })
              }).catch(() => {});
            </script>`
          : ""
      }
      ${
        options.delayedCurrencyLabel
          ? `<script>
              window.setTimeout(() => {
                const label = document.createElement("div");
                label.className = "ProviderListTitle_header__N2IzY";
                label.textContent = ${JSON.stringify(options.delayedCurrencyLabel)};
                document.body.append(label);
              }, 1000);
            </script>`
          : ""
      }
    </main>
  `);
}

function skyscannerSearchApiFixture(url: string, marketHeader = "", requestBodyText = ""): unknown {
  const parsedUrl = new URL(url);
  const requestBody = jsonObject(requestBodyText);
  const hasSafeMarketBody =
    requestBody.market === "KR" &&
    jsonObject(jsonObject(requestBody.query).originPlace).countryCode === "KR" &&
    jsonObject(jsonObject(requestBody.query).destinationPlace).countryCode === "JP" &&
    jsonObject(jsonObject(requestBody.query).passengerMetadata).country === "ZA";
  const requestedKrMarket =
    marketHeader === "KR" ||
    parsedUrl.hostname === "www.skyscanner.co.kr" ||
    parsedUrl.searchParams.get("market") === "KR";
  const country = requestedKrMarket && hasSafeMarketBody ? "KR" : "US";
  const firstPrice = country === "KR" ? 180 : 210;
  const secondPrice = country === "KR" ? 220 : 170;
  return {
    itineraries: {
      context: {
        status: "complete",
        totalResults: 1,
      },
      results: [
        {
          id: "10562-2606241255--32128-0-14788-2606241525",
          price: {
            raw: firstPrice,
            formatted: `$${firstPrice}`,
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
        {
          id: "10562-2606240830--12345-0-14788-2606241110",
          price: {
            raw: secondPrice,
            formatted: `$${secondPrice}`,
          },
          legs: [
            {
              id: "10562-2606240830--12345-0-14788-2606241110",
              durationInMinutes: 160,
              stopCount: 0,
              departure: "2026-06-24T08:30:00",
              arrival: "2026-06-24T11:10:00",
              carriers: {
                marketing: [{ name: "Tway", alternateId: "TW" }],
              },
              segments: [
                {
                  origin: { displayCode: "CJU" },
                  destination: { displayCode: "NRT" },
                  departure: "2026-06-24T08:30:00",
                  flightNumber: "123",
                  marketingCarrier: {
                    name: "Tway",
                    alternateId: "TW",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function waitForSkyscannerComparisonTab(
  context: BrowserContext,
  country: string,
  timeout = 15_000,
): Promise<Page> {
  const deadline = Date.now() + timeout;
  const expectedMarket = skyscannerMarketForCountry(country);

  return new Promise<Page>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => fail(new Error(`Timed out waiting for ${country} Skyscanner comparison tab.`)),
      timeout,
    );

    function resolveOnce(page: Page): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.off("page", onPage);
      resolve(page);
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.off("page", onPage);
      reject(error);
    }

    function watchPage(page: Page): void {
      const remaining = Math.max(1, deadline - Date.now());
      void page
        .waitForURL(
          (candidateUrl) => {
            return skyscannerMarketFromUrl(candidateUrl) === expectedMarket;
          },
          { timeout: remaining },
        )
        .then(() => resolveOnce(page))
        .catch(() => {});
    }

    function onPage(page: Page): void {
      watchPage(page);
    }

    context.on("page", onPage);
    for (const page of context.pages()) watchPage(page);
  });
}

function skyscannerMarketForCountry(country: string): string {
  const normalizedCountry = country.trim().toUpperCase();
  return normalizedCountry === "GB" ? "UK" : normalizedCountry;
}

function skyscannerMarketFromUrl(url: URL): string {
  const targetUrl = skyscannerTargetUrl(url);
  if (targetUrl !== url) return skyscannerMarketFromUrl(targetUrl);
  const market = url.searchParams.get("market");
  if (market) return skyscannerMarketForCountry(market);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "www.skyscanner.com") return "US";
  if (hostname === "www.skyscanner.net" || hostname === "www.skyscanner.co.uk") return "UK";
  if (hostname === "cn.skyscanner.com") return "CN";
  if (hostname === "gr.skyscanner.com") return "GR";
  if (hostname === "ro.skyscanner.com") return "RO";
  const countryHostMatch = hostname.match(/^www\.skyscanner\.(?:co|com)\.([a-z]{2})$/);
  if (countryHostMatch) return skyscannerMarketForCountry(countryHostMatch[1]);
  const tldHostMatch = hostname.match(/^www\.skyscanner\.([a-z]{2})$/);
  return tldHostMatch ? skyscannerMarketForCountry(tldHostMatch[1]) : "";
}

function skyscannerTargetUrl(url: URL): URL {
  if (!url.pathname.startsWith("/sttc/px/captcha-v2/")) return url;
  const encodedUrl = url.searchParams.get("url");
  if (!encodedUrl) return url;
  try {
    return new URL(Buffer.from(encodedUrl, "base64").toString("utf8"), url.origin);
  } catch {
    return url;
  }
}

function htmlFixture(body: string): string {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>MooFlights E2E fixture</title>
      </head>
      <body>${body}</body>
    </html>`;
}
