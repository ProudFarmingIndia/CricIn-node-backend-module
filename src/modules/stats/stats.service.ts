import Match from "../matches/match.model";
import Team from "../teams/team.model";

import Scoring from "../scoring/scoring.model";

/*
|--------------------------------------------------------------------------
| Stats & Leaderboards
|--------------------------------------------------------------------------
|
| Every number here is aggregated from the ball-by-ball Scoring collection,
| never read from Player.stats or Team.wins. Those fields exist on the
| schemas but nothing writes to them, so anything derived from them would
| be a page of zeroes. Aggregating from deliveries is also the number that
| cannot drift - a counter can fall out of step with reality, a sum of the
| actual balls cannot.
|
| ONE PIPELINE, FOUR BATTING BOARDS
| Most Runs, Best Strike Rate, Most Fours and Most Sixes are four sorts of
| the same per-batsman totals, so they come from a single aggregation and
| are sorted in memory afterwards. Running four near-identical pipelines
| would cost four full scans to produce the same rows.
|
*/

export type StatsRange = "today" | "week" | "month" | "all";

/*
| A strike-rate board with no qualifier is meaningless: someone who faced
| one ball and hit a six sits on top with 600. 30 balls is the smallest
| number that stops a single big over from winning the board outright.
*/

const DEFAULT_MIN_BALLS_FOR_STRIKE_RATE = 30;

const startOfRange = (range: StatsRange): Date | null => {
  const now = new Date();

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (range === "month") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return null;
};

/*
|--------------------------------------------------------------------------
| Which Matches Count
|--------------------------------------------------------------------------
|
| Ball type and match format filter the MATCH; player location filters the
| PLAYER further down. They are different questions - "runs scored with a
| tennis ball" and "batsmen from Delhi" - and applying either in the wrong
| place gives a subtly wrong board rather than an error.
|
*/

const resolveMatchIds = async (options: {
  range?: StatsRange;
  ballType?: string;
  matchType?: string;
}) => {
  const query: any = {
    status: { $in: ["live", "completed"] },
  };

  const since = startOfRange(options.range || "all");

  if (since) {
    query.$or = [
      { startTime: { $gte: since } },
      { startTime: null, createdAt: { $gte: since } },
    ];
  }

  if (options.ballType) {
    query.ballType = options.ballType;
  }

  if (options.matchType) {
    query.matchType = options.matchType;
  }

  const matches = await Match.find(query).select("_id");

  return matches.map((m) => m._id);
};

/*
| Location is matched case-insensitively and whole-string: a user typing
| "delhi" should find "Delhi", but "Delhi" must not also match
| "New Delhi Gymkhana".
*/

const buildLocationMatch = (
  prefix: string,
  options: { city?: string; state?: string; country?: string },
) => {
  const match: any = {};

  if (options.city) {
    match[`${prefix}.city`] = new RegExp(`^${options.city}$`, "i");
  }

  if (options.state) {
    match[`${prefix}.state`] = new RegExp(`^${options.state}$`, "i");
  }

  if (options.country) {
    match[`${prefix}.country`] = new RegExp(`^${options.country}$`, "i");
  }

  return Object.keys(match).length > 0 ? match : null;
};

/*
|--------------------------------------------------------------------------
| Batting Totals
|--------------------------------------------------------------------------
*/

const battingTotals = async (matchIds: any[], options: any) => {
  const locationMatch = buildLocationMatch("player", options);

  return await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        batsmanId: { $ne: null },
      },
    },

    {
      $group: {
        _id: "$batsmanId",

        runs: { $sum: "$runs" },

        /*
        | Legal deliveries only. A wide is not a ball faced, and counting
        | it would understate every strike rate on the board.
        */
        balls: {
          $sum: { $cond: [{ $eq: ["$isLegalDelivery", false] }, 0, 1] },
        },

        fours: { $sum: { $cond: [{ $eq: ["$runs", 4] }, 1, 0] } },

        sixes: { $sum: { $cond: [{ $eq: ["$runs", 6] }, 1, 0] } },

        // Distinct innings, so "matches played" is not "balls faced".
        inningsSet: { $addToSet: "$inningsId" },
      },
    },

    {
      $lookup: {
        from: "players",
        localField: "_id",
        foreignField: "_id",
        as: "player",
      },
    },

    { $unwind: "$player" },

    ...(locationMatch ? [{ $match: locationMatch }] : []),

    {
      $project: {
        _id: 1,
        runs: 1,
        balls: 1,
        fours: 1,
        sixes: 1,
        innings: { $size: "$inningsSet" },
        playerName: "$player.playerName",
        profileImage: "$player.profileImage",
        playerType: "$player.playerType",
        city: "$player.city",
        state: "$player.state",
      },
    },
  ]);
};

