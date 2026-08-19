import type { BookingOption, CountryResult, SearchCountryResult, SearchResult } from "./countryComparison";

export const DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES = [
  "US",
  "CA",
  "GB",
  "JP",
  "TW",
  "HK",
  "SG",
  "KR",
  "AU",
  "MY",
  "ES",
  "VN",
  "ZA",
  "IN",
  "PH",
  "NZ",
  "CN",
  "ID",
];
const DEFAULT_GOOGLE_FLIGHTS_CURRENCY = "USD";
const GOOGLE_FLIGHTS_BOOKING_PATH_RE = /^\/travel\/flights\/booking/;
const GOOGLE_FLIGHTS_ITINERARY_PATH = "/travel/flights";
export const GOOGLE_FLIGHTS_SEARCH_RESULT_ROW_SELECTOR = [
  ".pIav2d",
  ".yR1fYc",
  "[data-flt-ve]",
  "[role='listitem']",
].join(",");
const MOO_FLIGHTS_SEARCH_BADGE_SELECTOR = "[data-moo-flights-search-badge]";
const GOOGLE_FLIGHTS_CURRENCIES = new Set(
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XCD XDR XOF XPF XSU XUA YER ZAR ZMW ZWG".split(
    " ",
  ),
);

export type GoogleFlightsFlightSegment = {
  origin: string;
  destination: string;
  departureDate: string;
  sliceDate?: string;
  sliceGroup?: number;
  carrier?: string;
  flightNumber?: string;
};

export type GoogleFlightsMatrixCabin = "COACH" | "PREMIUM-COACH" | "BUSINESS" | "FIRST";

export type GoogleFlightsMatrixSearch = {
  tripType: "one-way" | "round-trip" | "multi-city";
  cabin: GoogleFlightsMatrixCabin;
  currency: string;
  slices: Array<{
    origin: string;
    destination: string;
    departureDate: string;
    segments: GoogleFlightsFlightSegment[];
  }>;
  carriers: string[];
  matrixUrl: string;
};

export function googleFlightsCountryUrl(
  baseUrl: string,
  country: string,
  currency = DEFAULT_GOOGLE_FLIGHTS_CURRENCY,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("gl", country);
  const fallbackCurrency = normalizeGoogleFlightsCurrency(currency) || DEFAULT_GOOGLE_FLIGHTS_CURRENCY;
  const urlCurrency = normalizeGoogleFlightsCurrency(url.searchParams.get("curr"));
  url.searchParams.set("curr", urlCurrency || fallbackCurrency);
  return url.toString();
}

export function googleFlightsPanelPageKey(
  url: string,
  country: string,
  includeCountry: boolean,
  currency = DEFAULT_GOOGLE_FLIGHTS_CURRENCY,
): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return "";
  }
  if (!isGoogleFlightsPanelPage(parsedUrl)) return "";

  const params = new URLSearchParams();
  const tfs = parsedUrl.searchParams.get("tfs");
  const keyNames = tfs ? ["tfs", "tfu"] : ["q", "origin", "destination", "depart", "return"];
  for (const key of keyNames) {
    const value = parsedUrl.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const fallbackCurrency = normalizeGoogleFlightsCurrency(currency) || DEFAULT_GOOGLE_FLIGHTS_CURRENCY;
  const urlCurrency = normalizeGoogleFlightsCurrency(parsedUrl.searchParams.get("curr"));
  params.set("curr", urlCurrency || fallbackCurrency);
  if (includeCountry) params.set("gl", country);
  return `${parsedUrl.pathname}?${params.toString()}`;
}

export function isGoogleFlightsPanelPageUrl(url: string): boolean {
  try {
    return isGoogleFlightsPanelPage(new URL(url));
  } catch {
    return false;
  }
}

function isGoogleFlightsPanelPage(url: URL): boolean {
  if (GOOGLE_FLIGHTS_BOOKING_PATH_RE.test(url.pathname)) return true;
  if (url.pathname === GOOGLE_FLIGHTS_ITINERARY_PATH) {
    return url.searchParams.get("source") === "ita_matrix" || hasGoogleFlightsSearchParams(url.searchParams);
  }
  return (
    url.pathname.startsWith(`${GOOGLE_FLIGHTS_ITINERARY_PATH}/`) &&
    (Boolean(url.searchParams.get("tfs")) || hasGoogleFlightsSearchParams(url.searchParams)) &&
    !GOOGLE_FLIGHTS_BOOKING_PATH_RE.test(url.pathname)
  );
}

function hasGoogleFlightsSearchParams(params: URLSearchParams): boolean {
  if (params.get("q")) return true;
  return Boolean(params.get("origin") && params.get("destination") && params.get("depart"));
}

export function normalizeGoogleFlightsCountryCodes(
  value: unknown,
  fallback = DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<string>();
  const codes = value
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter((item) => /^[A-Z]{2}$/.test(item))
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });

  return codes.length > 0 ? codes : [...fallback];
}

