import mongoose from "mongoose";

import Scoring from "../scoring/scoring.model";
import Match from "../matches/match.model";
import Player from "./player.model";

/*
|--------------------------------------------------------------------------
| Career Statistics
|--------------------------------------------------------------------------
|
| WHY THE PROFILE SHOWED ZEROES
|
| Every profile screen in the app reads `Player.stats` - a persisted object
| on the Player document with totalMatches, runs, wickets and the rest. That
| object has a default of 0 for every field, and NOTHING IN THE CODEBASE
| EVER WROTE TO IT. ProfileScreen even carried a comment pointing at
| "updatePlayerStatsOnMatchComplete (player.stats.service.ts)" - a function
| that did not exist. This file held one read-only helper, reachable through
| GET /players/:id/stats, which no screen ever called.
|
| So the profile was not failing to refresh. It was reading a field that had
| never been anything but zero, and it would have kept reading zero however
| many matches were played.
|
| THE RULE THIS IMPLEMENTS
|
| A match in progress must not move anybody's career figures; a match that
| has finished must. Both halves come from one decision: **only matches with
| status "completed" are counted, ever.** A live match contributes nothing
| because it is not in the input set, and the moment it completes it is.
|
| RECOMPUTED, NEVER INCREMENTED
|
| The obvious implementation - add this match's numbers to the stored totals
| when it ends - is wrong here, and dangerously so. finalizeMatchFromInnings
| can run more than once on the same match: undoing the ball that ended a
| match now reopens it (see undoLastBall), and the next ball finalises it
| again. An incremental update would count that match twice, and there would
| be no way to tell afterwards.
|
| Recomputing from the ball data is idempotent. Running it twice produces
| the same answer, running it after an undo produces the corrected answer,
| and a bug in one match's numbers cannot become permanent - it is fixed the
| next time anything recomputes.
|
| WRITTEN AND ALSO COMPUTED ON READ
|
| computeCareerStats is the single source of truth. It is used twice:
|
|   - persisted into Player.stats when a match completes, so the field stops
|     being a lie and future leaderboards have something to sort on;
|   - and called directly by the profile endpoints, so a player sees correct
|     figures immediately without waiting for their next match to end. That
|     matters right now: every match completed before this file existed left
|     nothing behind to read.
|
*/

const NOT_BATTER_RUNS = ["wide", "bye", "legBye"];

// Byes and leg byes are the batting side's runs, not the bowler's fault.
const NOT_BOWLER_RUNS = ["bye", "legBye"];

const normalise = (value: any) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/*
| What the batter scored off this delivery.
|
| Balls recorded before `batsmanRuns` existed do not carry it, so it is
| derived the same way the server would have rather than read as 0 - which
| would silently erase every run scored before that field was added.
*/

const batterRunsOf = (ball: any) => {
  if (typeof ball.batsmanRuns === "number") return ball.batsmanRuns;

  return NOT_BATTER_RUNS.includes(ball.extraType) ? 0 : ball.runs || 0;
};

const bowlerRunsOf = (ball: any) => {
  if (NOT_BOWLER_RUNS.includes(ball.extraType)) return 0;

  return ball.teamRuns ?? ball.runs ?? 0;
};

export type CareerStats = {
  totalMatches: number;
  innings: number;
  runs: number;
  ballsFaced: number;
  highestScore: number;
  strikeRate: number;
  average: number;
  fours: number;
  sixes: number;
  wickets: number;
  overs: number;
  economy: number;
  maidens: number;
  catches: number;
  stumpings: number;
  runOuts: number;
  playerOfMatch: number;
  bestBowling: string;
};

const emptyStats = (): CareerStats => ({
  totalMatches: 0,
  innings: 0,
  runs: 0,
  ballsFaced: 0,
  highestScore: 0,
  strikeRate: 0,
  average: 0,
  fours: 0,
  sixes: 0,
  wickets: 0,
  overs: 0,
  economy: 0,
  maidens: 0,
  catches: 0,
  stumpings: 0,
  runOuts: 0,
  playerOfMatch: 0,
  bestBowling: "",
});

