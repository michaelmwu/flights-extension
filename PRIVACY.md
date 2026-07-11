# Privacy Policy

Last updated: July 10, 2026

This policy applies to the current MooFlights browser extension.

## Data The Extension Handles

MooFlights processes flight-search and itinerary information in the browser so it can show mileage estimates,
booking links, airport-code helpers, and Google Flights country price comparisons.

Depending on the page and features you use, this can include:

- ITA Matrix itinerary details, such as airports, dates, cabins, carriers, flight numbers, booking classes, fare basis
  codes, prices, currencies, passenger counts, and derived route distances.
- Google Flights booking-page offers visible in your browser, including prices, booking options, selected country
  markets, and temporary comparison results.
- Extension settings, such as preferred providers, hidden providers, frequent-flyer program preferences, Google Flights
  country selections, airport-helper filters, and debug settings.
- If you choose to sign in, basic Moo Account profile data such as display name and verified email, plus the credentials
  needed to keep that extension session active.

The extension may write text to your clipboard when you use copy actions. It does not read your clipboard.

## How The Data Is Used

The extension uses this data to:

- Render the ITA Matrix and Google Flights companion panels.
- Estimate mileage earnings from local extension data.
- Build prefilled links to booking, search, and mileage-crediting websites.
- Compare selected Google Flights country pages.
- Save your extension preferences locally.
- Show your optional Moo Account connection and, in future versions, request explicitly supported account preferences.

MooFlights does not use the current production extension build for analytics, advertising profiles, or user
tracking.

MooFlights' use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use
requirements.

## Storage And Retention

Extension settings and short-lived helper caches are stored locally with Chrome extension storage on your device.
Cached data is used to keep the extension responsive and avoid repeated page work. You can remove locally stored
extension data by clearing the extension's site/app data in Chrome or uninstalling the extension.

If you sign in, access and refresh credentials are stored in private extension-origin IndexedDB owned by the background
runtime. Content scripts cannot read that database, and the popup/options messaging contract never returns the tokens.
Signing out clears the local credentials and attempts to revoke the server credential.

## Network Requests And Sharing

Moo Account sign-in does not send itinerary details, booking options, searches, prices, or local settings to Mu Travel
servers. Authentication and any separately consented Community Intelligence contribution are independent features.

The extension does make normal browser requests needed for its current features:

- It runs on ITA Matrix and Google Flights pages you visit and may open temporary Google Flights tabs for selected
  country comparisons.
- It fetches public foreign-exchange rate data from `https://cdn.jsdelivr.net/*` and `https://api.fxratesapi.com/*` to
  support approximate currency conversion in mileage estimates.
- If you explicitly sign in, it contacts the configured Moo Account issuer to authenticate, refresh the extension
  session, receive basic account profile claims in the signed identity response, and revoke credentials on sign-out.
- When you choose to open generated provider, airline, online-travel-agency, ITA Matrix, Google Flights, or mileage
  crediting links, those destination websites receive the URL and request information needed to load their pages.

Mu Travel LLC does not sell the personal data handled by the extension. Mu Travel LLC does not share that data with third
parties except when you choose to open a third-party website from the extension, or when Chrome and the websites you
visit necessarily process normal browser requests.

Third-party websites are governed by their own privacy policies.

## Permissions

The extension requests only the permissions needed for the current feature set:

- `storage` for local settings and caches.
- `clipboardWrite` for user-triggered copy actions.
- `identity` in account-enabled builds, for the user-initiated Moo Account browser sign-in window.
- Host access for ITA Matrix, Google Flights, public FX-rate sources, and bundled runtime pages listed in the extension
  manifest.
- Host access for the exact Moo Account issuer origin in account-enabled builds.

On Firefox, account identity and profile data are optional data permissions requested only when you choose Sign in. If
you remove either permission in Firefox settings, MooFlights clears the local account session and stops future account
requests until you grant permission and sign in again.

## Contact

For privacy questions about MooFlights, use the support or contact channel listed for the extension in the Chrome
Web Store, or open an issue in this repository.
