import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import esbuild from "esbuild";
import { authIssuerHostPermission, resolveAuthBuildConfig } from "./auth-build-config.mjs";
import { browserTarget } from "./browser-target.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const watch = process.argv.includes("--watch");
const browser = browserTarget();
const stableDist = process.argv.includes("--stable-dist") || process.env.MOOFLIGHTS_STABLE_EXTENSION_DIST === "1";
const dist = await distPath();
const devBuild = watch || process.argv.includes("--dev") || process.env.MOOFLIGHTS_DEV_BUILD === "1";
const accountAuth = resolveAuthBuildConfig(process.env, { devBuild });

const entries = [
  {
    entryPoints: ["src/content/itaMatrixContent.ts"],
    outfile: "content/itaMatrixContent.js",
    format: "iife",
  },
  {
    entryPoints: ["src/content/itaMatrixPageBridge.ts"],
    outfile: "content/itaMatrixPageBridge.js",
    format: "iife",
  },
  {
    entryPoints: ["src/content/googleFlightsContent.ts"],
    outfile: "content/googleFlightsContent.js",
    format: "iife",
  },
  {
    entryPoints: ["src/content/skyscannerSearchPageHook.ts"],
    outfile: "content/skyscannerSearchPageHook.js",
    format: "iife",
  },
  {
    entryPoints: ["src/content/skyscannerSearchPageHookInjector.ts"],
    outfile: "content/skyscannerSearchPageHookInjector.js",
    format: "iife",
  },
  {
    entryPoints: ["src/background/serviceWorker.ts"],
    outfile: "background/serviceWorker.js",
    format: browser === "firefox" ? "iife" : "esm",
  },
  {
    entryPoints: ["src/popup/main.tsx"],
    outfile: "popup/main.js",
    format: "iife",
  },
  {
    entryPoints: ["src/options/main.tsx"],
    outfile: "options/main.js",
    format: "iife",
  },
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

async function buildEntry(entry) {
  const outfile = resolve(dist, entry.outfile);
  await mkdir(dirname(outfile), { recursive: true });
  return {
    ...entry,
    outfile,
    bundle: true,
    sourcemap: devBuild,
    minify: !devBuild,
    target: browser === "firefox" ? "firefox107" : "chrome114",
    legalComments: "linked",
    define: {
      "process.env.NODE_ENV": JSON.stringify(devBuild ? "development" : "production"),
      __MOOFLIGHTS_DEV_BUILD__: JSON.stringify(devBuild),
      __MOOFLIGHTS_AUTH_ENABLED__: JSON.stringify(accountAuth.enabled),
      __MOOFLIGHTS_AUTH_ISSUER__: JSON.stringify(accountAuth.issuer),
      __MOOFLIGHTS_AUTH_CLIENT_ID__: JSON.stringify(accountAuth.clientId),
      __MOOFLIGHTS_AUTH_AUDIENCE__: JSON.stringify(accountAuth.audience),
    },
  };
}

const staticFiles = [
  ["src/popup/index.html", "popup/index.html"],
  ["src/options/index.html", "options/index.html"],
];

const mainContentScript = "content/googleFlightsContent.js";
const skyscannerHookScript = "content/skyscannerSearchPageHook.js";
const skyscannerHookInjectorScript = "content/skyscannerSearchPageHookInjector.js";

async function copyStaticFiles() {
  const manifest = JSON.parse(await readFile(resolve(root, "src/manifest.json"), "utf8"));
  applyBrowserManifest(manifest);
  await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [from, to] of staticFiles) {
    const target = resolve(dist, to);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(root, from), target);
  }

  await cp(resolve(root, "src/assets"), resolve(dist, "assets"), { recursive: true, force: true });
  await cp(resolve(root, "src/_locales"), resolve(dist, "_locales"), { recursive: true, force: true });

  await writeFile(
    resolve(dist, "OPEN_SOURCE_NOTICE.txt"),
    [
      "MooFlights Extension",
      "",
      "This browser extension is AGPL-3.0-only open-source software.",
      "The optional hosted MooTravel backend is a separate closed-source service.",
      "",
      "Bundled airport coordinate data is derived from OurAirports public-domain data.",
      "Source: https://ourairports.com/data/",
      "Bundled carrier icons are local copies of public airline/carrier image assets, primarily Seats.aero 64px carrier assets.",
      "Sources include: https://seats.aero/static/carriers64/",
      "",
      "See README.md, LICENSE, and the repository docs for development and contribution details.",
      "",
    ].join("\n"),
  );
}

