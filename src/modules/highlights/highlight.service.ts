import Match from "../matches/match.model";
import Innings from "../scoring/innings.model";
import Scoring from "../scoring/scoring.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";

/*
|--------------------------------------------------------------------------
| Highlights
|--------------------------------------------------------------------------
|
| Best moments and achievements, derived entirely from the ball-by-ball
| data that scoring already writes. No video, no uploads, nothing for a
| user to curate - the feed fills itself the moment anyone scores a match.
|
| WHY THIS IS COMPUTED, NOT STORED
| Player.stats is all zeroes because nothing writes to it, so anything read
| from there would be empty. The Scoring collection, by contrast, has a
| document per delivery with the batsman, the bowler, the runs and whether
| it was a wicket - which is everything a highlight needs. Deriving from
| balls is also the more honest number: a denormalised counter can drift
| away from what actually happened, an aggregation cannot.
|
| RANKING
| Every candidate moment gets a weight, and the feed is the top N by
| weight. The weights are deliberately far apart rather than finely tuned:
| a century must always outrank a six, and no amount of sixes should push a
| five-wicket haul off the list. Within a type, the actual number breaks
| ties, so a 140 outranks a 101.
|
*/

const WEIGHTS = {
  HAT_TRICK: 300,
  DOUBLE_HUNDRED: 280,
  HUNDRED: 250,
  FIVE_WICKET: 240,
  FOUR_WICKET: 180,
  FIFTY: 150,
  MATCH_RESULT: 90,
  WICKET: 40,
  SIX: 30,
};

export type HighlightRange = "today" | "week" | "month" | "all";

/*
|--------------------------------------------------------------------------
| Date Window
|--------------------------------------------------------------------------
|
| "today" is the start of the calendar day, not the last 24 hours - someone
| opening the app at 9am wants this morning's match, not yesterday
| evening's.
|
*/

const startOfRange = (range: HighlightRange): Date | null => {
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
| Which Matches Are In Scope
|--------------------------------------------------------------------------
|
| A match is dated by startTime when it has one and createdAt otherwise -
| a match created weeks ago but played today belongs in today's feed, and
| one that never started has only its creation date to go on.
|
*/

const resolveMatches = async (options: {
  matchId?: string;
  range?: HighlightRange;
  city?: string;
  state?: string;
  country?: string;
}) => {
  if (options.matchId) {
    const match = await Match.findById(options.matchId)
      .populate("teamA", "teamName shortName logo")
      .populate("teamB", "teamName shortName logo");

    return match ? [match] : [];
  }

  const query: any = {
    status: { $in: ["live", "completed"] },
  };

  const since = startOfRange(options.range || "week");

  if (since) {
    query.$or = [
      { startTime: { $gte: since } },
      { startTime: null, createdAt: { $gte: since } },
    ];
  }

  /*
  | Location filters are applied to the TEAMS, then matches are narrowed to
  | those involving one. Filtering the match directly is not possible -
  | a match has no city of its own, only the teams playing in it do.
  */

  const locationFilter: any = {};

  if (options.city) {
    locationFilter.city = new RegExp(`^${options.city}$`, "i");
  }

  if (options.state) {
    locationFilter.state = new RegExp(`^${options.state}$`, "i");
  }

  if (options.country) {
    locationFilter.country = new RegExp(`^${options.country}$`, "i");
  }

  if (Object.keys(locationFilter).length > 0) {
    const teams = await Team.find(locationFilter).select("_id");

    const teamIds = teams.map((t) => t._id);

    if (teamIds.length === 0) {
      return [];
    }

    query.$and = [
      {
        $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
      },
    ];
  }

  return await Match.find(query)
    .populate("teamA", "teamName shortName logo")
    .populate("teamB", "teamName shortName logo")
    .sort({ startTime: -1, createdAt: -1 })
    .limit(200);
};

/*
|--------------------------------------------------------------------------
| Batting Achievements
|--------------------------------------------------------------------------
|
| Grouped per innings, not per match: a batsman's fifty is a fifty in that
| innings. Grouping by match would silently merge both innings of a
| two-innings game into one inflated score.
|
*/

const battingMoments = async (matchIds: any[]) => {
  const rows = await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        batsmanId: { $ne: null },
      },
    },

    {
      $group: {
        _id: { matchId: "$matchId", inningsId: "$inningsId", batsmanId: "$batsmanId" },

        runs: { $sum: "$runs" },

        /*
        | Balls faced counts legal deliveries only - a wide is not a ball
        | faced, and counting it would understate every strike rate.
        */
        balls: {
          $sum: { $cond: [{ $eq: ["$isLegalDelivery", false] }, 0, 1] },
        },

        fours: { $sum: { $cond: [{ $eq: ["$runs", 4] }, 1, 0] } },

        sixes: { $sum: { $cond: [{ $eq: ["$runs", 6] }, 1, 0] } },
      },
    },

    { $match: { runs: { $gte: 50 } } },

    { $sort: { runs: -1 } },
  ]);

  return rows.map((row) => {
    const runs = row.runs;

    let type = "FIFTY";

    let weight = WEIGHTS.FIFTY;

    if (runs >= 200) {
      type = "DOUBLE_HUNDRED";
      weight = WEIGHTS.DOUBLE_HUNDRED;
    } else if (runs >= 100) {
      type = "HUNDRED";
      weight = WEIGHTS.HUNDRED;
    }

    return {
      type,

      matchId: row._id.matchId,

      playerId: row._id.batsmanId,

      runs,

      balls: row.balls,

      fours: row.fours,

      sixes: row.sixes,

      // Runs break ties within a type, so 140 sits above 101.
      weight: weight + runs,
    };
  });
};

