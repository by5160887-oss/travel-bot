# QA upgrades: draft only

No merge or production change is authorized by this PR. No new paid API is added.
All tests use mocked provider responses, never real AI/search calls.

Changes:
- Baggage, passport/visa and legal questions require live official sources; lack
  of official evidence returns a warning without calling Gemini. Client fallback
  cannot quote stored numeric rules for these questions on request failure.
- Exact official host allowlists replace permissive Chabad/airline name matching.
- Chabad directory returns only source excerpt fields; unverified details are
  marked missing. It is a partial list, not a guarantee of all centers.
- Thailand answers do not infer no kosher hotel from no search result. Meals,
  proximity and whole-hotel kosher certification remain separate.
- Day-count itinerary answers must cover every day, morning/noon/evening,
  accommodation, Shabbat and kosher food; a bounded repair runs once, then failure
  is clear. Dates are needed before assigning the actual weekday; no claim that
  day 7 is Shabbat. Transport schedules and venue hours need live evidence.
- Existing proofreading has deterministic mixed Hebrew/Arabic/Cyrillic cleanup;
  unclear mixed words are labelled rather than guessed. Names in other scripts
  are retained. Existing continuation/proofreading calls remain on the existing API.
- Legal prompt distinguishes refund conditions, overbooking scenarios and the
  applicability/exceptions of Israel's Aviation Services Law. Numeric legal
  sentences need references to supplied official sources. This is a source gate,
  not a semantic proof that a reference supports every model inference.
- Optional closing offers are removed from complete answers. Missing crucial
  information may still get a question.
- Public Travelor search steps preserve Yehuda's referral id. Private agent
  screens, reservations and commissions are not accessible or claimed verified.

Source review, 2026-10-05:
- https://chabadprague.cz/en/contact-us-2/ : address, phone and email of Maharal center.
- https://chabadthailand.co.il/houses/bangkok/ : kosher meals and community contact.
- https://chabadthailand.co.il/houses/phuket/ : restaurants and contact; no whole-hotel certification.
- https://www.jewishthailand.com/templates/articlecco_cdo/aid/316121/jewish/Kosher-Restaurant-Bakery-and-Shop.htm : meals and supervision only.
- https://www.jewishthailand.com/templates/articlecco_cdo/aid/422395/jewish/FAQs.htm : older FAQ, don't use old prices/hotel status without verification.
- https://www.icao.int/news/international-air-travel-liability-limits-set-increase-enhancing-customer-compensation-0 : official law-source lead; numbers are not bundled as live answers.
- https://www.travelor.com/he : public search fields; no private dashboard claims.

156 mocked regression tests pass locally. A deployed preview and real provider
QA are still required before any merge approval; live quality is not proved by
mocks. Access codes/caps remain a separate PR; this upgrade does not fix their
current exposure or put durable Redis quotas in production.
