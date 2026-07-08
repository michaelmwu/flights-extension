import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { browserTarget } from "./browser-target.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const browser = browserTarget();
const stableDist = process.argv.includes("--stable-dist") || process.env.MOOFLIGHTS_STABLE_EXTENSION_DIST === "1";
const packageRoot = await packageRootPath();
const artifacts = resolve(packageRoot, "artifacts");
const packageVersion = await extensionVersion();
const artifactBaseName =
  browser === "firefox" ? `mooflights-firefox-${packageVersion}` : `mooflights-${packageVersion}`;
const zipPath = resolve(artifacts, `${artifactBaseName}.zip`);
const crxPath = resolve(artifacts, `${artifactBaseName}.crx`);
const xpiPath = resolve(artifacts, `${artifactBaseName}.xpi`);
const generatedCrxPath = resolve(packageRoot, "dist.crx");
const generatedPemPath = resolve(packageRoot, "dist.pem");
const providedCrxKeyPath = crxKeyPathEnv() ? resolve(crxKeyPathEnv()) : "";
const dist = distPath();

await mkdir(artifacts, { recursive: true });
await removeExistingPackageArtifacts();
await rm(generatedCrxPath, { force: true });
if (!isProvidedCrxKeyPath(generatedPemPath)) await rm(generatedPemPath, { force: true });
try {
  await execFileAsync("zip", ["--version"]);
} catch {
  throw new Error("The `zip` CLI is required to package the extension. Install zip or run `bun run build` only.");
}
await execFileAsync("zip", ["-r", browser === "firefox" ? xpiPath : zipPath, "."], { cwd: dist });
console.log(`Wrote ${browser === "firefox" ? xpiPath : zipPath}`);

if (browser !== "firefox") {
  const chrome = await chromeExecutable();
  if (!chrome) {
    throw new Error(
      "Chrome or Chromium is required to package the CRX. Set CHROME_BIN or install Google Chrome/Chromium.",
    );
  }

  const keyPath = await crxKeyPath();
  if (!keyPath && process.env.MOOFLIGHTS_REQUIRE_CRX_KEY === "1") {
    throw new Error(
      "A stable CRX signing key is required for release packaging. Set MOOFLIGHTS_CRX_KEY_B64 or MOOFLIGHTS_CRX_KEY_PATH.",
    );
  }
  const args = [`--pack-extension=${dist}`, "--no-sandbox"];
  if (keyPath) args.push(`--pack-extension-key=${keyPath.path}`);

  try {
    await execFileAsync(chrome, args);
    await rename(generatedCrxPath, crxPath);
    console.log(`Wrote ${crxPath}`);
  } finally {
    if (keyPath?.temporary) await rm(keyPath.path, { force: true });
    await rm(generatedCrxPath, { force: true });
    if (!isProvidedCrxKeyPath(generatedPemPath)) await rm(generatedPemPath, { force: true });
  }
}

async function extensionVersion() {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const version = String(packageJson.version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid package.json version "${version}".`);
  return version;
}

async function packageRootPath() {
  if (!stableDist) return root;

  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const commonGitDir = stdout.trim();
    return basename(commonGitDir) === ".git" ? dirname(commonGitDir) : root;
  } catch (error) {
    console.warn(
      `Could not resolve canonical repo root for --stable-dist; falling back to workspace package paths. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return root;
  }
}

function distPath() {
  const override = process.env.MOOFLIGHTS_DIST_DIR || "";
  if (override) return resolve(root, override);
  return resolve(packageRoot, browser === "firefox" ? ".context/firefox-build" : "dist");
}

async function removeExistingPackageArtifacts() {
  const entries = await readdir(artifacts);
  const packageArtifactPattern =
    browser === "firefox" ? /^mooflights-firefox-\d+\.\d+\.\d+\.xpi$/ : /^mooflights(?:-\d+\.\d+\.\d+)?\.(zip|crx)$/;
  await Promise.all(
    entries
      .filter((entry) => packageArtifactPattern.test(entry))
      .map((entry) => rm(resolve(artifacts, entry), { force: true })),
  );
}

function isProvidedCrxKeyPath(path) {
  return Boolean(providedCrxKeyPath && resolve(path) === providedCrxKeyPath);
}

async function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

async function crxKeyPath() {
  const crxKeyB64 = process.env.MOOFLIGHTS_CRX_KEY_B64;
  if (crxKeyB64) {
    const path = resolve(artifacts, ".mooflights-crx-key.pem");
    await writeFile(path, Buffer.from(crxKeyB64, "base64"));
    return { path, temporary: true };
  }
  if (crxKeyPathEnv()) return { path: providedCrxKeyPath, temporary: false };
  return null;
}

function crxKeyPathEnv() {
  return process.env.MOOFLIGHTS_CRX_KEY_PATH || "";
}
