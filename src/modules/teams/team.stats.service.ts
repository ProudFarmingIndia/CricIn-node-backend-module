import mongoose from "mongoose";

import Match from "../matches/match.model";
import Team from "./team.model";

/*
|--------------------------------------------------------------------------
| Team Record
|--------------------------------------------------------------------------
|
| The same story as Player.stats, one collection over.
|
| Team.totalMatches, wins, losses and draws all exist on the schema, all
| default to 0, and NOTHING EVER WROTE TO THEM. The one function that
| touched them - updateTeamStats - recomputed winPercentage as
| `wins / totalMatches`, both of which were permanently zero, so it faithfully
| calculated 0% and saved it. TeamStatisticsTab reads all six fields, so
| every team in the app showed a blank record forever.
|
| Meanwhile the team LEADERBOARD in stats.service.ts already derived exactly
| these numbers, correctly, from completed Match documents - and said so in a
| comment explaining that it deliberately ignored Team.wins because those
| fields could not be trusted. Two views of the same thing, one of them
| right, and the profile was reading the other one.
|
| This makes them agree, and keeps the leaderboard's rule as the definition:
|
|   PLAYED   a completed match with this team on either side
|   WON      completed, and winnerTeam is this team
|   LOST     completed, with a winnerTeam that is somebody else
|   DRAWN    completed with NO winnerTeam - a tie, a draw, or an abandoned
|            game. Cricket distinguishes a tie from a draw; the Match schema
|            does not, so both land here rather than being guessed at.
|
| Only completed matches count, which is the same rule the player stats use:
| a match in progress moves nobody's record until it is over.
|
| Recomputed rather than incremented, for the same reason as player stats -
| undoing the final ball reopens a match, and a match can be finalised more
| than once. Adding to a stored total would double it with nothing to show
| for it afterwards.
|
*/

export type TeamRecord = {
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  winPercentage: number;
};

const emptyRecord = (): TeamRecord => ({
  totalMatches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winPercentage: 0,
});

export const computeTeamStats = async (
  teamIds: any[],
): Promise<Map<string, TeamRecord>> => {
  const ids = [...new Set((teamIds || []).map(String))].filter(Boolean);

  const out = new Map<string, TeamRecord>();

  for (const id of ids) out.set(id, emptyRecord());

  if (ids.length === 0) return out;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (objectIds.length === 0) return out;

  const matches = await Match.find({
    status: "completed",
    $or: [{ teamA: { $in: objectIds } }, { teamB: { $in: objectIds } }],
  })
    .select("teamA teamB winnerTeam")
    .lean();

  for (const match of matches as any[]) {
    const winner = match.winnerTeam ? String(match.winnerTeam) : "";

    for (const side of [String(match.teamA), String(match.teamB)]) {
      const record = out.get(side);

      if (!record) continue;

      record.totalMatches += 1;

      if (!winner) record.draws += 1;
      else if (winner === side) record.wins += 1;
      else record.losses += 1;
    }
  }

  for (const record of out.values()) {
    record.winPercentage =
      record.totalMatches > 0
        ? Number(((record.wins / record.totalMatches) * 100).toFixed(2))
        : 0;
  }

  return out;
};

/*
| Persisted when a match completes, so the stored fields stop being a lie and
| anything that sorts teams has something real to sort on.
|
| Never throws into its caller: a statistics write must not be able to stop a
| match being marked completed.
*/

export const recomputeTeamStats = async (teamIds: any[]) => {
  try {
    const stats = await computeTeamStats(teamIds);

    await Promise.all(
      [...stats.entries()].map(([teamId, record]) =>
        Team.findByIdAndUpdate(teamId, record),
      ),
    );
  } catch (error: any) {
    console.error("[team stats] recompute failed:", error?.message);
  }
};

export const recomputeTeamStatsForMatch = async (matchId: any) => {
  try {
    const match = await Match.findById(matchId).select("teamA teamB").lean();

    if (!match) return;

    await recomputeTeamStats([(match as any).teamA, (match as any).teamB]);
  } catch (error: any) {
    console.error("[team stats] recompute for match failed:", error?.message);
  }
};

/*
| Attached fresh on every team read, for the same reason the player profile
| computes on read: every match completed before this file existed left
| nothing stored, and a team would show a blank record until it next played.
|
| Works on one team or a list, and never throws - a team page must open even
| if the record query fails.
*/

export const withTeamRecord = async <T>(team: T): Promise<T> => {
  if (!team) return team;

  const [withRecord] = await withTeamRecords([team]);

  return withRecord;
};

export const withTeamRecords = async <T>(teams: T[]): Promise<T[]> => {
  if (!Array.isArray(teams) || teams.length === 0) return teams;

  try {
    const ids = teams.map((team: any) => team?._id).filter(Boolean);

    const stats = await computeTeamStats(ids);

    return teams.map((team: any) => {
      const record = stats.get(String(team?._id));

      if (!record) return team;

      const plain =
        typeof team?.toObject === "function" ? team.toObject() : team;

      return { ...plain, ...record };
    });
  } catch {
    return teams;
  }
};