const round2 = (n: number) => Number(n.toFixed(2));

/*
|--------------------------------------------------------------------------
| Compute
|--------------------------------------------------------------------------
|
| Returns a map of playerId -> CareerStats. Every id asked for gets an
| entry, zeroed if they have never played a completed match, so a caller
| never has to distinguish "no data" from "not computed".
|
*/

export const computeCareerStats = async (
  playerIds: any[],
): Promise<Map<string, CareerStats>> => {
  const ids = [...new Set((playerIds || []).map(String))].filter(Boolean);

  const out = new Map<string, CareerStats>();

  for (const id of ids) out.set(id, emptyStats());

  if (ids.length === 0) return out;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (objectIds.length === 0) return out;

  /*
  | THE ONE FILTER THAT MATTERS: status "completed".
  |
  | Scoped to matches these players were actually selected for, so this does
  | not walk every completed match in the database to answer a question
  | about eleven people.
  */

  const matches = await Match.find({
    status: "completed",
    $or: [
      { teamASquad: { $in: objectIds } },
      { teamBSquad: { $in: objectIds } },
    ],
  })
    .select("_id teamASquad teamBSquad playerOfTheMatch")
    .lean();

  if (matches.length === 0) return out;

  /*
  | Matches PLAYED, from the squads - not from the ball data.
  |
  | A number eleven who was not needed and a fielder who did not bowl both
  | played the match. Counting appearances from deliveries would leave them
  | on zero matches after a season.
  */

  for (const match of matches as any[]) {
    const squad = new Set(
      [...(match.teamASquad || []), ...(match.teamBSquad || [])].map(String),
    );

    for (const id of ids) {
      if (squad.has(id)) out.get(id)!.totalMatches += 1;
    }

    const award = match.playerOfTheMatch ? String(match.playerOfTheMatch) : "";

    if (award && out.has(award)) out.get(award)!.playerOfMatch += 1;
  }

  const balls = await Scoring.find({
    matchId: { $in: matches.map((m: any) => m._id) },
  }).lean();

  /*
  | Per-innings accumulators, needed for the three figures that are not
  | simple sums: a highest score, a best bowling analysis and a maiden all
  | belong to one innings (a maiden, to one over of one innings).
  */

  const battingByInnings = new Map<string, number>();
  const bowlingByInnings = new Map<
    string,
    { wickets: number; runs: number }
  >();
  const overRuns = new Map<string, { runs: number; legal: number }>();
  const dismissals = new Map<string, number>();

  for (const ball of balls as any[]) {
    // ── Batting ──────────────────────────────────────────────────────
    const batsmanId = ball.batsmanId ? String(ball.batsmanId) : "";

    if (batsmanId && out.has(batsmanId)) {
      const row = out.get(batsmanId)!;
      const runs = batterRunsOf(ball);

      row.runs += runs;

      /*
      | Balls faced excludes wides - the batter had no chance to play at
      | one - but INCLUDES no-balls, which he did face. Retirements and
      | penalties never reach here: neither carries a batsmanId.
      */
      if (ball.extraType !== "wide") row.ballsFaced += 1;

      if (runs === 4) row.fours += 1;
      if (runs === 6) row.sixes += 1;

      const key = `${batsmanId}|${ball.inningsId}`;
      battingByInnings.set(key, (battingByInnings.get(key) || 0) + runs);
    }

    // ── Bowling ──────────────────────────────────────────────────────
    const bowlerId = ball.bowlerId ? String(ball.bowlerId) : "";

    if (bowlerId && out.has(bowlerId)) {
      const row = out.get(bowlerId)!;
      const conceded = bowlerRunsOf(ball);
      const legal = ball.isLegalDelivery !== false;

      if (legal) row.overs += 1; // balls for now; converted below
      row.economy += conceded; // runs conceded for now; converted below

      const took = ball.isWicket && ball.bowlerCredit !== false;

      if (took) row.wickets += 1;

      const spellKey = `${bowlerId}|${ball.inningsId}`;
      const spell = bowlingByInnings.get(spellKey) || { wickets: 0, runs: 0 };
      spell.wickets += took ? 1 : 0;
      spell.runs += conceded;
      bowlingByInnings.set(spellKey, spell);

      const overKey = `${bowlerId}|${ball.inningsId}|${ball.over}`;
      const over = overRuns.get(overKey) || { runs: 0, legal: 0 };
      over.runs += conceded;
      over.legal += legal ? 1 : 0;
      overRuns.set(overKey, over);
    }

    // ── Fielding ─────────────────────────────────────────────────────
    if (ball.isWicket) {
      const type = normalise(ball.wicketType);
      const fielderId = ball.fielderId ? String(ball.fielderId) : "";

      if (fielderId && out.has(fielderId)) {
        const row = out.get(fielderId)!;

        if (type.startsWith("caught")) row.catches += 1;
        else if (type === "stumped") row.stumpings += 1;
        else if (type === "runout") row.runOuts += 1;
      }

      /*
      | Dismissals, for the batting average. Retired hurt is stored with
      | isWicket false, so it correctly never counts as being out.
      */
      const outId = ball.dismissedPlayerId
        ? String(ball.dismissedPlayerId)
        : batsmanId;

      if (outId && out.has(outId)) {
        dismissals.set(outId, (dismissals.get(outId) || 0) + 1);
      }
    }
  }

  // ── Innings, highest score ─────────────────────────────────────────
  for (const [key, runs] of battingByInnings) {
    const [playerId] = key.split("|");
    const row = out.get(playerId);

    if (!row) continue;

    row.innings += 1;

    if (runs > row.highestScore) row.highestScore = runs;
  }

  // ── Best bowling ───────────────────────────────────────────────────
  const best = new Map<string, { wickets: number; runs: number }>();

  for (const [key, spell] of bowlingByInnings) {
    const [playerId] = key.split("|");

    const current = best.get(playerId);

    // More wickets wins; on equal wickets, fewer runs wins.
    const better =
      !current ||
      spell.wickets > current.wickets ||
      (spell.wickets === current.wickets && spell.runs < current.runs);

    if (better) best.set(playerId, spell);
  }

  // ── Maidens ────────────────────────────────────────────────────────
  for (const [key, over] of overRuns) {
    const [playerId] = key.split("|");
    const row = out.get(playerId);

    // A maiden is a COMPLETED over of six legal balls that cost nothing.
    if (row && over.runs === 0 && over.legal >= 6) row.maidens += 1;
  }

  // ── Derived figures ────────────────────────────────────────────────
  for (const [playerId, row] of out) {
    const ballsBowled = row.overs; // still a ball count at this point
    const runsConceded = row.economy; // still a run total at this point

    /*
    | Overs in cricket notation: 12.3 is twelve overs and three balls, not
    | twelve and a third. Storing balls/6 as a decimal would print 12.5 for
    | a figure every reader would take to mean 12.3.
    */
    row.overs = Math.floor(ballsBowled / 6) + (ballsBowled % 6) / 10;

    row.economy =
      ballsBowled > 0 ? round2(runsConceded / (ballsBowled / 6)) : 0;

    row.strikeRate =
      row.ballsFaced > 0 ? round2((row.runs / row.ballsFaced) * 100) : 0;

    /*
    | A batter who has never been out has no average in the usual sense -
    | dividing by zero. Cricket shows their runs with an asterisk; here the
    | runs stand in, which is the closest honest number.
    */
    const timesOut = dismissals.get(playerId) || 0;

    row.average = timesOut > 0 ? round2(row.runs / timesOut) : row.runs;

    const bb = best.get(playerId);

    row.bestBowling = bb && ballsBowled > 0 ? `${bb.wickets}/${bb.runs}` : "";
  }

  return out;
};

