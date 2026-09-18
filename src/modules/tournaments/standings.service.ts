/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| standings.service.ts
|
| Description:
| Points table and Net Run Rate.
|
| RECOMPUTED, NEVER INCREMENTED
| Every call rebuilds the whole table from the completed matches. That is
| more work than adding two points to a row, and it is the only version
| that is correct: undoing the last ball reopens a finished match, and
| finishing it again would add the same result twice with nothing in the
| data to show it had happened. Recomputing is idempotent - run it ten
| times, get the same table.
|
| It also means a bad row can be fixed by running this again, rather than
| by hand-editing numbers nobody can verify.
|
|--------------------------------------------------------------------------
*/

import Match from "../matches/match.model";
import Innings from "../scoring/innings.model";
import Tournament from "./tournament.model";
import TournamentTeam from "./tournamentTeam.model";

/*
|--------------------------------------------------------------------------
| Overs are not decimals
|--------------------------------------------------------------------------
|
| "12.3 overs" means 12 overs and 3 balls - 75 balls. It does NOT mean
| 12.3. Adding 12.3 + 12.3 and calling it 24.6 is wrong twice over: the
| real answer is 25.0, and 24.6 is not even a legal over count.
|
| So everything is accumulated in balls and converted back once, at the
| end, for display.
|
*/

export const oversToBalls = (overs: number): number => {
  const whole = Math.floor(overs);

  /* The .3 in 12.3 - rounded because floating point makes it 0.2999996. */
  const balls = Math.round((overs - whole) * 10);

  return whole * 6 + Math.min(balls, 5);
};

export const ballsToOvers = (balls: number): number => {
  const whole = Math.floor(balls / 6);

  return Number(`${whole}.${balls % 6}`);
};

/*
|--------------------------------------------------------------------------
| The all-out rule
|--------------------------------------------------------------------------
|
| If a side is bowled out, Net Run Rate uses its FULL quota of overs, not
| the overs it actually faced.
|
| A team all out for 80 in 12.3 of a 20-over match counts as 80 off 20,
| not 80 off 12.5. Miss this and every team that collapses gets a better
| NRR than it earned - and NRR is what separates teams level on points, so
| the mistake decides who reaches the playoffs. Nobody would ever notice
| the table was wrong.
|
| Ten wickets is "all out" in an eleven-a-side game; the innings record's
| own wicket count is used so a nine-a-side gully match is judged on what
| actually happened.
|
*/

const effectiveBalls = (
  innings: any,
  tournamentOvers: number,
): number => {
  /*
  | The Innings model stores `balls` as a straight count alongside the
  | display `overs`, so no conversion is needed here - and a raw count
  | cannot be corrupted by the 12.3-is-not-12.3 problem. oversToBalls
  | stays as the fallback for any older row written before `balls` existed.
  */

  const faced = Number(innings?.balls ?? 0) || oversToBalls(Number(innings?.overs ?? 0));

  const quota = tournamentOvers * 6;

  const wickets = Number(innings?.wickets ?? 0);

  const allOut = wickets >= 10;

  return allOut ? quota : Math.min(faced, quota);
};

type Row = {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  runsScored: number;
  ballsFaced: number;
  runsConceded: number;
  ballsBowled: number;
  nrr: number;
  /* Who this team has beaten - used only for the head-to-head tie-break. */
  beat: Set<string>;
};

const emptyRow = (teamId: string): Row => ({
  teamId,
  played: 0,
  won: 0,
  lost: 0,
  tied: 0,
  noResult: 0,
  points: 0,
  runsScored: 0,
  ballsFaced: 0,
  runsConceded: 0,
  ballsBowled: 0,
  nrr: 0,
  beat: new Set<string>(),
});

/*
|--------------------------------------------------------------------------
| Recompute
|--------------------------------------------------------------------------
*/

