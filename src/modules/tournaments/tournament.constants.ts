/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| tournament.constants.ts
|
| Description:
| Every value the tournament feature branches on, in one place.
|
| These are shared by the model (enum validation), the fixture generator
| (how many matches to make) and the app (what to show in a picker). One
| source means a new playoff shape is added once, not in four files that
| then disagree.
|
|--------------------------------------------------------------------------
*/

export const TOURNAMENT_FORMATS = [
  "League",
  "Knockout",
  "League+Knockout",
] as const;

export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

/*
|--------------------------------------------------------------------------
| Playoff Shapes
|--------------------------------------------------------------------------
|
| The organizer picks this, and the app guides rather than dictates - each
| option carries the copy the picker shows, so the person choosing knows
| what they are signing up for BEFORE fixtures exist. After generation the
| shape is locked, because the bracket is already built from it.
|
| `minTeams` is enforced: offering "Top 4 - Semi Finals" to a five-team
| tournament produces a playoff involving most of the field, which is not
| a playoff.
|
*/

export const PLAYOFF_SHAPES = [
  {
    key: "final_only",
    label: "Top 2 — straight Final",
    matches: 1,
    minTeams: 2,
    summary: "League ke top 2 seedha Final khelenge.",
    detail:
      "Sabse chhota. 4-6 team ya kam din hon toh yahi theek hai — league hi asli mukabla rehta hai.",
  },
  {
    key: "top4_semis",
    label: "Top 4 — Semi Finals + Final",
    matches: 3,
    minTeams: 6,
    summary: "1v4 aur 2v3 semi-final, phir Final.",
    detail:
      "Sabse jaana-pehchana. Table topper ko 4th se aasan match milta hai, aur teen extra match mein khatam.",
  },
  {
    key: "ipl_playoffs",
    label: "Top 4 — Qualifier / Eliminator (IPL style)",
    matches: 4,
    minTeams: 8,
    summary: "Q1: 1v2 · Eliminator: 3v4 · Q2 · Final.",
    detail:
      "Top 2 ko doosra mauka milta hai — Q1 haarne wala Q2 khelta hai. League mein achha karne ka asli fayda yahi shape deta hai.",
  },
] as const;

export type PlayoffShapeKey = (typeof PLAYOFF_SHAPES)[number]["key"];

export const PLAYOFF_SHAPE_KEYS = PLAYOFF_SHAPES.map((s) => s.key);

export const playoffShape = (key: string) =>
  PLAYOFF_SHAPES.find((s) => s.key === key) ?? null;

/*
|--------------------------------------------------------------------------
| Statuses
|--------------------------------------------------------------------------
|
| draft              organizer is still setting up; nobody else sees it
| published          visible to everyone, teams can be invited and join
| registration_closed teams locked, fixtures generated, nothing starts yet
| live               first ball of the first match has been bowled
| completed          winner decided
| cancelled          called off by the organizer
|
*/

export const TOURNAMENT_STATUSES = [
  "draft",
  "published",
  "registration_closed",
  "live",
  "completed",
  "cancelled",
] as const;

export const TEAM_ENTRY_STATUSES = [
  "invited",
  "requested",
  "accepted",
  "declined",
  "withdrawn",
  "removed",
] as const;

/*
|--------------------------------------------------------------------------
| Squad Rules
|--------------------------------------------------------------------------
|
| A captain registers a squad for the tournament and only those players may
| appear in its matches. Fifteen is the floor because a cricket XI plus
| four is the smallest squad that survives one injury and one no-show;
| twenty is the ceiling so a team cannot quietly register its whole club
| and field a different side every week.
|
*/

export const SQUAD_MIN = 15;

export const SQUAD_MAX = 20;

/*
|--------------------------------------------------------------------------
| Points
|--------------------------------------------------------------------------
|
| Defaults, not rules - the organizer can change them on the create form.
| Editable only until the first match is complete, after which changing
| them would silently rewrite a table people have already read.
|
*/

export const DEFAULT_POINTS = {
  win: 2,
  loss: 0,
  tie: 1,
  noResult: 1,
};

/*
|--------------------------------------------------------------------------
| Scheduling
|--------------------------------------------------------------------------
|
| The organizer says which days are playable and how many matches fit in
| one; the generator walks forward from startDate placing fixtures. Days
| are 0-6 with Sunday at 0, matching JavaScript's getDay().
|
*/

export const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

export const WEEKEND_ONLY = [0, 6];

export const DEFAULT_MATCHES_PER_DAY = 2;

export const MIN_TEAMS = 3;

export const MAX_TEAMS = 32;

/*
|--------------------------------------------------------------------------
| Awards
|--------------------------------------------------------------------------
|
| Prizes come in two shapes and they are genuinely different things.
|
|   POSITION prizes  1st, 2nd, 3rd - decided by who wins the final.
|   AWARD prizes     Most Runs, Most Sixes, Man of the Series - decided by
|                    what individual players did across the whole event.
|
| They are separate arrays on the tournament for that reason: a position
| prize has a number and needs a team, an award has a metric and needs a
| player, and squeezing both into one list means every consumer has to
| branch on which kind it is before it can render a row.
|
| WHO DECIDES THE WINNER
| Whatever can be counted, the app counts - and keeps counting, so the
| leaderboard is live from the first ball rather than appearing at the end.
| `computed: true` marks those.
|
| The rest cannot be counted from a scorecard. "Best Fielder" is a judgment
| about dives and saved runs that no ball-by-ball record contains, and
| "Man of the Series" is an argument people enjoy having. Those are
| `computed: false` and the organizer picks the winner.
|
| The organizer can also override a computed award. That is not a
| contradiction - it is what you need when two players tie on 214 runs, or
| when a scorer credited the wrong batter in week one and everyone knows
| it. Once overridden the pick stands and the counter stops deciding.
|
| `direction` says which end of the leaderboard wins: "desc" for most runs,
| "asc" for best economy. `minQualifier` keeps a nonsense winner out of the
| rate-based awards - one over for two runs is not the best economy of a
| six-week tournament.
|
*/

