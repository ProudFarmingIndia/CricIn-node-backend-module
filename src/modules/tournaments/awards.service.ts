/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| awards.service.ts
|
| Description:
| Every countable award, counted from the ball-by-ball record.
|
| WHY THIS IS ONE AGGREGATION AND NOT TEN
| Ten awards over the same deliveries is ten passes over the same
| collection. A six-week tournament is tens of thousands of Scoring rows,
| and the awards tab is opened constantly once the semi-finals are near.
| So batting, bowling, fielding and the per-innings maxima come out of
| three aggregations total, and everything else is arithmetic on the
| result.
|
| WHY IT IS COMPUTED AND NOT STORED
| Same reason the points table is recomputed rather than incremented: a
| scorer undoes balls. An incremented "sixes" counter drifts the first
| time somebody presses undo on a six, and it drifts silently - nothing
| ever tells you the leaderboard is wrong, it just is. Recomputing is
| slower and always right, and "always right" is the only acceptable
| answer for a number somebody is being handed money against.
|
| WHY BOUNDARIES ARE DERIVED FROM batsmanRuns
| There is no isFour / isSix flag on a delivery, and adding one would only
| be true for balls bowled after the migration. batsmanRuns is what the
| batter actually scored off the bat - already computed on the server,
| already correct for overthrows and wides - so a four is batsmanRuns === 4
| and a six is batsmanRuns === 6. Runs taken by running are 1, 2 or 3 and
| never collide with it.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import Match from "../matches/match.model";
import Player from "../players/player.model";

import { AWARD_METRICS, awardMetric } from "./tournament.constants";

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

export interface LeaderRow {
  playerId: string;
  name: string;
  profileImage?: string | null;
  value: number;
  /* "214 runs", "8.4 SR", "3/24" - already formatted for display. */
  display: string;
  /* Everything the stats tab wants to show next to the headline number. */
  meta?: Record<string, number>;
}

/*
|--------------------------------------------------------------------------
| Match scope
|--------------------------------------------------------------------------
|
| Only COMPLETED matches count. A match in progress has a leader who
| changes every over, and a leaderboard that reshuffles while you look at
| it reads as broken rather than live. Abandoned and cancelled matches are
| excluded for the obvious reason.
|
*/

const completedMatchIds = async (filter: Record<string, any>) => {
  const matches: any[] = await Match.find({ ...filter, status: "completed" })
    .select("_id playerOfTheMatch")
    .lean();

  return matches;
};

/*
|--------------------------------------------------------------------------
| The three aggregations
|--------------------------------------------------------------------------
*/

const battingBoard = async (Scoring: any, matchIds: any[]) =>
  Scoring.aggregate([
    { $match: { matchId: { $in: matchIds }, batsmanId: { $ne: null } } },
    {
      $group: {
        _id: "$batsmanId",

        runs: { $sum: { $ifNull: ["$batsmanRuns", 0] } },

        /*
        | A ball faced is a LEGAL delivery. A wide is not faced by anyone
        | and counting it would deflate every strike rate in the
        | tournament by a few points.
        */
        balls: {
          $sum: { $cond: [{ $ne: ["$isLegalDelivery", false] }, 1, 0] },
        },

        fours: {
          $sum: { $cond: [{ $eq: ["$batsmanRuns", 4] }, 1, 0] },
        },

        sixes: {
          $sum: { $cond: [{ $eq: ["$batsmanRuns", 6] }, 1, 0] },
        },
      },
    },
  ]);

const bowlingBoard = async (Scoring: any, matchIds: any[]) =>
  Scoring.aggregate([
    { $match: { matchId: { $in: matchIds }, bowlerId: { $ne: null } } },
    {
      $group: {
        _id: "$bowlerId",

        /*
        | A wicket only counts for the bowler when bowlerCredit is true -
        | a run out is a wicket that is nobody's bowling figure. The field
        | already exists and defaults to true, so this is just honouring
        | it instead of counting every dismissal.
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

        /* Legal deliveries only - a wide is not a ball of the over. */
        balls: {
          $sum: { $cond: [{ $ne: ["$isLegalDelivery", false] }, 1, 0] },
        },

        /*
        | Runs conceded includes the extras the bowler is charged for
        | (wides and no-balls) but not byes and leg byes, which are the
        | keeper's problem. teamRuns minus bye-type extras is the closest
        | this schema gets, and it is what the scorecard already shows.
        */
        conceded: {
          $sum: {
            $cond: [
              { $in: ["$extraType", ["bye", "leg-bye", "legbye"]] },
              0,
              { $ifNull: ["$teamRuns", { $ifNull: ["$runs", 0] }] },
            ],
          },
        },
      },
    },
  ]);