/*
|--------------------------------------------------------------------------
| Bowling Totals
|--------------------------------------------------------------------------
*/

const bowlingTotals = async (matchIds: any[], options: any) => {
  const locationMatch = buildLocationMatch("player", options);

  return await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        bowlerId: { $ne: null },
      },
    },

    {
      $group: {
        _id: "$bowlerId",

        /*
        | bowlerCredit exists because a run-out is nobody's wicket.
        | Summing raw isWicket would credit the bowler for it.
        */
        wickets: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$isWicket", true] },
                  { $ne: ["$bowlerCredit", false] },
                ],
              },
              1,
              0,
            ],
          },
        },

        // teamRuns, not runs - a wide costs the bowler its penalty run too.
        runsConceded: { $sum: "$teamRuns" },

        balls: {
          $sum: { $cond: [{ $eq: ["$isLegalDelivery", false] }, 0, 1] },
        },

        inningsSet: { $addToSet: "$inningsId" },
      },
    },

    {
      $lookup: {
        from: "players",
        localField: "_id",
        foreignField: "_id",
        as: "player",
      },
    },

    { $unwind: "$player" },

    ...(locationMatch ? [{ $match: locationMatch }] : []),

    {
      $project: {
        _id: 1,
        wickets: 1,
        runsConceded: 1,
        balls: 1,
        innings: { $size: "$inningsSet" },
        playerName: "$player.playerName",
        profileImage: "$player.profileImage",
        playerType: "$player.playerType",
        city: "$player.city",
        state: "$player.state",
      },
    },
  ]);
};

const toPlayerRow = (row: any, extra: Record<string, any>) => ({
  playerId: row._id,

  playerName: row.playerName,

  profileImage: row.profileImage || null,

  playerType: row.playerType || null,

  city: row.city || "",

  innings: row.innings || 0,

  ...extra,
});

/*
|--------------------------------------------------------------------------
| Milestone Counts
|--------------------------------------------------------------------------
|
| Centuries, fifties and five-wicket hauls are counted PER INNINGS and then
| summed per player - two $group stages, not one. Grouping straight to the
| player would add every innings together and report one batsman on 300
| runs as a triple century rather than three separate scores.
|
| "Fifties" counts 50-99 and excludes hundreds, which is the convention on
| every scorecard: a batsman who made 112 has a hundred, not a fifty and a
| hundred.
|
*/

const battingMilestones = async (matchIds: any[], options: any) => {
  const locationMatch = buildLocationMatch("player", options);

  return await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        batsmanId: { $ne: null },
      },
    },

    // Per innings first.
    {
      $group: {
        _id: { inningsId: "$inningsId", batsmanId: "$batsmanId" },
        runs: { $sum: "$runs" },
      },
    },

    // Then per player.
    {
      $group: {
        _id: "$_id.batsmanId",

        hundreds: {
          $sum: { $cond: [{ $gte: ["$runs", 100] }, 1, 0] },
        },

        fifties: {
          $sum: {
            $cond: [
              {
                $and: [{ $gte: ["$runs", 50] }, { $lt: ["$runs", 100] }],
              },
              1,
              0,
            ],
          },
        },

        highestScore: { $max: "$runs" },

        innings: { $sum: 1 },
      },
    },

    {
      $lookup: {
        from: "players",
        localField: "_id",
        foreignField: "_id",
        as: "player",
      },
    },

    { $unwind: "$player" },

    ...(locationMatch ? [{ $match: locationMatch }] : []),

    {
      $project: {
        _id: 1,
        hundreds: 1,
        fifties: 1,
        highestScore: 1,
        innings: 1,
        playerName: "$player.playerName",
        profileImage: "$player.profileImage",
        playerType: "$player.playerType",
        city: "$player.city",
      },
    },
  ]);
};

