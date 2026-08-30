import Team from "./team.model";
import TeamBlockedDate from "./teamBlockedDate.model";
import Match from "../matches/match.model";
import Player from "../players/player.model";

import { assertCanEditTeam } from "./team.service";

/*
|--------------------------------------------------------------------------
| Team Availability
|--------------------------------------------------------------------------
|
| Single source of truth for "is this team free on this date" - used by
| the calendar display AND by match-challenge validation, so the two can
| never disagree with each other.
|
| A team is UNAVAILABLE on a date if either is true:
| 1. They have a Match with status in (upcoming, live) starting that day.
| 2. They have a TeamBlockedDate for that day.
|
*/

/*
|--------------------------------------------------------------------------
| Normalize Date
|--------------------------------------------------------------------------
|
| Strips time-of-day so every comparison in this module is a simple
| whole-day equality/range check, not a fragile exact-timestamp match.
|
*/

export const startOfDay = (date: Date | string): Date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (date: Date | string): Date => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/*
|--------------------------------------------------------------------------
| Is Team Available
|--------------------------------------------------------------------------
*/

export const isTeamAvailable = async (
  teamId: string,
  date: Date | string,
): Promise<{ available: boolean; reason?: string }> => {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const conflictingMatch = await Match.findOne({
    $or: [{ teamA: teamId }, { teamB: teamId }],
    status: { $in: ["upcoming", "live"] },
    startTime: { $gte: dayStart, $lte: dayEnd },
  });

  if (conflictingMatch) {
    return {
      available: false,
      reason: "Already scheduled for a match on this date.",
    };
  }

  const blockedDate = await TeamBlockedDate.findOne({
    teamId,
    date: dayStart,
  });

  if (blockedDate) {
    return {
      available: false,
      reason: blockedDate.reason || "Marked unavailable by the team.",
    };
  }

  return { available: true };
};

/*
|--------------------------------------------------------------------------
| Get Calendar (For A Date Range)
|--------------------------------------------------------------------------
|
| Returns one entry per day in range with its status - this is what both
| the owning team's calendar screen and another team's read-only preview
| render directly.
|
*/

export const getTeamCalendar = async (
  teamId: string,
  fromDate: Date | string,
  toDate: Date | string,
) => {
  const rangeStart = startOfDay(fromDate);
  const rangeEnd = endOfDay(toDate);

  const [matches, blockedDates] = await Promise.all([
    Match.find({
      $or: [{ teamA: teamId }, { teamB: teamId }],
      status: { $in: ["upcoming", "live"] },
      startTime: { $gte: rangeStart, $lte: rangeEnd },
    }).select("startTime status teamA teamB"),

    TeamBlockedDate.find({
      teamId,
      date: { $gte: rangeStart, $lte: rangeEnd },
    }),
  ]);

  const days: Record<
    string,
    { date: string; status: "booked" | "blocked"; matchId?: string; reason?: string }
  > = {};

  matches.forEach((match) => {
    const key = startOfDay(match.startTime as Date).toISOString();

    days[key] = {
      date: key,
      status: "booked",
      matchId: match._id.toString(),
    };
  });

  blockedDates.forEach((blocked) => {
    const key = startOfDay(blocked.date).toISOString();

    if (!days[key]) {
      days[key] = {
        date: key,
        status: "blocked",
        reason: blocked.reason,
      };
    }
  });

  return Object.values(days);
};

/*
|--------------------------------------------------------------------------
| Block Date
|--------------------------------------------------------------------------
*/

export const blockDate = async (
  userId: string,
  teamId: string,
  date: Date | string,
  reason?: string,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanEditTeam(team, userId);

  const dayStart = startOfDay(date);

  const availability = await isTeamAvailable(teamId, dayStart);

  if (!availability.available) {
    throw new Error(availability.reason || "This date is already unavailable.");
  }

  const actor = await Player.findOne({ userId });

  if (!actor) {
    throw new Error("Please complete your player profile first.");
  }

  return await TeamBlockedDate.create({
    teamId,
    date: dayStart,
    reason: reason || "",
    createdBy: actor._id,
  });
};

/*
|--------------------------------------------------------------------------
| Unblock Date
|--------------------------------------------------------------------------
*/

export const unblockDate = async (
  userId: string,
  teamId: string,
  date: Date | string,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanEditTeam(team, userId);

  const dayStart = startOfDay(date);

  const deleted = await TeamBlockedDate.findOneAndDelete({
    teamId,
    date: dayStart,
  });

  if (!deleted) {
    throw new Error("No block found for this date.");
  }

  return deleted;
};