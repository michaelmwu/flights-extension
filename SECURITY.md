# Security Policy

## Reporting Vulnerabilities

Do not open public issues for vulnerabilities, leaked secrets, or exploitable extension behavior.

Use GitHub private vulnerability reporting if it is available for this repository. If it is not available, contact the repository owner privately through the maintained MooTravel or GitHub owner channels.

## Secret Handling

- Never commit real `.env` files, tokens, private keys, credentials, production data, or browser profile data.
- Never add `POSTGRES_URL`, service-role keys, OAuth client secrets, affiliate secrets, or premium entitlement logic to extension code.
- Moo Account is a public OIDC client. Keep state, nonce, PKCE verifier, access tokens, and refresh tokens in the
  background runtime. Never return token material to popup/options callers or content scripts.
- Persist account credentials only in extension-origin private storage. Account commands must reject content-script and
  foreign-extension senders.
- Keep backend debugging behind public HTTPS API endpoints or local development URLs.
- Use `.env.example` only for documented placeholder configuration when this repo needs environment variables.

## Dependency Policy

This repository uses dependency cooldowns and locked installs:

- Bun filters newly published package versions with `minimumReleaseAge = 604800` in `bunfig.toml`.
- CI installs with `bun install --frozen-lockfile`.
- Dependabot updates Bun and GitHub Actions dependencies weekly with a 7-day cooldown.

Exceptions for urgent security fixes should be documented in the PR.

## GitHub Actions

Workflows should use least-privilege permissions, frozen installs, and pinned third-party actions where practical. Extension release workflows must not require backend secrets.

Dependency Review is available only when GitHub's Dependency graph is enabled for the repository. Set the repository variable `ENABLE_DEPENDENCY_REVIEW=true` after enabling that setting.