const bowlingMilestones = async (matchIds: any[], options: any) => {
  const locationMatch = buildLocationMatch("player", options);

  return await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        bowlerId: { $ne: null },
      },
    },

    {
      $group: {
        _id: { inningsId: "$inningsId", bowlerId: "$bowlerId" },

        wickets: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$isWicket", true] },
                  { $ne: ["$bowlerCredit", false] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },

    {
      $group: {
        _id: "$_id.bowlerId",

        fiveWicketHauls: {
          $sum: { $cond: [{ $gte: ["$wickets", 5] }, 1, 0] },
        },

        bestWickets: { $max: "$wickets" },

        innings: { $sum: 1 },
      },
    },

    {
      $lookup: {
        from: "players",
        localField: "_id",
        foreignField: "_id",
        as: "player",
      },
    },

    { $unwind: "$player" },

    ...(locationMatch ? [{ $match: locationMatch }] : []),

    {
      $project: {
        _id: 1,
        fiveWicketHauls: 1,
        bestWickets: 1,
        innings: 1,
        playerName: "$player.playerName",
        profileImage: "$player.profileImage",
        playerType: "$player.playerType",
        city: "$player.city",
      },
    },
  ]);
};

/*
|--------------------------------------------------------------------------
| Hat-Tricks
|--------------------------------------------------------------------------
|
| A hat-trick is three wickets on three consecutive deliveries BY THAT
| BOWLER - not three consecutive balls of the innings, because a hat-trick
| can span two overs with the other bowler in between. So it cannot be done
| with $group at all; it needs the bowler's own ordered sequence of legal
| deliveries.
|
| Reading every ball to find them would be wasteful, so this narrows first:
| only (innings, bowler) pairs with at least three wickets can possibly
| contain one, and in practice that is a handful of rows. Only those
| bowlers' deliveries are then fetched and walked.
|
*/

const hatTrickCounts = async (matchIds: any[]) => {
  const candidates = await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        bowlerId: { $ne: null },
        isWicket: true,
        bowlerCredit: { $ne: false },
      },
    },

    {
      $group: {
        _id: { inningsId: "$inningsId", bowlerId: "$bowlerId" },
        wickets: { $sum: 1 },
      },
    },

    { $match: { wickets: { $gte: 3 } } },
  ]);

  if (candidates.length === 0) {
    return new Map<string, number>();
  }

  const inningsIds = candidates.map((c) => c._id.inningsId);

  const bowlerIds = candidates.map((c) => c._id.bowlerId);

  const balls = await Scoring.find({
    inningsId: { $in: inningsIds },
    bowlerId: { $in: bowlerIds },
  })
    .select("inningsId bowlerId over ball isWicket bowlerCredit isLegalDelivery")
    .sort({ inningsId: 1, over: 1, ball: 1 })
    .lean();

  const sequences = new Map<string, any[]>();

  for (const ball of balls) {
    /*
    | A wide or no-ball does not break a hat-trick - it is not a delivery,
    | so it is skipped rather than resetting the streak.
    */
    if (ball.isLegalDelivery === false) {
      continue;
    }

    const key = `${ball.inningsId}|${ball.bowlerId}`;

    if (!sequences.has(key)) {
      sequences.set(key, []);
    }

    sequences.get(key)!.push(ball);
  }

  const counts = new Map<string, number>();

  for (const [key, sequence] of sequences) {
    const bowlerId = key.split("|")[1];

    let streak = 0;

    for (const ball of sequence) {
      const isBowlerWicket =
        ball.isWicket === true && ball.bowlerCredit !== false;

      streak = isBowlerWicket ? streak + 1 : 0;

      if (streak === 3) {
        counts.set(bowlerId, (counts.get(bowlerId) || 0) + 1);

        // Four-in-four is one hat-trick, not two overlapping ones.
        streak = 0;
      }
    }
  }

  return counts;
};

/*
|--------------------------------------------------------------------------
| Leaderboards
|--------------------------------------------------------------------------
|
| Five boards in one response. The Stats tab shows all of them at once, so
| returning them together is one round trip instead of five - and the two
| aggregations behind them are shared rather than repeated per board.
|
*/

