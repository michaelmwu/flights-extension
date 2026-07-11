import "../shared/firefoxChromeCompat";
import {
  hasMooAccountDataConsent,
  isMooAccountRequest,
  isTrustedMooAccountSender,
  type MooAccountRequest,
  type MooAccountResponse,
  removesMooAccountDataConsent,
  unavailableMooAccountState,
} from "../shared/accountMessages";
import { type CountryResult, countryComparisonUrl, type SearchCountryResult } from "../shared/countryComparison";
import type { RemoteProviderMetadata } from "../shared/types";
import { compiledMooAccountAuthConfig, MooAccountAuthController, publicAccountError } from "./accountAuth";
import { IndexedDbMooAccountSessionStore } from "./accountSessionStore";

type RuntimeMessage = {
  command?: string;
  baseUrl?: string;
  countries?: string[];
  baselineOptionCount?: number;
  baselineSearchResultCount?: number;
  matrixUrl?: string;
  openedByPage?: boolean;
  requestId?: string;
  waitForExpansion?: boolean;
};

type GoogleFlightsSearchExpansionResult = {
  ok?: boolean;
  clicked?: boolean;
  beforeRows?: number;
  afterRows?: number;
};

const GOOGLE_FLIGHTS_COMPARE_CONCURRENCY = 3;
const GOOGLE_FLIGHTS_TAB_CREATE_SPACING_MS = 750;
const MATRIX_AUTO_OPEN_TABS_STORAGE_KEY = "muTravelMatrixAutoOpenTabs";
const LEGACY_MATRIX_AUTO_OPEN_UNTIL_STORAGE_KEY = "muTravelMatrixAutoOpenUntil";
const MATRIX_AUTO_OPEN_TTL_MS = 5 * 60 * 1000;

let tabCreateQueue = Promise.resolve();
let lastTabCreatedAt = 0;

const mooAccountController = new MooAccountAuthController(compiledMooAccountAuthConfig(), {
  sessionStore: new IndexedDbMooAccountSessionStore(),
  launchWebAuthFlow: (details) => chrome.identity.launchWebAuthFlow(details),
  getRedirectUrl: () => chrome.identity.getRedirectURL("moo-account"),
  fetch: globalThis.fetch.bind(globalThis),
  hasDataConsent: hasMooAccountDataConsent,
});
void mooAccountController.initialize().catch(() => undefined);

chrome.permissions.onRemoved.addListener((permissions) => {
  if (removesMooAccountDataConsent(permissions)) {
    void mooAccountController.forgetSession().catch(() => undefined);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isMooAccountRequest(message)) {
    if (!isTrustedMooAccountSender(sender, chrome.runtime.id, chrome.runtime.getURL("/"))) {
      const response: MooAccountResponse = {
        ok: false,
        state: unavailableMooAccountState(),
        error: {
          code: "not_allowed",
          message: "Moo Account commands are available only to trusted extension pages.",
        },
      };
      sendResponse(response);
      return false;
    }

    void handleMooAccountRequest(message).then(sendResponse);
    return true;
  }

  const payload = message as RuntimeMessage;
  if (payload.command === "openOptionsPage") {
    openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (payload.command === "openMatrixWithAutoOpen") {
    void openMatrixWithAutoOpen(payload.matrixUrl || "", payload.openedByPage === true, sender.tab?.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not open ITA Matrix." });
      });
    return true;
  }

  if (payload.command === "consumeMatrixAutoOpenForTab") {
    void consumeMatrixAutoOpenForTab(sender.tab?.id)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (payload.command === "compareGoogleFlightsCountries") {
    const progressTabId = sender.tab?.id;
    if (typeof progressTabId !== "number") {
      sendResponse({ ok: false, error: "Missing Google Flights tab." });
      return false;
    }
    if (typeof payload.requestId !== "string" || !payload.requestId) {
      sendResponse({ ok: false, error: "Missing Google Flights comparison request." });
      return false;
    }
    void compareGoogleFlightsCountries(payload, progressTabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Compare failed.";
        sendGoogleFlightsCountryComplete(progressTabId, payload.requestId, {
          ok: false,
          error: message,
        });
        sendResponse({ ok: false, error: message });
      });
    return true;
  }

  if (payload.command === "compareGoogleFlightsSearchCountries") {
    const progressTabId = sender.tab?.id;
    if (typeof progressTabId !== "number") {
      sendResponse({ ok: false, error: "Missing Google Flights tab." });
      return false;
    }
    if (typeof payload.requestId !== "string" || !payload.requestId) {
      sendResponse({ ok: false, error: "Missing Google Flights comparison request." });
      return false;
    }
    void compareGoogleFlightsSearchCountries(payload, progressTabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Search comparison failed.";
        sendGoogleFlightsSearchComplete(progressTabId, payload.requestId, {
          ok: false,
          error: message,
        });
        sendResponse({ ok: false, error: message });
      });
    return true;
  }

  if (payload.command !== "fetchProviderMetadata") return false;

  void fetchProviderMetadata(payload.baseUrl || "")
    .then((providers) => sendResponse({ providers }))
    .catch(() => sendResponse({ providers: [] }));
  return true;
});

