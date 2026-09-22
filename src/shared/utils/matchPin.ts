/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Shared / Utils
|
| File:
| matchPin.ts
|
| Description:
| The one place a match PIN is created.
|
| WHY THIS FILE EXISTS
|
| The two PINs on a Match are what stop a scorer starting a game the two
| captains have not agreed to. That guard is only as good as the PINs being
| there in the first place - and they were only being generated in ONE of
| the three places a Match gets created:
|
|   match.service.createMatch      -> generated them        (challenge flow)
|   fixtures.service               -> did NOT               (tournament)
|   series.service                 -> did NOT               (series)
|
| A tournament fixture therefore had teamAPin = teamBPin = null. requiredPinSides
| filters on `hasPin`, so it returned an empty list, the app rendered no PIN
| gate, and startMatch looped over nothing and started the match. The guard
| was not bypassed - it had nothing to check.
|
| So the rule lives here, in a file with no imports of its own, and all
| three creation paths call it. A fourth path added later cannot silently
| skip it without someone noticing this file was never imported.
|
| WHY crypto AND NOT Math.random
|
| Math.random is seeded predictably enough that a motivated person who has
| seen a few PINs could narrow the next one. It is a low-stakes secret - two
| captains standing on a ground - but randomInt costs nothing and removes
| the question entirely.
|
|--------------------------------------------------------------------------
*/

import { randomInt } from "crypto";

/* A 4-digit code, always 4 digits - 1000..9999, never "0042". */
export const newMatchPin = (): string => String(randomInt(1000, 10000));

/*
| Both PINs for a new match, ready to spread into Match.create.
|
| Returned as a pair rather than called twice at each site so that no
| creation path can generate one and forget the other - which would leave
| exactly half the guard working, the hardest kind of bug to see.
*/
export const newMatchPins = (): { teamAPin: string; teamBPin: string } => ({
  teamAPin: newMatchPin(),
  teamBPin: newMatchPin(),
});