export const getLeaderboards = async (options: {
  range?: StatsRange;
  city?: string;
  state?: string;
  country?: string;
  ballType?: string;
  matchType?: string;
  limit?: number;
  minBalls?: number;
}) => {
  const limit = Math.min(Math.max(options.limit || 10, 1), 50);

  const minBalls = options.minBalls ?? DEFAULT_MIN_BALLS_FOR_STRIKE_RATE;

  const matchIds = await resolveMatchIds(options);

  if (matchIds.length === 0) {
    return {
      topRunScorers: [],
      topWicketTakers: [],
      bestStrikeRates: [],
      mostFours: [],
      mostSixes: [],
      mostCenturies: [],
      mostFifties: [],
      mostFiveWicketHauls: [],
      mostHatTricks: [],
      meta: { matches: 0, minBallsForStrikeRate: minBalls },
    };
  }

  const [batting, bowling, battingMs, bowlingMs, hatTricks] = await Promise.all([
    battingTotals(matchIds, options),
    bowlingTotals(matchIds, options),
    battingMilestones(matchIds, options),
    bowlingMilestones(matchIds, options),
    hatTrickCounts(matchIds),
  ]);

  /*
  | Sorted copies of the same batting rows - four boards, one scan.
  | Ties break on a sensible second measure rather than arbitrarily:
  | equal runs go to the faster scorer, equal boundaries to the one who
  | needed fewer balls.
  */

  const topRunScorers = [...batting]
    .sort((a, b) => b.runs - a.runs || a.balls - b.balls)
    .slice(0, limit)
    .map((r) =>
      toPlayerRow(r, {
        runs: r.runs,
        balls: r.balls,
        fours: r.fours,
        sixes: r.sixes,
        strikeRate: r.balls > 0 ? Number(((r.runs / r.balls) * 100).toFixed(2)) : 0,
      }),
    );

  const bestStrikeRates = batting
    .filter((r) => r.balls >= minBalls)
    .map((r) => ({
      ...r,
      strikeRate: r.balls > 0 ? Number(((r.runs / r.balls) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.strikeRate - a.strikeRate || b.runs - a.runs)
    .slice(0, limit)
    .map((r) =>
      toPlayerRow(r, {
        strikeRate: r.strikeRate,
        runs: r.runs,
        balls: r.balls,
      }),
    );

  const mostFours = [...batting]
    .filter((r) => r.fours > 0)
    .sort((a, b) => b.fours - a.fours || a.balls - b.balls)
    .slice(0, limit)
    .map((r) => toPlayerRow(r, { fours: r.fours, runs: r.runs, balls: r.balls }));

  const mostSixes = [...batting]
    .filter((r) => r.sixes > 0)
    .sort((a, b) => b.sixes - a.sixes || a.balls - b.balls)
    .slice(0, limit)
    .map((r) => toPlayerRow(r, { sixes: r.sixes, runs: r.runs, balls: r.balls }));

  /*
  | Equal wickets go to the bowler who gave away fewer runs - the standard
  | cricket tie-break, and the one a reader expects.
  */

  const topWicketTakers = [...bowling]
    .filter((r) => r.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded)
    .slice(0, limit)
    .map((r) =>
      toPlayerRow(r, {
        wickets: r.wickets,
        runsConceded: r.runsConceded,
        balls: r.balls,
        overs: `${Math.floor(r.balls / 6)}.${r.balls % 6}`,
        economy:
          r.balls > 0
            ? Number((r.runsConceded / (r.balls / 6)).toFixed(2))
            : 0,
      }),
    );

  /*
  | Milestone boards. Each drops players with a zero count rather than
  | listing them - a "Most Centuries" board padded with people who have
  | never scored one is noise, and an empty board says something true.
  */

  const mostCenturies = battingMs
    .filter((r: any) => r.hundreds > 0)
    .sort((a: any, b: any) => b.hundreds - a.hundreds || b.highestScore - a.highestScore)
    .slice(0, limit)
    .map((r: any) =>
      toPlayerRow(r, { centuries: r.hundreds, highestScore: r.highestScore }),
    );

  const mostFifties = battingMs
    .filter((r: any) => r.fifties > 0)
    .sort((a: any, b: any) => b.fifties - a.fifties || b.highestScore - a.highestScore)
    .slice(0, limit)
    .map((r: any) =>
      toPlayerRow(r, { fifties: r.fifties, highestScore: r.highestScore }),
    );

  const mostFiveWicketHauls = bowlingMs
    .filter((r: any) => r.fiveWicketHauls > 0)
    .sort(
      (a: any, b: any) =>
        b.fiveWicketHauls - a.fiveWicketHauls || b.bestWickets - a.bestWickets,
    )
    .slice(0, limit)
    .map((r: any) =>
      toPlayerRow(r, {
        fiveWicketHauls: r.fiveWicketHauls,
        bestWickets: r.bestWickets,
      }),
    );

  /*
  | Hat-tricks are counted outside the aggregation, so the player details
  | are joined back on from the bowling milestone rows.
  */

  const bowlerById = new Map(bowlingMs.map((r: any) => [String(r._id), r]));

  const mostHatTricks = Array.from(hatTricks.entries())
    .map(([bowlerId, count]) => {
      const row = bowlerById.get(String(bowlerId));

      return row ? toPlayerRow(row, { hatTricks: count }) : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.hatTricks - a.hatTricks)
    .slice(0, limit);

  return {
    topRunScorers,

    topWicketTakers,

    bestStrikeRates,

    mostFours,

    mostSixes,

    mostCenturies,

    mostFifties,

    mostFiveWicketHauls,

    mostHatTricks,

    meta: {
      matches: matchIds.length,

      minBallsForStrikeRate: minBalls,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Team Rankings
|--------------------------------------------------------------------------
|
| Built from completed Match documents, not from Team.wins / Team.losses -
| those columns exist but nothing maintains them, so a ranking read from
| them would put every team on zero.
|
| Ranked on points (win 3, draw 1), which is the system people already
| understand from every league table. Win percentage breaks ties, then
| matches played - so between two teams on equal points the better record
| wins, and between two equal records the one who played more does.
|
| A team that has never completed a match is left out entirely rather than
| shown at the bottom on zero: an unranked team is not the same as a bad
| one.
|
*/

export const getTeamRankings = async (options: {
  city?: string;
  state?: string;
  country?: string;
  teamType?: string;
  minMatches?: number;
  limit?: number;
}) => {
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);

  const minMatches = options.minMatches ?? 1;

  const teamQuery: any = {
    isActive: true,
  };

  if (options.city) {
    teamQuery.city = new RegExp(`^${options.city}$`, "i");
  }

  if (options.state) {
    teamQuery.state = new RegExp(`^${options.state}$`, "i");
  }

  if (options.country) {
    teamQuery.country = new RegExp(`^${options.country}$`, "i");
  }

  if (options.teamType) {
    teamQuery.teamType = options.teamType;
  }

  const teams = await Team.find(teamQuery).select(
    "teamName shortName logo city state country teamType rating reviewCount followersCount players",
  );

  if (teams.length === 0) {
    return [];
  }

  const teamIds = teams.map((t) => t._id);

  const matches = await Match.find({
    status: "completed",
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  }).select("teamA teamB winnerTeam");

  const records = new Map<string, any>();

  for (const team of teams) {
    records.set(String(team._id), {
      played: 0,
      won: 0,
      lost: 0,
      drawn: 0,
    });
  }

  for (const match of matches) {
    const sides = [String(match.teamA), String(match.teamB)];

    for (const side of sides) {
      const record = records.get(side);

      if (!record) {
        continue;
      }

      record.played += 1;

      if (!match.winnerTeam) {
        // No winner recorded - a draw, tie or abandoned game.
        record.drawn += 1;
      } else if (String(match.winnerTeam) === side) {
        record.won += 1;
      } else {
        record.lost += 1;
      }
    }
  }

  const ranked = teams
    .map((team) => {
      const record = records.get(String(team._id));

      const points = record.won * 3 + record.drawn;

      const winPercentage =
        record.played > 0
          ? Number(((record.won / record.played) * 100).toFixed(1))
          : 0;

      return {
        team: {
          _id: team._id,
          teamName: team.teamName,
          shortName: team.shortName,
          logo: team.logo,
          city: team.city,
          state: team.state,
          country: team.country,
          teamType: team.teamType,
          rating: team.rating,
          reviewCount: team.reviewCount,
          followersCount: team.followersCount,
          squadSize: Array.isArray(team.players) ? team.players.length : 0,
        },

        played: record.played,
        won: record.won,
        lost: record.lost,
        drawn: record.drawn,
        points,
        winPercentage,
      };
    })
    .filter((row) => row.played >= minMatches)
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.winPercentage - a.winPercentage ||
        b.played - a.played,
    )
    .slice(0, limit);

  return ranked.map((row, index) => ({
    rank: index + 1,
    ...row,
  }));
};

/*
|--------------------------------------------------------------------------
| Filter Options
|--------------------------------------------------------------------------
|
| The cities, states and countries that actually have teams, so the filter
| offers real choices instead of a free-text box that silently matches
| nothing when it is spelled differently.
|
*/

export const getFilterOptions = async () => {
  const [cities, states, countries] = await Promise.all([
    Team.distinct("city", { isActive: true, city: { $nin: ["", null] } }),
    Team.distinct("state", { isActive: true, state: { $nin: ["", null] } }),
    Team.distinct("country", { isActive: true, country: { $nin: ["", null] } }),
  ]);

  return {
    cities: cities.sort(),

    states: states.sort(),

    countries: countries.sort(),

    ballTypes: ["Leather", "Tennis", "Other"],

    matchTypes: ["T5", "T10", "T20", "ODI", "Test"],

    teamTypes: ["Club", "Corporate", "Academy", "Friends", "School", "College"],
  };
};