/*
|--------------------------------------------------------------------------
| Persist
|--------------------------------------------------------------------------
|
| Called when a match completes, and again if an undo reopens it. Writes the
| recomputed figures for every player who was in either squad.
|
| Never throws into its caller. A statistics write must not be able to stop
| a match from being marked completed - the result is the important thing,
| and the stats can be recomputed at any time from data that is already
| safely stored.
|
*/

export const recomputePlayerStats = async (playerIds: any[]) => {
  try {
    const stats = await computeCareerStats(playerIds);

    await Promise.all(
      [...stats.entries()].map(([playerId, value]) =>
        Player.findByIdAndUpdate(playerId, { stats: value }),
      ),
    );
  } catch (error: any) {
    console.error("[stats] recompute failed:", error?.message);
  }
};

export const recomputePlayerStatsForMatch = async (matchId: any) => {
  try {
    const match = await Match.findById(matchId)
      .select("teamASquad teamBSquad")
      .lean();

    if (!match) return;

    await recomputePlayerStats([
      ...((match as any).teamASquad || []),
      ...((match as any).teamBSquad || []),
    ]);
  } catch (error: any) {
    console.error("[stats] recompute for match failed:", error?.message);
  }
};

/*
|--------------------------------------------------------------------------
| Match History
|--------------------------------------------------------------------------
|
| MatchesTab on the profile renders `profile.matches` - a field that exists
| on no schema anywhere. It was always undefined, so the tab always said
| "No Matches Found" and always would have.
|
| Filled here from the same completed-match set the statistics use, so the
| tab and the numbers above it can never disagree about what counts.
|
| Capped, and newest first: a profile is a summary, not an archive.
|
*/

