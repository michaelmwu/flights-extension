# Development

## Setup

```sh
bun install --frozen-lockfile
```

## Build And Load

```sh
bun run build
```

Then open Chrome or another Chromium-compatible browser:

1. Go to `chrome://extensions`.
2. Enable Developer Mode.
3. Click "Load unpacked".
4. Select this repo's `dist/` directory.
5. Open `https://matrix.itasoftware.com/`.

For iterative work:

```sh
bun run dev
```

`bun run dev` creates a dev build and watches source files. Reload the unpacked extension after rebuilds.

For a one-shot dev build:

```sh
bun run build:dev
```

Dev builds expose an options-page "Developer Backend" section for pointing the extension at a locally running API such as `http://localhost:3000`. Production builds hide this section.

## Moo Account Builds

Account support is disabled when all account variables are absent. A partial configuration fails the build so a release
cannot silently ship a mismatched issuer or client:

```sh
MOOFLIGHTS_AUTH_ISSUER=https://id.michaelmwu.com \
MOOFLIGHTS_AUTH_CLIENT_ID=mooflights-extension-dev \
MOOFLIGHTS_AUTH_AUDIENCE=https://api.mootravel.app \
bun run build:dev
```

Production issuer and audience URLs must use HTTPS. Dev builds also accept HTTP loopback URLs, which allows a local
identity service without coupling ordinary extension work to it:

```sh
MOOFLIGHTS_AUTH_ISSUER=http://127.0.0.1:4310 \
MOOFLIGHTS_AUTH_CLIENT_ID=mooflights-extension-local \
MOOFLIGHTS_AUTH_AUDIENCE=http://localhost:48731 \
bun run build:dev
```

Register the exact value returned by `chrome.identity.getRedirectURL("moo-account")` for each production/development
extension identity. Chrome and Firefox use different redirect origins. Account clients are public: never add a client
secret to a build variable, manifest, source file, or extension setting.

Account-enabled Firefox builds require Firefox 140 or later and declare `authenticationInfo` and
`personallyIdentifyingInfo` as optional data-collection permissions. Firefox requests those permissions only when the
user chooses Sign in. Account-disabled Firefox builds keep the existing Firefox 107 minimum and declare no data
collection.

Release and Chrome Web Store workflows read the three public values from repository variables with the same names. If
all three variables are unset, packages remain account-disabled; if only some are set, packaging fails closed.

For Firefox:

```sh
bun run package:firefox
```

Then open Firefox:

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on...".
3. Select `artifacts/mooflights-firefox-<version>.xpi`.
4. Open `https://matrix.itasoftware.com/`.

Prefer a stable high port for the backend when you are not intentionally running multiple backend worktrees:

```env
PORT=48731
APP_URL=http://localhost:48731
```

Then set the extension dev backend URL to `http://localhost:48731`. If Conductor assigns a different worktree port, use the custom URL field in the Developer Backend section.

## Checks

```sh
bun run check
bun run typecheck
bun run test
```

## Packaging

```sh
bun run package
```

This writes versioned packages such as `artifacts/mooflights-0.0.8.zip` and `artifacts/mooflights-0.0.8.crx`. The CRX step requires Google Chrome or Chromium; set `CHROME_BIN` if it is not in a standard location. Set `MOOFLIGHTS_CRX_KEY_PATH` or `MOOFLIGHTS_CRX_KEY_B64` when a stable CRX key is needed; otherwise Chrome generates a throwaway package key during packaging.

For Firefox development packaging:

```sh
bun run package:firefox
bun run package:firefox:stable
```

These write `artifacts/mooflights-firefox-<version>.xpi` in the workspace or canonical repo root, respectively. Firefox
development loading should use the packed XPI, not an unpacked directory. The generated Firefox package is unsigned;
release distribution still needs the Mozilla Add-ons signing flow.

To prepare the next unused patch release version from the latest local `vX.Y.Z` tag or checked-in version:

```sh
bun run release:next-patch
```

To prepare that version and package it in one step:

```sh
bun run release:package:next-patch
```

To prepare the next unused minor release version, such as `0.1.0` after `0.0.x`:

```sh
bun run release:next-minor
```

To prepare that minor version and package it in one step:

```sh
bun run release:package:next-minor
```

Before cutting a release, keep `package.json` and `src/manifest.json` versions in sync:

```sh
bun run release:verify
```

## GitHub Workflows

- `CI`: runs on pull requests and pushes to `main`; installs with Bun, runs Biome, typecheck, tests, and production build.
- `Release Extension Package`: runs manually or on `v*` tags; verifies the repo, checks the release tag matches the extension version when provided, builds versioned Chrome `artifacts/mooflights-*.zip` and `artifacts/mooflights-*.crx` packages plus the Firefox `artifacts/mooflights-firefox-*.xpi` package, uploads the package artifacts, generates GitHub release notes from the tag history, and attaches the packages to a single GitHub release for that source version. Manual runs can omit `release_tag` to build only, use the default `next_patch` strategy to package the next unused patch version as a build artifact, choose `next_minor` for a `0.1.0`-style bump, or provide an existing `vX.Y.Z` tag to create/update a draft release.

The release workflow intentionally does not publish to the Chrome Web Store or sign Firefox packages yet. Until Mu Travel
LLC has the relevant store automation credentials, store submission and Mozilla Add-ons signing remain manual and outside
GitHub Actions. The Firefox XPI attached to GitHub releases is unsigned and intended for Mozilla Add-ons submission or
developer testing.

Neither workflow needs backend secrets. The extension build must not read `.env`. Release workflows that enable Moo
Account need only the non-secret issuer, public client ID, and resource audience values.

## Stable Unpacked Extension Path

Browsers key unpacked-extension storage to the loaded extension identity, and loading a build directory from a different
Conductor workspace can make the browser treat it as a different extension. To keep settings while archiving and
recreating workspaces, use the stable targets:

```sh
bun run dev:stable
bun run package:firefox:stable
```

In a linked worktree, `bun run dev:stable` writes Chrome's unpacked build to the canonical repo root `dist/` directory
instead of the workspace-local build directory. Load that canonical `dist/` once in Chrome and reload it after workspace
builds.

Firefox expects a packed file, including in development. Use `bun run package:firefox:stable` to write the canonical
repo root `artifacts/mooflights-firefox-<version>.xpi`, then load that XPI through `about:debugging`.

The checked-in Conductor Run script uses `bun run dev:stable` and is marked non-concurrent so two workspaces do not race
to write the same Chrome extension directory. Use the Firefox stable package script with the same non-concurrent
expectation if you add it to Conductor.

## Browser Extension Notes

- `src/manifest.json` is the Chrome MV3 source manifest.
- `bun run build` writes the Chrome MV3 build to `dist/`.
- `bun run package:firefox` writes a packed Firefox XPI to `artifacts/`.
- The Firefox build rewrites the manifest to MV2 with an event-page background script because Firefox continues to
  support MV2 and older local Firefox builds do not run Chrome-style MV3 background service workers.
- Content scripts are bundled as IIFEs because Chrome loads them as plain files from the manifest.
- The Chrome background service worker is bundled as ESM; the Firefox event-page background is bundled as an IIFE.
- Popup and options pages are static HTML files plus bundled React entrypoints.
- Static data that must work offline belongs in `src/shared/data/`.
- Backend debugging still goes through HTTP API endpoints. Do not put `POSTGRES_URL` or direct database credentials into extension settings.