function applyBrowserManifest(manifest) {
  const skyscannerTransportMatches = skyscannerTransportMatchesFromManifest(manifest);
  const skyscannerWebAccessibleMatches = skyscannerTransportMatches.map(skyscannerWebAccessibleMatch);
  addSkyscannerMatchesToGeneratedManifest(manifest, skyscannerTransportMatches);

  const issuerHostPermission = authIssuerHostPermission(accountAuth);
  const hostPermissions = unique([
    ...(manifest.host_permissions || []),
    ...(issuerHostPermission ? [issuerHostPermission] : []),
    ...(devBuild ? ["http://localhost/*", "http://127.0.0.1/*"] : []),
  ]);
  const webAccessibleResources = [
    {
      matches: ["https://matrix.itasoftware.com/*"],
      resources: [
        "content/itaMatrixPageBridge.js",
        "assets/extension-icons/icon-32.png",
        "assets/extension-icons/icon-48.png",
        "assets/extension-icons/icon-64.png",
      ],
    },
    {
      // Chrome MV3 web_accessible_resources matches are origin-scoped; path-scoped
      // Google Flights patterns are rejected as invalid match patterns.
      matches: ["https://www.google.com/*", "https://google.com/*"],
      resources: [
        "assets/extension-icons/icon-32.png",
        "assets/extension-icons/icon-48.png",
        "assets/extension-icons/icon-64.png",
      ],
    },
    {
      matches: skyscannerWebAccessibleMatches,
      resources: [
        ...(browser === "firefox" ? [skyscannerHookScript] : []),
        "assets/extension-icons/icon-32.png",
        "assets/extension-icons/icon-48.png",
        "assets/extension-icons/icon-64.png",
      ],
    },
  ];

  manifest.host_permissions = hostPermissions;
  manifest.permissions = unique([...(manifest.permissions || []), ...(accountAuth.enabled ? ["identity"] : [])]);
  manifest.web_accessible_resources = webAccessibleResources;

  if (browser !== "firefox") return;

  const hookScript = contentScriptForJs(manifest, skyscannerHookScript);
  hookScript.js = [skyscannerHookInjectorScript];
  for (const contentScript of manifest.content_scripts || []) delete contentScript.world;

  const browserAction = manifest.action;
  manifest.manifest_version = 2;
  delete manifest.action;
  manifest.browser_action = browserAction;
  manifest.background = {
    scripts: ["background/serviceWorker.js"],
    persistent: false,
  };
  manifest.permissions = Array.from(new Set([...(manifest.permissions || []), "tabs", ...hostPermissions]));
  delete manifest.host_permissions;
  manifest.web_accessible_resources = Array.from(
    new Set(webAccessibleResources.flatMap((entry) => entry.resources || [])),
  );
  manifest.browser_specific_settings = {
    gecko: {
      id: "extension@mooflights.com",
      data_collection_permissions: accountAuth.enabled
        ? {
            optional: ["authenticationInfo", "personallyIdentifyingInfo"],
          }
        : {
            required: ["none"],
          },
      strict_min_version: accountAuth.enabled ? "140.0" : "107.0",
    },
  };
}

function addSkyscannerMatchesToGeneratedManifest(manifest, skyscannerTransportMatches) {
  const mainScript = contentScriptForJs(manifest, mainContentScript);
  const hookScript = contentScriptForJs(manifest, skyscannerHookScript);

  hookScript.matches = skyscannerTransportMatches;
  mainScript.matches = unique([
    ...(mainScript.matches || []).filter((match) => !isSkyscannerMatch(match)),
    ...skyscannerTransportMatches,
  ]);
  manifest.host_permissions = unique([
    ...(manifest.host_permissions || []).filter((match) => !isSkyscannerMatch(match)),
    ...skyscannerTransportMatches,
  ]);
}

function skyscannerTransportMatchesFromManifest(manifest) {
  const hookScript = contentScriptForJs(manifest, skyscannerHookScript);
  const matches = unique((hookScript.matches || []).filter(isSkyscannerTransportMatch));
  if (matches.length === 0) {
    throw new Error(`${skyscannerHookScript} must define at least one Skyscanner transport match pattern`);
  }
  return matches;
}

function contentScriptForJs(manifest, script) {
  const contentScript = (manifest.content_scripts || []).find((candidate) => candidate.js?.includes(script));
  if (!contentScript) throw new Error(`Missing content script entry for ${script}`);
  return contentScript;
}

function isSkyscannerTransportMatch(match) {
  return /^https:\/\/(?:[^/]+\.)?skyscanner\.[^/]+\/transport\/\*$/.test(match);
}

function isSkyscannerMatch(match) {
  return /^https:\/\/(?:[^/]+\.)?skyscanner\.[^/]+\//.test(match);
}

function skyscannerWebAccessibleMatch(match) {
  return match.replace(/\/transport\/\*$/, "/*");
}

function unique(values) {
  return Array.from(new Set(values));
}

async function distPath() {
  if (process.env.MOOFLIGHTS_DIST_DIR) return resolve(process.env.MOOFLIGHTS_DIST_DIR);
  const directoryName = browser === "firefox" ? ".context/firefox-build" : "dist";
  if (!stableDist) return resolve(root, directoryName);

  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const commonGitDir = stdout.trim();
    const repoRoot = basename(commonGitDir) === ".git" ? dirname(commonGitDir) : root;
    return resolve(repoRoot, directoryName);
  } catch (error) {
    console.warn(
      `Could not resolve canonical repo root for --stable-dist; falling back to workspace dist. ${error instanceof Error ? error.message : String(error)}`,
    );
    return resolve(root, directoryName);
  }
}

if (watch) {
  const contexts = await Promise.all(entries.map(async (entry) => esbuild.context(await buildEntry(entry))));
  await copyStaticFiles();
  await Promise.all(contexts.map((context) => context.watch()));
  console.log(
    `Watching ${browser} extension sources in dev-build mode. Load or reload the unpacked extension from ${dist}.`,
  );
} else {
  await Promise.all(entries.map(async (entry) => esbuild.build(await buildEntry(entry))));
  await copyStaticFiles();
  console.log(`Wrote ${browser} extension build to ${dist}`);
}
