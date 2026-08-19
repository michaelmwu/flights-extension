import "../shared/firefoxChromeCompat";
import { safeChromeCall, sendRuntimeMessage } from "../shared/chromeRuntime";
import { createContentTranslator } from "../shared/contentI18n";
import {
  type CountryResult,
  countryComparisonUrl,
  type SearchCountryResult,
  type SearchResult,
} from "../shared/countryComparison";
import { routeSpecificCrossProviderSearchUrl } from "../shared/crossProviderSearch";
import { flagEmoji } from "../shared/flags";
import {
  DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES,
  type GoogleFlightsMatrixSearch,
  googleFlightsPanelPageKey,
  inferGoogleFlightsCurrency,
  isGoogleFlightsPanelPageUrl,
  normalizeGoogleFlightsCurrency,
  parseBookingOptions as parseGoogleFlightsBookingOptions,
  parseGoogleFlightsCountryInput,
  parseGoogleFlightsMatrixSearch,
  parseSearchResults as parseGoogleFlightsSearchResults,
  searchResultRows,
  stableHash as stableContentHash,
} from "../shared/googleFlightsBooking";
import {
  allGoogleFlightsCountryCodes,
  filterAvailableGoogleFlightsCountryCodes,
  googleFlightsAvailableCountryOptions,
  googleFlightsCountryCodeFromSearchValue,
  isAllGoogleFlightsCountryCodes,
} from "../shared/googleFlightsCountries";
import { mileageCarrierName } from "../shared/mileageCarriers";
import {
  isSkyscannerFinalComparePageUrl,
  isSkyscannerFlightsPageUrl,
  isSkyscannerSearchPageUrl,
  parseSkyscannerMatrixSearch,
  parseSkyscannerPricingOptions,
  parseSkyscannerSearchApiResponse,
  parseSkyscannerSponsoredSearchRows,
  skyscannerCountryCodeFromUrl,
  skyscannerPanelPageKey,
  skyscannerSearchResultRows,
} from "../shared/skyscannerBooking";
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, SETTINGS_KEY } from "../shared/storage";
import type { AppLanguage } from "../shared/types";
import {
  mooFlightsPanelHeaderStyles,
  renderMooFlightsMinimizedButton,
  renderMooFlightsPanelHeader,
} from "./panelChrome";

type CompareState = {
  comparing: boolean;
  baseline: CountryResult | null;
  baselineSignature: string;
  results: CountryResult[];
  resultsCachedAt: number;
  error: string;
  countryInput: string;
  pageKey: string;
  cacheKey: string;
  panelMinimized: boolean;
  panelPosition: PanelPosition;
  panelCollapsePosition: PanelPosition | null;
  comparingRequestId: string;
  comparingCacheKey: string;
  comparingCountryCodes: string[];
  progressCompleted: number;
  progressTotal: number;
  comparisonStopRequested: boolean;
  comparisonStopped: boolean;
  countrySearch: string;
  language: AppLanguage;
  searchBaseline: SearchCountryResult | null;
  searchResults: SearchCountryResult[];
  searchBestByRowKey: Record<string, SearchBestPrice>;
};

type SearchBestPrice = {
  rowKey: string;
  targetMatchKey: string;
  targetItineraryKey?: string;
  country: string;
  url: string;
  price: number;
  currency: string;
  priceText: string;
  currentPrice: number;
  delta: number;
  matchConfidence: SearchResult["matchConfidence"];
};

type SearchCountryPriceOption = {
  country: string;
  url: string;
  price: number;
  priceText: string;
  matchKey: string;
};

type PanelEdge = "top" | "right" | "bottom" | "left";

type PanelPosition = {
  edge: PanelEdge;
  ratio: number;
};

const PANEL_ID = "mooflights-google-flights-panel";
const RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const INFERRED_CURRENCY_CACHE_TTL_MS = 5000;
const TRANSIENT_EMPTY_PAGE_KEY_GRACE_MS = 10000;
const RESULT_CACHE_STORAGE_KEY = "muTravelGoogleFlightsCountryResults";
const PANEL_UI_STORAGE_KEY = "muTravelGoogleFlightsPanelUi";
const PANEL_SESSION_HIDE_STORAGE_KEY = "muTravelGoogleFlightsPanelHiddenForSession";
const SEARCH_HIGHLIGHT_STORAGE_KEY = "mooFlightsGoogleFlightsSearchHighlight";
const SEARCH_COMPARISON_HANDOFF_STORAGE_KEY = "mooFlightsGoogleFlightsSearchComparisonHandoff";
const SEARCH_COMPARISON_CACHE_STORAGE_KEY = "mooFlightsGoogleFlightsSearchComparisonCache";
const SEARCH_COUNTRY_SELECTION_SESSION_KEY = "mooFlightsGoogleFlightsCountrySelection";
const SEARCH_DEBUG_LOG_SESSION_KEY = "mooFlightsGoogleFlightsDebugLog";
const SEARCH_BADGE_SELECTOR = "[data-moo-flights-search-badge]";
const SEARCH_BADGE_TARGET_SELECTOR = "[data-moo-flights-search-badge-target]";
const SEARCH_HIGHLIGHT_SELECTOR = "[data-moo-flights-search-highlight]";
const SEARCH_BADGE_STYLES_ID = "moo-flights-search-badge-styles";
const OWN_SEARCH_ANNOTATION_SELECTOR = `${SEARCH_BADGE_SELECTOR}, #${PANEL_ID}, #${SEARCH_BADGE_STYLES_ID}`;
const DEFAULT_PANEL_POSITION: PanelPosition = { edge: "right", ratio: 1 };
const PANEL_EDGE_OFFSET_PX = 16;
const GOOGLE_FLIGHTS_HEADER_HEIGHT_PX = 64;
const GOOGLE_FLIGHTS_HEADER_BUFFER_PX = 12;
const PANEL_CORNER_SNAP_PX = 96;
const PANEL_MINIMIZED_ICON_SIZE_PX = 64;
const STORED_OPTIONS_LIMIT = 24;
const VIEW_MORE_FLIGHTS_LABEL_PATTERNS = [
  /^view more flights$/i,
  /^more flights$/i,
  /^さらに表示$/i,
  /^他のフライトを表示$/i,
  /^その他のフライトを表示$/i,
  /^查看更多航班$/,
  /^顯示更多航班$/,
  /^显示更多航班$/,
];
const COUNTRY_OPTIONS_BY_LANGUAGE = new Map<AppLanguage, ReturnType<typeof googleFlightsAvailableCountryOptions>>();
let regionDisplayNames: Intl.DisplayNames | null | undefined;
let countryCodeByDisplayName: Map<string, string> | null | undefined;
let suppressPanelRestoreClick = false;
let inferredCurrencyCache: { href: string; currency: string; cachedAt: number } | null = null;
let transientEmptyPageKeyStartedAt = 0;
let transientEmptyPageKeyTimer: number | undefined;
let highlightedSearchDeepLink = "";
let latestSkyscannerSearchCapture: SkyscannerSearchCapture | null = null;
const pendingSkyscannerMarketSearches = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: number;
  }
>();
const panelUi = loadPanelUiState();

const state: CompareState = {
  comparing: false,
  baseline: null,
  baselineSignature: "",
  results: [],
  resultsCachedAt: 0,
  error: "",
  countryInput: DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES.join(", "),
  pageKey: "",
  cacheKey: "",
  panelMinimized: panelUi.minimized,
  panelPosition: panelUi.position,
  panelCollapsePosition: panelUi.collapsePosition,
  comparingRequestId: "",
  comparingCacheKey: "",
  comparingCountryCodes: [],
  progressCompleted: 0,
  progressTotal: 0,
  comparisonStopRequested: false,
  comparisonStopped: false,
  countrySearch: "",
  language: DEFAULT_SETTINGS.language,
  searchBaseline: null,
  searchResults: [],
  searchBestByRowKey: {},
};

const resultCache = new Map<
  string,
  {
    results: CountryResult[];
    cachedAt: number;
  }
>();
const searchComparisonCache = new Map<string, StoredSearchComparisonEntry>();

type StoredResultCache = Record<string, { results: CountryResult[]; cachedAt: number }>;

type StoredSearchComparisonHandoff = {
  pageKey: string;
  selectedCountries: string[];
  results: SearchCountryResult[];
  cachedAt: number;
};

type StoredSearchComparisonEntry = StoredSearchComparisonHandoff & {
  baselineSignature: string;
};

type StoredSearchComparisonCache = Record<string, StoredSearchComparisonEntry>;
type SkyscannerSearchCapture = {
  url: string;
  pageUrl: string;
  payload: unknown;
  capturedAt: number;
};

const SKYSCANNER_SEARCH_HOOK_SOURCE = "mooFlightsSkyscannerSearchHook";
const SKYSCANNER_CONTENT_SOURCE = "mooFlightsSkyscannerContent";

function readCachedResults(pageKey: string, now = Date.now()): { results: CountryResult[]; cachedAt: number } | null {
  const cached = resultCache.get(pageKey);
  if (!cached) return null;
  if (now - cached.cachedAt <= RESULT_CACHE_TTL_MS) return cached;
  resultCache.delete(pageKey);
  return null;
}

function pruneExpiredResultCache(now = Date.now()): void {
  for (const [pageKey, cached] of resultCache.entries()) {
    if (now - cached.cachedAt > RESULT_CACHE_TTL_MS) resultCache.delete(pageKey);
  }
}

function applyCachedResults(cached: { results: CountryResult[]; cachedAt: number } | null): void {
  state.results = cached?.results || [];
  state.resultsCachedAt = cached?.cachedAt || 0;
}

async function loadStoredCachedResults(cacheKey: string, now = Date.now()): Promise<void> {
  const cache = await readStoredResultCache();
  const cached = cache[cacheKey];
  if (!cached) return;
  if (now - cached.cachedAt > RESULT_CACHE_TTL_MS) {
    delete cache[cacheKey];
    await writeStoredResultCache(cache);
    return;
  }
  resultCache.set(cacheKey, cached);
  if (state.cacheKey !== cacheKey || state.results.length > 0) return;
  applyCachedResults(cached);
  render();
}

async function storeCachedResults(cacheKey: string, results: CountryResult[], cachedAt = Date.now()): Promise<void> {
  const cached = { results, cachedAt };
  resultCache.set(cacheKey, cached);
  const cache = await readStoredResultCache();
  cache[cacheKey] = { results: sanitizeResultsForStorage(results), cachedAt };
  await writeStoredResultCache(pruneStoredResultCache(cache, cachedAt));
}

async function readStoredResultCache(): Promise<StoredResultCache> {
  try {
    const stored = await chrome.storage.local.get(RESULT_CACHE_STORAGE_KEY);
    return normalizeStoredResultCache(stored[RESULT_CACHE_STORAGE_KEY]);
  } catch {
    return {};
  }
}

async function writeStoredResultCache(cache: StoredResultCache): Promise<void> {
  try {
    await chrome.storage.local.set({ [RESULT_CACHE_STORAGE_KEY]: cache });
  } catch {
    // Country comparison cache is optional; fresh comparisons still work without persistence.
  }
}

function normalizeStoredResultCache(value: unknown): StoredResultCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cache: StoredResultCache = {};
  for (const [pageKey, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as { results?: unknown; cachedAt?: unknown };
    if (!Array.isArray(candidate.results) || typeof candidate.cachedAt !== "number") continue;
    cache[pageKey] = {
      results: sanitizeResultsForStorage(candidate.results.filter(isCountryResult)),
      cachedAt: candidate.cachedAt,
    };
  }
  return cache;
}

function pruneStoredResultCache(cache: StoredResultCache, now = Date.now()): StoredResultCache {
  return Object.fromEntries(Object.entries(cache).filter(([, cached]) => now - cached.cachedAt <= RESULT_CACHE_TTL_MS));
}

function isCountryResult(value: unknown): value is CountryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { country?: unknown; url?: unknown; options?: unknown; status?: unknown };
  return (
    typeof candidate.country === "string" &&
    typeof candidate.url === "string" &&
    Array.isArray(candidate.options) &&
    typeof candidate.status === "string"
  );
}

function sanitizeResultsForStorage(results: CountryResult[]): CountryResult[] {
  return results.map(sanitizeResultForStorage);
}

function sanitizeResultForStorage(result: CountryResult): CountryResult {
  const safeOptions = result.options.filter(isBookingOption).map((option) => {
    const { bookingUrl: _bookingUrl, ...safeOption } = option;
    return safeOption;
  });
  const direct = safeOptions.find((option) => option.isDirect);
  const options = safeOptions.slice(0, STORED_OPTIONS_LIMIT);
  if (direct && !options.some((option) => bookingOptionKey(option) === bookingOptionKey(direct))) {
    options.push(direct);
  }
  return {
    ...result,
    options,
    cheapest: options[0],
    direct: options.find((option) => option.isDirect),
  };
}

async function storeSearchComparisonHandoff(cacheKey: string): Promise<void> {
  if (!cacheKey || !state.searchBaseline || state.searchResults.length === 0) return;
  const results = mergeSearchCountryResults([], [state.searchBaseline, ...state.searchResults]);
  if (results.length === 0) return;
  debugSearch("store-handoff", { cacheKey, resultCountries: results.map((result) => result.country) });
  const handoff: StoredSearchComparisonHandoff = {
    pageKey: cacheKey,
    selectedCountries: selectedGoogleFlightsCountries(),
    results,
    cachedAt: Date.now(),
  };
  try {
    await chrome.storage.local.set({ [SEARCH_COMPARISON_HANDOFF_STORAGE_KEY]: handoff });
  } catch {
    // The hash deep link still works without comparison handoff persistence.
  }
}

async function storeSearchComparisonCache(
  cacheKey: string,
  baselineSignature: string,
  cachedAt = Date.now(),
): Promise<void> {
  if (!cacheKey || !baselineSignature || !state.searchBaseline || state.searchResults.length === 0) return;
  const results = mergeSearchCountryResults([], [state.searchBaseline, ...state.searchResults]);
  if (results.length === 0) return;
  const entry: StoredSearchComparisonEntry = {
    pageKey: cacheKey,
    baselineSignature,
    selectedCountries: selectedGoogleFlightsCountries(),
    results,
    cachedAt,
  };
  debugSearch("store-cache", {
    cacheKey,
    baselineSignatureHash: stableContentHash(baselineSignature),
    baselineRows: state.searchBaseline.results.length,
    resultCountries: results.map((result) => result.country),
  });
  searchComparisonCache.set(searchComparisonCacheEntryKey(cacheKey, baselineSignature), entry);
  const cache = await readStoredSearchComparisonCache();
  cache[searchComparisonCacheEntryKey(cacheKey, baselineSignature)] = entry;
  await writeStoredSearchComparisonCache(pruneStoredSearchComparisonCache(cache, cachedAt));
}

async function loadStoredSearchComparisonCache(
  cacheKey: string,
  baselineSignature: string,
  now = Date.now(),
): Promise<void> {
  if (!cacheKey || !baselineSignature || state.comparing) return;
  const cache = {
    ...(await readStoredSearchComparisonCache()),
    ...Object.fromEntries(searchComparisonCache.entries()),
  };
  const entryKey = searchComparisonCacheEntryKey(cacheKey, baselineSignature);
  const foundEntry =
    cache[entryKey] && isFreshStoredSearchComparisonEntry(cache[entryKey], cacheKey, now)
      ? { entryKey, entry: cache[entryKey], source: "exact" }
      : bestStoredSearchComparisonCacheEntry(cache, cacheKey, baselineSignature, parseCurrentSearchPage(), now);
  if (!foundEntry) {
    debugSearch("load-cache-miss", {
      cacheKey,
      baselineSignatureHash: stableContentHash(baselineSignature),
      cacheEntries: Object.keys(cache).length,
    });
    return;
  }
  const { entry } = foundEntry;
  debugSearch("load-cache-hit", {
    cacheKey,
    source: foundEntry.source,
    baselineSignatureHash: stableContentHash(baselineSignature),
    resultCountries: entry.results.map((result) => result.country),
  });
  if (entry.pageKey !== cacheKey || now - entry.cachedAt > RESULT_CACHE_TTL_MS) {
    delete cache[foundEntry.entryKey];
    await writeStoredSearchComparisonCache(cache);
    return;
  }
  if (
    state.cacheKey !== cacheKey ||
    state.baselineSignature !== baselineSignature ||
    currentGoogleFlightsPanelMode() !== "search"
  ) {
    return;
  }
  applyStoredSearchComparison(entry);
}

function isFreshStoredSearchComparisonEntry(
  entry: StoredSearchComparisonEntry | undefined,
  cacheKey: string,
  now = Date.now(),
): entry is StoredSearchComparisonEntry {
  return Boolean(
    entry &&
      entry.pageKey === cacheKey &&
      now - entry.cachedAt <= RESULT_CACHE_TTL_MS &&
      entry.results.filter((result) => result.results.length > 0).length >= 2,
  );
}

