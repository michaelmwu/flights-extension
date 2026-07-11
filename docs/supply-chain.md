# Dependency Supply Chain

This repository follows a small set of dependency rules to keep local development, CI, and release packaging reproducible.

## Bun

Use the committed `bun.lock` and install through Bun:

```sh
bun install --frozen-lockfile
```

`bunfig.toml` sets a 7-day `minimumReleaseAge` so newly published package versions are filtered during dependency resolution. If a security fix or production incident needs a newer package immediately, document the exception in the PR.

## CI

GitHub Actions should install with:

```sh
bun install --frozen-lockfile
```

The baseline validation sequence is:

```sh
bun run check
bun run typecheck
bun run test
bun run build
```

## Dependency Updates

Dependabot is configured for weekly Bun and GitHub Actions updates with a 7-day cooldown. Keep dependency PRs small enough that extension behavior and permissions can be reviewed clearly.

GitHub Dependency Review is opt-in through the repository variable `ENABLE_DEPENDENCY_REVIEW=true` because the action requires GitHub's Dependency graph to be enabled in repository settings.

## Extension Boundary

Dependency changes must preserve the offline-first extension boundary:

- Do not add packages that require backend credentials in extension code.
- Do not move private MooTravel backend logic into this repository.
- Prefer browser-safe shared code under `src/shared/` for functionality that must run offline.

`oauth4webapi` is the account-enabled background runtime's standards implementation for OpenID discovery,
Authorization Code + PKCE, ID Token verification, refresh, and revocation. It has no transitive runtime dependencies and
must not be imported by content-script entrypoints.