export const AWARD_METRICS = [
  {
    key: "most_runs",
    label: "Most Runs",
    unit: "runs",
    computed: true,
    direction: "desc",
    icon: "flame",
    hint: "Poore tournament mein sabse zyada run banane wala.",
  },
  {
    key: "most_wickets",
    label: "Most Wickets",
    unit: "wickets",
    computed: true,
    direction: "desc",
    icon: "disc",
    hint: "Sabse zyada wicket lene wala gendbaz.",
  },
  {
    key: "most_sixes",
    label: "Most Sixes",
    unit: "sixes",
    computed: true,
    direction: "desc",
    icon: "rocket",
    hint: "Sabse zyada chhakke.",
  },
  {
    key: "most_fours",
    label: "Most Fours",
    unit: "fours",
    computed: true,
    direction: "desc",
    icon: "flash",
    hint: "Sabse zyada chauke.",
  },
  {
    key: "most_catches",
    label: "Most Catches",
    unit: "catches",
    computed: true,
    direction: "desc",
    icon: "hand-left",
    hint: "Sabse zyada catch pakadne wala.",
  },
  {
    key: "highest_score",
    label: "Highest Individual Score",
    unit: "runs",
    computed: true,
    direction: "desc",
    icon: "trending-up",
    hint: "Ek innings mein sabse bada score.",
  },
  {
    key: "best_bowling",
    label: "Best Bowling Figures",
    unit: "wickets",
    computed: true,
    direction: "desc",
    icon: "medal",
    hint: "Ek match mein sabse behtareen bowling.",
  },
  {
    /*
    | Rate awards need a floor or they are won by somebody who faced four
    | balls. 30 deliveries is roughly five overs faced - enough that the
    | number means something, low enough that a genuine finisher who came
    | in late still qualifies.
    */
    key: "best_strike_rate",
    label: "Best Strike Rate",
    unit: "SR",
    computed: true,
    direction: "desc",
    minQualifier: 30,
    qualifierLabel: "kam se kam 30 gend kheli hon",
    icon: "speedometer",
    hint: "Sabse tez run banane wala (30+ gend).",
  },
  {
    key: "best_economy",
    label: "Best Economy",
    unit: "econ",
    computed: true,
    direction: "asc",
    minQualifier: 60,
    qualifierLabel: "kam se kam 10 over daale hon",
    icon: "shield-checkmark",
    hint: "Sabse kanjoos gendbaz (10+ over).",
  },
  {
    /*
    | Counted from each match's own Player of the Match, which the scoring
    | flow already records. Nothing new to fill in - the tournament just
    | adds up who won it most often.
    */
    key: "most_potm",
    label: "Most Player of the Match Awards",
    unit: "awards",
    computed: true,
    direction: "desc",
    icon: "star",
    hint: "Sabse zyada baar Player of the Match bana.",
  },

  /* ── Organizer's call ──────────────────────────────────────────── */

  {
    key: "man_of_the_series",
    label: "Man of the Series",
    computed: false,
    icon: "trophy",
    hint: "Organiser decide karega — koi formula nahi.",
  },
  {
    key: "best_fielder",
    label: "Best Fielder",
    computed: false,
    icon: "hand-right",
    hint: "Catch, run out, bachaye hue run — scorecard mein nahi aata.",
  },
  {
    key: "emerging_player",
    label: "Emerging Player",
    computed: false,
    icon: "sparkles",
    hint: "Naya ya sabse zyada improve karne wala player.",
  },
  {
    key: "best_captain",
    label: "Best Captain",
    computed: false,
    icon: "ribbon",
    hint: "Organiser decide karega.",
  },
  {
    key: "fair_play",
    label: "Fair Play Award",
    computed: false,
    icon: "happy",
    hint: "Team ya player ko — organiser decide karega.",
  },
  {
    /*
    | The escape hatch. Local tournaments invent awards nobody else has
    | ("Best Local Talent", "Sponsor's Choice") and a fixed list would send
    | the organizer looking for the closest wrong option.
    */
    key: "custom",
    label: "Custom Award",
    computed: false,
    icon: "add-circle",
    hint: "Apna naam do — jo bhi award dena ho.",
  },
] as const;

export type AwardMetricKey = (typeof AWARD_METRICS)[number]["key"];

export const AWARD_METRIC_KEYS = AWARD_METRICS.map((a) => a.key);

export const awardMetric = (key: string) =>
  AWARD_METRICS.find((a) => a.key === key) ?? null;

/*
| What a new tournament starts with on the create form. Two of them, both
| computed, both at zero - the organizer adds amounts and more awards, or
| deletes these. Starting empty makes awards feel optional; starting with
| ten makes the form look like homework.
*/

export const DEFAULT_AWARD_ROWS = [
  { metric: "most_runs", label: "Most Runs", amount: 0 },
  { metric: "most_wickets", label: "Most Wickets", amount: 0 },
];