export const recomputeStandings = async (tournamentId: string) => {
  const tournament: any = await Tournament.findById(tournamentId).lean();

  if (!tournament) return null;

  const entries: any[] = await TournamentTeam.find({
    tournamentId,
    status: { $in: ["accepted", "withdrawn"] },
  }).lean();

  if (!entries.length) return [];

  const rows = new Map<string, Row>();

  for (const e of entries) rows.set(String(e.teamId), emptyRow(String(e.teamId)));

  /*
  | Only league matches count toward the table. A semi-final is not a
  | league fixture and must not move anybody's points - including it would
  | let a knocked-out side climb the table after being eliminated.
  */

  const matches: any[] = await Match.find({
    tournamentId,
    status: "completed",
    "tournamentRound.stage": "league",
  }).lean();

  const inningsByMatch = new Map<string, any[]>();

  if (matches.length) {
    const allInnings: any[] = await Innings.find({
      matchId: { $in: matches.map((m) => m._id) },
    }).lean();

    for (const i of allInnings) {
      const key = String(i.matchId);

      inningsByMatch.set(key, [...(inningsByMatch.get(key) ?? []), i]);
    }
  }

  for (const match of matches) {
    const aId = String(match.teamA ?? "");
    const bId = String(match.teamB ?? "");

    const rowA = rows.get(aId);
    const rowB = rows.get(bId);

    if (!rowA || !rowB) continue;

    rowA.played++;
    rowB.played++;

    const innings = inningsByMatch.get(String(match._id)) ?? [];

    const winnerId = match.winnerTeam ? String(match.winnerTeam) : null;

    /*
    | No innings recorded at all means the match was abandoned before a
    | ball was bowled. Both sides take the no-result points and NOTHING is
    | added to the run totals - a rained-off game must not drag anyone's
    | NRR around.
    */

    if (!innings.length) {
      rowA.noResult++;
      rowB.noResult++;
      rowA.points += tournament.pointsNoResult ?? 1;
      rowB.points += tournament.pointsNoResult ?? 1;
      continue;
    }

    for (const inn of innings) {
      const battingId = String(inn.battingTeam ?? "");

      const batting = rows.get(battingId);

      const bowling = battingId === aId ? rowB : battingId === bId ? rowA : null;

      if (!batting || !bowling) continue;

      const runs = Number(inn.totalRuns ?? 0);

      const balls = effectiveBalls(inn, tournament.overs || 20);

      batting.runsScored += runs;
      batting.ballsFaced += balls;

      bowling.runsConceded += runs;
      bowling.ballsBowled += balls;
    }

    if (winnerId && rows.has(winnerId)) {
      const winner = rows.get(winnerId)!;
      const loser = winnerId === aId ? rowB : rowA;

      winner.won++;
      winner.points += tournament.pointsWin ?? 2;
      winner.beat.add(loser.teamId);

      loser.lost++;
      loser.points += tournament.pointsLoss ?? 0;
    } else {
      /*
      | Completed, both innings played, no winner recorded - a tie. Both
      | sides take the tie points.
      */

      rowA.tied++;
      rowB.tied++;
      rowA.points += tournament.pointsTie ?? 1;
      rowB.points += tournament.pointsTie ?? 1;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | NRR
  |--------------------------------------------------------------------------
  |
  | Tournament-wide, not an average of per-match rates. Every run scored
  | divided by every ball faced, minus every run conceded divided by every
  | ball bowled.
  |
  */

  for (const row of rows.values()) {
    const scoredRate = row.ballsFaced ? (row.runsScored / row.ballsFaced) * 6 : 0;

    const concededRate = row.ballsBowled
      ? (row.runsConceded / row.ballsBowled) * 6
      : 0;

    row.nrr = Number((scoredRate - concededRate).toFixed(3));
  }

  /* Write the cached numbers back so the table is a sorted find. */

  await Promise.all(
    [...rows.values()].map((row) =>
      TournamentTeam.updateOne(
        { tournamentId, teamId: row.teamId },
        {
          played: row.played,
          won: row.won,
          lost: row.lost,
          tied: row.tied,
          noResult: row.noResult,
          points: row.points,
          runsScored: row.runsScored,
          ballsFaced: row.ballsFaced,
          runsConceded: row.runsConceded,
          ballsBowled: row.ballsBowled,
          nrr: row.nrr,
        },
      ),
    ),
  );

  return [...rows.values()];
};

/*
|--------------------------------------------------------------------------
| Ranked table
|--------------------------------------------------------------------------
|
| Points, then NRR, then wins, then head-to-head, then name.
|
| The last one is not decoration. Without a final deterministic key, two
| teams identical on everything else swap places on every refresh, and the
| person on the qualifying line watches themselves move in and out of the
| playoffs at random.
|
*/

export const getStandings = async (tournamentId: string) => {
  const entries: any[] = await TournamentTeam.find({
    tournamentId,
    status: { $in: ["accepted", "withdrawn"] },
  })
    .populate("teamId", "teamName logo")
    .lean();

  /*
  | Head-to-head needs to know who beat whom, and that is not stored on the
  | row - so it is read once here rather than on every comparison.
  */

  const decided: any[] = await Match.find({
    tournamentId,
    status: "completed",
    winnerTeam: { $ne: null },
    "tournamentRound.stage": "league",
  })
    .select("teamA teamB winnerTeam")
    .lean();

  const beat = new Map<string, Set<string>>();

  for (const m of decided) {
    const w = String(m.winnerTeam);
    const l = String(m.teamA) === w ? String(m.teamB) : String(m.teamA);

    beat.set(w, (beat.get(w) ?? new Set()).add(l));
  }

  const sorted = entries.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;

    if (y.nrr !== x.nrr) return y.nrr - x.nrr;

    if (y.won !== x.won) return y.won - x.won;

    const xi = String(x.teamId?._id ?? x.teamId);
    const yi = String(y.teamId?._id ?? y.teamId);

    if (beat.get(xi)?.has(yi)) return -1;
    if (beat.get(yi)?.has(xi)) return 1;

    return String(x.teamId?.teamName ?? "").localeCompare(
      String(y.teamId?.teamName ?? ""),
    );
  });

  return sorted.map((e, i) => ({
    position: i + 1,
    teamId: e.teamId?._id ?? e.teamId,
    teamName: e.teamId?.teamName ?? "Team",
    logo: e.teamId?.logo ?? null,
    seed: e.seed,
    played: e.played,
    won: e.won,
    lost: e.lost,
    tied: e.tied,
    noResult: e.noResult,
    points: e.points,
    nrr: e.nrr,
    oversFaced: ballsToOvers(e.ballsFaced || 0),
    oversBowled: ballsToOvers(e.ballsBowled || 0),
    runsScored: e.runsScored,
    runsConceded: e.runsConceded,
    withdrawn: !!e.withdrawnAt,
  }));
};

/*
|--------------------------------------------------------------------------
| Called when any match completes
|--------------------------------------------------------------------------
|
| Fired from match.service the moment a match is finalised. It must never
| throw: the result is what matters, and a standings write failing cannot
| be allowed to stop a match being marked complete. If it fails, the next
| completed match recomputes the whole table anyway.
|
*/

export const recomputeStandingsForMatch = async (matchId: string) => {
  try {
    const match: any = await Match.findById(matchId)
      .select("tournamentId")
      .lean();

    if (!match?.tournamentId) return;

    await recomputeStandings(String(match.tournamentId));

    /* Playoff slots may now be fillable - see tournament.service. */
    const { advanceTournament } = await import("./tournament.service");

    await advanceTournament(String(match.tournamentId));
  } catch (error: any) {
    console.error("[standings] recompute failed:", error?.message);
  }
};