export function inferGoogleFlightsCurrency(root: ParentNode): string {
  for (const element of Array.from(root.querySelectorAll("[aria-label], [role='text']"))) {
    const ariaLabel = element.getAttribute("aria-label") || "";
    const visibleText = normalizedText(element.textContent || "");
    const ariaCurrency = ariaLabel ? inferCurrencyFromPriceText(ariaLabel) : "";
    if (ariaCurrency) return ariaCurrency;

    const visibleCurrency = visibleText ? inferCurrencyFromPriceText(visibleText) : "";
    if (visibleCurrency) return visibleCurrency;
  }
  return "";
}

export function normalizeGoogleFlightsCurrency(value: unknown): string {
  if (typeof value !== "string") return "";
  const currency = value.trim().toUpperCase();
  return GOOGLE_FLIGHTS_CURRENCIES.has(currency) ? currency : "";
}

export function parseGoogleFlightsCountryInput(value: string): string[] {
  return normalizeGoogleFlightsCountryCodes(value.split(/[,\s]+/), []);
}

export function parseGoogleFlightsMatrixSearch(
  url: string,
  fallbackCurrency = DEFAULT_GOOGLE_FLIGHTS_CURRENCY,
): GoogleFlightsMatrixSearch | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  const tfs = parsedUrl.searchParams.get("tfs");
  if (!tfs) return null;
  const cabin = parseGoogleFlightsTfsCabin(tfs);
  const currency =
    normalizeGoogleFlightsCurrency(parsedUrl.searchParams.get("curr")) ||
    normalizeGoogleFlightsCurrency(fallbackCurrency) ||
    DEFAULT_GOOGLE_FLIGHTS_CURRENCY;
  const segments = parseGoogleFlightsTfsSegments(tfs);
  if (segments.length === 0) return null;
  const slices = groupGoogleFlightsSegments(segments);
  if (slices.length === 0) return null;
  const tripType = googleFlightsTripType(slices);
  return {
    tripType,
    cabin,
    currency,
    slices,
    carriers: Array.from(new Set(segments.map((segment) => segment.carrier).filter(isString))).sort(),
    matrixUrl: buildItaMatrixSearchUrl(tripType, slices, cabin, currency),
  };
}

export function parseBookingOptions(root: ParentNode, country: string, url: string): CountryResult {
  const options = Array.from(root.querySelectorAll(".gN1nAc"))
    .map((row) => parseBookingOption(row, url))
    .filter((option): option is BookingOption => Boolean(option))
    .sort((left, right) => left.price - right.price || left.provider.localeCompare(right.provider));

  return {
    country,
    url,
    options,
    cheapest: options[0],
    direct: options.find((option) => option.isDirect),
    status: options.length > 0 ? "ready" : "empty",
  };
}

export const parseGoogleFlightsBookingOptions = parseBookingOptions;

export function parseSearchResults(
  root: ParentNode,
  country: string,
  url: string,
  limit = Number.POSITIVE_INFINITY,
): SearchCountryResult {
  const results = searchResultRows(root)
    .map((row, index) => parseSearchResultRow(row, index))
    .filter((result): result is SearchResult => Boolean(result))
    .slice(0, limit);

  return {
    country,
    url,
    results,
    status: results.length > 0 ? "ready" : "empty",
  };
}

export const parseGoogleFlightsSearchResults = parseSearchResults;

export function searchResultRows(root: ParentNode): Element[] {
  const seen = new Set<Element>();
  const rows: Element[] = [];
  for (const element of Array.from(root.querySelectorAll(GOOGLE_FLIGHTS_SEARCH_RESULT_ROW_SELECTOR))) {
    if (seen.has(element) || element.closest(MOO_FLIGHTS_SEARCH_BADGE_SELECTOR)) continue;
    seen.add(element);
    const text = normalizedSearchResultText(element);
    if (!text || text.length < 20) continue;
    if (!hasSearchResultSignal(text)) continue;
    if (!parseSearchResultPrice(element)) continue;
    if (rows.some((row) => row !== element && row.contains(element))) continue;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (element.contains(rows[index])) rows.splice(index, 1);
    }
    rows.push(element);
  }
  return rows;
}

function parseGoogleFlightsTfsSegments(tfs: string): GoogleFlightsFlightSegment[] {
  const decoded = decodeBase64UrlText(tfs);
  if (!decoded) return [];
  const slices = googleFlightsTfsSliceBlocks(decoded);
  const parsedSlices = slices.length > 0 ? slices : [{ value: decoded, group: 0 }];
  const segments = parsedSlices.flatMap((slice) => parseGoogleFlightsTfsSliceSegments(slice.value, slice.group));
  return dedupeGoogleFlightsSegments(segments);
}

function googleFlightsTfsSliceBlocks(value: string): Array<{ value: string; group: number }> {
  const blocks: Array<{ value: string; group: number }> = [];
  let group = 0;
  for (let index = 0; index < value.length - 2; index += 1) {
    if (value.charCodeAt(index) !== 26) continue;
    const length = readVarint(value, index + 1);
    if (!length) continue;
    const start = length.nextIndex;
    const end = start + length.value;
    if (end > value.length) continue;
    const block = value.slice(start, end);
    if (!/\d{4}-\d{2}-\d{2}/.test(block) || !/[A-Z]{3}/.test(block)) continue;
    blocks.push({ value: block, group });
    group += 1;
    index = end - 1;
  }
  return blocks;
}