function bestStoredSearchComparisonCacheEntry(
  cache: StoredSearchComparisonCache,
  cacheKey: string,
  baselineSignature: string,
  currentBaseline: SearchCountryResult,
  now = Date.now(),
): { entryKey: string; entry: StoredSearchComparisonEntry; source: string } | null {
  if (currentBaseline.results.length === 0) return null;
  let best: { entryKey: string; entry: StoredSearchComparisonEntry; score: number } | null = null;
  for (const [entryKey, entry] of Object.entries(cache)) {
    if (entry.baselineSignature === baselineSignature) continue;
    if (!isFreshStoredSearchComparisonEntry(entry, cacheKey, now)) continue;
    const score = storedSearchComparisonOverlapScore(currentBaseline, entry);
    if (score < 0.5) continue;
    if (!best || score > best.score || (score === best.score && entry.cachedAt > best.entry.cachedAt)) {
      best = { entryKey, entry, score };
    }
  }
  return best ? { entryKey: best.entryKey, entry: best.entry, source: `overlap:${best.score.toFixed(2)}` } : null;
}

function storedSearchComparisonOverlapScore(
  currentBaseline: SearchCountryResult,
  entry: StoredSearchComparisonEntry,
): number {
  if (currentBaseline.results.length === 0) return 0;
  const storedResults = entry.results.filter((result) => result.results.length > 0);
  if (storedResults.length === 0) return 0;
  const matchedRows = currentBaseline.results.filter((row) =>
    storedResults.some((result) => Boolean(bestSearchResultMatch(row, result.results, 0.72))),
  ).length;
  return matchedRows / currentBaseline.results.length;
}

async function loadStoredSearchComparisonHandoff(cacheKey: string, now = Date.now()): Promise<void> {
  if (!cacheKey || state.comparing) return;
  let handoff: StoredSearchComparisonHandoff | null = null;
  try {
    const stored = await chrome.storage.local.get(SEARCH_COMPARISON_HANDOFF_STORAGE_KEY);
    handoff = normalizeStoredSearchComparisonHandoff(stored[SEARCH_COMPARISON_HANDOFF_STORAGE_KEY]);
  } catch {
    return;
  }
  if (!handoff) return;
  if (handoff.pageKey !== cacheKey || now - handoff.cachedAt > RESULT_CACHE_TTL_MS) {
    try {
      await chrome.storage.local.remove(SEARCH_COMPARISON_HANDOFF_STORAGE_KEY);
    } catch {
      // Expired handoff cleanup is best-effort.
    }
    return;
  }
  if (state.cacheKey !== cacheKey || currentGoogleFlightsPanelMode() !== "search") return;

  applyStoredSearchComparison(handoff);
}

function applyStoredSearchComparison(entry: StoredSearchComparisonHandoff): void {
  const selectedCountries = filterAvailableGoogleFlightsCountryCodes(entry.selectedCountries);
  if (selectedCountries.length > 0) {
    state.countryInput = selectedCountries.join(", ");
    writeSessionGoogleFlightsCountrySelection(selectedCountries);
  }
  const currentCountry = currentComparableCountryCode();
  const currentBaseline = parseCurrentSearchPage();
  if (currentBaseline.results.length > 0) state.searchBaseline = currentBaseline;
  state.searchResults = mergeSearchCountryResults(
    [],
    entry.results.filter((result) => result.country !== currentCountry),
  );
  if (state.searchResults.length === 0) {
    debugSearch("apply-stored-empty-after-filter", {
      currentCountry,
      entryCountries: entry.results.map((result) => result.country),
    });
    return;
  }
  debugSearch("apply-stored", {
    currentCountry,
    baselineRows: state.searchBaseline?.results.length || 0,
    resultCountries: state.searchResults.map((result) => result.country),
  });
  state.searchBestByRowKey = bestPricesBySearchRow(state.searchBaseline, state.searchResults);
  render();
  applySearchBadges();
  applyRequestedSearchHighlight(state.searchBaseline);
}

async function readStoredSearchComparisonCache(): Promise<StoredSearchComparisonCache> {
  try {
    const stored = await chrome.storage.local.get(SEARCH_COMPARISON_CACHE_STORAGE_KEY);
    return normalizeStoredSearchComparisonCache(stored[SEARCH_COMPARISON_CACHE_STORAGE_KEY]);
  } catch {
    return {};
  }
}

async function writeStoredSearchComparisonCache(cache: StoredSearchComparisonCache): Promise<void> {
  try {
    await chrome.storage.local.set({ [SEARCH_COMPARISON_CACHE_STORAGE_KEY]: cache });
  } catch {
    // Search comparison cache is optional; fresh comparisons still work without persistence.
  }
}

function normalizeStoredSearchComparisonCache(value: unknown): StoredSearchComparisonCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cache: StoredSearchComparisonCache = {};
  for (const [entryKey, entry] of Object.entries(value)) {
    const normalized = normalizeStoredSearchComparisonEntry(entry);
    if (normalized) cache[entryKey] = normalized;
  }
  return cache;
}

function normalizeStoredSearchComparisonEntry(value: unknown): StoredSearchComparisonEntry | null {
  const handoff = normalizeStoredSearchComparisonHandoff(value);
  if (!handoff || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { baselineSignature?: unknown };
  if (typeof candidate.baselineSignature !== "string") return null;
  return { ...handoff, baselineSignature: candidate.baselineSignature };
}

function pruneStoredSearchComparisonCache(
  cache: StoredSearchComparisonCache,
  now = Date.now(),
): StoredSearchComparisonCache {
  return Object.fromEntries(Object.entries(cache).filter(([, entry]) => now - entry.cachedAt <= RESULT_CACHE_TTL_MS));
}

function searchComparisonCacheEntryKey(cacheKey: string, baselineSignature: string): string {
  return `${stableContentHash(cacheKey)}:${stableContentHash(baselineSignature)}`;
}

function normalizeStoredSearchComparisonHandoff(value: unknown): StoredSearchComparisonHandoff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as {
    pageKey?: unknown;
    selectedCountries?: unknown;
    results?: unknown;
    cachedAt?: unknown;
  };
  if (
    typeof candidate.pageKey !== "string" ||
    !Array.isArray(candidate.selectedCountries) ||
    !Array.isArray(candidate.results) ||
    typeof candidate.cachedAt !== "number"
  ) {
    return null;
  }
  return {
    pageKey: candidate.pageKey,
    selectedCountries: filterAvailableGoogleFlightsCountryCodes(
      candidate.selectedCountries.filter((country): country is string => typeof country === "string"),
    ),
    results: candidate.results.filter(isSearchCountryResult),
    cachedAt: candidate.cachedAt,
  };
}

function isBookingOption(value: unknown): value is CountryResult["options"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    provider?: unknown;
    price?: unknown;
    currency?: unknown;
    priceText?: unknown;
    isDirect?: unknown;
  };
  return (
    typeof candidate.provider === "string" &&
    typeof candidate.price === "number" &&
    typeof candidate.currency === "string" &&
    typeof candidate.priceText === "string" &&
    typeof candidate.isDirect === "boolean"
  );
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const payload = message as {
    command?: string;
    requestId?: unknown;
    result?: unknown;
    ok?: unknown;
    cancelled?: unknown;
    error?: unknown;
    waitForExpansion?: unknown;
  };
  if (payload.command === "parseBookingOptions" || payload.command === "parseGoogleFlightsBookingOptions") {
    sendResponse(parseCurrentBookingPage());
    return false;
  }
  if (payload.command === "parseSearchResults" || payload.command === "parseGoogleFlightsSearchResults") {
    sendResponse(parseCurrentSearchPage());
    return false;
  }
  if (payload.command === "expandGoogleFlightsSearchResults") {
    void expandGoogleFlightsSearchResults(payload.waitForExpansion !== false)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not expand Google Flights results.",
        }),
      );
    return true;
  }
  if (payload.command === "googleFlightsCountryComparisonResult") {
    applyGoogleFlightsCountryProgress(payload);
    return false;
  }
  if (payload.command === "googleFlightsCountryComparisonComplete") {
    applyGoogleFlightsCountryComplete(payload);
    return false;
  }
  if (payload.command === "googleFlightsSearchComparisonResult") {
    applyGoogleFlightsSearchProgress(payload);
    return false;
  }
  if (payload.command === "googleFlightsSearchComparisonComplete") {
    applyGoogleFlightsSearchComplete(payload);
    return false;
  }
  return false;
});

void init();

async function init(): Promise<void> {
  installSkyscannerSearchCaptureListener();
  try {
    const settings = await loadSettings();
    applyGoogleFlightsCountryInput(readSessionGoogleFlightsCountrySelection() || settings.googleFlights.countryCodes);
    state.language = settings.language;
  } catch {
    applyGoogleFlightsCountryInput(readSessionGoogleFlightsCountrySelection() || DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES);
  }
  chrome.storage?.onChanged?.addListener(onSettingsChanged);
  scheduleRender();
  installObserver();
  requestLatestSkyscannerSearchCapture();
}

function onSettingsChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
  const next = mergeSettings(changes[SETTINGS_KEY].newValue);
  const languageChanged = next.language !== state.language;
  state.language = next.language;
  applyGoogleFlightsCountryInput(readSessionGoogleFlightsCountrySelection() || next.googleFlights.countryCodes);
  if (languageChanged) state.countrySearch = "";
  render();
}

function installSkyscannerSearchCaptureListener(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      url?: unknown;
      pageUrl?: unknown;
      payload?: unknown;
      capturedAt?: unknown;
      requestId?: unknown;
      country?: unknown;
      error?: unknown;
    };
    if (data?.source !== SKYSCANNER_SEARCH_HOOK_SOURCE) return;
    if (data.type === "market-response") {
      applySkyscannerMarketSearchResponse(data);
      return;
    }
    if (data.type !== "search-response") return;
    if (typeof data.url !== "string" || typeof data.capturedAt !== "number") return;
    const capture = {
      url: data.url,
      pageUrl: typeof data.pageUrl === "string" ? data.pageUrl : "",
      payload: data.payload,
      capturedAt: data.capturedAt,
    };
    if (!skyscannerSearchCaptureMatchesCurrentPage(capture)) {
      if (latestSkyscannerSearchCapture && !skyscannerSearchCaptureMatchesCurrentPage(latestSkyscannerSearchCapture)) {
        latestSkyscannerSearchCapture = null;
      }
      return;
    }
    latestSkyscannerSearchCapture = capture;
    invalidateInferredCurrencyCache();
    scheduleRender();
  });
}

function requestLatestSkyscannerSearchCapture(): void {
  if (!isCurrentSkyscannerSearchPage()) return;
  window.postMessage(
    {
      source: SKYSCANNER_CONTENT_SOURCE,
      type: "request-latest",
    },
    window.location.origin,
  );
}

function requestSkyscannerMarketSearch(country: string): Promise<unknown> {
  const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingSkyscannerMarketSearches.delete(requestId);
      reject(new Error(t()("countryComparisonFailed")));
    }, 20000);
    pendingSkyscannerMarketSearches.set(requestId, { resolve, reject, timeoutId });
    window.postMessage(
      {
        source: SKYSCANNER_CONTENT_SOURCE,
        type: "compare-market",
        requestId,
        country,
      },
      window.location.origin,
    );
  });
}

function applySkyscannerMarketSearchResponse(message: {
  requestId?: unknown;
  country?: unknown;
  payload?: unknown;
  errorCode?: unknown;
  error?: unknown;
}): void {
  if (typeof message.requestId !== "string") return;
  const pending = pendingSkyscannerMarketSearches.get(message.requestId);
  if (!pending) return;
  pendingSkyscannerMarketSearches.delete(message.requestId);
  window.clearTimeout(pending.timeoutId);
  if (typeof message.errorCode === "string" && message.errorCode) {
    pending.reject(new Error(skyscannerMarketErrorMessage(message.errorCode)));
    return;
  }
  if (typeof message.error === "string" && message.error) {
    pending.reject(new Error(t()("countryComparisonFailed")));
    return;
  }
  pending.resolve(message.payload);
}

function skyscannerMarketErrorMessage(errorCode: string): string {
  if (errorCode === "missing-search-request") return t()("noSkyscannerSearchApiResponse");
  return t()("countryComparisonFailed");
}

function currentCountryCode(): string {
  if (isCurrentSkyscannerPage()) return currentSkyscannerCountryCode() || "CURRENT";
  const country = urlCountryCode();
  if (country) return country;
  const visibleCountry = visibleGoogleFlightsLocation();
  return countryCodeFromDisplayName(visibleCountry) || visibleCountry || "CURRENT";
}

function isRealCountryCode(country: string): boolean {
  return /^[A-Z]{2}$/.test(country.toUpperCase());
}

function currentComparableCountryCode(): string {
  if (isCurrentSkyscannerPage()) return currentSkyscannerCountryCode() || "US";
  return (
    urlCountryCode() ||
    countryCodeFromDisplayName(visibleGoogleFlightsLocation()) ||
    DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES[0] ||
    "US"
  );
}

function currentComparableCurrencyCode(): string {
  return currentVisibleCurrencyCode() || "USD";
}

function currentVisibleCurrencyCode(): string {
  const urlCurrency = urlCurrencyCode();
  if (urlCurrency) return urlCurrency;
  const now = Date.now();
  if (
    inferredCurrencyCache &&
    inferredCurrencyCache.href === window.location.href &&
    now - inferredCurrencyCache.cachedAt <= INFERRED_CURRENCY_CACHE_TTL_MS
  ) {
    return inferredCurrencyCache.currency;
  }
  if (isCurrentSkyscannerPage()) {
    const currency = inferSkyscannerCurrency(document);
    inferredCurrencyCache = currency ? { href: window.location.href, currency, cachedAt: now } : null;
    return currency;
  }
  const currency = inferGoogleFlightsCurrency(document);
  inferredCurrencyCache = currency ? { href: window.location.href, currency, cachedAt: now } : null;
  return currency;
}

function parseCurrentBookingPage(): CountryResult {
  if (isCurrentSkyscannerPanelPage()) {
    return parseSkyscannerPricingOptions(document, currentCountryCode(), window.location.href);
  }
  return parseGoogleFlightsBookingOptions(document, currentCountryCode(), window.location.href);
}

function parseCurrentSearchPage(): SearchCountryResult {
  if (isCurrentSkyscannerSearchPage()) {
    if (!latestSkyscannerSearchCapture || !skyscannerSearchCaptureMatchesCurrentPage(latestSkyscannerSearchCapture)) {
      return { country: currentComparableCountryCode(), url: window.location.href, results: [], status: "empty" };
    }
    return mergeSkyscannerVisibleSponsoredRows(
      parseSkyscannerSearchApiResponse(
        latestSkyscannerSearchCapture.payload,
        currentComparableCountryCode(),
        window.location.href,
      ),
    );
  }
  return parseGoogleFlightsSearchResults(document, currentComparableCountryCode(), window.location.href);
}

function mergeSkyscannerVisibleSponsoredRows(result: SearchCountryResult): SearchCountryResult {
  const sponsored = parseSkyscannerSponsoredSearchRows(document, result.country, result.url).results;
  if (sponsored.length === 0) return result;
  const merged = [...result.results];
  for (const row of sponsored) {
    if (merged.some((candidate) => bestSearchResultMatch(row, [candidate], 0.9))) continue;
    merged.push({ ...row, rowIndex: merged.length });
  }
  return {
    ...result,
    results: merged,
    status: merged.length > 0 ? "ready" : result.status,
  };
}

async function expandGoogleFlightsSearchResults(waitForExpansion = true): Promise<{
  ok: boolean;
  clicked: boolean;
  beforeRows: number;
  afterRows: number;
}> {
  if (isCurrentSkyscannerSearchPage()) {
    requestLatestSkyscannerSearchCapture();
    const rows = parseCurrentSearchPage().results.length;
    return { ok: true, clicked: false, beforeRows: rows, afterRows: rows };
  }
  const beforeRows = parseCurrentSearchPage().results.length;
  const button = viewMoreFlightsButton();
  if (!button) return { ok: true, clicked: false, beforeRows, afterRows: beforeRows };
  button.click();
  if (!waitForExpansion) {
    window.setTimeout(scheduleRender, 800);
    window.setTimeout(scheduleRender, 2000);
    return { ok: true, clicked: true, beforeRows, afterRows: beforeRows };
  }
  const afterRows = await waitForSearchRowsAfterExpansion(beforeRows);
  scheduleRender();
  return { ok: true, clicked: true, beforeRows, afterRows };
}

function viewMoreFlightsButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll("button[aria-label], button"));
  return (
    buttons.find((button): button is HTMLButtonElement => {
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      const label = normalizeText(button.getAttribute("aria-label") || button.textContent || "");
      return isViewMoreFlightsLabel(label);
    }) || null
  );
}

function isViewMoreFlightsLabel(label: string): boolean {
  if (!label) return false;
  if (VIEW_MORE_FLIGHTS_LABEL_PATTERNS.some((pattern) => pattern.test(label))) return true;
  const normalized = label.toLocaleLowerCase("en-US");
  return (
    (normalized.includes("view") && normalized.includes("flight")) ||
    (label.includes("フライト") && label.includes("表示")) ||
    (label.includes("航班") && (label.includes("更多") || label.includes("查看更多") || label.includes("顯示")))
  );
}

