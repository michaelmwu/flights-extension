# Backend Contract

The extension is offline-first. Backend APIs are optional enhancements.

## Shared Identity Contract

Moo Account is a dedicated OpenID Connect issuer, separate from the MooFlights product API and database. The extension
is a public client and uses Authorization Code with PKCE S256 through `chrome.identity.launchWebAuthFlow()`.

Build-time configuration:

```text
MOOFLIGHTS_AUTH_ISSUER=https://id.michaelmwu.com
MOOFLIGHTS_AUTH_CLIENT_ID=<registered-public-client-id>
MOOFLIGHTS_AUTH_AUDIENCE=https://api.mootravel.app
```

The audience is sent as the RFC 8707 `resource` parameter on authorization, code exchange, and refresh. The issuer must
advertise OpenID discovery, authorization and token endpoints on the issuer origin, and PKCE S256. Register every
supported browser redirect returned by `identity.getRedirectURL("moo-account")` as an exact redirect URI.

The extension requests `openid profile email offline_access` with `prompt=consent` so offline refresh is explicit. It
never has a client secret. Product APIs must accept
only credentials issued by the exact configured issuer for the exact MooTravel API resource; tokens for other Moo apps
must not be interchangeable.

Because the access token is resource-restricted to the MooTravel API, the extension does not send it to the OIDC
UserInfo endpoint. The issuer contract must include `name` (or `preferred_username`), `email`, and `email_verified` in
the signed ID Token when those claims are available.

The extension background stores access/refresh credentials privately and exposes only token-free account state to its
popup and options pages. Content scripts cannot use account commands. Authentication alone must not upload itinerary,
search, or price data, and must not silently link a separate anonymous Community Intelligence contributor identity.

## Do Not Expose Database Credentials

Do not pass Neon/Postgres URLs, service-role keys, or SQL credentials to the extension. RLS is useful as backend defense-in-depth, but the browser extension should talk to HTTPS API endpoints only.

## Local Backend Debugging

Dev builds expose hidden developer options for pointing the extension at a local API server, for example:

- `http://localhost:48731`
- `http://localhost:3000`
- `http://localhost:8787`
- `http://127.0.0.1:48731`
- `http://127.0.0.1:3000`

This is still an API base URL. It must not be a direct Postgres URL. Use:

```sh
bun run build:dev
```

or:

```sh
bun run dev
```

Production builds hide these controls from normal users.

## Preference Sync Model

The Chrome options page remains the local/offline preference sheet. Future hosted preferences are an authenticated Moo
Account surface, not a replacement for local settings.

Merge direction:

- Load local `chrome.storage.local` settings immediately.
- If the user is signed in and the API is reachable, fetch hosted preferences.
- Apply hosted values only for syncable/account-level fields such as preferred frequent-flyer programs, provider
  preferences, and premium feature toggles.
- Keep local-only fields such as dev backend URL, debug controls, and immediate privacy opt-outs on the device.

The extension should continue working if preference sync fails.

## Initial Endpoint

```http
GET /api/extension/v1/providers
```

Purpose: allow the closed MooTravel backend to override public provider metadata without shipping a new extension version.

Response:

```json
{
  "providers": [
    {
      "providerId": "kayak",
      "reliabilityScore": 88,
      "knownIssues": "Optional public note",
      "disabled": false
    }
  ]
}
```

Rules:

- Missing providers keep local defaults.
- Invalid or unreachable responses are ignored.
- `disabled: true` hides that provider.
- Scores are public confidence hints, not private scoring internals.

## Future Endpoints

- `GET /api/extension/v1/me`
- `GET /api/extension/v1/settings`
- `PUT /api/extension/v1/settings`
- `POST /api/extension/v1/provider-feedback`
- `GET /api/extension/v1/entitlements`

These are intentionally deferred from the first reviewable extension release.