function readVarint(value: string, startIndex: number): { value: number; nextIndex: number } | null {
  let result = 0;
  let shift = 0;
  for (let index = startIndex; index < value.length; index += 1) {
    const byte = value.charCodeAt(index);
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, nextIndex: index + 1 };
    shift += 7;
    if (shift > 28) return null;
  }
  return null;
}

function parseGoogleFlightsTfsSliceSegments(value: string, group: number): GoogleFlightsFlightSegment[] {
  const segments: GoogleFlightsFlightSegment[] = [];
  const sliceDate = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  // biome-ignore lint/complexity/useRegexLiterals: constructor keeps protobuf control markers out of a regex literal.
  const pattern = new RegExp(
    "\\x0a\\x03([A-Z]{3})\\x12\\x0a(\\d{4}-\\d{2}-\\d{2})[\\x1a\\x5a]\\x03([A-Z]{3})\\x2a\\x02([A-Z][A-Z0-9]|[0-9][A-Z])\\x32[\\x01-\\x04](\\d{1,4})",
    "g",
  );
  let match = pattern.exec(value);
  while (match) {
    const [, origin, segmentDate, destination, carrier, flightNumber] = match;
    segments.push({
      origin: origin || "",
      destination: destination || "",
      departureDate: segmentDate || sliceDate || "",
      sliceDate,
      sliceGroup: group,
      carrier,
      flightNumber,
    });
    match = pattern.exec(value);
  }
  return segments.length > 0 ? segments : parseGoogleFlightsTfsRouteOnlySegment(value, group, sliceDate);
}

function parseGoogleFlightsTfsRouteOnlySegment(
  value: string,
  group: number,
  sliceDate: string | undefined,
): GoogleFlightsFlightSegment[] {
  if (!sliceDate) return [];
  // Route-only Google Flights search URLs can encode just date + endpoints, without carrier or flight number fields.
  // biome-ignore lint/complexity/useRegexLiterals: constructor keeps protobuf control markers out of a regex literal.
  const routePattern = new RegExp(
    "\\x12\\x0a(\\d{4}-\\d{2}-\\d{2}).*?\\x6a\\x07\\x08[\\x00-\\x04]\\x12\\x03([A-Z]{3}).*?\\x72\\x07\\x08[\\x00-\\x04]\\x12\\x03([A-Z]{3})",
    "s",
  );
  const match = routePattern.exec(value);
  if (!match) return [];
  const [, departureDate, origin, destination] = match;
  if (!origin || !destination) return [];
  return [
    {
      origin,
      destination,
      departureDate: departureDate || sliceDate,
      sliceDate,
      sliceGroup: group,
    },
  ];
}

function parseGoogleFlightsTfsCabin(tfs: string): GoogleFlightsMatrixCabin {
  const decoded = decodeBase64UrlText(tfs);
  if (!decoded) return "COACH";
  return cabinFromGoogleFlightsTfsField(decoded, 9) || cabinFromGoogleFlightsTfsField(decoded, 19) || "COACH";
}

function cabinFromGoogleFlightsTfsField(value: string, fieldNumber: number): GoogleFlightsMatrixCabin | "" {
  return cabinFromProtobufMessage(value, fieldNumber, 0, value.length, 0);
}

function cabinFromProtobufMessage(
  value: string,
  fieldNumber: number,
  startIndex: number,
  endIndex: number,
  depth: number,
): GoogleFlightsMatrixCabin | "" {
  for (let index = startIndex; index < endIndex; ) {
    const tag = readProtobufTag(value, index);
    if (!tag || tag.nextIndex > endIndex) return "";
    if (tag.fieldNumber === fieldNumber && tag.wireType === 0) {
      const cabin = readVarint(value, tag.nextIndex);
      if (!cabin || cabin.nextIndex > endIndex) return "";
      const mapped = googleFlightsCabinValue(cabin.value);
      if (mapped) return mapped;
      index = cabin.nextIndex;
      continue;
    }
    if (tag.wireType === 2 && depth < 6) {
      const length = readVarint(value, tag.nextIndex);
      const nestedStart = length?.nextIndex || 0;
      const nestedEnd = nestedStart + (length?.value || 0);
      if (length && nestedStart <= endIndex && nestedEnd <= endIndex) {
        const nestedCabin = cabinFromProtobufMessage(value, fieldNumber, nestedStart, nestedEnd, depth + 1);
        if (nestedCabin) return nestedCabin;
      }
    }
    const nextIndex = skipProtobufField(value, tag, endIndex);
    if (nextIndex <= index) return "";
    index = nextIndex;
  }
  return "";
}

function readProtobufTag(
  value: string,
  startIndex: number,
): { fieldNumber: number; wireType: number; nextIndex: number } | null {
  const tag = readVarint(value, startIndex);
  if (!tag) return null;
  return {
    fieldNumber: tag.value >> 3,
    wireType: tag.value & 7,
    nextIndex: tag.nextIndex,
  };
}