export const getPlayerMatchHistory = async (playerId: any, limit = 20) => {
  if (!playerId || !mongoose.Types.ObjectId.isValid(String(playerId))) {
    return [];
  }

  const id = new mongoose.Types.ObjectId(String(playerId));

  return await Match.find({
    status: "completed",
    $or: [{ teamASquad: id }, { teamBSquad: id }],
  })
    .select(
      "matchTitle matchType overs venueName teamA teamB winnerTeam result startTime endTime status playerOfTheMatch playerOfTheMatchStats",
    )
    .populate("teamA", "teamName shortName logo")
    .populate("teamB", "teamName shortName logo")
    .populate("winnerTeam", "teamName shortName logo")
    .populate("playerOfTheMatch", "playerName profileImage")
    .sort({ endTime: -1, startTime: -1 })
    .limit(Math.min(Math.max(limit, 1), 50))
    .lean();
};

/*
|--------------------------------------------------------------------------
| One Player, For The Profile Endpoints
|--------------------------------------------------------------------------
*/

export const getCareerStats = async (playerId: any): Promise<CareerStats> => {
  const stats = await computeCareerStats([playerId]);

  return stats.get(String(playerId)) || emptyStats();
};

/*
| The shape GET /players/:playerId/stats has always returned, kept so the
| endpoint's contract does not change - but now over COMPLETED matches only,
| the same rule as everywhere else. It used to count live matches too, so
| the one screen that called it would have disagreed with the profile.
*/

export const getPlayerStats = async (playerId: string) => {
  const s = await getCareerStats(playerId);

  const ballsBowled =
    Math.floor(s.overs) * 6 + Math.round((s.overs % 1) * 10);

  return {
    runs: s.runs,
    ballsFaced: s.ballsFaced,
    fours: s.fours,
    sixes: s.sixes,
    wickets: s.wickets,
    runsConceded: ballsBowled > 0 ? Math.round(s.economy * (ballsBowled / 6)) : 0,
    ballsBowled,
    strikeRate: s.strikeRate,
    economy: s.economy,
  };
};