async function waitForSearchRowsAfterExpansion(beforeRows: number): Promise<number> {
  const deadline = Date.now() + 5000;
  let latestRows = beforeRows;
  while (Date.now() < deadline) {
    await delay(200);
    latestRows = parseCurrentSearchPage().results.length;
    if (latestRows > beforeRows || !viewMoreFlightsButton()) return latestRows;
  }
  return latestRows;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function installPanel(): void {
  getShadowRoot();
}

function installObserver(): void {
  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(scheduleRender, 250);
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnSearchAnnotationMutation)) return;
    invalidateInferredCurrencyCache();
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installNavigationObserver(schedule);
  window.addEventListener("focus", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule();
  });
}

function invalidateInferredCurrencyCache(): void {
  if (isCurrentSkyscannerPage() || inferredCurrencyCache?.currency) {
    inferredCurrencyCache = null;
  }
}

function isOwnSearchAnnotationMutation(mutation: MutationRecord): boolean {
  const target = mutation.target;
  if (target instanceof Element && target.closest(OWN_SEARCH_ANNOTATION_SELECTOR)) {
    return true;
  }
  const nodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
  return nodes.length > 0 && nodes.every(isOwnSearchAnnotationNode);
}

function isOwnSearchAnnotationNode(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(OWN_SEARCH_ANNOTATION_SELECTOR) || Boolean(node.closest(OWN_SEARCH_ANNOTATION_SELECTOR)))
  );
}

function installNavigationObserver(schedule: () => void): void {
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    schedule();
    return result;
  };
  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    schedule();
    return result;
  };
}

function scheduleRender(): void {
  if (shouldHidePanel()) {
    removePanel();
    removeSearchBadges();
    removeSearchHighlights();
    return;
  }

  const mode = currentGoogleFlightsPanelMode();
  const pageKey = currentPanelPageKey(mode);
  const cacheKey = currentPanelComparisonCacheKey(mode);
  const pageKeyChanged = state.pageKey !== pageKey;
  if (pageKey) {
    transientEmptyPageKeyStartedAt = 0;
    clearTransientEmptyPageKeyTimer();
  }
  if (
    mode === "search" &&
    latestSkyscannerSearchCapture &&
    !skyscannerSearchCaptureMatchesCurrentPage(latestSkyscannerSearchCapture)
  ) {
    latestSkyscannerSearchCapture = null;
  }
  if (!pageKey) {
    if (!transientEmptyPageKeyStartedAt) transientEmptyPageKeyStartedAt = Date.now();
    if (shouldKeepPanelDuringTransientEmptyPageKey()) {
      debugSearch("keep-state-during-transient-empty-page-key", {
        mode,
        previousPageKeyHash: stableContentHash(state.pageKey),
      });
      scheduleTransientEmptyPageKeyRecheck();
      render();
      return;
    }
    if (!state.pageKey && !document.getElementById(PANEL_ID)) return;
    removePanel();
    state.pageKey = "";
    state.cacheKey = "";
    state.baseline = null;
    state.baselineSignature = "";
    state.results = [];
    state.resultsCachedAt = 0;
    state.error = "";
    state.comparing = false;
    state.comparingRequestId = "";
    state.comparingCacheKey = "";
    state.progressCompleted = 0;
    state.progressTotal = 0;
    state.comparisonStopRequested = false;
    state.comparisonStopped = false;
    state.searchBaseline = null;
    state.searchResults = [];
    state.searchBestByRowKey = {};
    removeSearchBadges();
    removeSearchHighlights();
    return;
  }

  installPanel();
  if (state.comparing && state.pageKey === pageKey) {
    if (mode === "search") {
      updateSearchBaselineDuringComparison();
      applySearchBadges();
      applyRequestedSearchHighlight(state.searchBaseline);
    }
    return;
  }
  const baseline = mode === "booking" ? parseCurrentBookingPage() : null;
  const searchBaseline = mode === "search" ? parseCurrentSearchPage() : null;
  const baselineSignature =
    mode === "booking" && baseline
      ? googleFlightsResultSignature(baseline)
      : searchBaseline
        ? googleFlightsSearchResultSignature(searchBaseline)
        : "";
  debugSearch("schedule", {
    mode,
    pageKeyChanged,
    previousSignatureHash: state.baselineSignature ? stableContentHash(state.baselineSignature) : "",
    nextSignatureHash: baselineSignature ? stableContentHash(baselineSignature) : "",
    parsedRows: searchBaseline?.results.length || 0,
    stateRows: state.searchBaseline?.results.length || 0,
    comparedCountries: state.searchResults.map((result) => result.country),
    badgeCount: document.querySelectorAll(SEARCH_BADGE_SELECTOR).length,
  });
  if (
    mode === "search" &&
    searchBaseline &&
    searchBaseline.results.length === 0 &&
    state.searchBaseline?.results.length &&
    state.searchResults.length > 0
  ) {
    debugSearch("keep-state-during-empty-parse", {
      stateRows: state.searchBaseline.results.length,
      comparedCountries: state.searchResults.map((result) => result.country),
    });
    applySearchBadges();
    applyRequestedSearchHighlight(state.searchBaseline);
    return;
  }
  if (pageKeyChanged && shouldRekeyComparisonWithoutReset(pageKey)) {
    debugSearch("rekey-comparison-same-itinerary", {
      mode,
      previousPageKeyHash: stableContentHash(state.pageKey),
      nextPageKeyHash: stableContentHash(pageKey),
      comparing: state.comparing,
      resultCount: state.results.length,
      comparedCountries: state.searchResults.map((result) => result.country),
    });
    state.pageKey = pageKey;
    state.cacheKey = cacheKey;
  } else if (pageKeyChanged) {
    state.pageKey = pageKey;
    state.cacheKey = cacheKey;
    state.baselineSignature = "";
    state.error = "";
    state.comparing = false;
    state.comparingRequestId = "";
    state.comparingCacheKey = "";
    state.progressCompleted = 0;
    state.progressTotal = 0;
    state.comparisonStopRequested = false;
    state.comparisonStopped = false;
    state.searchBaseline = null;
    state.searchResults = [];
    state.searchBestByRowKey = {};
    if (mode === "booking") {
      applyCachedResults(readCachedResults(cacheKey));
      void loadStoredCachedResults(cacheKey);
    } else {
      state.results = [];
      state.resultsCachedAt = 0;
      void loadStoredSearchComparisonHandoff(cacheKey);
      requestLatestSkyscannerSearchCapture();
    }
  } else if (state.baselineSignature && state.baselineSignature !== baselineSignature) {
    if (mode === "search") {
      const previousSearchBaseline = state.searchBaseline;
      const keepSearchResults =
        previousSearchBaseline && searchBaseline
          ? searchBaselineIncludesPreviousRows(previousSearchBaseline, searchBaseline) ||
            shouldKeepHandoffResultsForInitialRows(previousSearchBaseline, searchBaseline)
          : false;
      debugSearch("signature-change", {
        previousSignatureHash: stableContentHash(state.baselineSignature),
        nextSignatureHash: stableContentHash(baselineSignature),
        previousRows: previousSearchBaseline?.results.length || 0,
        nextRows: searchBaseline?.results.length || 0,
        keepSearchResults,
        comparedCountries: state.searchResults.map((result) => result.country),
      });
      void storeSearchComparisonCache(state.cacheKey, state.baselineSignature);
      state.searchBaseline = searchBaseline;
      if (!keepSearchResults) {
        state.searchResults = [];
        state.searchBestByRowKey = {};
      }
      state.resultsCachedAt = 0;
    } else if (state.results.length > 0 && !state.resultsCachedAt) {
      state.resultsCachedAt = Date.now();
    } else if (state.results.length === 0) {
      void loadStoredCachedResults(cacheKey);
    }
  }

  if (!pageKeyChanged && state.baselineSignature === baselineSignature) {
    applySearchBadges();
    applyRequestedSearchHighlight(searchBaseline);
    if (mode === "search" && state.searchResults.length === 0)
      void loadStoredSearchComparisonCache(cacheKey, baselineSignature);
    return;
  }
  state.baseline = baseline;
  state.searchBaseline = searchBaseline;
  state.baselineSignature = baselineSignature;
  state.searchBestByRowKey = bestPricesBySearchRow(state.searchBaseline, state.searchResults);
  render();
  applySearchBadges();
  applyRequestedSearchHighlight(state.searchBaseline);
  if (mode === "search") void loadStoredSearchComparisonCache(cacheKey, baselineSignature);
}

function shouldKeepPanelDuringTransientEmptyPageKey(now = Date.now()): boolean {
  if (!state.pageKey || !transientEmptyPageKeyStartedAt || !hasComparisonStateToPreserve()) return false;
  return now - transientEmptyPageKeyStartedAt <= TRANSIENT_EMPTY_PAGE_KEY_GRACE_MS;
}

function hasComparisonStateToPreserve(): boolean {
  return (
    state.comparing ||
    state.results.length > 0 ||
    state.searchResults.length > 0 ||
    Object.keys(state.searchBestByRowKey).length > 0
  );
}

function scheduleTransientEmptyPageKeyRecheck(now = Date.now()): void {
  clearTransientEmptyPageKeyTimer();
  const elapsed = Math.max(0, now - transientEmptyPageKeyStartedAt);
  const delayMs = Math.max(50, TRANSIENT_EMPTY_PAGE_KEY_GRACE_MS - elapsed + 50);
  transientEmptyPageKeyTimer = window.setTimeout(() => {
    transientEmptyPageKeyTimer = undefined;
    scheduleRender();
  }, delayMs);
}

function clearTransientEmptyPageKeyTimer(): void {
  if (transientEmptyPageKeyTimer === undefined) return;
  window.clearTimeout(transientEmptyPageKeyTimer);
  transientEmptyPageKeyTimer = undefined;
}

// When a panel-page URL omits `curr`/`gl`, those segments of the page key are inferred from the
// rendered DOM. That inference is unstable while the page is still painting localized prices (e.g. a
// JPY booking page momentarily reads as the USD default), so the key can flip between two valid values
// with no real navigation. Treat such a flip as a re-key of the same itinerary rather than a fresh page.
function panelPageNavigationIdentity(pageKey: string): string {
  const queryIndex = pageKey.indexOf("?");
  if (queryIndex === -1) return pageKey;
  const params = new URLSearchParams(pageKey.slice(queryIndex + 1));
  params.delete("curr");
  params.delete("gl");
  params.sort();
  return `${pageKey.slice(0, queryIndex)}?${params.toString()}`;
}

function shouldRekeyComparisonWithoutReset(nextPageKey: string): boolean {
  if (!state.pageKey || !nextPageKey || !hasComparisonStateToPreserve()) return false;
  if (explicitPanelMarketOrCurrencyChanged()) return false;
  return panelPageNavigationIdentity(state.pageKey) === panelPageNavigationIdentity(nextPageKey);
}

function explicitPanelMarketOrCurrencyChanged(): boolean {
  try {
    const url = new URL(window.location.href);
    const explicitCountry = normalizeOptionalUrlParam(url.searchParams.get("gl"));
    const explicitCurrency = normalizeGoogleFlightsCurrency(url.searchParams.get("curr"));
    return (
      Boolean(explicitCountry && explicitCountry !== pageKeyParam(state.pageKey, "gl")) ||
      Boolean(explicitCurrency && explicitCurrency !== pageKeyParam(state.pageKey, "curr"))
    );
  } catch {
    return true;
  }
}

function pageKeyParam(pageKey: string, key: string): string {
  const queryIndex = pageKey.indexOf("?");
  if (queryIndex === -1) return "";
  return normalizeOptionalUrlParam(new URLSearchParams(pageKey.slice(queryIndex + 1)).get(key));
}

function normalizeOptionalUrlParam(value: string | null): string {
  return (value || "").trim().toUpperCase();
}

function currentBookingPageKey(): string {
  return currentBookingPageKeyForCountry(true);
}

function currentComparisonCacheKey(): string {
  return currentBookingPageKeyForCountry(false);
}

function currentPanelPageKey(mode: "booking" | "search"): string {
  return mode === "search" ? currentSearchPageKey(true) : currentBookingPageKey();
}

function currentPanelComparisonCacheKey(mode: "booking" | "search"): string {
  return mode === "search" ? currentSearchPageKey(false) : currentComparisonCacheKey();
}

function currentSearchPageKey(includeCountry: boolean): string {
  if (isCurrentSkyscannerSearchPage()) {
    return skyscannerPanelPageKey(
      window.location.href,
      currentComparableCountryCode(),
      includeCountry,
      currentComparableCurrencyCode(),
    );
  }
  if (!isGoogleFlightsPanelPageUrl(window.location.href)) return "";
  try {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    const tfs = url.searchParams.get("tfs");
    if (tfs) params.set("tfs", tfs);
    if (!tfs) {
      for (const key of ["q", "origin", "destination", "depart", "return"]) {
        const value = url.searchParams.get(key);
        if (value) params.set(key, value);
      }
    }
    params.set("curr", currentComparableCurrencyCode());
    if (includeCountry) params.set("gl", currentComparableCountryCode());
    return `${url.pathname}?${params.toString()}`;
  } catch {
    return "";
  }
}

function skyscannerSearchCaptureMatchesCurrentPage(capture: SkyscannerSearchCapture): boolean {
  if (!capture.pageUrl || !isCurrentSkyscannerSearchPage()) return false;
  return (
    skyscannerPanelPageKey(
      capture.pageUrl,
      skyscannerCountryCodeFromUrl(capture.pageUrl) || currentComparableCountryCode(),
      false,
    ) === skyscannerPanelPageKey(window.location.href, currentComparableCountryCode(), false)
  );
}

function currentGoogleFlightsPanelMode(): "booking" | "search" {
  try {
    const url = new URL(window.location.href);
    if (isSkyscannerFinalComparePageUrl(url.toString())) return "booking";
    if (isSkyscannerSearchPageUrl(url.toString())) return "search";
    return /^\/travel\/flights\/booking/.test(url.pathname) || url.searchParams.get("source") === "ita_matrix"
      ? "booking"
      : "search";
  } catch {
    return "booking";
  }
}

function currentBookingPageKeyForCountry(includeCountry: boolean): string {
  if (isCurrentSkyscannerPanelPage()) {
    return skyscannerPanelPageKey(
      window.location.href,
      currentComparableCountryCode(),
      includeCountry,
      currentComparableCurrencyCode(),
    );
  }
  if (!isGoogleFlightsPanelPageUrl(window.location.href)) return "";
  return googleFlightsPanelPageKey(
    window.location.href,
    currentComparableCountryCode(),
    includeCountry,
    currentComparableCurrencyCode(),
  );
}

