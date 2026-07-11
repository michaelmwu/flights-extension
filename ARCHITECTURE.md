# Architecture

## Current Shape

The extension has four runtime surfaces:

- ITA Matrix content script: renders the companion panel and interacts with ITA result pages.
- Popup: compact status and quick links.
- Options page: local settings for provider ranking, airport defaults, backend metadata, affiliate opt-out, and optional
  Moo Account sign-in.
- Background service worker: extension lifecycle hooks and the only owner of Moo Account credentials.

Shared domain code lives under `src/shared/` and is intentionally browser-safe.

## Preference Surfaces

The product can have two preference surfaces:

- Local extension preferences: the Chrome options page. This is the MVP source of truth for offline behavior, provider
  hiding/preference, airport helper defaults, affiliate opt-out, and dev-only backend API targets. It stores data in
  `chrome.storage.local`.
- Hosted account preferences: a future Moo Account web page backed by the shared identity service and private product
  APIs. This should handle account security, cross-browser sync, account-level frequent-flyer preferences, premium
  entitlements, and backend-owned provider config.

When both exist, the extension should boot from local preferences first, then merge authenticated hosted preferences as an
optional overlay. Local opt-out and privacy controls should remain available even when the hosted service is unavailable.

## Offline-First Flow

1. The content script loads local settings from `chrome.storage.local`.
2. The user captures ITA Matrix "Copy as JSON" output or pastes it manually.
3. Shared itinerary code normalizes slices, segments, fare carriers, fare bases, booking classes, price, and trip type.
4. Provider ranking combines local provider definitions with optional remote provider metadata.
5. The panel renders Where to Credit, verified booking, and utility links.
6. Airport helper filters local airport data and inserts or copies airport codes.

If the backend is disabled or unavailable, steps 1-6 still work.

## Backend Boundary

The private MooTravel backend may provide:

- Access-token validation against the dedicated Moo Account OIDC issuer.
- Neon Postgres-backed accounts and synced preferences.
- Provider reliability metadata.
- User feedback aggregation.
- Affiliate routing configuration.
- Premium subscription and entitlement logic.

The extension should consume only stable HTTPS APIs. It must not contain direct database credentials, OAuth secrets, service-role tokens, or private commercial logic.

## Moo Account Boundary

Configured builds use a public OpenID Connect client and Authorization Code with PKCE through
`chrome.identity.launchWebAuthFlow()`. Build configuration supplies the exact issuer, public client ID, and RFC 8707
resource audience. The build adds only the issuer origin to host permissions and never embeds a client secret.

The background runtime owns discovery, state/nonce/PKCE validation, token exchange, refresh, revocation, and credential
storage. Credentials live in extension-origin IndexedDB and are never returned through runtime messages. Popup and
options pages receive a small typed account projection containing only display name, email, verification state, and
sign-in status. Content-script senders are rejected from all account commands. Firefox data-consent grants are checked
again in the background before authentication or refresh; withdrawing consent clears the local session without another
identity-provider request.

Moo Account authentication is independent from itinerary sharing and Community Intelligence. Signing in must never
create, link, enable, or replace an anonymous contributor identity without a separate explicit user action and backend
contract.

## Provider Metadata Contract

Initial endpoint:

```http
GET /api/extension/v1/providers
```

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

The local provider registry remains the fallback source of truth.