/*
|--------------------------------------------------------------------------
| Bowling Achievements
|--------------------------------------------------------------------------
*/

const bowlingMoments = async (matchIds: any[]) => {
  const rows = await Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        bowlerId: { $ne: null },
      },
    },

    {
      $group: {
        _id: { matchId: "$matchId", inningsId: "$inningsId", bowlerId: "$bowlerId" },

        /*
        | bowlerCredit exists because not every wicket belongs to the
        | bowler - a run out is nobody's wicket. Counting raw isWicket
        | would hand the bowler credit for it.
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

        runsConceded: { $sum: "$teamRuns" },

        balls: {
          $sum: { $cond: [{ $eq: ["$isLegalDelivery", false] }, 0, 1] },
        },
      },
    },

    { $match: { wickets: { $gte: 4 } } },

    { $sort: { wickets: -1, runsConceded: 1 } },
  ]);

  return rows.map((row) => ({
    type: row.wickets >= 5 ? "FIVE_WICKET" : "FOUR_WICKET",

    matchId: row._id.matchId,

    playerId: row._id.bowlerId,

    wickets: row.wickets,

    runsConceded: row.runsConceded,

    balls: row.balls,

    weight:
      (row.wickets >= 5 ? WEIGHTS.FIVE_WICKET : WEIGHTS.FOUR_WICKET) +
      row.wickets * 5,
  }));
};

/*
|--------------------------------------------------------------------------
| Hat-Tricks
|--------------------------------------------------------------------------
|
| Three wickets on three consecutive deliveries BY THAT BOWLER - which is
| not the same as three consecutive deliveries in the innings, because a
| hat-trick can span two overs with the other bowler in between. So the
| check runs over each bowler's own ordered sequence of legal deliveries,
| not over the innings timeline.
|
*/

const hatTrickMoments = async (matchIds: any[]) => {
  const balls = await Scoring.find({
    matchId: { $in: matchIds },
    bowlerId: { $ne: null },
  })
    .select("matchId inningsId bowlerId over ball isWicket bowlerCredit isLegalDelivery")
    .sort({ matchId: 1, inningsId: 1, over: 1, ball: 1 })
    .lean();

  const sequences = new Map<string, any[]>();

  for (const ball of balls) {
    // A wide or no-ball does not break a hat-trick - it is not a delivery.
    if (ball.isLegalDelivery === false) {
      continue;
    }

    const key = `${ball.matchId}|${ball.inningsId}|${ball.bowlerId}`;

    if (!sequences.has(key)) {
      sequences.set(key, []);
    }

    sequences.get(key)!.push(ball);
  }

  const moments: any[] = [];

  for (const [key, sequence] of sequences) {
    let streak = 0;

    for (const ball of sequence) {
      const isBowlerWicket =
        ball.isWicket === true && ball.bowlerCredit !== false;

      streak = isBowlerWicket ? streak + 1 : 0;

      if (streak === 3) {
        const [matchId, , bowlerId] = key.split("|");

        moments.push({
          type: "HAT_TRICK",

          matchId,

          playerId: bowlerId,

          weight: WEIGHTS.HAT_TRICK,
        });

        // Four in four is still one hat-trick entry, not two.
        streak = 0;
      }
    }
  }

  return moments;
};

/*
|--------------------------------------------------------------------------
| Standout Individual Balls
|--------------------------------------------------------------------------
|
| Sixes and wickets, to fill the feed when there are no achievements to
| show - a Sunday friendly may contain neither a fifty nor a four-for, and
| an empty Highlights tab is worse than a modest one.
|
| Capped, because a season of matches contains thousands of these and they
| would otherwise all be loaded just to be discarded by the top-N cut.
|
*/

const ballMoments = async (matchIds: any[]) => {
  const balls = await Scoring.find({
    matchId: { $in: matchIds },
    $or: [{ runs: 6 }, { isWicket: true }],
  })
    .select("matchId batsmanId bowlerId runs isWicket wicketType commentaryText createdAt over ball")
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  return balls.map((ball) => {
    const isSix = ball.runs === 6 && !ball.isWicket;

    return {
      type: isSix ? "SIX" : "WICKET",

      matchId: ball.matchId,

      playerId: isSix ? ball.batsmanId : ball.bowlerId,

      over: ball.over,

      ballNumber: ball.ball,

      wicketType: ball.wicketType,

      commentary: ball.commentaryText,

      weight: isSix ? WEIGHTS.SIX : WEIGHTS.WICKET,
    };
  });
};

/*
|--------------------------------------------------------------------------
| Match Results
|--------------------------------------------------------------------------
*/

const resultMoments = (matches: any[]) =>
  matches
    .filter((m) => m.status === "completed" && m.winnerTeam)
    .map((m) => ({
      type: "MATCH_RESULT",

      matchId: m._id,

      playerId: null,

      winnerTeamId: m.winnerTeam,

      result: m.result || "",

      weight: WEIGHTS.MATCH_RESULT,
    }));

/*
|--------------------------------------------------------------------------
| Build The Feed
|--------------------------------------------------------------------------
*/

export const getHighlights = async (options: {
  matchId?: string;
  range?: HighlightRange;
  city?: string;
  state?: string;
  country?: string;
  limit?: number;
}) => {
  const limit = Math.min(Math.max(options.limit || 10, 1), 50);

  const matches = await resolveMatches(options);

  if (matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((m) => m._id);

  const matchById = new Map(matches.map((m) => [String(m._id), m]));

  const [batting, bowling, hatTricks, balls] = await Promise.all([
    battingMoments(matchIds),
    bowlingMoments(matchIds),
    hatTrickMoments(matchIds),
    ballMoments(matchIds),
  ]);

  const candidates = [
    ...hatTricks,
    ...batting,
    ...bowling,
    ...balls,
    ...resultMoments(matches),
  ];

  /*
  | Cut to the top N BEFORE resolving player names, so a feed of ten rows
  | costs one small player lookup rather than one covering every six hit
  | this month.
  */

  candidates.sort((a, b) => b.weight - a.weight);

  const top = candidates.slice(0, limit);

  const playerIds = top.map((c) => c.playerId).filter(Boolean);

  const players = await Player.find({ _id: { $in: playerIds } }).select(
    "playerName profileImage playerType",
  );

  const playerById = new Map(players.map((p) => [String(p._id), p]));

  return top.map((moment, index) => {
    const match = matchById.get(String(moment.matchId));

    const player = moment.playerId
      ? playerById.get(String(moment.playerId))
      : null;

    return {
      id: `${moment.type}-${moment.matchId}-${moment.playerId || index}`,

      type: moment.type,

      rank: index + 1,

      player: player
        ? {
            _id: player._id,
            playerName: player.playerName,
            profileImage: player.profileImage,
          }
        : null,

      match: match
        ? {
            _id: match._id,
            matchTitle: match.matchTitle,
            teamA: match.teamA,
            teamB: match.teamB,
            status: match.status,
            startTime: match.startTime || (match as any).createdAt,
          }
        : null,

      /*
      | Every numeric field the row might need is passed through rather
      | than pre-formatted into a sentence here - the phrasing belongs to
      | the client, which knows how much space it has.
      */
      stats: {
        runs: (moment as any).runs,
        balls: (moment as any).balls,
        fours: (moment as any).fours,
        sixes: (moment as any).sixes,
        wickets: (moment as any).wickets,
        runsConceded: (moment as any).runsConceded,
        over: (moment as any).over,
        ballNumber: (moment as any).ballNumber,
        wicketType: (moment as any).wicketType,
        result: (moment as any).result,
        winnerTeamId: (moment as any).winnerTeamId,
      },

      commentary: (moment as any).commentary || "",
    };
  });
};
