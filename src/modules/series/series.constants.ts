/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Series
|
| File:
| series.constants.ts
|
| Description:
| Everything the series feature branches on.
|
| A SERIES IS NOT A SMALL TOURNAMENT
| It is a different shape and that is why it is a separate module rather
| than a tournament with maxTeams: 2.
|
|   A tournament has N teams, a seeding order, a points table, a bracket
|   and a playoff. All of that exists to answer "who is best of many".
|
|   A series has exactly two teams and answers "who is better, over N
|   games". There is no seeding (there is nothing to seed), no NRR (two
|   teams, so it decides nothing), and no bracket. What it has instead is
|   a SCORELINE - 2-1, 3-0 - which a tournament has no concept of.
|
| Trying to serve both from one model means every tournament query grows a
| branch for the two-team case, and every series screen grows a hidden
| points table. Two modules that share the Match document is the cheaper
| arrangement, and it is why a series fixture is an ordinary Match: toss,
| squads, the PIN, the scoring pad, live streaming and career stats all
| work on it with no changes to any of those modules.
|
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Length
|--------------------------------------------------------------------------
|
| The organizer picks a number of matches, not a "best of". Best-of is a
| stopping rule - a best-of-5 ends at 3-0 and the last two are never
| played - and local cricket does not work that way: the ground is booked,
| both teams turned up, they play the dead rubber.
|
| So every match in the series is scheduled and played, and `decidedAt`
| records the moment one side went beyond reach. That is the honest model
| of what actually happens on a maidan.
|
| An odd number is offered first because an even-length series can end
| level, which is a real outcome but rarely the one anybody wants.
|
*/

export const SERIES_LENGTHS = [1, 2, 3, 4, 5, 7];

export const MIN_MATCHES = 1;

export const MAX_MATCHES = 15;

export const DEFAULT_MATCHES = 3;

/*
|--------------------------------------------------------------------------
| Statuses
|--------------------------------------------------------------------------
|
| draft       organizer is still setting it up; nobody else sees it
| published   visible, and the opponent has been or can be invited
| scheduled   opponent accepted, fixtures generated, nothing played yet
| live        first ball bowled
| completed   every match played
| cancelled   called off
|
| There is no "registration_closed" equivalent because there is nothing to
| close - a series has one invite, and it is either accepted or it is not.
|
*/

export const SERIES_STATUSES = [
  "draft",
  "published",
  "scheduled",
  "live",
  "completed",
  "cancelled",
] as const;

/*
| The opponent's answer. One invite, one team, three possible states -
| much smaller than a tournament's entry lifecycle, which has to cope with
| public join requests and withdrawals from a field of twenty.
*/

export const OPPONENT_STATUSES = [
  "pending",
  "accepted",
  "declined",
] as const;

/*
|--------------------------------------------------------------------------
| Scheduling
|--------------------------------------------------------------------------
|
| Days are 0-6 with Sunday at 0, matching JavaScript's getDay() and the
| tournament scheduler. Kept identical on purpose: an organizer who has
| run a tournament should not have to relearn the same picker.
|
| A series defaults to one match per playing day. Two teams playing twice
| in a day is a thing that happens, but it is unusual enough that it
| should be a choice rather than the default.
*/

export const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

export const WEEKEND_ONLY = [0, 6];

export const DEFAULT_MATCHES_PER_DAY = 1;

/*
|--------------------------------------------------------------------------
| Awards
|--------------------------------------------------------------------------
|
| A series uses the SAME award catalogue as a tournament, imported rather
| than copied. Two lists would drift, and then "Most Sixes" would mean
| something subtly different in a series than in a tournament - which is
| exactly the kind of difference nobody notices until a player disputes an
| award.
|
| Only the default rows differ: a series is short, so it starts with Man
| of the Series rather than two statistical awards. Three matches is not
| enough for "Most Runs" to feel like a real title, but every series ever
| played has had a man of the series.
|
*/

export { AWARD_METRICS, AWARD_METRIC_KEYS, awardMetric } from "../tournaments/tournament.constants";

export const DEFAULT_SERIES_AWARD_ROWS = [
  { metric: "man_of_the_series", label: "Man of the Series", amount: 0 },
];