function skipProtobufField(
  value: string,
  tag: { fieldNumber: number; wireType: number; nextIndex: number },
  endIndex = value.length,
): number {
  if (tag.wireType === 0) return readVarint(value, tag.nextIndex)?.nextIndex || tag.nextIndex;
  if (tag.wireType === 1) return Math.min(endIndex, tag.nextIndex + 8);
  if (tag.wireType === 2) {
    const length = readVarint(value, tag.nextIndex);
    if (!length) return tag.nextIndex;
    return Math.min(endIndex, length.nextIndex + length.value);
  }
  if (tag.wireType === 3) return skipProtobufGroup(value, tag.fieldNumber, tag.nextIndex, endIndex);
  if (tag.wireType === 4) return tag.nextIndex;
  if (tag.wireType === 5) return Math.min(endIndex, tag.nextIndex + 4);
  return tag.nextIndex;
}

function skipProtobufGroup(value: string, fieldNumber: number, startIndex: number, endIndex: number): number {
  let index = startIndex;
  while (index < endIndex) {
    const tag = readProtobufTag(value, index);
    if (!tag) return index + 1;
    if (tag.wireType === 4 && tag.fieldNumber === fieldNumber) return tag.nextIndex;
    const nextIndex = skipProtobufField(value, tag, endIndex);
    index = nextIndex > index ? nextIndex : index + 1;
  }
  return index;
}

function googleFlightsCabinValue(value: number): GoogleFlightsMatrixCabin | "" {
  if (value === 1) return "COACH";
  if (value === 2) return "PREMIUM-COACH";
  if (value === 3) return "BUSINESS";
  if (value === 4) return "FIRST";
  return "";
}