async function handleMooAccountRequest(request: MooAccountRequest): Promise<MooAccountResponse> {
  try {
    if (!(await hasMooAccountDataConsent())) {
      const state = await mooAccountController.forgetSession();
      if (request.command === "mooAccount:signIn") {
        return {
          ok: false,
          state,
          error: {
            code: "not_allowed",
            message: "Moo Account sign-in needs permission to share account identity data.",
          },
        };
      }
      return { ok: true, state };
    }
    const state =
      request.command === "mooAccount:signIn"
        ? await mooAccountController.signIn()
        : request.command === "mooAccount:signOut"
          ? await mooAccountController.signOut()
          : await mooAccountController.getState();
    return { ok: true, state };
  } catch (error) {
    const state = await mooAccountController.getState().catch(unavailableMooAccountState);
    return { ok: false, state, error: publicAccountError(error) };
  }
}

async function compareGoogleFlightsCountries(payload: RuntimeMessage, progressTabId?: number): Promise<void> {
  const baseUrl = payload.baseUrl || "";
  if (!baseUrl) throw new Error("Missing Google Flights URL.");
  const countries = Array.from(new Set((payload.countries || []).filter((country) => /^[A-Z]{2}$/.test(country))));
  const baselineOptionCount = payload.baselineOptionCount || 0;
  await mapWithConcurrency(countries, GOOGLE_FLIGHTS_COMPARE_CONCURRENCY, async (country) => {
    const result = await compareBookingCountry(baseUrl, country, baselineOptionCount);
    sendGoogleFlightsCountryProgress(progressTabId, payload.requestId, result);
    return result;
  });
  sendGoogleFlightsCountryComplete(progressTabId, payload.requestId, { ok: true });
}

async function compareGoogleFlightsSearchCountries(payload: RuntimeMessage, progressTabId?: number): Promise<void> {
  const baseUrl = payload.baseUrl || "";
  if (!baseUrl) throw new Error("Missing Google Flights URL.");
  const countries = Array.from(new Set((payload.countries || []).filter((country) => /^[A-Z]{2}$/.test(country))));
  const baselineResultCount = payload.baselineSearchResultCount || 0;
  await mapWithConcurrency(countries, GOOGLE_FLIGHTS_COMPARE_CONCURRENCY, async (country) => {
    return compareGoogleFlightsSearchCountry(baseUrl, country, baselineResultCount, (result) => {
      sendGoogleFlightsSearchProgress(progressTabId, payload.requestId, result);
    });
  });
  sendGoogleFlightsSearchComplete(progressTabId, payload.requestId, { ok: true });
}

async function openMatrixWithAutoOpen(matrixUrl: string, openedByPage = false, sourceWindowId?: number): Promise<void> {
  const url = validatedMatrixUrl(matrixUrl);
  await chrome.storage.local.remove(LEGACY_MATRIX_AUTO_OPEN_UNTIL_STORAGE_KEY);
  if (openedByPage) {
    const tab = await findPageOpenedMatrixTab(url, sourceWindowId);
    if (typeof tab?.id === "number") await rememberMatrixAutoOpenTab(tab.id);
    return;
  }
  const tab = await createActiveTab(url);
  if (typeof tab.id !== "number") throw new Error("Chrome did not provide a tab id.");
  await rememberMatrixAutoOpenTab(tab.id);
}