function render(): void {
  if (shouldHidePanel()) {
    removePanel();
    return;
  }

  const shadow = getShadowRoot();
  if (!shadow) return;
  const matrixSearch = isCurrentSkyscannerPage()
    ? parseSkyscannerMatrixSearch(window.location.href, currentComparableCurrencyCode())
    : parseGoogleFlightsMatrixSearch(window.location.href, currentComparableCurrencyCode());
  const selectedCodes = selectedGoogleFlightsCountries();
  const translate = t();
  const mode = currentRenderPanelMode();
  const panelScrollTop = shadow.querySelector<HTMLElement>(".panel")?.scrollTop ?? 0;

  shadow.innerHTML = `
    <style>${styles()}</style>
    <section class="panel ${state.panelMinimized ? "minimized" : ""}" style="${panelPositionStyle(state.panelPosition)}" aria-label="${escapeHtml(translate("googleFlightsCountryPriceComparison"))}">
      ${
        state.panelMinimized
          ? renderMooFlightsMinimizedButton(panelChromeLabels())
          : `${renderMooFlightsPanelHeader({ optionsAction: "open-options", labels: panelChromeLabels() })}
            ${
              mode === "search"
                ? `${renderCrossProviderSearchAction()}
                  ${renderSearchComparisonPanel(selectedCodes)}`
                : `${renderCrossProviderSearchAction()}
                  ${renderMilesEstimatePrompt(matrixSearch)}
                  <div class="section-heading">${escapeHtml(translate("compareCountryPricing"))}</div>
                  ${renderCountrySelect(selectedCodes, countryComparisonDisplayCount(selectedCodes))}
                  ${renderComparisonAction({
                    action: "compare-countries",
                    label: translate("compareCount", { count: countryComparisonDisplayCount(selectedCodes) }),
                    disabled: selectedCodes.length === 0,
                  })}
                  ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
                  ${renderComparisonNotice()}
                  ${renderCacheNotice()}
                  ${renderResults(state.results)}`
            }`
      }
    </section>
  `;

  const panel = shadow.querySelector<HTMLElement>(".panel");
  if (panelScrollTop > 0 && panel && !state.panelMinimized) panel.scrollTop = panelScrollTop;

  shadow.querySelector('[data-action="minimize-panel"]')?.addEventListener("click", () => {
    minimizePanel(shadow);
  });
  shadow.querySelector('[data-action="hide-panel-session"]')?.addEventListener("click", hidePanelForSession);
  shadow.querySelectorAll<HTMLElement>(".panel-menu .menu-item").forEach((item) => {
    item.addEventListener("click", closePanelMenu);
  });
  shadow.querySelector('[data-action="restore-panel"]')?.addEventListener("click", () => {
    if (!state.panelMinimized) return;
    if (suppressPanelRestoreClick) {
      suppressPanelRestoreClick = false;
      return;
    }
    state.panelCollapsePosition = state.panelPosition;
    restoreExpandedPanelPosition();
    state.panelMinimized = false;
    savePanelUiState();
    render();
  });
  shadow.querySelector<HTMLElement>('[data-action="restore-panel"]')?.addEventListener("pointerdown", onPanelDragStart);
  shadow.querySelector<HTMLElement>('[data-role="panel-header"]')?.addEventListener("pointerdown", onPanelDragStart);

  const countrySearch = shadow.querySelector<HTMLInputElement>('[data-role="country-search"]');
  const countryDropdown = shadow.querySelector<HTMLElement>('[data-role="country-dropdown"]');
  countrySearch?.addEventListener("input", () => {
    state.countrySearch = countrySearch.value;
    if (state.error) {
      state.error = "";
      shadow.querySelector(".error")?.remove();
    }
    if (state.countrySearch.includes(",")) {
      addCountrySearchValue(true);
      return;
    }
    renderCountryDropdown(countryDropdown);
  });
  countrySearch?.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.getData("text") || "";
    if (!pasted || parseGoogleFlightsCountryInput(pasted).length === 0) return;
    event.preventDefault();
    state.countrySearch = pasted;
    addCountrySearchValue(true);
  });
  countrySearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCountrySearchValue(false);
      return;
    }
    if (event.key === "Escape") {
      state.countrySearch = "";
      countrySearch.value = "";
      renderCountryDropdown(countryDropdown);
      return;
    }
    if (event.key === "Backspace" && countrySearch.value === "") {
      removeGoogleFlightsCountry(selectedGoogleFlightsCountries().at(-1) || "");
    }
  });
  countrySearch?.addEventListener("focus", () => {
    renderCountryDropdown(countryDropdown);
  });
  shadow.querySelectorAll<HTMLElement>('[data-action="add-country"]').forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const code = button.dataset.code || "";
      if (!code) return;
      addGoogleFlightsCountries([code], true);
    });
  });
  shadow.querySelectorAll<HTMLElement>('[data-action="remove-country"]').forEach((button) => {
    button.addEventListener("click", () => {
      removeGoogleFlightsCountry(button.dataset.code || "");
    });
  });
  shadow.querySelector('[data-action="country-recommended"]')?.addEventListener("click", () => {
    if (state.comparing) return;
    updateGoogleFlightsCountrySelection(DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES);
    render();
  });
  shadow.querySelector('[data-action="country-all"]')?.addEventListener("click", () => {
    if (state.comparing) return;
    updateGoogleFlightsCountrySelection(allGoogleFlightsCountryCodes());
    render();
  });
  shadow.querySelector('[data-action="country-clear"]')?.addEventListener("click", () => {
    if (state.comparing) return;
    updateGoogleFlightsCountrySelection([]);
    render();
  });
  shadow.querySelector('[data-action="compare-countries"]')?.addEventListener("click", () => {
    void compareCountries();
  });
  shadow.querySelector('[data-action="compare-search-rows"]')?.addEventListener("click", () => {
    void compareSearchRows();
  });
  shadow.querySelector('[data-action="stop-comparison"]')?.addEventListener("click", () => {
    void stopComparison();
  });
  shadow.querySelector<HTMLAnchorElement>('[data-action="open-matrix"]')?.addEventListener("click", (event) => {
    const anchor = event.currentTarget;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    const openedWindow = window.open(anchor.href, "_blank");
    try {
      if (openedWindow) openedWindow.opener = null;
    } catch {
      // The Matrix tab is already open; opener cleanup is a defense-in-depth enhancement.
    }
    void openMatrixWithAutoOpen(anchor.href, Boolean(openedWindow));
  });
  shadow.querySelector('[data-action="open-options"]')?.addEventListener("click", () => {
    sendRuntimeMessage({ command: "openOptionsPage" });
  });
  applySearchBadges();
}

function t(): ReturnType<typeof createContentTranslator> {
  return createContentTranslator(state.language);
}

function currentRenderPanelMode(): "booking" | "search" {
  const mode = currentGoogleFlightsPanelMode();
  if (currentPanelPageKey(mode) || !hasComparisonStateToPreserve()) return mode;
  return state.searchBaseline ? "search" : "booking";
}

function panelChromeLabels(): {
  panelActions: string;
  hideForSession: string;
  minimize: string;
  settings: string;
  expandPanel: string;
} {
  const translate = t();
  return {
    panelActions: translate("panelActions"),
    hideForSession: translate("hideForSession"),
    minimize: translate("minimize"),
    settings: translate("settings"),
    expandPanel: translate("expandPanel"),
  };
}

function closePanelMenu(event: Event): void {
  const item = event.currentTarget;
  if (!(item instanceof HTMLElement)) return;
  const menu = item.closest<HTMLDetailsElement>(".panel-menu");
  if (menu) menu.open = false;
}

function minimizePanel(root: ShadowRoot): void {
  const panel = root.querySelector<HTMLElement>(".panel");
  state.panelPosition =
    state.panelCollapsePosition || (panel ? minimizedPanelPositionFromPanel(panel) : state.panelPosition);
  state.panelCollapsePosition = null;
  state.panelMinimized = true;
  savePanelUiState();
  render();
}