const fieldingBoard = async (Scoring: any, matchIds: any[]) =>
  Scoring.aggregate([
    {
      $match: {
        matchId: { $in: matchIds },
        isWicket: true,
        fielderId: { $ne: null },
      },
    },
    {
      $group: {
        _id: "$fielderId",

        /*
        | wicketType is free text on the schema, so it is matched loosely
        | rather than against an enum that does not exist. "Caught",
        | "caught behind" and "c & b" all contain "caught"; "run out",
        | "runout" and "Run Out" all normalise the same way.
        */
        catches: {
          $sum: {
            $cond: [
              {
                $regexMatch: {
                  input: { $toLower: { $ifNull: ["$wicketType", ""] } },
                  regex: "caught|catch",
                },
              },
              1,
              0,
            ],
          },
        },

        runOuts: {
          $sum: {
            $cond: [
              {
                $regexMatch: {
                  input: { $toLower: { $ifNull: ["$wicketType", ""] } },
                  regex: "run.?out",
                },
              },
              1,
              0,
            ],
          },
        },

        stumpings: {
          $sum: {
            $cond: [
              {
                $regexMatch: {
                  input: { $toLower: { $ifNull: ["$wicketType", ""] } },
                  regex: "stump",
                },
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

/*
| Per-innings maxima - "highest individual score" and "best bowling
| figures" are about one innings, not a tournament total, so they need
| their own grouping by (player, match).
*/

const bestInningsBoards = async (Scoring: any, matchIds: any[]) => {
  const knocks = await Scoring.aggregate([
    { $match: { matchId: { $in: matchIds }, batsmanId: { $ne: null } } },
    {
      $group: {
        _id: { player: "$batsmanId", match: "$matchId" },
        runs: { $sum: { $ifNull: ["$batsmanRuns", 0] } },
        balls: {
          $sum: { $cond: [{ $ne: ["$isLegalDelivery", false] }, 1, 0] },
        },
      },
    },
    { $sort: { runs: -1 } },
    { $group: { _id: "$_id.player", runs: { $first: "$runs" }, balls: { $first: "$balls" } } },
  ]);

  const spells = await Scoring.aggregate([
    { $match: { matchId: { $in: matchIds }, bowlerId: { $ne: null } } },
    {
      $group: {
        _id: { player: "$bowlerId", match: "$matchId" },
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
        conceded: {
          $sum: {
            $cond: [
              { $in: ["$extraType", ["bye", "leg-bye", "legbye"]] },
              0,
              { $ifNull: ["$teamRuns", { $ifNull: ["$runs", 0] }] },
            ],
          },
        },
      },
    },

    /*
    | Sorted by wickets first and runs SECOND, ascending - because 4/18 is
    | a better spell than 4/52, and sorting on wickets alone would pick
    | whichever of the two Mongo happened to return first.
    */
    { $sort: { wickets: -1, conceded: 1 } },
    {
      $group: {
        _id: "$_id.player",
        wickets: { $first: "$wickets" },
        conceded: { $first: "$conceded" },
      },
    },
  ]);

  return { knocks, spells };
};

/*
|--------------------------------------------------------------------------
| Leaderboards
|--------------------------------------------------------------------------
|
| Builds every board in one go for a set of matches. Used by tournaments
| and by series - both hand it a match filter and get back the same shape,
| which is why it takes a filter rather than a tournamentId.
|
*/

export const buildLeaderboards = async (
  matchFilter: Record<string, any>,
): Promise<Record<string, LeaderRow[]>> => {
  const matches = await completedMatchIds(matchFilter);

  const empty: Record<string, LeaderRow[]> = {};

  for (const m of AWARD_METRICS) {
    if (m.computed) empty[m.key] = [];
  }

  if (!matches.length) return empty;

  const matchIds = matches.map((m) => m._id);

  /* Imported here rather than at module load - scoring imports matches,
     and a top-level import both ways is a cycle. */
  const Scoring = (await import("../scoring/scoring.model")).default;

  const [batting, bowling, fielding, best] = await Promise.all([
    battingBoard(Scoring, matchIds),
    bowlingBoard(Scoring, matchIds),
    fieldingBoard(Scoring, matchIds),
    bestInningsBoards(Scoring, matchIds),
  ]);

  /* Player of the Match counts come off the matches themselves. */

  const potmCount = new Map<string, number>();

  for (const m of matches) {
    if (!m.playerOfTheMatch) continue;

    const id = String(m.playerOfTheMatch);

    potmCount.set(id, (potmCount.get(id) ?? 0) + 1);
  }

  /* One name lookup for every player who appears on any board. */

  const ids = new Set<string>();

  const collect = (rows: any[]) =>
    rows.forEach((r) => r._id && ids.add(String(r._id)));

  collect(batting);
  collect(bowling);
  collect(fielding);
  collect(best.knocks);
  collect(best.spells);
  potmCount.forEach((_v, k) => ids.add(k));

  const players: any[] = await Player.find({
    _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select("playerName profileImage")
    .lean();

  const byId = new Map(players.map((p) => [String(p._id), p]));

  const row = (
    playerId: any,
    value: number,
    display: string,
    meta?: Record<string, number>,
  ): LeaderRow => {
    const p = byId.get(String(playerId));

    return {
      playerId: String(playerId),
      name: p?.playerName ?? "Player",
      profileImage: p?.profileImage ?? null,
      value,
      display,
      ...(meta ? { meta } : {}),
    };
  };

  const top = (rows: LeaderRow[], direction: string) =>
    rows
      .sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value))
      .slice(0, 10);

  const oversOf = (balls: number) =>
    `${Math.floor(balls / 6)}.${balls % 6}`;

  const boards: Record<string, LeaderRow[]> = {
    most_runs: top(
      batting
        .filter((b: any) => b.runs > 0)
        .map((b: any) =>
          row(b._id, b.runs, `${b.runs}`, {
            balls: b.balls,
            fours: b.fours,
            sixes: b.sixes,
            strikeRate: b.balls
              ? Number(((b.runs / b.balls) * 100).toFixed(1))
              : 0,
          }),
        ),
      "desc",
    ),

    most_wickets: top(
      bowling
        .filter((b: any) => b.wickets > 0)
        .map((b: any) =>
          row(b._id, b.wickets, `${b.wickets}`, {
            balls: b.balls,
            conceded: b.conceded,
            economy: b.balls
              ? Number(((b.conceded / b.balls) * 6).toFixed(2))
              : 0,
          }),
        ),
      "desc",
    ),

    most_sixes: top(
      batting
        .filter((b: any) => b.sixes > 0)
        .map((b: any) => row(b._id, b.sixes, `${b.sixes}`)),
      "desc",
    ),

    most_fours: top(
      batting
        .filter((b: any) => b.fours > 0)
        .map((b: any) => row(b._id, b.fours, `${b.fours}`)),
      "desc",
    ),

    most_catches: top(
      fielding
        .filter((f: any) => f.catches > 0)
        .map((f: any) =>
          row(f._id, f.catches, `${f.catches}`, {
            runOuts: f.runOuts,
            stumpings: f.stumpings,
          }),
        ),
      "desc",
    ),

    highest_score: top(
      best.knocks
        .filter((k: any) => k.runs > 0)
        .map((k: any) => row(k._id, k.runs, `${k.runs} (${k.balls})`)),
      "desc",
    ),

    best_bowling: top(
      best.spells
        .filter((s: any) => s.wickets > 0)
        .map((s: any) =>
          /*
          | Ranked on wickets, but a five-for for 20 must beat a five-for
          | for 60. Runs conceded are folded in as a small decimal
          | penalty, which orders them correctly without ever letting a
          | 4-for outrank a 5-for: the penalty is capped below 1.
          */
          row(
            s._id,
            s.wickets + Math.max(0, 1 - s.conceded / 200) * 0.9,
            `${s.wickets}/${s.conceded}`,
            { wickets: s.wickets, conceded: s.conceded },
          ),
        ),
      "desc",
    ),

    best_strike_rate: top(
      batting
        .filter((b: any) => b.balls >= 30)
        .map((b: any) =>
          row(
            b._id,
            Number(((b.runs / b.balls) * 100).toFixed(1)),
            `${((b.runs / b.balls) * 100).toFixed(1)}`,
            { runs: b.runs, balls: b.balls },
          ),
        ),
      "desc",
    ),

    best_economy: top(
      bowling
        .filter((b: any) => b.balls >= 60)
        .map((b: any) =>
          row(
            b._id,
            Number(((b.conceded / b.balls) * 6).toFixed(2)),
            `${((b.conceded / b.balls) * 6).toFixed(2)}`,
            { overs: Number(oversOf(b.balls)), conceded: b.conceded },
          ),
        ),
      "asc",
    ),

    most_potm: top(
      [...potmCount.entries()].map(([id, n]) => row(id, n, `${n}`)),
      "desc",
    ),
  };

  return { ...empty, ...boards };
};

/*
|--------------------------------------------------------------------------
| Resolve winners
|--------------------------------------------------------------------------
|
| Attaches a winner to each award the organizer configured.
|
| Precedence, highest first:
|
|   1  an organizer override    they picked somebody, that is final
|   2  the computed leader      for a countable award with data
|   3  nothing                  shown as "Abhi decide nahi hua"
|
| A non-computed award with no override has no winner and says so, rather
| than borrowing a number from a board it has nothing to do with.
|
*/

export const resolveAwards = async (
  awards: any[],
  matchFilter: Record<string, any>,
) => {
  if (!awards?.length) return { awards: [], leaderboards: {} };

  const leaderboards = await buildLeaderboards(matchFilter);

  /* Manual picks need names too, and they are not on any board. */

  const manualIds = awards
    .filter((a) => a.winnerPlayerId)
    .map((a) => String(a.winnerPlayerId));

  const manualPlayers: any[] = manualIds.length
    ? await Player.find({
        _id: { $in: manualIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select("playerName profileImage")
        .lean()
    : [];

  const manualById = new Map(manualPlayers.map((p) => [String(p._id), p]));

  const resolved = awards.map((a: any) => {
    const meta = awardMetric(a.metric);

    const board = leaderboards[a.metric] ?? [];

    const computedLeader = meta?.computed ? board[0] ?? null : null;

    const override = a.winnerPlayerId
      ? (() => {
          const p = manualById.get(String(a.winnerPlayerId));

          /*
          | An overridden computed award keeps the player's real number
          | from the board, so "Most Runs - Rahul, 198" stays true even
          | though a human picked Rahul.
          */
          const onBoard = board.find(
            (r) => String(r.playerId) === String(a.winnerPlayerId),
          );

          return {
            playerId: String(a.winnerPlayerId),
            name: p?.playerName ?? "Player",
            profileImage: p?.profileImage ?? null,
            value: onBoard?.value ?? 0,
            display: onBoard?.display ?? "",
          };
        })()
      : null;

    return {
      metric: a.metric,
      label: a.label || meta?.label || "Award",
      amount: a.amount ?? 0,
      description: a.description ?? "",

      computed: !!meta?.computed,
      unit: (meta as any)?.unit ?? null,
      icon: (meta as any)?.icon ?? "trophy",
      hint: (meta as any)?.hint ?? "",
      qualifierLabel: (meta as any)?.qualifierLabel ?? null,

      /* Who decided it, so the app can say "organiser ne chuna". */
      decidedBy: override ? "organizer" : computedLeader ? "app" : null,

      winner: override ?? computedLeader,

      /* Runners-up, for the "who else is close" strip. */
      contenders: meta?.computed ? board.slice(0, 5) : [],
    };
  });

  return { awards: resolved, leaderboards };
};