async function findPageOpenedMatrixTab(matrixUrl: string, sourceWindowId?: number): Promise<chrome.tabs.Tab | null> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const tabs = await queryTabs({
      active: true,
      ...(typeof sourceWindowId === "number" ? { windowId: sourceWindowId } : { lastFocusedWindow: true }),
    });
    const tab = tabs.find((candidate) => tabMatchesMatrixUrl(candidate, matrixUrl));
    if (tab) return tab;
    await delay(100);
  }
  return null;
}

async function rememberMatrixAutoOpenTab(tabId: number): Promise<void> {
  const existing = await chrome.storage.local.get(MATRIX_AUTO_OPEN_TABS_STORAGE_KEY);
  const tabs = autoOpenTabMap(existing[MATRIX_AUTO_OPEN_TABS_STORAGE_KEY]);
  tabs[String(tabId)] = Date.now() + MATRIX_AUTO_OPEN_TTL_MS;
  pruneAutoOpenTabMap(tabs);
  await chrome.storage.local.set({ [MATRIX_AUTO_OPEN_TABS_STORAGE_KEY]: tabs });
}

async function consumeMatrixAutoOpenForTab(tabId: number | undefined): Promise<boolean> {
  if (typeof tabId !== "number") return false;
  const existing = await chrome.storage.local.get(MATRIX_AUTO_OPEN_TABS_STORAGE_KEY);
  const tabs = autoOpenTabMap(existing[MATRIX_AUTO_OPEN_TABS_STORAGE_KEY]);
  pruneAutoOpenTabMap(tabs);
  const tabKey = String(tabId);
  const authorized = Boolean(tabs[tabKey] && tabs[tabKey] >= Date.now());
  if (authorized) delete tabs[tabKey];
  await chrome.storage.local.set({ [MATRIX_AUTO_OPEN_TABS_STORAGE_KEY]: tabs });
  return authorized;
}

function validatedMatrixUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "matrix.itasoftware.com") {
    throw new Error("Invalid ITA Matrix URL.");
  }
  return url.toString();
}

function autoOpenTabMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => /^\d+$/.test(entry[0]) && typeof entry[1] === "number")
      .slice(-50),
  );
}

function pruneAutoOpenTabMap(tabs: Record<string, number>, now = Date.now()): void {
  for (const [tabId, expiresAt] of Object.entries(tabs)) {
    if (!tabId || expiresAt < now) delete tabs[tabId];
  }
}

function tabMatchesMatrixUrl(tab: chrome.tabs.Tab, matrixUrl: string): boolean {
  const value = tab.pendingUrl || tab.url || "";
  try {
    const tabUrl = new URL(value);
    const targetUrl = new URL(matrixUrl);
    return (
      tabUrl.protocol === targetUrl.protocol &&
      tabUrl.hostname === targetUrl.hostname &&
      tabUrl.pathname === targetUrl.pathname
    );
  } catch {
    return false;
  }
}

function sendGoogleFlightsCountryProgress(
  tabId: number | undefined,
  requestId: string | undefined,
  result: CountryResult,
): void {
  if (typeof tabId !== "number" || !requestId) return;
  chrome.tabs.sendMessage(
    tabId,
    {
      command: "googleFlightsCountryComparisonResult",
      requestId,
      result,
    },
    () => {
      // The user may navigate away before long all-country checks finish.
      void chrome.runtime.lastError;
    },
  );
}