function dedupeGoogleFlightsSegments(segments: GoogleFlightsFlightSegment[]): GoogleFlightsFlightSegment[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const key = [
      segment.origin,
      segment.destination,
      segment.departureDate,
      segment.sliceDate || "",
      typeof segment.sliceGroup === "number" ? segment.sliceGroup : "",
      segment.carrier || "",
      segment.flightNumber || "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupGoogleFlightsSegments(segments: GoogleFlightsFlightSegment[]): GoogleFlightsMatrixSearch["slices"] {
  const slices: GoogleFlightsMatrixSearch["slices"] = [];
  for (const segment of segments) {
    const current = slices.at(-1);
    const currentOrigin = current?.segments[0]?.origin;
    const currentDestination = current?.segments.at(-1)?.destination;
    const currentSliceGroup = current?.segments[0]?.sliceGroup;
    const sameSliceGroup =
      typeof currentSliceGroup === "number" && typeof segment.sliceGroup === "number"
        ? currentSliceGroup === segment.sliceGroup
        : currentDestination === segment.origin;
    const isConnection =
      current && sameSliceGroup && currentDestination === segment.origin && segment.destination !== currentOrigin;
    if (current && isConnection) {
      current.destination = segment.destination;
      current.segments.push(segment);
      continue;
    }
    slices.push({
      origin: segment.origin,
      destination: segment.destination,
      departureDate: segment.departureDate,
      segments: [segment],
    });
  }
  return slices;
}

function googleFlightsTripType(slices: GoogleFlightsMatrixSearch["slices"]): GoogleFlightsMatrixSearch["tripType"] {
  if (slices.length === 1) return "one-way";
  const [first, second] = slices;
  if (slices.length === 2 && first?.origin === second?.destination && first?.destination === second?.origin) {
    return "round-trip";
  }
  return "multi-city";
}

export function buildItaMatrixSearchUrl(
  tripType: GoogleFlightsMatrixSearch["tripType"],
  slices: GoogleFlightsMatrixSearch["slices"],
  cabin: GoogleFlightsMatrixCabin,
  currency: string,
): string {
  const matrixSlices =
    tripType === "round-trip" && slices[0] && slices[1]
      ? [matrixSearchSlice(slices[0], slices[1])]
      : slices.map((slice) => matrixSearchSlice(slice));
  const payload = {
    type: tripType,
    mooFlightsAutoOpen: "1",
    mooFlightsAutoSearch: "1",
    slices: matrixSlices,
    options: {
      cabin,
      stops: "-1",
      extraStops: "1",
      allowAirportChanges: "true",
      showOnlyAvailable: "true",
      currency: { code: currency },
    },
    pax: {
      adults: "1",
    },
  };
  const params = new URLSearchParams({
    search: encodeBase64(JSON.stringify(payload)),
    mooFlightsAutoOpen: "1",
    mooFlightsAutoSearch: "1",
  });
  return `https://matrix.itasoftware.com/search?${params.toString()}`;
}

function matrixSearchSlice(
  slice: GoogleFlightsMatrixSearch["slices"][number],
  returnSlice?: GoogleFlightsMatrixSearch["slices"][number],
): Record<string, unknown> {
  const dates: Record<string, unknown> = {
    searchDateType: "specific",
    departureDate: slice.departureDate,
    departureDateType: "depart",
    departureDateModifier: "0",
    departureDatePreferredTimes: [],
    returnDateType: "depart",
    returnDateModifier: "0",
    returnDatePreferredTimes: [],
  };
  if (returnSlice?.departureDate) dates.returnDate = returnSlice.departureDate;
  return {
    origin: [slice.origin],
    dest: [slice.destination],
    routing: carrierRouting(slice),
    ext: "",
    routingRet: returnSlice ? carrierRouting(returnSlice) : "",
    extRet: "",
    dates,
  };
}

function carrierRouting(slice: GoogleFlightsMatrixSearch["slices"][number]): string {
  const flightTokens = slice.segments.map(matrixFlightToken).filter(isString);
  if (flightTokens.length === slice.segments.length && flightTokens.length > 0) {
    return flightTokens.length === 1 ? `F:${flightTokens[0]}` : flightTokens.join(" ");
  }
  return slice.segments
    .map((segment) => segment.carrier)
    .filter(isString)
    .join(" ");
}

function matrixFlightToken(segment: GoogleFlightsFlightSegment): string {
  return segment.carrier && segment.flightNumber ? `${segment.carrier}${segment.flightNumber}` : "";
}

function decodeBase64UrlText(value: string): string {
  try {
    const base64 = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return globalThis.atob(base64);
  } catch {
    return "";
  }
}

function encodeBase64(value: string): string {
  return globalThis.btoa(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseSearchResultRow(row: Element, rowIndex: number): SearchResult | null {
  const price = parseSearchResultPrice(row);
  if (!price) return null;

  const summaryText = normalizedSearchResultText(row);
  const matchKey = searchResultMatchKey(summaryText, price.priceText);
  if (matchKey.length < 12) return null;

  const timeText =
    searchResultTimeSignature(summaryText) ||
    firstSearchResultText(row, [
      ".wtdjmc",
      ".Ak5kof",
      "[aria-label*='AM']",
      "[aria-label*='PM']",
      "[aria-label*='am']",
      "[aria-label*='pm']",
    ]);
  const durationText = firstPatternText(summaryText, /\b\d+\s*hr(?:\s*\d+\s*min)?\b/i);
  const stopsText = firstPatternText(summaryText, /\b(?:nonstop|direct|\d+\s+stops?)\b/i);
  const carrierText = firstSearchResultText(row, [".sSHqwe", ".Ir0Voe", ".C3iPNc"]);
  const itineraryKey = searchResultItineraryKey(row);
  const confidence =
    itineraryKey || /(?:nonstop|direct|\d+\s+stops?|\b\d+\s*hr\b)/i.test(summaryText) ? "high" : "medium";

  return {
    rowKey: `gf-row-${stableHash(matchKey)}`,
    matchKey,
    rowIndex,
    price: price.price,
    currency: price.currency,
    priceText: price.priceText,
    summaryText,
    ...(carrierText ? { carrierText } : {}),
    ...(timeText ? { timeText } : {}),
    ...(durationText ? { durationText } : {}),
    ...(stopsText ? { stopsText } : {}),
    ...(itineraryKey ? { itineraryKey } : {}),
    matchConfidence: confidence,
  };
}

function parseSearchResultPrice(row: Element): { price: number; currency: string; priceText: string } | null {
  const candidates = Array.from(row.querySelectorAll("[aria-label], [role='text'], span, div"))
    .filter((element) => !element.closest(MOO_FLIGHTS_SEARCH_BADGE_SELECTOR))
    .map((element) => ({
      ariaLabel: element.getAttribute("aria-label") || "",
      visibleText: textContentWithoutSearchBadges(element),
    }))
    .map((candidate) => ({
      ...candidate,
      sourceText: normalizedText(candidate.ariaLabel || candidate.visibleText),
      price: parsePriceText(candidate.ariaLabel, candidate.visibleText),
    }))
    .filter(
      (candidate): candidate is typeof candidate & { price: { price: number; currency: string; priceText: string } } =>
        Boolean(candidate.price && isLikelyFlightPrice(candidate.price, candidate.sourceText)),
    )
    .sort((left, right) => priceCandidateScore(left) - priceCandidateScore(right));
  return candidates[0]?.price || null;
}

function textContentWithoutSearchBadges(element: Element): string {
  const clone = element.cloneNode(true);
  if (!(clone instanceof Element)) return normalizedText(element.textContent || "");
  for (const badge of Array.from(clone.querySelectorAll(MOO_FLIGHTS_SEARCH_BADGE_SELECTOR))) badge.remove();
  return normalizedText(clone.textContent || "");
}

function priceCandidateScore(candidate: { sourceText: string; price: { priceText: string } }): number {
  const extraTextLength = Math.max(0, candidate.sourceText.length - candidate.price.priceText.length);
  return extraTextLength;
}

function isLikelyFlightPrice(price: { price: number; priceText: string }, sourceText: string): boolean {
  if (!Number.isFinite(price.price) || price.price <= 0) return false;
  if (price.priceText.length > 40 || !/[0-9]/.test(price.priceText)) return false;
  if (
    sourceText.length > price.priceText.length + 16 &&
    /\b(?:AM|PM|hr|min|stop|stops|nonstop|direct)\b/i.test(sourceText)
  ) {
    return false;
  }
  return true;
}

function normalizedSearchResultText(row: Element): string {
  const clone = row.cloneNode(true);
  if (clone instanceof Element) {
    for (const badge of Array.from(clone.querySelectorAll(MOO_FLIGHTS_SEARCH_BADGE_SELECTOR))) badge.remove();
    const selectFlightSummary = rankedSearchResultSummaries(clone)[0]?.text || "";
    if (selectFlightSummary) return selectFlightSummary;
    return normalizedText(clone.textContent || "");
  }
  return normalizedText(row.textContent || "");
}

function rankedSearchResultSummaries(row: Element): Array<{ text: string; score: number }> {
  return Array.from(row.querySelectorAll("[aria-label]"))
    .map((element) => ({
      text: normalizedText(element.getAttribute("aria-label") || ""),
      score: searchSummaryScore(element),
    }))
    .filter((candidate) => candidate.text.length >= 20 && hasSearchResultSignal(candidate.text))
    .sort((left, right) => right.score - left.score || right.text.length - left.text.length);
}

function searchSummaryScore(element: Element): number {
  const text = normalizedText(element.getAttribute("aria-label") || "");
  if (!text) return 0;
  if (isEnglishSelectFlightSummary(text)) return 1000;
  if (element.matches(".JMc5Xc[aria-label], [role='link'][aria-label]") && isPrimaryFlightSummary(text)) return 800;
  if (/^Flight details\./i.test(text)) return 250;
  if (hasSearchResultSignal(text)) return 100;
  return 0;
}

function isEnglishSelectFlightSummary(text: string): boolean {
  return (
    /\bSelect flight\b/i.test(text) &&
    /\bLeaves\b/i.test(text) &&
    /\barrives\b/i.test(text) &&
    /\bTotal duration\b/i.test(text) &&
    /\b(?:(?:nonstop|direct|\d+\s+stops?|\d+\s+stop)\s+flight|flight with)\b/i.test(text)
  );
}

function isPrimaryFlightSummary(text: string): boolean {
  if (isEnglishSelectFlightSummary(text)) return true;
  const hasPrice = Boolean(parsePriceAmount(text)) || /円|日圓|日元|yen|dollars?|euros?|pounds?/i.test(text);
  return hasPrice && hasSearchResultSignal(text);
}

function hasSearchResultSignal(text: string): boolean {
  return /\b(?:nonstop|direct|\d+\s+stops?|\d+\s*hr|AM|PM|am|pm)\b/.test(text) || /\d{1,2}:\d{2}/.test(text);
}

function searchResultMatchKey(text: string, priceText: string): string {
  return normalizeSearchKey(stripSearchPriceText(stripSearchUiText(text), priceText));
}

function stripSearchUiText(text: string): string {
  return text
    .replace(/\bselect flight\b/gi, " ")
    .replace(/\bflight details\b/gi, " ")
    .replace(/\bview more flights\b/gi, " ")
    .replace(/\b(?:best|cheapest)\s+(?:here|[A-Z]{2})\b/gi, " ")
    .replace(/\bnot found\b/gi, " ")
    .replace(/\bchecking\b/gi, " ");
}

function stripSearchPriceText(text: string, priceText: string): string {
  const escapedPrice = escapeRegExp(priceText);
  return text
    .replace(new RegExp(escapedPrice, "gi"), " ")
    .replace(/\bfrom\s+/gi, " ")
    .replace(
      /\b[0-9][0-9.,\s'’]*\s+(?:US|Hong Kong|Taiwan|Canadian|Australian|New Zealand|Singapore)?\s*dollars?\b/gi,
      " ",
    )
    .replace(
      /\b[0-9][0-9.,\s'’]*\s+(?:Japanese|Korean|Thai|Malaysian|Chinese|Indian|Swiss|Danish|Norwegian|Swedish|Mexican|Philippine|New Taiwan|Taiwan)?\s*(?:euros?|pounds?|yen|won|baht|ringgit|yuan|rupees?|francs?|kron(?:er|a)|pesos?)\b/gi,
      " ",
    )
    .replace(/[0-9][0-9.,\s'’]*\s*円(?:～|から)?/g, " ")
    .replace(/[0-9][0-9.,\s'’]*\s*(?:日圓|日元)(?:起)?/g, " ")
    .replace(/\b(?:USD|HKD|TWD|CAD|AUD|NZD|SGD|EUR|GBP|JPY|KRW|THB|MYR|CNY|INR|CHF)\s*[0-9][0-9.,\s'’]*/gi, " ")
    .replace(/[A-Z]{0,3}[$€£¥￥₩฿₹]\s*[0-9][0-9.,\s'’]*/g, " ")
    .replace(/[0-9][0-9.,\s'’]*\s*(?:USD|HKD|TWD|CAD|AUD|NZD|SGD|EUR|GBP|JPY|KRW|THB|MYR|CNY|INR|CHF)\b/gi, " ");
}

function normalizeSearchKey(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSearchResultText(row: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = normalizedText(row.querySelector(selector)?.textContent || "");
    if (value && value.length <= 80 && !parsePriceAmount(value)) return value;
  }
  return "";
}

function firstPatternText(text: string, pattern: RegExp): string {
  return normalizedText(text.match(pattern)?.[0] || "");
}

function searchResultTimeSignature(text: string): string {
  const times = Array.from(
    text.matchAll(
      /(?:\b(?:AM|PM|am|pm)\s*)?(?:(?:上午|下午|晚上|早上|中午|凌晨)\s*)?(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:AM|PM|am|pm))?\b/g,
    ),
  )
    .map((match) => normalizedClockTime(match[0]))
    .filter(isString);
  return times.length >= 2 ? `${times[0]}-${times[times.length - 1]}` : "";
}

function normalizedClockTime(value: string): string {
  const text = normalizedText(value);
  const match = text.match(
    /^(?:(AM|PM|am|pm)\s*)?(?:(上午|下午|晚上|早上|中午|凌晨)\s*)?(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?$/,
  );
  if (!match) return "";
  let hour = Number(match[3]);
  const minute = match[4] || "";
  const latinMeridiem = (match[1] || match[5] || "").toUpperCase();
  const cjkMeridiem = match[2] || "";
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "";
  if ((latinMeridiem === "AM" || cjkMeridiem === "凌晨") && hour === 12) hour = 0;
  if (
    (latinMeridiem === "PM" || cjkMeridiem === "下午" || cjkMeridiem === "晚上" || cjkMeridiem === "中午") &&
    hour < 12
  ) {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function searchResultItineraryKey(row: Element): string {
  const itineraryUrl = Array.from(row.querySelectorAll("[data-travelimpactmodelwebsiteurl]"))
    .map((element) => element.getAttribute("data-travelimpactmodelwebsiteurl") || "")
    .find(Boolean);
  if (!itineraryUrl) return "";
  try {
    const itinerary = new URL(itineraryUrl, "https://www.google.com").searchParams.get("itinerary") || "";
    return itinerary
      .split(",")
      .map((segment) => {
        const [origin, destination, carrier, flightNumber, date] = segment.split("-");
        if (!origin || !destination || !carrier || !flightNumber) return "";
        return `${origin}-${destination}-${carrier}${flightNumber}${date ? `-${date}` : ""}`;
      })
      .filter(Boolean)
      .join("|");
  } catch {
    return "";
  }
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBookingOption(row: Element, pageUrl: string): BookingOption | null {
  const label = providerLabel(row);
  const price = providerPrice(row);
  if (!label || !price) return null;

  const bookingUrl = bookingOptionUrl(row, pageUrl);
  return {
    provider: label.provider,
    price: price.price,
    currency: price.currency,
    priceText: price.priceText,
    isDirect: label.isDirect,
    ...(bookingUrl ? { bookingUrl } : {}),
  };
}

function bookingOptionUrl(row: Element, pageUrl: string): string | undefined {
  const anchor =
    row instanceof HTMLAnchorElement
      ? row
      : row.querySelector<HTMLAnchorElement>("a[href]") || row.closest<HTMLAnchorElement>("a[href]");
  if (!anchor?.href) return undefined;
  try {
    const url = new URL(anchor.getAttribute("href") || anchor.href, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function providerLabel(row: Element): { provider: string; isDirect: boolean } | null {
  const labelElement = row.querySelector(".ogfYpf");
  const rawLabel =
    normalizedText(
      Array.from(labelElement?.childNodes || []).find((node) => node.nodeType === Node.TEXT_NODE)?.textContent || "",
    ) || normalizedText(labelElement?.textContent || "");
  if (!rawLabel) return null;

  const isDirect = Boolean(row.querySelector(".EA71Tc"));
  const provider = cleanProviderLabel(rawLabel);

  return provider ? { provider, isDirect } : null;
}

function cleanProviderLabel(value: string): string {
  return value
    .replace(/^(?:Book with|Reserve with|Reservar con|Réserver avec|Buchen bei|Prenota con|Reservar com)\s+/i, "")
    .replace(/^(?:透過|通过)\s*/i, "")
    .replace(/\s*(?:で予約|予約|預訂|预订)$/i, "")
    .replace(/\s*Airline$/i, "")
    .trim();
}

function providerPrice(row: Element): { price: number; currency: string; priceText: string } | null {
  for (const element of Array.from(row.querySelectorAll("[aria-label], [role='text']"))) {
    const ariaLabel = element.getAttribute("aria-label") || "";
    const visibleText = normalizedText(element.textContent || "");
    const price = parsePriceText(ariaLabel, visibleText);
    if (price) return price;
  }

  return null;
}

function parsePriceText(
  ariaLabel: string,
  visibleText: string,
): { price: number; currency: string; priceText: string } | null {
  const ariaText = normalizedText(ariaLabel);
  const parsedAria = ariaText ? parsePriceAmount(ariaText) : null;
  const parsedVisible = visibleText ? parsePriceAmount(visibleText) : null;
  const parsed =
    parsedAria?.currency === "UNKNOWN" && parsedVisible && parsedVisible.currency !== "UNKNOWN"
      ? parsedVisible
      : parsedAria || parsedVisible;
  if (!parsed) return null;

  return {
    price: parsed.price,
    currency: parsed.currency,
    priceText: parsedVisible?.priceText || parsed.priceText,
  };
}

function parsePriceAmount(value: string): { price: number; currency: string; priceText: string } | null {
  const amount = value.match(/([0-9][0-9.,\s'’]*[0-9]|[0-9])/);
  if (!amount) return null;
  const price = parseLocalizedNumber(amount[1]);
  if (!Number.isFinite(price)) return null;

  const currency = currencyFromText(value) || currencyCodeFromText(value);
  const priceText = priceTextFromValue(value) || priceLikeTextFromValue(value);
  if (!currency && !priceText) return null;

  return {
    price,
    currency: currency || "UNKNOWN",
    priceText: priceText || value,
  };
}

function currencyCodeFromText(value: string): string {
  return normalizeGoogleFlightsCurrency(value.match(/\b[A-Z]{3}\b/)?.[0]);
}

function inferCurrencyFromPriceText(value: string): string {
  const text = normalizedText(value);
  if (!/[0-9]/.test(text)) return "";
  const code = currencyCodeNearAmount(text);
  if (code) return code;
  if (unknownDollarCurrencyPrefix(text)) return "";
  return currencyFromText(text);
}

function currencyCodeNearAmount(value: string): string {
  return (
    normalizeGoogleFlightsCurrency(value.match(/\b([A-Z]{3})\s*[0-9]/)?.[1]) ||
    normalizeGoogleFlightsCurrency(value.match(/[0-9][0-9.,\s'’]*\s*([A-Z]{3})\b/)?.[1])
  );
}

function priceLikeTextFromValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 40 || !/[0-9]/.test(trimmed)) return "";
  if (currencyCodeFromText(trimmed)) return trimmed;
  if (unknownDollarCurrencyPrefix(trimmed)) return trimmed;
  if (hasCurrencyNameHint(trimmed)) return trimmed;
  return "";
}

function hasCurrencyNameHint(value: string): boolean {
  return /francs?|kron(?:er|a)|pesos?|dollars?|euros?|pounds?|yen|rupees?|won|baht|ringgit|yuan|円|日圓|日元/i.test(
    value,
  );
}

function priceTextFromValue(value: string): string {
  const trimmed = value.trim();
  if (currencyFromText(trimmed) && /[0-9]/.test(trimmed) && trimmed.length <= 40) {
    return trimmed;
  }
  const usd = trimmed.match(/([0-9][0-9.,\s'’]*[0-9]|[0-9])\s+US dollars?\b/i);
  const price = usd ? parseLocalizedNumber(usd[1]) : undefined;
  if (typeof price === "number" && Number.isFinite(price)) return `$${price.toLocaleString()}`;
  return "";
}

function parseLocalizedNumber(value: string): number {
  const compact = value.replace(/[\s'’]/g, "");
  if (!compact) return Number.NaN;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupSeparator = decimalSeparator === "," ? "." : ",";
    const normalized = compact.replaceAll(groupSeparator, "").replace(decimalSeparator, ".");
    return Number(normalized);
  }

  if (lastComma !== -1) return parseSingleSeparatorNumber(compact, ",");
  if (lastDot !== -1) return parseSingleSeparatorNumber(compact, ".");
  return Number(compact);
}

function parseSingleSeparatorNumber(value: string, separator: "," | "."): number {
  const parts = value.split(separator);
  const last = parts.at(-1) || "";
  if (parts.length > 2) {
    if (last.length === 3) return Number(parts.join(""));
    return Number(`${parts.slice(0, -1).join("")}.${last}`);
  }

  const [head, tail = ""] = parts;
  if (tail.length === 3 && head.length <= 3) return Number(`${head}${tail}`);
  if (!tail) return Number(head);
  return Number(`${head}.${tail}`);
}

function currencyFromText(value: string): string {
  if (/NT\$/i.test(value) || /Taiwan dollars?/i.test(value)) return "TWD";
  if (/HK\$/i.test(value) || /Hong Kong dollars?/i.test(value)) return "HKD";
  if (/CA\$/i.test(value) || /Canadian dollars?/i.test(value)) return "CAD";
  if (/AU\$/i.test(value) || /Australian dollars?/i.test(value)) return "AUD";
  if (/NZ\$/i.test(value) || /New Zealand dollars?/i.test(value)) return "NZD";
  if (/US\$/i.test(value) || /US dollars?|USD/i.test(value)) return "USD";
  if (/(?:^|[^\p{L}\p{N}])S\$/iu.test(value) || /Singapore dollars?/i.test(value)) return "SGD";
  if (/(?:^|[^\p{L}\p{N}])C\$/iu.test(value)) return "CAD";
  if (/(?:^|[^\p{L}\p{N}])A\$/iu.test(value)) return "AUD";
  if (unknownDollarCurrencyPrefix(value)) return "";
  if (/\$/i.test(value)) return "USD";
  if (/€|euros?|EUR/i.test(value)) return "EUR";
  if (/£|pounds?|GBP/i.test(value)) return "GBP";
  if (/¥|￥|Japanese yen|JPY|円|日圓|日元/i.test(value)) return "JPY";
  if (/₩|Korean won|KRW/i.test(value)) return "KRW";
  if (/฿|baht|THB/i.test(value)) return "THB";
  if (/ringgit|MYR/i.test(value)) return "MYR";
  if (/yuan|CNY|RMB/i.test(value)) return "CNY";
  if (/₹|rupees?|INR/i.test(value)) return "INR";
  return "";
}

function unknownDollarCurrencyPrefix(value: string): boolean {
  return /\b(?!NT|HK|CA|AU|NZ|US)[A-Z]{2,3}\$/i.test(value);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
