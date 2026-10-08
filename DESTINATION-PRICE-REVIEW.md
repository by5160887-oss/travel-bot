# Destination and Travelor price guardrails

Draft only. Nothing merged, no production environment or sandbox changes.

## Evidence and limits
Production HTML matched main commit 6d27f59. Fresh requests for ordinary Thailand questions and a two-week Thailand itinerary (including the spelling תילאנד) answered about Thailand. The reported Japan/US itinerary was not reproduced and the original conversation was lost. No claim of a confirmed original root cause.

Verified defects:
- The old browser network-error fallback used the first KB substring match. An ESTA question about Thailand could select the US entry; a mixed-country question could select the Japan product.
- Explicit country changes retained previous country itineraries in model input.
- A budget of 500 with no currency was interpreted as shekels and answered with unsupported general price ranges.

## Changes
Shared safe browser fallback replaces first-hit KB matching. Explicit single-country changes reset conflicting country history, without resetting follow-ups or multi-country comparisons. Thailand spelling variants normalize. Both backends intercept hotel-price requests before providers and clearly say Travelor inventory is not connected. This is NOT a live price connector. Service-worker cache includes the shared fallback modules for offline use.

## Travelor integration
The affiliate URL https://www.travelor.com/he?fid=84016 currently has a public hotel-search form (destination, arrival/departure, rooms/adults/children). No login is needed for that entry point. No developer/API documentation link was exposed on that homepage. This does not prove that no partner API exists.

Do not deploy private browser credentials, infer prices from an affiliate login page, or label general search results as quotes. The safe next step is a supported BeAgent/Travelor partner API or permitted feed with affiliate attribution. Ask whether the provider offers it. If yes, collect connection secrets securely and build a server-side adapter. Quotes must bind destination, dates, room distribution and children's ages, hotel/room/board, currency, full-stay total, taxes/fees, cancellation terms, availability, source URL and checked-at time. Without a supported source, keep the explicit no-price guardrail and direct the user to the exact affiliate search entry. Browser-assisted manual lookups are possible separately, not a dependable unattended public bot integration.