function renderCountrySelect(selectedCodes: string[], comparisonDisplayCount: number): string {
  const dropdownOptions = countryDropdownOptions();
  const disabled = state.comparing ? "disabled" : "";
  const translate = t();
  return `
    <div class="country-select">
      <div class="country-head">
        <span>${escapeHtml(translate("countries"))}</span>
        <small>${escapeHtml(translate("comparedShort", { count: comparisonDisplayCount }))}</small>
      </div>
      <div class="country-combo">
        <input type="search" data-role="country-search" aria-label="${escapeHtml(translate("addCountry"))}" placeholder="${escapeHtml(translate("addCountryPlaceholder"))}" autocomplete="off" spellcheck="false" value="${escapeHtml(state.countrySearch)}" ${disabled}>
        <ul class="country-dropdown" data-role="country-dropdown" ${dropdownOptions.length === 0 ? "hidden" : ""}>
          ${renderCountryDropdownRows(dropdownOptions)}
        </ul>
      </div>
      <div class="country-chips" data-role="country-chips">
        ${selectedCodes
          .map(
            (code) => `
              <button type="button" class="country-chip" data-action="remove-country" data-code="${escapeHtml(code)}" aria-label="${escapeHtml(translate("removeAirportCode", { code: panelCountryDisplayName(code) }))}" ${disabled}>
                <span class="flag" aria-hidden="true">${escapeHtml(flagEmoji(code))}</span>${escapeHtml(code)}<span class="x">x</span>
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="country-toolbar">
        <button type="button" class="link" data-action="country-recommended" ${disabled}>${escapeHtml(translate("recommended"))}</button>
        <button type="button" class="link" data-action="country-all" ${disabled}>${escapeHtml(translate("allUseful"))}</button>
        <button type="button" class="link" data-action="country-clear" ${disabled}>${escapeHtml(translate("clear"))}</button>
      </div>
    </div>
  `;
}

function renderCrossProviderSearchAction(): string {
  const translate = t();
  const url = routeSpecificCrossProviderSearchUrl(window.location.href, currentComparableCurrencyCode());
  const isSkyscanner = isCurrentSkyscannerPage();
  const label = isSkyscanner ? translate("searchGoogleFlights") : translate("searchSkyscanner");
  if (!url) {
    const unavailableMessage = isSkyscanner
      ? translate("searchGoogleFlightsUnavailable")
      : translate("searchSkyscannerUnavailable");
    return `
      <div class="cross-search unavailable" aria-label="${escapeHtml(label)}">
        <button type="button" disabled>${escapeHtml(label)}</button>
        <small>${escapeHtml(unavailableMessage)}</small>
      </div>
    `;
  }
  return `
    <div class="cross-search">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>
    </div>
  `;
}

function renderSearchComparisonPanel(selectedCodes: string[]): string {
  const translate = t();
  const visibleRows = state.searchBaseline?.results.length || parseCurrentSearchPage().results.length;
  const comparisonDisplayCount = countryComparisonDisplayCount(selectedCodes);
  const emptyRowsMessage = isCurrentSkyscannerSearchPage()
    ? translate("noSkyscannerSearchApiResponse")
    : translate("noVisibleGoogleFlightsRows");
  return `
    <div class="section-heading">${escapeHtml(translate("compareVisibleFlightRows"))}</div>
    ${renderCountrySelect(selectedCodes, comparisonDisplayCount)}
    ${renderComparisonAction({
      action: "compare-search-rows",
      label: translate("compareRowsCount", { count: comparisonDisplayCount }),
      disabled: selectedCodes.length === 0 || visibleRows === 0,
    })}
    ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
    ${renderComparisonNotice()}
    ${visibleRows === 0 ? `<p class="cache-note">${escapeHtml(emptyRowsMessage)}</p>` : ""}
  `;
}

function renderComparisonAction({
  action,
  label,
  disabled,
}: {
  action: "compare-countries" | "compare-search-rows";
  label: string;
  disabled: boolean;
}): string {
  const translate = t();
  if (!state.comparing) {
    return `
      <div class="actions">
        <button type="button" class="wide" ${disabled ? "disabled" : ""} data-action="${action}">
          ${escapeHtml(label)}
        </button>
      </div>
    `;
  }

  const completed = state.progressCompleted;
  const total = state.progressTotal;
  const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const progressLabel = translate("countriesChecked", { completed, total });
  return `
    <div class="actions">
      <div class="comparison-progress" role="group" aria-label="${escapeHtml(translate("checking"))}">
        <span class="comparison-progress-fill" style="width: ${progress}%" aria-hidden="true"></span>
        <div class="comparison-progress-content">
          <span class="comparison-progress-status" role="progressbar" aria-label="${escapeHtml(progressLabel)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}">
            <span class="comparison-spinner" aria-hidden="true"></span>
            <span>${escapeHtml(progressLabel)}</span>
          </span>
          <button type="button" class="comparison-stop" data-action="stop-comparison" aria-label="${escapeHtml(translate("stopChecking"))}" ${state.comparisonStopRequested ? "disabled" : ""}>
            ${escapeHtml(state.comparisonStopRequested ? translate("stopping") : translate("stopChecking"))}
          </button>
        </div>
      </div>
    </div>
  `;
}

function countryComparisonDisplayCount(selectedCodes: string[]): number {
  if (selectedCodes.length === 0) return 0;
  const baselineCountry = currentCountryCode();
  const includesBaseline =
    isRealCountryCode(baselineCountry) && currentVisibleCurrencyCode() && !selectedCodes.includes(baselineCountry);
  return includesBaseline ? selectedCodes.length + 1 : selectedCodes.length;
}

function countryDropdownOptions(): Array<{ code: string; label: string; searchValue: string; aliases?: string[] }> {
  const query = normalizeCountryName(state.countrySearch);
  if (!query) return [];
  const selectedCodes = new Set(selectedGoogleFlightsCountries());
  return countryOptions()
    .filter((country) => {
      if (selectedCodes.has(country.code)) return false;
      return (
        country.code.toLowerCase().includes(query) ||
        normalizeCountryName(country.label).includes(query) ||
        normalizeCountryName(country.searchValue).includes(query) ||
        (country.aliases || []).some((alias) => normalizeCountryName(alias).includes(query))
      );
    })
    .slice(0, 8);
}

function countryOptions(): ReturnType<typeof googleFlightsAvailableCountryOptions> {
  const cached = COUNTRY_OPTIONS_BY_LANGUAGE.get(state.language);
  if (cached) return cached;
  const options = googleFlightsAvailableCountryOptions(state.language);
  COUNTRY_OPTIONS_BY_LANGUAGE.set(state.language, options);
  return options;
}

function renderCountryDropdownRows(countries: Array<{ code: string; label: string }>): string {
  const disabled = state.comparing ? "disabled" : "";
  return countries
    .map(
      (country, index) => `
        <li>
          <button type="button" class="${index === 0 ? "active" : ""}" data-action="add-country" data-code="${escapeHtml(country.code)}" ${disabled}>
            <span class="flag" aria-hidden="true">${escapeHtml(flagEmoji(country.code))}</span>
            <span>${escapeHtml(country.label)}</span>
            <small>${escapeHtml(country.code)}</small>
          </button>
        </li>
      `,
    )
    .join("");
}

function renderCountryDropdown(dropdown: HTMLElement | null): void {
  if (!dropdown) return;
  const countries = countryDropdownOptions();
  dropdown.hidden = countries.length === 0;
  dropdown.innerHTML = renderCountryDropdownRows(countries);
  dropdown.querySelectorAll<HTMLElement>('[data-action="add-country"]').forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const code = button.dataset.code || "";
      if (!code) return;
      addGoogleFlightsCountries([code], true);
    });
  });
}

function addCountrySearchValue(parseAsList: boolean): void {
  if (state.comparing) return;
  const parsedCodes = parseAsList
    ? filterAvailableGoogleFlightsCountryCodes(parseGoogleFlightsCountryInput(state.countrySearch))
    : [];
  const firstMatch = countryDropdownOptions()[0]?.code || "";
  const code = googleFlightsCountryCodeFromSearchValue(state.countrySearch, countryOptions()) || firstMatch;
  const countryCodes = parsedCodes.length > 0 ? parsedCodes : code ? [code] : [];
  addGoogleFlightsCountries(countryCodes, true);
}

function addGoogleFlightsCountries(countryCodes: string[], refocusSearch: boolean): void {
  if (state.comparing) return;
  const availableCountryCodes = filterAvailableGoogleFlightsCountryCodes(countryCodes);
  if (availableCountryCodes.length === 0) {
    state.error = t()("chooseAvailableGoogleFlightsCountry");
    render();
    if (refocusSearch) focusCountrySearch();
    return;
  }
  const nextCountries = filterAvailableGoogleFlightsCountryCodes([
    ...selectedGoogleFlightsCountries(),
    ...availableCountryCodes,
  ]);
  if (nextCountries.length === 0) return;
  updateGoogleFlightsCountrySelection(nextCountries);
  render();
  if (refocusSearch) focusCountrySearch();
}

function removeGoogleFlightsCountry(countryCode: string): void {
  if (state.comparing) return;
  if (!countryCode) return;
  const nextCountries = selectedGoogleFlightsCountries().filter((code) => code !== countryCode);
  updateGoogleFlightsCountrySelection(nextCountries);
  render();
}

function updateGoogleFlightsCountrySelection(countryCodes: string[]): void {
  const nextCountries = applyGoogleFlightsCountryInput(countryCodes);
  writeSessionGoogleFlightsCountrySelection(nextCountries);
}

function applyGoogleFlightsCountryInput(countryCodes: string[]): string[] {
  const nextCountries = filterAvailableGoogleFlightsCountryCodes(countryCodes);
  const selectedCountrySet = new Set(nextCountries);
  state.countryInput = nextCountries.join(", ");
  state.countrySearch = "";
  state.results = state.results.filter((result) => selectedCountrySet.has(result.country));
  state.searchResults = state.searchResults.filter((result) => selectedCountrySet.has(result.country));
  state.searchBestByRowKey = bestPricesBySearchRow(state.searchBaseline, state.searchResults);
  state.resultsCachedAt = 0;
  state.error = "";
  state.comparisonStopped = false;
  return nextCountries;
}

function selectedGoogleFlightsCountries(): string[] {
  return filterAvailableGoogleFlightsCountryCodes(parseGoogleFlightsCountryInput(state.countryInput));
}

function readSessionGoogleFlightsCountrySelection(): string[] | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_COUNTRY_SELECTION_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const countries = Array.isArray(parsed) ? filterAvailableGoogleFlightsCountryCodes(parsed) : [];
    return countries.length > 0 ? countries : null;
  } catch {
    return null;
  }
}

function writeSessionGoogleFlightsCountrySelection(countryCodes: string[]): void {
  try {
    sessionStorage.setItem(
      SEARCH_COUNTRY_SELECTION_SESSION_KEY,
      JSON.stringify(filterAvailableGoogleFlightsCountryCodes(countryCodes)),
    );
  } catch {
    // Session selection is an enhancement; settings/defaults still apply.
  }
}

function focusCountrySearch(): void {
  getShadowRoot()?.querySelector<HTMLInputElement>('[data-role="country-search"]')?.focus();
}

function renderCacheNotice(now = Date.now()): string {
  if (!state.resultsCachedAt || state.results.length === 0) return "";
  const minutes = Math.max(0, Math.floor((now - state.resultsCachedAt) / 60000));
  const translate = t();
  const age = minutes <= 0 ? translate("justNow") : translate("minutesAgo", { count: minutes });
  return `<p class="cache-note">${escapeHtml(translate("cachedCountryComparison", { age }))}</p>`;
}

function renderComparisonNotice(): string {
  const translate = t();
  if (state.comparisonStopped) {
    return `<p class="cache-note">${escapeHtml(
      translate("partialCountryComparison", { completed: state.progressCompleted, total: state.progressTotal }),
    )}</p>`;
  }
  const selectedCountries = selectedGoogleFlightsCountries();
  const selectedCount = selectedCountries.length;
  if (selectedCount <= DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES.length) return "";
  if (isAllGoogleFlightsCountryCodes(selectedCountries)) {
    return `<p class="cache-note">${escapeHtml(translate("allUsefulCountriesNotice"))}</p>`;
  }
  return `<p class="cache-note">${escapeHtml(translate("largeCountrySelectionNotice"))}</p>`;
}

function renderMilesEstimatePrompt(matrixSearch: GoogleFlightsMatrixSearch | null): string {
  if (!matrixSearch) return "";
  const translate = t();
  const earningCarriers = matrixSearch.carriers
    .map((carrier) => ({ carrier, name: mileageCarrierName(carrier) }))
    .filter((carrier): carrier is { carrier: string; name: string } => Boolean(carrier.name));
  const carrierLabels = earningCarriers.map((carrier) => `${carrier.name} (${carrier.carrier})`).join(", ");
  const promptText =
    earningCarriers.length > 0
      ? translate("bookingClassesAndMileageFor", { carriers: carrierLabels })
      : translate("bookingClassesAndMileage");
  return `
    <div class="mileage-prompt">
      <strong>${escapeHtml(translate("milesEarning"))}</strong>
      <span><a href="${escapeHtml(matrixSearch.matrixUrl)}" target="_blank" rel="noopener noreferrer" data-action="open-matrix">${escapeHtml(translate("searchItaMatrix"))}</a>${escapeHtml(promptText)}</span>
    </div>
  `;
}

async function openMatrixWithAutoOpen(matrixUrl: string, openedByPage = false): Promise<void> {
  const openedByBackground = await safeChromeCall(async () => {
    const response = await chrome.runtime.sendMessage({ command: "openMatrixWithAutoOpen", matrixUrl, openedByPage });
    return Boolean(response?.ok);
  }, false);
  if (openedByBackground || openedByPage) return;

  window.location.assign(matrixUrl);
}

function renderResults(results: CountryResult[]): string {
  if (results.length === 0) return "";
  const translate = t();
  const sorted = [...results].sort(compareCountryResultDisplayOrder);

  return `
    <div class="results">
      ${sorted
        .map((result) => {
          const cheapest = renderCheapest(result);
          const direct = result.direct ? `${result.direct.priceText} ${translate("direct")}` : translate("noDirect");
          const isCurrent = state.baseline?.country === result.country;
          return `
            <div class="result ${result.status}">
              <strong>${escapeHtml(panelCountryDisplayName(result.country))}${isCurrent ? ` <span class="current">${escapeHtml(translate("current"))}</span>` : ""}</strong>
              <span>${escapeHtml(cheapest)}</span>
              <small>${escapeHtml(direct)} · ${escapeHtml(translate("optionCount", { count: result.options.length }))}${result.refreshed ? ` · ${escapeHtml(translate("retried"))}` : ""}</small>
              ${renderResultActions(result)}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function compareCountryResultDisplayOrder(left: CountryResult, right: CountryResult): number {
  const priceDifference =
    (left.cheapest?.price ?? Number.POSITIVE_INFINITY) - (right.cheapest?.price ?? Number.POSITIVE_INFINITY);
  if (!Number.isNaN(priceDifference) && priceDifference !== 0) return priceDifference;

  const baselineCountry = state.baseline?.country;
  const currentDifference = (left.country === baselineCountry ? 0 : 1) - (right.country === baselineCountry ? 0 : 1);
  return currentDifference || left.country.localeCompare(right.country);
}

function renderResultActions(result: CountryResult): string {
  const bookingTargets = bookingActionTargets(result);
  return `
    <div class="result-actions">
      <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t()("openCountryPage"))}</a>
      ${bookingTargets
        .map(
          (target) =>
            `<a href="${escapeHtml(target.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(target.label)}</a>`,
        )
        .join("")}
    </div>
  `;
}

function countryComparisonResultCountries(selectedCountries: string[]): string[] {
  const countries = [...selectedCountries];
  const baselineCountry = state.baseline?.country;
  if (baselineCountry && !countries.includes(baselineCountry)) countries.push(baselineCountry);
  return countries;
}

function mergeCountryResults(
  previousResults: CountryResult[],
  updates: CountryResult[],
  selectedCountries: string[],
): { results: CountryResult[]; retained: boolean } {
  const updateCountries = new Set(updates.map((result) => result.country));
  const selectedCountrySet = new Set(selectedCountries);
  const byCountry = new Map(
    previousResults
      .filter((result) => selectedCountrySet.has(result.country) || updateCountries.has(result.country))
      .map((result) => [result.country, result]),
  );
  let retained = false;
  for (const update of updates) {
    const previous = byCountry.get(update.country);
    const merged = previous ? mergeCountryResult(previous, update) : update;
    if (previous && resultRetainedPreviousData(previous, update, merged)) retained = true;
    byCountry.set(update.country, merged);
  }
  for (const previous of previousResults) {
    if (selectedCountrySet.has(previous.country) && !updateCountries.has(previous.country)) retained = true;
  }
  return { results: Array.from(byCountry.values()), retained };
}

function mergeCountryResult(previous: CountryResult, update: CountryResult): CountryResult {
  const optionsByKey = new Map(previous.options.map((option) => [bookingOptionKey(option), option]));
  for (const option of update.options) optionsByKey.set(bookingOptionKey(option), option);
  const options = Array.from(optionsByKey.values()).sort(
    (left, right) => left.price - right.price || left.provider.localeCompare(right.provider),
  );
  return {
    ...previous,
    ...update,
    options,
    cheapest: options[0],
    direct: options.find((option) => option.isDirect),
    status: options.length > 0 && update.status === "empty" ? previous.status : update.status,
  };
}

function resultRetainedPreviousData(previous: CountryResult, update: CountryResult, merged: CountryResult): boolean {
  return (
    merged.options.length > update.options.length ||
    Boolean(previous.direct && !update.direct && merged.direct) ||
    previous.country !== update.country
  );
}

function bookingOptionKey(option: CountryResult["options"][number]): string {
  return `${option.provider}:${option.isDirect ? "direct" : "ota"}`;
}

function bookingActionTargets(result: CountryResult): Array<{ label: string; url: string }> {
  const targets: Array<{ label: string; url: string }> = [];
  if (result.cheapest?.bookingUrl) {
    targets.push({
      label: t()("bookProvider", { provider: result.cheapest.provider }),
      url: result.cheapest.bookingUrl,
    });
  }
  if (result.direct?.bookingUrl && result.direct.bookingUrl !== result.cheapest?.bookingUrl) {
    targets.push({ label: t()("bookDirect"), url: result.direct.bookingUrl });
  }
  return targets;
}

function renderCheapest(result: CountryResult): string {
  if (!result.cheapest) return t()("noOptions");
  const tiedProviders = result.options
    .filter((option) => option.price === result.cheapest?.price)
    .map((option) => option.provider);
  return `${result.cheapest.priceText} ${tiedProviders.join(", ")}`;
}

function loadPanelUiState(): {
  minimized: boolean;
  position: PanelPosition;
  collapsePosition: PanelPosition | null;
} {
  try {
    const raw = sessionStorage.getItem(PANEL_UI_STORAGE_KEY);
    if (!raw) {
      return { minimized: false, position: DEFAULT_PANEL_POSITION, collapsePosition: null };
    }
    const parsed = JSON.parse(raw) as {
      minimized?: unknown;
      position?: unknown;
      collapsePosition?: unknown;
    };
    const position = isPanelPosition(parsed.position) ? parsed.position : DEFAULT_PANEL_POSITION;
    return {
      minimized: parsed.minimized === true,
      position,
      collapsePosition: isPanelPosition(parsed.collapsePosition) ? parsed.collapsePosition : null,
    };
  } catch {
    return { minimized: false, position: DEFAULT_PANEL_POSITION, collapsePosition: null };
  }
}

function savePanelUiState(): void {
  try {
    sessionStorage.setItem(
      PANEL_UI_STORAGE_KEY,
      JSON.stringify({
        minimized: state.panelMinimized,
        position: state.panelPosition,
        collapsePosition: state.panelCollapsePosition,
      }),
    );
  } catch {
    // Session storage is an enhancement; the panel still works without it.
  }
}

function isPanelPosition(value: unknown): value is PanelPosition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { edge?: unknown; ratio?: unknown };
  return (
    (candidate.edge === "top" ||
      candidate.edge === "right" ||
      candidate.edge === "bottom" ||
      candidate.edge === "left") &&
    typeof candidate.ratio === "number" &&
    Number.isFinite(candidate.ratio) &&
    candidate.ratio >= 0 &&
    candidate.ratio <= 1
  );
}

function onPanelDragStart(event: PointerEvent): void {
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  if (handle.dataset.role === "panel-header" && isInteractivePanelDragTarget(event.target)) return;
  const panel = handle.closest<HTMLElement>(".panel");
  if (!panel) return;

  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  let dragged = false;
  const startX = event.clientX;
  const startY = event.clientY;

  const movePanel = (pointerEvent: PointerEvent) => {
    if (Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) <= 4) return;
    dragged = true;
    state.panelPosition = panelPositionFromPoint(pointerEvent.clientX, pointerEvent.clientY);
    panel.setAttribute("style", panelPositionStyle(state.panelPosition));
  };

  const stopDragging = (pointerEvent: PointerEvent) => {
    if (dragged) movePanel(pointerEvent);
    if (dragged) state.panelCollapsePosition = null;
    savePanelUiState();
    handle.releasePointerCapture(pointerEvent.pointerId);
    handle.removeEventListener("pointermove", movePanel);
    handle.removeEventListener("pointerup", stopDragging);
    handle.removeEventListener("pointercancel", stopDragging);
    if (dragged && handle.dataset.action === "restore-panel") {
      suppressPanelRestoreClick = true;
      window.setTimeout(() => {
        suppressPanelRestoreClick = false;
      }, 0);
    } else if (handle.dataset.action === "restore-panel") {
      state.panelCollapsePosition = state.panelPosition;
      restoreExpandedPanelPosition();
      state.panelMinimized = false;
      savePanelUiState();
      render();
    }
  };

  handle.addEventListener("pointermove", movePanel);
  handle.addEventListener("pointerup", stopDragging);
  handle.addEventListener("pointercancel", stopDragging);
}

function isInteractivePanelDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, select, textarea, summary, label"));
}

function restoreExpandedPanelPosition(): void {
  state.panelPosition = nearestWindowCornerPanelPosition(state.panelPosition);
}

function panelPositionFromPoint(clientX: number, clientY: number): PanelPosition {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const topOffset = panelTopOffsetPx();
  const verticalAxisLength = Math.max(height - topOffset - PANEL_EDGE_OFFSET_PX, 1);
  const verticalAxisPoint = clamp(clientY - topOffset, 0, verticalAxisLength);
  const distances: Array<{ edge: PanelEdge; distance: number }> = [
    { edge: "left", distance: clientX },
    { edge: "right", distance: width - clientX },
    { edge: "top", distance: Math.max(clientY - topOffset, 0) },
    { edge: "bottom", distance: height - clientY },
  ];
  distances.sort((a, b) => a.distance - b.distance);

  const edge = distances[0]?.edge || DEFAULT_PANEL_POSITION.edge;
  const axisLength = edge === "top" || edge === "bottom" ? width : verticalAxisLength;
  const axisPoint = edge === "top" || edge === "bottom" ? clientX : verticalAxisPoint;
  let ratio = clamp(axisPoint / axisLength, 0, 1);

  if (axisPoint <= PANEL_CORNER_SNAP_PX) ratio = 0;
  if (axisLength - axisPoint <= PANEL_CORNER_SNAP_PX) ratio = 1;

  return { edge, ratio };
}

function minimizedPanelPositionFromPanel(panel: HTMLElement): PanelPosition {
  const rect = panel.getBoundingClientRect();
  const topOffset = panelTopOffsetPx();
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const viewportCorners = [
    { x: 0, y: topOffset },
    { x: width, y: topOffset },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  const panelCorners = [
    { distanceX: rect.left, distanceY: rect.top, x: rect.left, y: rect.top },
    { distanceX: rect.right, distanceY: rect.top, x: rect.right, y: rect.top },
    {
      distanceX: rect.left,
      distanceY: rect.bottom,
      x: rect.left,
      y: rect.bottom - PANEL_MINIMIZED_ICON_SIZE_PX,
    },
    {
      distanceX: rect.right,
      distanceY: rect.bottom,
      x: rect.right,
      y: rect.bottom - PANEL_MINIMIZED_ICON_SIZE_PX,
    },
  ];
  const nearest = panelCorners
    .map((corner) => ({
      ...corner,
      distance: Math.min(
        ...viewportCorners.map((viewportCorner) =>
          Math.hypot(corner.distanceX - viewportCorner.x, corner.distanceY - viewportCorner.y),
        ),
      ),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  return panelPositionFromPoint(nearest?.x ?? rect.right, nearest?.y ?? rect.top);
}

function nearestWindowCornerPanelPosition(position: PanelPosition): PanelPosition {
  const point = panelPositionPoint(position);
  const topOffset = panelTopOffsetPx();
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const corners: Array<{ position: PanelPosition; x: number; y: number }> = [
    { position: { edge: "top", ratio: 0 }, x: 0, y: topOffset },
    { position: { edge: "top", ratio: 1 }, x: width, y: topOffset },
    { position: { edge: "bottom", ratio: 0 }, x: 0, y: height },
    { position: { edge: "bottom", ratio: 1 }, x: width, y: height },
  ];
  return (
    corners
      .map((corner) => ({
        ...corner,
        distance: Math.hypot(point.x - corner.x, point.y - corner.y),
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.position || DEFAULT_PANEL_POSITION
  );
}

function panelPositionPoint(position: PanelPosition): { x: number; y: number } {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const topOffset = panelTopOffsetPx();
  const verticalAxisLength = Math.max(height - topOffset - PANEL_EDGE_OFFSET_PX, 1);
  if (position.edge === "top") return { x: width * position.ratio, y: topOffset };
  if (position.edge === "bottom") return { x: width * position.ratio, y: height };
  return {
    x: position.edge === "left" ? 0 : width,
    y: topOffset + verticalAxisLength * position.ratio,
  };
}

function panelPositionStyle(position: PanelPosition): string {
  const percent = `${Math.round(position.ratio * 1000) / 10}%`;
  const offset = `${PANEL_EDGE_OFFSET_PX}px`;
  const topOffsetPx = panelTopOffsetPx();
  const topOffset = `${topOffsetPx}px`;
  const topMaxHeight = `max-height: calc(100vh - ${topOffsetPx + PANEL_EDGE_OFFSET_PX}px);`;
  const verticalAxisLength = Math.max(window.innerHeight - topOffsetPx - PANEL_EDGE_OFFSET_PX, 1);
  const topPx = Math.round(topOffsetPx + verticalAxisLength * position.ratio);
  if (position.edge === "top" && position.ratio === 0) return `top: ${topOffset}; left: ${offset}; ${topMaxHeight}`;
  if (position.edge === "top" && position.ratio === 1) return `top: ${topOffset}; right: ${offset}; ${topMaxHeight}`;
  if (position.edge === "bottom" && position.ratio === 0) return `bottom: ${offset}; left: ${offset};`;
  if (position.edge === "bottom" && position.ratio === 1) return `right: ${offset}; bottom: ${offset};`;
  if (position.edge === "left" && position.ratio === 0) return `top: ${topOffset}; left: ${offset}; ${topMaxHeight}`;
  if (position.edge === "left" && position.ratio === 1) return `bottom: ${offset}; left: ${offset};`;
  if (position.edge === "right" && position.ratio === 0) return `top: ${topOffset}; right: ${offset}; ${topMaxHeight}`;
  if (position.edge === "right" && position.ratio === 1) return `right: ${offset}; bottom: ${offset};`;
  if (position.edge === "top") {
    return `top: ${topOffset}; left: ${percent}; transform: translateX(-${percent}); ${topMaxHeight}`;
  }
  if (position.edge === "bottom") return `bottom: ${offset}; left: ${percent}; transform: translateX(-${percent});`;
  if (position.edge === "left")
    return `left: ${offset}; top: ${topPx}px; transform: translateY(-${percent}); ${topMaxHeight}`;
  return `right: ${offset}; top: ${topPx}px; transform: translateY(-${percent}); ${topMaxHeight}`;
}

function panelTopOffsetPx(): number {
  const maxOffset = Math.max(PANEL_EDGE_OFFSET_PX, window.innerHeight - 96);
  return clamp(GOOGLE_FLIGHTS_HEADER_HEIGHT_PX + GOOGLE_FLIGHTS_HEADER_BUFFER_PX, PANEL_EDGE_OFFSET_PX, maxOffset);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function searchDebugEnabled(): boolean {
  try {
    const params = new URL(window.location.href).searchParams;
    return window.localStorage.getItem("mooFlightsDebug") === "1" || params.get("mooFlightsDebug") === "1";
  } catch {
    return false;
  }
}

function debugSearch(event: string, details: Record<string, unknown> = {}): void {
  if (!searchDebugEnabled()) return;
  const entry = {
    at: new Date().toISOString(),
    event,
    details,
  };
  try {
    console.debug("[MooFlights]", event, details);
  } catch {
    // Console logging is best-effort.
  }
  try {
    const raw = window.sessionStorage.getItem(SEARCH_DEBUG_LOG_SESSION_KEY);
    const previous = raw ? (JSON.parse(raw) as unknown) : [];
    const log = Array.isArray(previous) ? previous : [];
    log.push(entry);
    window.sessionStorage.setItem(SEARCH_DEBUG_LOG_SESSION_KEY, JSON.stringify(log.slice(-200)));
  } catch {
    // Session debug logging is optional.
  }
}

function googleFlightsResultSignature(result: CountryResult): string {
  const cheapest = result.cheapest ? `${result.cheapest.provider}:${result.cheapest.priceText}` : "";
  const direct = result.direct ? `${result.direct.provider}:${result.direct.priceText}` : "";
  return [result.country, result.options.length, cheapest, direct, result.status].join("|");
}

function googleFlightsSearchResultSignature(result: SearchCountryResult): string {
  return [
    result.country,
    result.results.length,
    ...result.results.map((row) => `${row.rowKey}:${row.priceText}`),
    result.status,
  ].join("|");
}

function countryDisplayName(country: string): string {
  const code = country.toUpperCase();
  if (country === "CURRENT") return "Current country";
  if (!/^[A-Z]{2}$/.test(code)) return country;
  const displayNames = getRegionDisplayNames();
  if (displayNames) {
    const label = displayNames.of(code);
    return label || code;
  }
  return code;
}

function panelCountryDisplayName(country: string): string {
  const code = country.toUpperCase();
  if (country === "CURRENT") return t()("current");
  if (!/^[A-Z]{2}$/.test(code)) return country;
  return countryOptions().find((option) => option.code === code)?.label || countryDisplayName(country);
}

function urlCountryCode(): string {
  const country = new URL(window.location.href).searchParams.get("gl")?.toUpperCase() || "";
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

function urlCurrencyCode(): string {
  const params = new URL(window.location.href).searchParams;
  return normalizeGoogleFlightsCurrency(params.get("curr") || params.get("currency"));
}

function isCurrentSkyscannerPanelPage(): boolean {
  return isSkyscannerFinalComparePageUrl(window.location.href);
}

function isCurrentSkyscannerSearchPage(): boolean {
  return isSkyscannerSearchPageUrl(window.location.href);
}

function isCurrentSkyscannerPage(): boolean {
  return isSkyscannerFlightsPageUrl(window.location.href);
}

function currentSkyscannerCountryCode(): string {
  return skyscannerCountryCodeFromUrl(window.location.href);
}

function inferSkyscannerCurrency(root: ParentNode): string {
  const candidates = [
    ...Array.from(root.querySelectorAll('[class*="ProviderListTitle"], [role="text"]')).map(
      (element) => element.textContent || "",
    ),
    root instanceof Document ? root.body?.textContent || "" : root.textContent || "",
  ];
  for (const candidate of candidates) {
    const currency = skyscannerCurrencyFromText(candidate);
    if (currency) return currency;
  }
  return inferGoogleFlightsCurrency(root);
}

function skyscannerCurrencyFromText(value: string): string {
  return (
    normalizeGoogleFlightsCurrency(value.match(/\bPrices\s+in\s+([A-Z]{3})\b/i)?.[1]) ||
    normalizeGoogleFlightsCurrency(value.match(/(?:^|[^A-Z])([A-Z]{3})\s*での価格/i)?.[1]) ||
    skyscannerCurrencyFromPricePrefix(value)
  );
}

function skyscannerCurrencyFromPricePrefix(value: string): string {
  if (/NT\$/i.test(value)) return "TWD";
  if (/HK\$/i.test(value)) return "HKD";
  if (/CA\$/i.test(value) || /(?:^|[^\p{L}\p{N}])C\$/iu.test(value)) return "CAD";
  if (/AU\$/i.test(value) || /(?:^|[^\p{L}\p{N}])A\$/iu.test(value)) return "AUD";
  if (/NZ\$/i.test(value)) return "NZD";
  if (/MX\$/i.test(value)) return "MXN";
  if (/US\$/i.test(value)) return "USD";
  if (/(?:^|[^\p{L}\p{N}])S\$/iu.test(value)) return "SGD";
  if (/R\$/i.test(value)) return "BRL";
  if (/₱|PHP/i.test(value)) return "PHP";
  if (/(?:^|[^\p{L}\p{N}])Rp\s*\d/iu.test(value) || /\bIDR\b/i.test(value)) return "IDR";
  if (/₫|\bVND\b/i.test(value)) return "VND";
  if (/\bRM\b/i.test(value)) return "MYR";
  if (currentSkyscannerCountryCode() === "CN" && /[¥￥]/.test(value)) return "CNY";
  return "";
}

function visibleGoogleFlightsLocation(): string {
  const locationLabel = Array.from(document.querySelectorAll<HTMLElement>(".twocKe"))
    .map((element) => ({
      value: normalizeText(element.textContent || ""),
      context: normalizeText(element.parentElement?.textContent || ""),
    }))
    .find((entry) => entry.value && /\bLocation\b/i.test(entry.context));
  return locationLabel?.value || "";
}

function countryCodeFromDisplayName(value: string): string {
  const normalized = normalizeCountryName(value);
  if (!normalized) return "";
  return getCountryCodeByDisplayName()?.get(normalized) || "";
}

function getCountryCodeByDisplayName(): Map<string, string> | null {
  if (countryCodeByDisplayName !== undefined) return countryCodeByDisplayName;
  const displayNames = getRegionDisplayNames();
  if (!displayNames) {
    countryCodeByDisplayName = null;
    return countryCodeByDisplayName;
  }

  countryCodeByDisplayName = new Map<string, string>();
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = `${String.fromCharCode(first)}${String.fromCharCode(second)}`;
      const label = displayNames.of(code);
      if (!label || label === code) continue;
      countryCodeByDisplayName.set(normalizeCountryName(label), code);
    }
  }
  return countryCodeByDisplayName;
}

function getRegionDisplayNames(): Intl.DisplayNames | null {
  if (regionDisplayNames !== undefined) return regionDisplayNames;
  try {
    regionDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    regionDisplayNames = null;
  }
  return regionDisplayNames;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCountryName(value: string): string {
  return normalizeText(value).toLocaleLowerCase("en-US");
}

async function compareCountries(): Promise<void> {
  const selectedCountries = selectedGoogleFlightsCountries();
  if (selectedCountries.length === 0) {
    state.error = t()("enterAtLeastOneCountryCode");
    render();
    return;
  }
  const visibleCurrency = currentVisibleCurrencyCode();
  if (!visibleCurrency) {
    state.error = t()("googleFlightsCurrencyStillLoading");
    render();
    return;
  }
  state.countryInput = selectedCountries.join(", ");
  state.comparing = true;
  state.comparingCountryCodes = selectedCountries;
  state.error = "";
  state.comparisonStopRequested = false;
  state.comparisonStopped = false;
  state.comparingRequestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  state.comparingCacheKey = state.cacheKey || currentPanelComparisonCacheKey("booking");
  state.progressCompleted = 0;
  const previousResults = state.results;
  const comparableCurrency = visibleCurrency;
  const comparePageKey = state.pageKey;
  const baseUrl = countryComparisonUrl(window.location.href, currentComparableCountryCode(), comparableCurrency);
  const baselineCandidate = parseCurrentBookingPage();
  const baseline = baselineCandidate && isRealCountryCode(baselineCandidate.country) ? baselineCandidate : null;
  state.baseline = baseline;
  const countries = selectedCountries.filter((country) => country !== baseline?.country);
  state.progressTotal = countries.length;
  if (baseline) {
    state.results = mergeCountryResults(
      previousResults,
      [baseline],
      countryComparisonResultCountries(selectedCountries),
    ).results;
    state.resultsCachedAt = 0;
  }
  const requestId = state.comparingRequestId;
  render();
  try {
    const response = (await chrome.runtime.sendMessage({
      command: "compareGoogleFlightsCountries",
      baseUrl,
      countries,
      baselineOptionCount: baseline?.options.length ?? 0,
      requestId,
    })) as { ok?: boolean; error?: string } | undefined;
    if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
    if (!response?.ok) throw new Error(response?.error || t()("countryComparisonFailed"));
  } catch (error) {
    if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
    state.error = error instanceof Error ? error.message : t()("countryComparisonFailed");
    state.comparing = false;
    state.comparingRequestId = "";
    state.comparingCacheKey = "";
    state.comparingCountryCodes = [];
    state.comparisonStopRequested = false;
    render();
  }
}

async function compareSearchRows(): Promise<void> {
  const selectedCountries = selectedGoogleFlightsCountries();
  if (selectedCountries.length === 0) {
    state.error = t()("enterAtLeastOneCountryCode");
    render();
    return;
  }
  void expandGoogleFlightsSearchResults(false);
  const baseline = parseCurrentSearchPage();
  if (baseline.results.length === 0) {
    state.error = isCurrentSkyscannerSearchPage()
      ? t()("noSkyscannerSearchApiResponse")
      : t()("noVisibleGoogleFlightsRows");
    render();
    return;
  }

  state.countryInput = selectedCountries.join(", ");
  state.comparing = true;
  state.comparingCountryCodes = selectedCountries;
  state.error = "";
  state.comparisonStopRequested = false;
  state.comparisonStopped = false;
  state.comparingRequestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  state.comparingCacheKey = state.cacheKey || currentPanelComparisonCacheKey("search");
  state.progressCompleted = 0;
  state.searchBaseline = baseline;
  state.searchResults = [];
  state.baselineSignature = googleFlightsSearchResultSignature(baseline);
  state.searchBestByRowKey = bestPricesBySearchRow(baseline, state.searchResults);

  const comparableCurrency = currentComparableCurrencyCode();
  const comparePageKey = state.pageKey;
  const baseUrl = countryComparisonUrl(window.location.href, currentComparableCountryCode(), comparableCurrency);
  const countries = selectedCountries.filter((country) => country !== baseline.country);
  state.progressTotal = countries.length;
  const requestId = state.comparingRequestId;
  render();
  applySearchBadges();

  if (isCurrentSkyscannerSearchPage()) {
    void compareSkyscannerSearchRowsInPage(baseUrl, countries, requestId, comparePageKey);
    return;
  }

  try {
    const response = (await chrome.runtime.sendMessage({
      command: "compareGoogleFlightsSearchCountries",
      baseUrl,
      countries,
      baselineSearchResultCount: baseline.results.length,
      requestId,
    })) as { ok?: boolean; error?: string } | undefined;
    if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
    if (!response?.ok) throw new Error(response?.error || t()("countryComparisonFailed"));
  } catch (error) {
    if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
    state.error = error instanceof Error ? error.message : t()("countryComparisonFailed");
    state.comparing = false;
    state.comparingRequestId = "";
    state.comparingCacheKey = "";
    state.comparingCountryCodes = [];
    state.comparisonStopRequested = false;
    render();
  }
}

async function stopComparison(): Promise<void> {
  const requestId = state.comparingRequestId;
  if (!state.comparing || state.comparisonStopRequested || !requestId) return;

  state.comparisonStopRequested = true;
  render();

  if (isCurrentSkyscannerSearchPage()) {
    cancelPendingSkyscannerMarketSearches();
    applyGoogleFlightsSearchComplete({ requestId, ok: true, cancelled: true });
    return;
  }

  try {
    const response = (await chrome.runtime.sendMessage({
      command: "cancelGoogleFlightsComparison",
      requestId,
    })) as { ok?: boolean } | undefined;
    if (response?.ok) return;
  } catch {
    // The extension may have reloaded while the comparison was running.
  }

  if (currentRenderPanelMode() === "search") {
    applyGoogleFlightsSearchComplete({ requestId, ok: true, cancelled: true });
  } else {
    applyGoogleFlightsCountryComplete({ requestId, ok: true, cancelled: true });
  }
}

function cancelPendingSkyscannerMarketSearches(): void {
  for (const [requestId, pending] of pendingSkyscannerMarketSearches) {
    pendingSkyscannerMarketSearches.delete(requestId);
    window.clearTimeout(pending.timeoutId);
    pending.reject(new Error("Comparison stopped."));
  }
}

async function compareSkyscannerSearchRowsInPage(
  baseUrl: string,
  countries: string[],
  requestId: string,
  comparePageKey: string,
): Promise<void> {
  try {
    for (const country of countries) {
      const payload = await requestSkyscannerMarketSearch(country);
      if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
      applyGoogleFlightsSearchProgress({
        requestId,
        result: parseSkyscannerSearchApiResponse(payload, country, countryComparisonUrl(baseUrl, country)),
      });
    }
    if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
    applyGoogleFlightsSearchComplete({ requestId, ok: true });
  } catch (error) {
    if (state.pageKey !== comparePageKey || state.comparingRequestId !== requestId) return;
    applyGoogleFlightsSearchComplete({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : t()("countryComparisonFailed"),
    });
  }
}

function applyGoogleFlightsCountryProgress(payload: { requestId?: unknown; result?: unknown }): void {
  if (
    typeof payload.requestId !== "string" ||
    payload.requestId !== state.comparingRequestId ||
    !isCountryResult(payload.result)
  ) {
    return;
  }

  const selectedCountries =
    state.comparingCountryCodes.length > 0 ? state.comparingCountryCodes : selectedGoogleFlightsCountries();
  state.results = mergeCountryResults(
    state.results,
    [payload.result],
    countryComparisonResultCountries(selectedCountries),
  ).results;
  state.resultsCachedAt = 0;
  state.progressCompleted = Math.min(state.progressTotal, state.progressCompleted + 1);
  render();
}

function applyGoogleFlightsCountryComplete(payload: {
  requestId?: unknown;
  ok?: unknown;
  cancelled?: unknown;
  error?: unknown;
}): void {
  if (typeof payload.requestId !== "string" || payload.requestId !== state.comparingRequestId) return;
  const cancelled = payload.cancelled === true;
  if (!payload.ok) {
    state.error = typeof payload.error === "string" ? payload.error : t()("countryComparisonFailed");
  } else if (cancelled) {
    state.comparisonStopped = true;
  } else if (state.comparingCacheKey || state.cacheKey || state.pageKey) {
    state.resultsCachedAt = Date.now();
    pruneExpiredResultCache();
    void storeCachedResults(
      state.comparingCacheKey || state.cacheKey || state.pageKey,
      state.results,
      state.resultsCachedAt,
    );
  }
  if (!cancelled) state.progressCompleted = state.progressTotal;
  state.comparing = false;
  state.comparingRequestId = "";
  state.comparingCacheKey = "";
  state.comparingCountryCodes = [];
  state.comparisonStopRequested = false;
  render();
}

function applyGoogleFlightsSearchProgress(payload: { requestId?: unknown; result?: unknown }): void {
  if (
    typeof payload.requestId !== "string" ||
    payload.requestId !== state.comparingRequestId ||
    !isSearchCountryResult(payload.result)
  ) {
    return;
  }

  const searchResult = payload.result;
  const wasSeen = state.searchResults.some((result) => result.country === searchResult.country);
  state.searchResults = mergeSearchCountryResults(state.searchResults, [searchResult]);
  state.searchBestByRowKey = bestPricesBySearchRow(state.searchBaseline, state.searchResults);
  state.resultsCachedAt = 0;
  if (!wasSeen) state.progressCompleted = Math.min(state.progressTotal, state.progressCompleted + 1);
  render();
}

function applyGoogleFlightsSearchComplete(payload: {
  requestId?: unknown;
  ok?: unknown;
  cancelled?: unknown;
  error?: unknown;
}): void {
  if (typeof payload.requestId !== "string" || payload.requestId !== state.comparingRequestId) return;
  const cancelled = payload.cancelled === true;
  if (!payload.ok) {
    state.error = typeof payload.error === "string" ? payload.error : t()("countryComparisonFailed");
  } else if (cancelled) {
    state.comparisonStopped = true;
  } else if (state.comparingCacheKey || state.cacheKey || state.pageKey) {
    state.resultsCachedAt = Date.now();
    void storeSearchComparisonCache(
      state.comparingCacheKey || state.cacheKey || state.pageKey,
      state.baselineSignature,
      state.resultsCachedAt,
    );
  }
  if (!cancelled) state.progressCompleted = state.progressTotal;
  state.comparing = false;
  state.comparingRequestId = "";
  state.comparingCacheKey = "";
  state.comparingCountryCodes = [];
  state.comparisonStopRequested = false;
  state.searchBestByRowKey = bestPricesBySearchRow(state.searchBaseline, state.searchResults);
  render();
  applySearchBadges();
  applyRequestedSearchHighlight(state.searchBaseline);
}

function applySearchBadges(): void {
  if (currentGoogleFlightsPanelMode() !== "search" || !state.searchBaseline) return;
  const activeBadges = new Set<HTMLElement>();
  const activeTargets = new Set<HTMLElement>();
  const existingBadges = existingSearchBadgesByRowKey();
  const rows = currentSearchResultRows();
  const currentRows = parseCurrentSearchPage().results;
  const usedCurrentRowKeys = new Set<string>();
  let created = 0;
  let missingBest = 0;
  rows.forEach((row, index) => {
    const currentParsed = currentSearchResultForVisibleRow(row, index, currentRows, usedCurrentRowKeys);
    if (currentParsed) usedCurrentRowKeys.add(currentParsed.rowKey);
    const baselineParsed = currentParsed
      ? bestSearchResultMatch(currentParsed, state.searchBaseline?.results || [], 0.58)
      : null;
    const best = baselineParsed ? state.searchBestByRowKey[baselineParsed.rowKey] : undefined;
    if (!currentParsed || !baselineParsed || !best) {
      missingBest += 1;
      return;
    }
    const badge = reconcileSearchBadge(existingBadges.get(baselineParsed.rowKey), baselineParsed, best);
    const target = searchBadgeTarget(row, currentParsed);
    badge.classList.toggle("moo-flights-search-badge-skyscanner", isCurrentSkyscannerSearchPage());
    if (target instanceof HTMLElement) {
      target.dataset.mooFlightsSearchBadgeTarget = "1";
      activeTargets.add(target);
    }
    if (badge.parentElement !== target) target.append(badge);
    activeBadges.add(badge);
    created += 1;
  });
  pruneInactiveSearchBadges(activeBadges, activeTargets);
  debugSearch("apply-badges", {
    rows: rows.length,
    currentRows: currentRows.length,
    baselineRows: state.searchBaseline.results.length,
    comparedCountries: state.searchResults.map((result) => result.country),
    bestRows: Object.keys(state.searchBestByRowKey).length,
    created,
    missingBest,
  });
  ensureSearchBadgeStyles();
}

function currentSearchResultForVisibleRow(
  row: Element,
  index: number,
  currentRows: SearchResult[],
  usedRowKeys: Set<string>,
): SearchResult | null {
  const unusedRows = currentRows.filter((result) => !usedRowKeys.has(result.rowKey));
  if (!isCurrentSkyscannerSearchPage()) return unusedRows.find((result) => result.rowIndex === index) || null;

  const itineraryKey = skyscannerVisibleRowItineraryKey(row);
  if (itineraryKey) {
    const exact = unusedRows.find((result) => result.itineraryKey === itineraryKey);
    if (exact) return exact;
  }

  return (
    unusedRows
      .map((result) => ({ result, score: skyscannerVisibleRowMatchScore(row, result) }))
      .filter((entry) => entry.score >= 0.62)
      .sort((left, right) => right.score - left.score)[0]?.result || null
  );
}

function skyscannerVisibleRowItineraryKey(row: Element): string {
  for (const anchor of Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href*="/config/"]'))) {
    const href = anchor.getAttribute("href") || anchor.href || "";
    try {
      const url = new URL(href, window.location.href);
      const match = url.pathname.match(/\/config\/([^/?#]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
      const match = href.match(/\/config\/([^/?#]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }
  }
  return "";
}

function skyscannerVisibleRowMatchScore(row: Element, result: SearchResult): number {
  const rowText = normalizeText(textContentWithoutSearchBadges(row));
  const normalizedRowText = normalizeCountryName(rowText);
  const compactRowText = compactSearchText(rowText);
  let score = 0;
  if (result.priceText && rowText.includes(result.priceText)) score += 0.35;
  if (result.carrierText && tokenSimilarity(normalizedRowText, result.carrierText) >= 0.6) score += 0.2;
  if (result.timeText && compactRowText.includes(compactSearchText(result.timeText))) score += 0.18;
  if (result.durationText && rowContainsAllTokens(normalizedRowText, result.durationText)) score += 0.12;
  if (result.stopsText && rowContainsAllTokens(normalizedRowText, result.stopsText)) score += 0.08;
  return Math.min(score, 1);
}

function compactSearchText(value: string): string {
  return normalizeCountryName(value).replace(/[^a-z0-9]/g, "");
}

function rowContainsAllTokens(rowText: string, value: string): boolean {
  const tokens = searchMatchTokens(value);
  if (tokens.size === 0) return false;
  for (const token of tokens) {
    if (!rowText.includes(token)) return false;
  }
  return true;
}

function existingSearchBadgesByRowKey(): Map<string, HTMLElement> {
  const badges = new Map<string, HTMLElement>();
  for (const badge of Array.from(document.querySelectorAll(SEARCH_BADGE_SELECTOR))) {
    if (!(badge instanceof HTMLElement)) continue;
    const rowKey = badge.dataset.mooFlightsSearchRowKey;
    if (rowKey && !badges.has(rowKey)) badges.set(rowKey, badge);
  }
  return badges;
}

function reconcileSearchBadge(
  existingBadge: HTMLElement | undefined,
  row: SearchResult,
  best: SearchBestPrice,
): HTMLElement {
  const isCurrentCountryBest = searchBadgeIsCurrentCountry(best);
  const expectedTagName = isCurrentCountryBest ? "SPAN" : "BUTTON";
  const badge =
    existingBadge?.tagName === expectedTagName
      ? existingBadge
      : document.createElement(isCurrentCountryBest ? "span" : "button");
  if (existingBadge && existingBadge !== badge) existingBadge.remove();
  badge.dataset.mooFlightsSearchBadge = "1";
  badge.dataset.mooFlightsSearchRowKey = row.rowKey;
  badge.className = "moo-flights-search-badge";
  badge.textContent = searchBadgeText(best);
  const title = searchBadgeTitle(row, best);
  if (title) badge.title = title;
  else badge.removeAttribute("title");
  if (badge instanceof HTMLButtonElement) {
    badge.type = "button";
    badge.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openSearchResultDeepLink(best);
    };
    badge.setAttribute("aria-label", `Open ${countryDisplayName(best.country)} price ${best.priceText}`);
  } else {
    badge.removeAttribute("aria-label");
    badge.onclick = null;
  }
  return badge;
}

function pruneInactiveSearchBadges(activeBadges: Set<HTMLElement>, activeTargets: Set<HTMLElement>): void {
  for (const badge of Array.from(document.querySelectorAll(SEARCH_BADGE_SELECTOR))) {
    if (badge instanceof HTMLElement && !activeBadges.has(badge)) badge.remove();
  }
  for (const target of Array.from(document.querySelectorAll(SEARCH_BADGE_TARGET_SELECTOR))) {
    if (target instanceof HTMLElement && !activeTargets.has(target)) {
      target.removeAttribute("data-moo-flights-search-badge-target");
    }
  }
}

function searchResultDeepLink(best: SearchBestPrice): string {
  try {
    const skyscannerDirectUrl = skyscannerSearchResultDeepLink(best);
    if (skyscannerDirectUrl) return skyscannerDirectUrl;
    const url = new URL(best.url);
    url.hash = `mooFlightsFlight=${encodeURIComponent(best.targetMatchKey)}`;
    return url.toString();
  } catch {
    return best.url;
  }
}

function skyscannerSearchResultDeepLink(best: SearchBestPrice): string {
  if (!best.targetItineraryKey || !isSkyscannerFlightsPageUrl(best.url)) return "";
  try {
    const url = new URL(best.url);
    const configPath = skyscannerConfigPath(url.pathname, best.targetItineraryKey);
    if (!configPath) return "";
    url.pathname = configPath;
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function skyscannerConfigPath(pathname: string, itineraryKey: string): string {
  const encodedItineraryKey = encodeURIComponent(itineraryKey);
  const existingConfigIndex = pathname.indexOf("/config/");
  if (existingConfigIndex >= 0) return `${pathname.slice(0, existingConfigIndex)}/config/${encodedItineraryKey}`;
  const normalizedPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (!normalizedPath || !/^\/transport\/(?:flights|d)\//.test(normalizedPath)) return "";
  return `${normalizedPath}/config/${encodedItineraryKey}`;
}

async function openSearchResultDeepLink(best: SearchBestPrice): Promise<void> {
  const url = searchResultDeepLink(best);
  const openedWindow = window.open("about:blank", "_blank");
  try {
    if (openedWindow) openedWindow.opener = null;
  } catch {
    // The destination tab can still load; opener cleanup is defense-in-depth.
  }
  const cacheKey = state.cacheKey || currentPanelComparisonCacheKey("search");
  await storeSearchComparisonCache(cacheKey, state.baselineSignature);
  await storeSearchComparisonHandoff(cacheKey);
  if (openedWindow) {
    openedWindow.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function applyRequestedSearchHighlight(searchBaseline: SearchCountryResult | null): void {
  removeSearchHighlights();
  if (currentGoogleFlightsPanelMode() !== "search" || !searchBaseline) return;
  const requestedMatchKey = requestedSearchMatchKey();
  if (!requestedMatchKey) return;
  const currentRows = parseCurrentSearchPage().results;
  const requestedBaseline = findSearchResultByMatchKey(searchBaseline.results, requestedMatchKey);
  const parsed =
    findSearchResultByMatchKey(currentRows, requestedMatchKey) ||
    (requestedBaseline ? bestSearchResultMatch(requestedBaseline, currentRows, 0.58) : null);
  if (!parsed) return;

  const row = currentSearchResultRows()[parsed.rowIndex];
  const target = row ? searchHighlightTarget(row) : null;
  if (!target) return;
  ensureSearchBadgeStyles();
  target.dataset.mooFlightsSearchHighlight = "1";
  const deepLink = `${currentSearchHighlightPageKey()}:${requestedMatchKey}`;
  if (highlightedSearchDeepLink !== deepLink) {
    highlightedSearchDeepLink = deepLink;
    window.setTimeout(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 150);
  }
}

function findSearchResultByMatchKey(rows: SearchResult[], matchKey: string, minimumScore = 0.72): SearchResult | null {
  return (
    rows.find((row) => row.matchKey === matchKey) ||
    rows
      .map((row) => ({ row, score: tokenSimilarity(row.matchKey, matchKey) }))
      .filter((entry) => entry.score >= minimumScore)
      .sort((left, right) => right.score - left.score)[0]?.row ||
    null
  );
}

function searchHighlightTarget(row: Element): HTMLElement | null {
  const resultRow = row.closest("li.pIav2d");
  if (resultRow instanceof HTMLElement) return resultRow;
  return row instanceof HTMLElement ? row : null;
}

function removeSearchHighlights(): void {
  for (const row of Array.from(document.querySelectorAll(SEARCH_HIGHLIGHT_SELECTOR))) {
    row.removeAttribute("data-moo-flights-search-highlight");
  }
}

function requestedSearchMatchKey(): string {
  const pageKey = currentSearchHighlightPageKey();
  const hash = window.location.hash || "";
  const marker = "mooFlightsFlight=";
  const index = hash.indexOf(marker);
  if (index === -1) return storedSearchHighlightMatchKey(pageKey);
  try {
    const matchKey = decodeURIComponent(hash.slice(index + marker.length));
    rememberSearchHighlightMatchKey(pageKey, matchKey);
    return matchKey;
  } catch {
    return storedSearchHighlightMatchKey(pageKey);
  }
}

function currentSearchHighlightPageKey(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function rememberSearchHighlightMatchKey(pageKey: string, matchKey: string): void {
  try {
    sessionStorage.setItem(SEARCH_HIGHLIGHT_STORAGE_KEY, JSON.stringify({ pageKey, matchKey }));
  } catch {
    // Highlight persistence is optional; hash-based highlighting still works.
  }
}

function storedSearchHighlightMatchKey(pageKey: string): string {
  try {
    const raw = sessionStorage.getItem(SEARCH_HIGHLIGHT_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { pageKey?: unknown; matchKey?: unknown };
    return parsed.pageKey === pageKey && typeof parsed.matchKey === "string" ? parsed.matchKey : "";
  } catch {
    return "";
  }
}

function removeSearchBadges(): void {
  for (const badge of Array.from(document.querySelectorAll(SEARCH_BADGE_SELECTOR))) {
    badge.remove();
  }
  for (const target of Array.from(document.querySelectorAll(SEARCH_BADGE_TARGET_SELECTOR))) {
    target.removeAttribute("data-moo-flights-search-badge-target");
  }
}

function currentSearchResultRows(): Element[] {
  return isCurrentSkyscannerSearchPage() ? skyscannerSearchResultRows(document) : searchResultRows(document);
}

function searchBadgeTarget(row: Element, parsed: SearchResult): Element {
  if (isCurrentSkyscannerSearchPage()) return skyscannerSearchBadgeTarget(row, parsed);
  const priceContainers = Array.from(
    row.querySelectorAll(".U3gSDe .YMlIz.FpEdX, .XWuBZb .YMlIz.FpEdX, .BVAVmf .YMlIz.FpEdX, .YMlIz.FpEdX"),
  ).filter((element) => element instanceof HTMLElement);
  const visiblePriceContainers = priceContainers.filter(isVisibleElement);
  const matchingPriceContainer = visiblePriceContainers.find((element) =>
    searchTargetContainsPrice(element, parsed.priceText),
  );
  if (matchingPriceContainer) return priceBlockTarget(matchingPriceContainer);

  const visiblePriceContainer = visiblePriceContainers[0];
  if (visiblePriceContainer) return priceBlockTarget(visiblePriceContainer);

  const hiddenMatchingPriceContainer = priceContainers.find((element) =>
    searchTargetContainsPrice(element, parsed.priceText),
  );
  if (hiddenMatchingPriceContainer) return priceBlockTarget(hiddenMatchingPriceContainer);

  const priceElement = Array.from(row.querySelectorAll("[aria-label], [role='text'], span, div")).find((element) => {
    if (element.closest(SEARCH_BADGE_SELECTOR)) return false;
    return searchTargetContainsPrice(element, parsed.priceText);
  });
  return priceElement?.parentElement || row.querySelector(".YMlIz, .FpEdX, .U3gSDe")?.parentElement || row;
}

function skyscannerSearchBadgeTarget(row: Element, parsed: SearchResult): Element {
  const priceContainers = Array.from(
    row.querySelectorAll(
      [
        '[class*="TicketStubPrice_priceWrapper"]',
        '[class*="Price_mainPriceContainer"]',
        '[class*="Price_ticketStubPrice"]',
        '[class*="TicketStubContent_priceCluster"]',
      ].join(", "),
    ),
  ).filter((element) => element instanceof HTMLElement && isVisibleElement(element));
  const matchingPriceContainer = priceContainers.find((element) =>
    searchTargetContainsPrice(element, parsed.priceText),
  );
  if (matchingPriceContainer) return skyscannerPriceBadgeTarget(matchingPriceContainer);

  const visiblePriceContainer = priceContainers[0];
  if (visiblePriceContainer) return skyscannerPriceBadgeTarget(visiblePriceContainer);

  const priceElement = Array.from(row.querySelectorAll("[aria-label], span, div, p")).find((element) => {
    if (element.closest(SEARCH_BADGE_SELECTOR)) return false;
    if (element.closest('[class*="EcoTicket"]')) return false;
    if (!isVisibleElement(element)) return false;
    if (!searchTargetContainsPrice(element, parsed.priceText)) return false;
    const text = normalizeText(textContentWithoutSearchBadges(element));
    const ariaLabel = normalizeText(element.getAttribute("aria-label") || "");
    const shortestMatch = [text, ariaLabel]
      .filter((value) => value.includes(parsed.priceText))
      .sort((left, right) => left.length - right.length)[0];
    return Boolean(shortestMatch && shortestMatch.length <= parsed.priceText.length + 32);
  });
  if (priceElement) return skyscannerPriceBadgeTarget(priceElement);
  return row;
}

function priceBlockTarget(priceContainer: Element): Element {
  return priceContainer;
}

function skyscannerPriceBadgeTarget(priceElement: Element): Element {
  return (
    priceElement.closest('[class*="TicketStubPrice_priceWrapper"]') ||
    priceElement.closest('[class*="TicketStubContent_priceCluster"]') ||
    priceElement.parentElement ||
    priceElement
  );
}

function searchTargetContainsPrice(element: Element, priceText: string): boolean {
  const text = normalizeText(textContentWithoutSearchBadges(element));
  const ariaLabel = normalizeText(element.getAttribute("aria-label") || "");
  return text.includes(priceText) || ariaLabel.includes(priceText);
}

function textContentWithoutSearchBadges(element: Element): string {
  const clone = element.cloneNode(true);
  if (!(clone instanceof Element)) return element.textContent || "";
  for (const badge of Array.from(clone.querySelectorAll(SEARCH_BADGE_SELECTOR))) badge.remove();
  return clone.textContent || "";
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function searchBadgeText(best: SearchBestPrice): string {
  return searchBadgeIsCurrentCountry(best) ? "Cheapest" : `${countryDisplayName(best.country)} ${best.priceText}`;
}

function searchBadgeTitle(row: SearchResult, best: SearchBestPrice): string {
  const options = searchCountryPriceOptionsForRow(row)
    .filter((option) => option.country !== currentComparableCountryCode())
    .slice(0, 5);
  if (options.length === 0)
    return searchBadgeIsCurrentCountry(best) ? "Cheapest on this page." : "Click to open cheapest.";
  const lines = options.map((option) => `${countryDisplayName(option.country)}: ${option.priceText}`);
  if (!searchBadgeIsCurrentCountry(best)) lines.push("Click to open cheapest.");
  return lines.join("\n");
}

function searchCountryPriceOptionsForRow(row: SearchResult): SearchCountryPriceOption[] {
  if (!state.searchBaseline) return [];
  const options: SearchCountryPriceOption[] = [
    {
      country: state.searchBaseline.country,
      url: state.searchBaseline.url,
      price: row.price,
      priceText: row.priceText,
      matchKey: row.matchKey,
    },
  ];
  for (const result of state.searchResults) {
    const match = bestSearchResultMatch(row, result.results);
    if (!match || !Number.isFinite(match.price)) continue;
    options.push({
      country: result.country,
      url: result.url,
      price: match.price,
      priceText: match.priceText,
      matchKey: match.matchKey,
    });
  }
  return options.sort((left, right) => left.price - right.price || left.country.localeCompare(right.country));
}

function searchBadgeIsCurrentCountry(best: SearchBestPrice): boolean {
  return best.country === currentComparableCountryCode() || best.country === state.searchBaseline?.country;
}

function ensureSearchBadgeStyles(): void {
  if (document.getElementById(SEARCH_BADGE_STYLES_ID)) return;
  const style = document.createElement("style");
  style.id = SEARCH_BADGE_STYLES_ID;
  style.textContent = `
    [data-moo-flights-search-badge-target] {
      position: relative !important;
      overflow: visible !important;
    }
    .moo-flights-search-badge {
      position: absolute !important;
      top: 6px !important;
      left: auto !important;
      right: 48px !important;
      z-index: 2147483646 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: max-content !important;
      max-width: min(180px, calc(100vw - 32px)) !important;
      min-height: 16px !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #9aa3af !important;
      padding: 0 !important;
      font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      letter-spacing: 0 !important;
      white-space: nowrap !important;
      pointer-events: none !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      box-shadow: none !important;
      text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35) !important;
      text-align: center !important;
    }
    button.moo-flights-search-badge {
      pointer-events: auto !important;
      cursor: pointer !important;
    }
    .moo-flights-search-badge-skyscanner {
      position: static !important;
      display: flex !important;
      justify-content: flex-start !important;
      max-width: 100% !important;
      margin-top: 2px !important;
      color: #4b5563 !important;
      text-shadow: none !important;
      text-align: left !important;
    }
    .moo-flights-search-badge:hover {
      background: transparent !important;
      color: #cbd5e1 !important;
      text-decoration: none !important;
    }
    [data-moo-flights-search-highlight] {
      outline: 3px solid #0062e3 !important;
      outline-offset: 2px !important;
      border-radius: 8px !important;
      box-shadow: 0 0 0 6px rgba(0, 98, 227, 0.14), 0 12px 28px rgba(15, 23, 42, 0.22) !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function mergeSearchCountryResults(
  previousResults: SearchCountryResult[],
  updates: SearchCountryResult[],
): SearchCountryResult[] {
  const byCountry = new Map(previousResults.map((result) => [result.country, result]));
  for (const update of updates) byCountry.set(update.country, update);
  return Array.from(byCountry.values());
}

function bestPricesBySearchRow(
  baseline: SearchCountryResult | null,
  countryResults: SearchCountryResult[],
): Record<string, SearchBestPrice> {
  if (!baseline) return {};
  const comparedByCountry = new Map(countryResults.map((result) => [result.country, result]));
  const output: Record<string, SearchBestPrice> = {};
  for (const row of baseline.results) {
    let matchedComparedRows = 0;
    let best: SearchBestPrice = {
      rowKey: row.rowKey,
      targetMatchKey: row.matchKey,
      ...(row.itineraryKey ? { targetItineraryKey: row.itineraryKey } : {}),
      country: baseline.country,
      url: baseline.url,
      price: row.price,
      currency: row.currency,
      priceText: row.priceText,
      currentPrice: row.price,
      delta: 0,
      matchConfidence: row.matchConfidence,
    };
    for (const result of comparedByCountry.values()) {
      const match = bestSearchResultMatch(row, result.results);
      if (!match || !Number.isFinite(match.price)) continue;
      matchedComparedRows += 1;
      if (match.price < best.price) {
        best = {
          rowKey: row.rowKey,
          targetMatchKey: match.matchKey,
          ...(match.itineraryKey ? { targetItineraryKey: match.itineraryKey } : {}),
          country: result.country,
          url: result.url,
          price: match.price,
          currency: match.currency,
          priceText: match.priceText,
          currentPrice: row.price,
          delta: match.price - row.price,
          matchConfidence: match.matchConfidence === "high" && row.matchConfidence === "high" ? "high" : "medium",
        };
      }
    }
    if (matchedComparedRows > 0) output[row.rowKey] = best;
  }
  return output;
}

function updateSearchBaselineDuringComparison(): void {
  if (!state.searchBaseline) return;
  const currentBaseline = parseCurrentSearchPage();
  if (currentBaseline.results.length <= state.searchBaseline.results.length) return;
  if (!searchBaselineIncludesPreviousRows(state.searchBaseline, currentBaseline)) return;
  debugSearch("comparison-baseline-expanded", {
    previousRows: state.searchBaseline.results.length,
    nextRows: currentBaseline.results.length,
    comparedCountries: state.searchResults.map((result) => result.country),
  });
  state.searchBaseline = currentBaseline;
  state.baselineSignature = googleFlightsSearchResultSignature(currentBaseline);
  state.searchBestByRowKey = bestPricesBySearchRow(state.searchBaseline, state.searchResults);
  render();
}

function searchBaselineIncludesPreviousRows(
  previousBaseline: SearchCountryResult,
  nextBaseline: SearchCountryResult,
): boolean {
  if (previousBaseline.results.length === 0 || nextBaseline.results.length < previousBaseline.results.length) {
    return false;
  }
  const matchedRows = previousBaseline.results.filter((row) =>
    Boolean(bestSearchResultMatch(row, nextBaseline.results, 0.9)),
  ).length;
  return matchedRows / previousBaseline.results.length >= 0.8;
}

function shouldKeepHandoffResultsForInitialRows(
  previousBaseline: SearchCountryResult,
  nextBaseline: SearchCountryResult,
): boolean {
  return previousBaseline.results.length === 0 && nextBaseline.results.length > 0 && state.searchResults.length > 0;
}

function bestSearchResultMatch(
  baseline: SearchResult,
  candidates: SearchResult[],
  minimumScore = 0.72,
): SearchResult | null {
  const itineraryExact = candidates.find(
    (candidate) => baseline.itineraryKey && candidate.itineraryKey === baseline.itineraryKey,
  );
  if (itineraryExact) return itineraryExact;

  const exact = candidates.find(
    (candidate) =>
      candidate.matchKey === baseline.matchKey &&
      (!baseline.itineraryKey || !candidate.itineraryKey || candidate.itineraryKey === baseline.itineraryKey),
  );
  if (exact) return exact;

  return (
    candidates
      .map((candidate) => ({ candidate, score: searchResultMatchScore(baseline, candidate) }))
      .filter((entry) => entry.score >= minimumScore)
      .sort((left, right) => right.score - left.score)[0]?.candidate || null
  );
}

function searchResultMatchScore(left: SearchResult, right: SearchResult): number {
  if (left.itineraryKey && right.itineraryKey && left.itineraryKey !== right.itineraryKey) return 0;

  const leftTime = normalizeText(left.timeText || "");
  const rightTime = normalizeText(right.timeText || "");
  if (leftTime && rightTime && leftTime !== rightTime) return 0;

  let score = tokenSimilarity(left.matchKey, right.matchKey) * 0.55;
  if (leftTime && rightTime) score += 0.18;
  if (
    left.durationText &&
    right.durationText &&
    normalizeText(left.durationText) === normalizeText(right.durationText)
  ) {
    score += 0.12;
  }
  if (left.stopsText && right.stopsText && normalizeText(left.stopsText) === normalizeText(right.stopsText))
    score += 0.08;
  if (left.carrierText && right.carrierText && tokenSimilarity(left.carrierText, right.carrierText) >= 0.6)
    score += 0.12;
  return Math.min(score, 1);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = searchMatchTokens(left);
  const rightTokens = searchMatchTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function searchMatchTokens(value: string): Set<string> {
  return new Set(
    normalizeCountryName(value)
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .filter((token) => !SEARCH_MATCH_STOP_WORDS.has(token)),
  );
}

const SEARCH_MATCH_STOP_WORDS = new Set([
  "from",
  "best",
  "cheapest",
  "flight",
  "flights",
  "price",
  "prices",
  "trip",
  "select",
  "button",
  "google",
]);

function isSearchCountryResult(value: unknown): value is SearchCountryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { country?: unknown; url?: unknown; results?: unknown; status?: unknown };
  return (
    typeof candidate.country === "string" &&
    typeof candidate.url === "string" &&
    Array.isArray(candidate.results) &&
    candidate.results.every(isSearchResult) &&
    typeof candidate.status === "string"
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    rowKey?: unknown;
    matchKey?: unknown;
    rowIndex?: unknown;
    price?: unknown;
    currency?: unknown;
    priceText?: unknown;
    summaryText?: unknown;
    carrierText?: unknown;
    timeText?: unknown;
    durationText?: unknown;
    stopsText?: unknown;
    itineraryKey?: unknown;
    matchConfidence?: unknown;
  };
  return (
    typeof candidate.rowKey === "string" &&
    typeof candidate.matchKey === "string" &&
    typeof candidate.rowIndex === "number" &&
    typeof candidate.price === "number" &&
    typeof candidate.currency === "string" &&
    typeof candidate.priceText === "string" &&
    typeof candidate.summaryText === "string" &&
    optionalString(candidate.carrierText) &&
    optionalString(candidate.timeText) &&
    optionalString(candidate.durationText) &&
    optionalString(candidate.stopsText) &&
    optionalString(candidate.itineraryKey) &&
    (candidate.matchConfidence === "high" || candidate.matchConfidence === "medium")
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function getShadowRoot(): ShadowRoot | null {
  let host = document.getElementById(PANEL_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_ID;
    document.documentElement.appendChild(host);
  }
  return host.shadowRoot || host.attachShadow({ mode: "open" });
}

function removePanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

function hidePanelForSession(): void {
  try {
    sessionStorage.setItem(PANEL_SESSION_HIDE_STORAGE_KEY, "1");
  } catch {
    // Session storage is an enhancement; removing the current panel still honors the click.
  }
  removeSearchBadges();
  removeSearchHighlights();
  removePanel();
}

function shouldHidePanel(): boolean {
  try {
    return sessionStorage.getItem(PANEL_SESSION_HIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function styles(): string {
  return `
    :host { all: initial; }
    .panel, .panel * {
      box-sizing: border-box;
    }
    .panel {
      position: fixed;
      z-index: 2147483647;
      width: min(340px, calc(100vw - 32px));
      max-height: min(560px, calc(100vh - 32px));
      overflow-x: hidden;
      overflow-y: auto;
      border: 1px solid #d7dde8;
      border-radius: 8px;
      background: #ffffff;
      color: #172033;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .panel.minimized {
      width: auto;
      max-height: none;
      overflow: visible;
      border: 0;
      border-radius: 999px;
      background: transparent;
      box-shadow: none;
    }
    ${mooFlightsPanelHeaderStyles()}
    .panel-icon {
      display: inline-grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #172033;
      box-shadow: none;
      font: inherit;
      font-weight: 750;
      letter-spacing: 0;
      cursor: pointer;
      overflow: visible;
    }
    .panel-icon img {
      width: 64px;
      height: 64px;
      border-radius: 10px;
      transform: translate(-3px, -5px);
    }
    .icon-button {
      flex: 0 0 auto;
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border-color: #cbd5e1;
      background: #ffffff;
      color: #475569;
      font-size: 18px;
      line-height: 1;
    }
    .cross-search {
      padding: 10px 12px 0;
    }
    .cross-search a,
    .cross-search button {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      color: #334155;
      text-decoration: none;
      font: inherit;
      font-weight: 650;
    }
    .cross-search a:hover {
      background: #f8fafc;
      border-color: #94a3b8;
    }
    .cross-search button:disabled {
      cursor: default;
      border-color: #e2e8f0;
      background: #f8fafc;
      color: #94a3b8;
      opacity: 1;
    }
    .cross-search.unavailable {
      display: grid;
      gap: 4px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.35;
    }
    .cross-search.unavailable small {
      display: block;
      color: #64748b;
      font: inherit;
      padding: 0 2px;
    }
    .mileage-prompt {
      display: grid;
      gap: 3px;
      margin: 10px 12px 0;
      border: 1px solid #d7dde8;
      border-left: 4px solid #0f766e;
      border-radius: 6px;
      padding: 8px;
    }
    .mileage-prompt strong { color: #172033; }
    .mileage-prompt span { color: #64748b; }
    .mileage-prompt a {
      color: #0f766e;
      font-weight: 700;
      text-decoration: none;
    }
    .mileage-prompt a:hover {
      text-decoration: underline;
    }
    .section-heading {
      padding: 10px 12px 0;
      color: #172033;
      font-weight: 750;
    }
    .country-select {
      display: grid;
      gap: 6px;
      padding: 6px 12px 0;
    }
    .country-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      color: #64748b;
      font-weight: 650;
    }
    .country-head small {
      color: #94a3b8;
      font-size: 11px;
      font-weight: 650;
    }
    .country-combo {
      position: relative;
    }
    .country-combo input {
      width: 100%;
      min-width: 0;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      color: #172033;
      -webkit-text-fill-color: #172033;
      appearance: none;
      padding: 7px 8px;
      font: inherit;
      font-weight: 400;
      min-height: 32px;
    }
    .country-dropdown {
      position: absolute;
      z-index: 2;
      left: 0;
      right: 0;
      top: calc(100% + 2px);
      max-height: 200px;
      overflow: auto;
      margin: 0;
      padding: 4px;
      list-style: none;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
    }
    .country-dropdown[hidden] {
      display: none;
    }
    .country-dropdown button {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      width: 100%;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #172033;
      padding: 6px 7px;
      text-align: left;
      font-weight: 550;
    }
    .country-dropdown button:hover,
    .country-dropdown button.active {
      background: #f1f5f9;
    }
    .country-dropdown small {
      color: #94a3b8;
      font-size: 11px;
      font-weight: 650;
    }
    .country-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 120px;
      overflow-y: auto;
    }
    .country-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 0;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      background: #f8fafc;
      color: #172033;
      padding: 2px 6px 2px 5px;
      font-weight: 600;
    }
    .country-chip .flag {
      font-weight: 400;
    }
    .country-chip .x {
      color: #94a3b8;
    }
    .country-chip:hover .x {
      color: #dc2626;
    }
    .country-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    button.link {
      min-height: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #0f766e;
      padding: 0;
      font-weight: 650;
    }
    .actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
      padding: 9px 12px;
    }
    .actions .wide {
      grid-column: 1 / -1;
    }
    .comparison-progress {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      min-height: 32px;
      border: 1px solid #0f766e;
      border-radius: 6px;
      background: #0f766e;
      color: #ffffff;
    }
    .comparison-progress-fill {
      position: absolute;
      z-index: -1;
      inset: 0 auto 0 0;
      background: #115e59;
      transition: width 180ms ease-out;
    }
    .comparison-progress-content {
      display: flex;
      min-height: 32px;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 2px 3px 2px 8px;
    }
    .comparison-progress-status {
      display: inline-flex;
      min-width: 0;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 650;
    }
    .comparison-progress-status > span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .comparison-spinner {
      width: 12px;
      height: 12px;
      flex: 0 0 auto;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: moo-flights-spin 700ms linear infinite;
    }
    button.comparison-stop {
      min-width: 46px;
      min-height: 26px;
      border-color: rgba(255, 255, 255, 0.82);
      background: #ffffff;
      color: #0f766e;
      padding: 2px 7px;
      font-size: 12px;
    }
    button.comparison-stop:disabled {
      cursor: progress;
      opacity: 0.82;
    }
    @keyframes moo-flights-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .comparison-progress-fill { transition: none; }
      .comparison-spinner { animation: none; }
    }
    button {
      border: 1px solid #0f766e;
      border-radius: 6px;
      background: #0f766e;
      color: #ffffff;
      padding: 7px 9px;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
      min-width: 0;
      min-height: 32px;
    }
    button.secondary {
      border-color: #94a3b8;
      background: #ffffff;
      color: #334155;
    }
    button:disabled { cursor: wait; opacity: 0.72; }
    .error {
      margin: 0 12px 10px;
      border-radius: 6px;
      background: #fef2f2;
      color: #991b1b;
      padding: 8px;
    }
    .cache-note {
      margin: 0 12px 10px;
      border-radius: 6px;
      background: #f8fafc;
      color: #64748b;
      padding: 6px 8px;
      font-size: 12px;
    }
    .results {
      display: grid;
      gap: 6px;
      padding: 0 12px 12px;
    }
    .result {
      display: grid;
      gap: 2px;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #0f766e;
      border-radius: 6px;
      padding: 8px;
    }
    .result.sparse { border-left-color: #d97706; }
    .result.empty, .result.error { border-left-color: #dc2626; }
    .result span { font-weight: 650; }
    .result .current {
      margin-left: 6px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #0369a1;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 700;
    }
    .result small { color: #64748b; }
    .result-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }
    .result-actions a {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      color: #334155;
      padding: 3px 6px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 650;
    }
    .result-actions a:hover {
      border-color: #0f766e;
      color: #0f766e;
    }
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] || character;
  });
}