function sendGoogleFlightsCountryComplete(
  tabId: number | undefined,
  requestId: string | undefined,
  result: { ok: boolean; error?: string },
): void {
  if (typeof tabId !== "number" || !requestId) return;
  chrome.tabs.sendMessage(
    tabId,
    {
      command: "googleFlightsCountryComparisonComplete",
      requestId,
      ...result,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

function sendGoogleFlightsSearchProgress(
  tabId: number | undefined,
  requestId: string | undefined,
  result: SearchCountryResult,
): void {
  if (typeof tabId !== "number" || !requestId) return;
  chrome.tabs.sendMessage(
    tabId,
    {
      command: "googleFlightsSearchComparisonResult",
      requestId,
      result,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

function sendGoogleFlightsSearchComplete(
  tabId: number | undefined,
  requestId: string | undefined,
  result: { ok: boolean; error?: string },
): void {
  if (typeof tabId !== "number" || !requestId) return;
  chrome.tabs.sendMessage(
    tabId,
    {
      command: "googleFlightsSearchComparisonComplete",
      requestId,
      ...result,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

async function compareBookingCountry(
  baseUrl: string,
  country: string,
  baselineOptionCount: number,
): Promise<CountryResult> {
  const url = countryComparisonUrl(baseUrl, country);
  let tabId: number | undefined;
  try {
    const tab = await createInactiveTabPaced(url);
    tabId = tab.id;
    if (typeof tabId !== "number") throw new Error("Chrome did not provide a tab id.");
    await waitForTabComplete(tabId);
    let result = await parseBookingComparisonTab(tabId, country, url);
    if (shouldRetrySparseResult(result, baselineOptionCount)) {
      await reloadTab(tabId);
      await waitForTabComplete(tabId);
      result = await parseBookingComparisonTab(tabId, country, url);
      result.refreshed = true;
      if (isSparseResult(result, baselineOptionCount)) result.status = "sparse";
    }
    return result;
  } catch (error) {
    return {
      country,
      url,
      options: [],
      status: "error",
      error: error instanceof Error ? error.message : "Country check failed.",
    };
  } finally {
    if (typeof tabId === "number") await removeTab(tabId);
  }
}

async function compareGoogleFlightsSearchCountry(
  baseUrl: string,
  country: string,
  baselineResultCount: number,
  onProgress?: (result: SearchCountryResult) => void,
): Promise<SearchCountryResult> {
  const url = countryComparisonUrl(baseUrl, country);
  let tabId: number | undefined;
  let sentProgress = false;
  try {
    const tab = await createInactiveTabPaced(url);
    tabId = tab.id;
    if (typeof tabId !== "number") throw new Error("Chrome did not provide a tab id.");
    await waitForTabComplete(tabId);
    let result = await parseGoogleFlightsSearchTab(tabId, country, url);
    if (baselineResultCount > 0 && result.status !== "error" && result.results.length === 0) {
      await reloadTab(tabId);
      await waitForTabComplete(tabId);
      result = await parseGoogleFlightsSearchTab(tabId, country, url);
    }
    onProgress?.(result);
    sentProgress = true;
    const expandedResult = await waitForExpandedGoogleFlightsSearchTab(tabId, country, url, result.results.length);
    if (expandedResult && expandedResult.results.length > result.results.length) {
      result = expandedResult;
      onProgress?.(result);
    }
    return result;
  } catch (error) {
    const result = {
      country,
      url,
      results: [],
      status: "error",
      error: error instanceof Error ? error.message : "Search country check failed.",
    } satisfies SearchCountryResult;
    if (!sentProgress) onProgress?.(result);
    return result;
  } finally {
    if (typeof tabId === "number") await removeTab(tabId);
  }
}

function createInactiveTabPaced(url: string): Promise<chrome.tabs.Tab> {
  const scheduled = tabCreateQueue.then(async () => {
    const elapsed = Date.now() - lastTabCreatedAt;
    const waitMs = Math.max(0, GOOGLE_FLIGHTS_TAB_CREATE_SPACING_MS - elapsed);
    if (waitMs > 0) await delay(waitMs);
    const tab = await createInactiveTab(url);
    lastTabCreatedAt = Date.now();
    return tab;
  });
  tabCreateQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

function shouldRetrySparseResult(result: CountryResult, baselineOptionCount: number): boolean {
  return baselineOptionCount > 3 && result.status !== "error" && result.options.length <= 3 && !result.refreshed;
}

function isSparseResult(result: CountryResult, baselineOptionCount: number): boolean {
  return (
    baselineOptionCount > 3 && result.status !== "error" && result.options.length > 0 && result.options.length <= 3
  );
}

async function parseBookingComparisonTab(tabId: number, country: string, url: string): Promise<CountryResult> {
  let latest: CountryResult | null = null;
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    try {
      latest = await sendTabMessage<CountryResult>(tabId, {
        command: "parseBookingOptions",
      });
      if (latest.options.length > 0) return { ...latest, country, url };
    } catch {
      // The content script may not be ready immediately after the tab completes.
    }
    await delay(600);
  }
  if (latest) return { ...latest, country, url };
  return { country, url, options: [], status: "empty" };
}

async function parseGoogleFlightsSearchTab(tabId: number, country: string, url: string): Promise<SearchCountryResult> {
  let latest: SearchCountryResult | null = null;
  const deadline = Date.now() + 18000;
  let expanded = false;
  while (Date.now() < deadline) {
    try {
      if (!expanded) {
        expanded = await tryExpandGoogleFlightsSearchResults(tabId);
      }
      latest = await sendTabMessage<SearchCountryResult>(tabId, {
        command: "parseSearchResults",
      });
      if (latest.results.length > 0) return { ...latest, country, url };
    } catch {
      // The content script may not be ready immediately after the tab completes.
    }
    await delay(600);
  }
  if (latest) return { ...latest, country, url };
  return { country, url, results: [], status: "empty" };
}

async function waitForExpandedGoogleFlightsSearchTab(
  tabId: number,
  country: string,
  url: string,
  previousResultCount: number,
): Promise<SearchCountryResult | null> {
  if (previousResultCount <= 0) return null;
  const deadline = Date.now() + 6500;
  let latest: SearchCountryResult | null = null;
  let expanded = false;
  while (Date.now() < deadline) {
    await delay(600);
    try {
      if (!expanded) {
        expanded = await tryExpandGoogleFlightsSearchResults(tabId);
      }
      latest = await sendTabMessage<SearchCountryResult>(tabId, {
        command: "parseSearchResults",
      });
      if (latest.results.length > previousResultCount) return { ...latest, country, url };
    } catch {
      // Google may still be mutating the result list after View more is clicked.
    }
  }
  return latest && latest.results.length > previousResultCount ? { ...latest, country, url } : null;
}

async function tryExpandGoogleFlightsSearchResults(tabId: number): Promise<boolean> {
  const result = await sendTabMessage<GoogleFlightsSearchExpansionResult>(tabId, {
    command: "expandGoogleFlightsSearchResults",
    waitForExpansion: false,
  });
  return result.clicked === true;
}

async function fetchProviderMetadata(baseUrl: string): Promise<RemoteProviderMetadata[]> {
  if (typeof __MOOFLIGHTS_DEV_BUILD__ !== "undefined" && !__MOOFLIGHTS_DEV_BUILD__) return [];
  if (!baseUrl) return [];
  const origin = hostPermissionOrigin(baseUrl);
  if (origin && !(await hasHostPermission(origin))) return [];

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/extension/v1/providers`, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { providers?: RemoteProviderMetadata[] };
  return Array.isArray(body.providers) ? body.providers : [];
}

async function hasHostPermission(origin: string): Promise<boolean> {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

function hostPermissionOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

function openOptionsPage(): void {
  const openOptionsTab = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("options/index.html") });
  };

  if (typeof chrome.runtime.openOptionsPage !== "function") {
    openOptionsTab();
    return;
  }

  chrome.runtime.openOptionsPage(() => {
    if (!chrome.runtime.lastError) return;
    openOptionsTab();
  });
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker));
  return results;
}

function createInactiveTab(url: string): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

function createActiveTab(url: string): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

function queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs);
    });
  });
}

function reloadTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function removeTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => resolve());
  });
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(done, 20000);

    function done(): void {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(updatedTabId: number, changeInfo: { status?: string }): void {
      if (updatedTabId === tabId && changeInfo.status === "complete") done();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab.status === "complete") done();
    });
  });
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
