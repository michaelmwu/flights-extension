type BrowserApi = {
  identity?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  storage?: {
    local?: Record<string, unknown>;
  };
};

const extensionGlobals = globalThis as typeof globalThis & {
  browser?: BrowserApi;
  chrome?: BrowserApi;
};

installFirefoxChromePromiseCompat();

function installFirefoxChromePromiseCompat(): void {
  const browserApi = extensionGlobals.browser;
  const chromeApi = extensionGlobals.chrome;
  if (!browserApi || !chromeApi || browserApi === chromeApi) return;

  wrapPromiseMethod(chromeApi.runtime, browserApi.runtime, "sendMessage");
  wrapPromiseMethod(chromeApi.identity, browserApi.identity, "getRedirectURL");
  wrapPromiseMethod(chromeApi.identity, browserApi.identity, "launchWebAuthFlow");
  wrapPromiseMethod(chromeApi.permissions, browserApi.permissions, "contains");
  wrapPromiseMethod(chromeApi.permissions, browserApi.permissions, "getAll");
  wrapPromiseMethod(chromeApi.permissions, browserApi.permissions, "request");
  wrapPromiseMethod(chromeApi.storage?.local, browserApi.storage?.local, "get");
  wrapPromiseMethod(chromeApi.storage?.local, browserApi.storage?.local, "set");
  wrapPromiseMethod(chromeApi.storage?.local, browserApi.storage?.local, "remove");
  wrapPromiseMethod(chromeApi.storage?.local, browserApi.storage?.local, "clear");
}

function wrapPromiseMethod(
  target: Record<string, unknown> | undefined,
  source: Record<string, unknown> | undefined,
  key: string,
): void {
  if (!target || !source) return;
  const callbackMethod = target[key];
  const promiseMethod = source[key];
  if (typeof callbackMethod !== "function" || typeof promiseMethod !== "function") return;

  target[key] = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === "function")) return callbackMethod.apply(target, args);
    return promiseMethod.apply(source, args);
  };
}
