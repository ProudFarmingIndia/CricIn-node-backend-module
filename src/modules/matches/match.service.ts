import { getIO } from "../../socket/socket";
import Match from "./match.model";
import Innings from "../scoring/innings.model";
import Scoring from "../scoring/scoring.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";
import mongoose from "mongoose";

import { assertCanEditTeam } from "../teams/team.service";

import {
  sendMatchConfirmationRequiredNotification,
  sendMatchConfirmedNotification,
  sendMatchConfirmationRejectedNotification,
  sendMatchPinSharedNotification,
} from "../notifications/notification.helper";

/*
| Follower fan-out. Every function here swallows its own errors, so none of
| these calls can fail a match transition - see follow.fanout.ts.
*/

import {
  notifyFollowersMatchLive,
  notifyFollowersMatchResult,
  notifyFollowersPlayerOfTheMatch,
} from "../follows/follow.fanout";

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const canEditTeam = async (team: any, userId: string): Promise<boolean> => {
  try {
    await assertCanEditTeam(team, userId);
    return true;
  } catch {
    return false;
  }
};

const canManageTeam = async (team: any, userId: string): Promise<boolean> => {
  try {
    await assertCanEditTeam(team, userId);
    return true;
  } catch {
    return false;
  }
};

/*
|--------------------------------------------------------------------------
| Create Match
|--------------------------------------------------------------------------
*/

export const createMatch = async (userId: string, payload: any) => {
  return await Match.create({
    ...payload,
    userId,
    inviteSenderUserId: userId,
    teamAPin: Math.floor(1000 + Math.random() * 9000).toString(),
    teamBPin: Math.floor(1000 + Math.random() * 9000).toString(),
  });
};

/*
|--------------------------------------------------------------------------
| "My Matches" (Creator Only)
|--------------------------------------------------------------------------
*/

export const getMatches = async (userId: string) => {
  return await Match.find({ userId })
    .populate("teamA")
    .populate("teamB")
    .populate("tossWinner");
};

/*
|--------------------------------------------------------------------------
| Get Match By ID (with canManage / matchPin / isInviteSender)
|--------------------------------------------------------------------------
*/

export const getMatchById = async (matchId: string, userId?: string) => {
  const match = await Match.findById(matchId)
    .populate({ path: "teamA", populate: { path: "players" } })
    .populate({ path: "teamB", populate: { path: "players" } })
    .populate("tossWinner")
    // So the Live tab can name the Player of the Match once it is set.
    .populate("playerOfTheMatch", "playerName profileImage playerType")
    .populate("winnerTeam", "teamName shortName logo")
    .populate("teamASquad", "playerName playerType userId")
    .populate("teamBSquad", "playerName playerType userId");

  if (!match) return null;

  let canManage = false;
  let matchPin: string | null | undefined;
  let isInviteSender = false;

  if (userId) {
    const managesTeamA = await canEditTeam(match.teamA, userId);
    const managesTeamB = await canEditTeam(match.teamB, userId);
    canManage = managesTeamA || managesTeamB;

    if (canManage) {
      matchPin = managesTeamA ? match.teamAPin : match.teamBPin;
    }

    isInviteSender = !!(
      match.inviteSenderUserId &&
      String(match.inviteSenderUserId) === String(userId)
    );
  }

  const obj = match.toObject();
  return {
    ...obj,
    canManage,
    matchPin,
    isInviteSender,
  };
};

/*
|--------------------------------------------------------------------------
| Ownership Guard (Creator-only operations: delete, complete)
|--------------------------------------------------------------------------
*/

const assertIsMatchOwner = async (matchId: string, userId: string) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  console.log("assertIsMatchOwner → match.userId:", String(match.userId));
  console.log("assertIsMatchOwner → userId param:", userId);

  if (!match.userId || String(match.userId) !== String(userId)) {
    throw new Error("You are not authorized to modify this match.");
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Update Match  —  ✅ NOW USES canManageTeam (either captain)
|--------------------------------------------------------------------------
|
| Either captain can update match setup (squads, toss, etc.).
| Consistent with resetMatchSetup and startMatch.
| PROTECTED_FIELDS still prevents anyone from overwriting status,
| userId, PINs, winnerTeam, result, startTime, endTime.
|
*/

const PROTECTED_FIELDS = [
  "userId",
  "status",
  "confirmationStatus",
  "confirmationRequiredFrom",
  "teamAPin",
  "teamBPin",
  "winnerTeam",
  "result",
  "startTime",
  "endTime",
];

export const updateMatch = async (
  userId: string,
  matchId: string,
  payload: any,
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const managesTeamA = await canManageTeam(match.teamA, userId);
  const managesTeamB = await canManageTeam(match.teamB, userId);

  if (!managesTeamA && !managesTeamB) {
    throw new Error("You are not authorized to modify this match.");
  }

  const safePayload = { ...payload };

  PROTECTED_FIELDS.forEach((field) => {
    delete safePayload[field];
  });

  return await Match.findByIdAndUpdate(matchId, safePayload, {
    new: true,
  });
};

/*
|--------------------------------------------------------------------------
| Delete Match (Creator-only)
|--------------------------------------------------------------------------
*/

export const deleteMatch = async (userId: string, matchId: string) => {
  await assertIsMatchOwner(matchId, userId);
  return await Match.findByIdAndDelete(matchId);
};

/*
|--------------------------------------------------------------------------
| Reset Match Setup (upcoming only, either captain)
|--------------------------------------------------------------------------
*/

export const resetMatchSetup = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const canManage =
    (await canEditTeam(match.teamA, userId)) ||
    (await canEditTeam(match.teamB, userId));

  if (!canManage) {
    throw new Error("You are not authorized to reset this match setup.");
  }

  if (match.status === "live" || match.status === "completed") {
    throw new Error("A live or completed match cannot be reset.");
  }

  match.teamASquad = [];
  match.teamBSquad = [];
  match.tossWinner = null;
  match.tossDecision = null;

  await match.save();

  await Innings.deleteMany({ matchId: match._id });
  await Scoring.deleteMany({ matchId: match._id });

  return match;
};

/*
|--------------------------------------------------------------------------
| Start Match (Opponent-PIN-gated, either captain)
|--------------------------------------------------------------------------
*/

export const startMatch = async (
  userId: string,
  matchId: string,
  pin?: string,
  pins?: { teamA?: string; teamB?: string },
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const managesTeamA = await canEditTeam(match.teamA, userId);
  const managesTeamB = await canEditTeam(match.teamB, userId);

  /*
  |--------------------------------------------------------------------------
  | Who May Start
  |--------------------------------------------------------------------------
  |
  | This used to require managing one of the two teams, full stop. That
  | rules out a neutral scorer - somebody recording a match between two
  | teams they have nothing to do with - which is the whole point of Quick
  | Score.
  |
  | A neutral scorer is allowed here ONLY because the match already exists,
  | and for a neutral scorer a match only comes into existence after both
  | captains approved the scoring request. The consent was collected before
  | this point; what is checked below is the PIN, which is a different
  | question - not "did you agree" but "are you here, now".
  |
  */

  const isScorer =
    String(match.userId) === String(userId) ||
    String(match.scorerUserId || "") === String(userId) ||
    String(match.inviteSenderUserId || "") === String(userId);

  if (!managesTeamA && !managesTeamB && !isScorer) {
    throw new Error("You are not authorized to start this match.");
  }

  if (match.status === "live") {
    return match;
  }

  if (match.status !== "upcoming") {
    throw new Error("This match cannot be started from its current state.");
  }

  /*
  |--------------------------------------------------------------------------
  | PIN Gate
  |--------------------------------------------------------------------------
  |
  | One rule: a PIN is required for each of the two teams the starter does
  | NOT manage.
  |
  |   manages both    -> no PIN (they own both sides; nobody to prove
  |                      anything to)
  |   manages one     -> the opponent's PIN. Unchanged behaviour, and what
  |                      the Add Match flow has always done.
  |   manages neither -> both PINs, one from each captain.
  |
  | `pin` is kept for the single-PIN callers that already exist; `pins`
  | carries the pair. Checking both teams in one loop means the two-PIN
  | case cannot accidentally accept one correct PIN and ignore the other.
  |
  */

  const required: { label: string; expected?: string | null; given?: string }[] = [];

  if (!managesTeamA) {
    required.push({
      label: (match.teamA as any)?.teamName || "Team A",
      expected: match.teamAPin,
      given: pins?.teamA ?? (managesTeamB ? pin : undefined),
    });
  }

  if (!managesTeamB) {
    required.push({
      label: (match.teamB as any)?.teamName || "Team B",
      expected: match.teamBPin,
      given: pins?.teamB ?? (managesTeamA ? pin : undefined),
    });
  }

  for (const entry of required) {
    // A match with no PIN stored for that side cannot be gated on one.
    if (!entry.expected) {
      continue;
    }

    if (entry.given !== entry.expected) {
      throw new Error(
        `Incorrect PIN for ${entry.label}. Ask that team's captain for their PIN.`,
      );
    }
  }

  const started = await Match.findByIdAndUpdate(
    matchId,
    { status: "live", startTime: new Date() },
    { new: true },
  );

  /*
  | Tell everyone following either team that the match is live.
  |
  | Placed after the status write and deliberately not awaited-into the
  | return value: the captain starting the match should not wait on a
  | fan-out to a few hundred followers before the scoring screen opens.
  |
  | The early return above for an already-live match matters here - without
  | it, a captain tapping Start twice would fan out twice.
  */

  void notifyFollowersMatchLive(started);

  return started;
};

/*
|--------------------------------------------------------------------------
| Verify Match PIN
|--------------------------------------------------------------------------
*/

export const verifyMatchPin = async (
  userId: string,
  matchId: string,
  pin: string,
) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  const managesTeamA = await canEditTeam(match.teamA, userId);
  const managesTeamB = await canEditTeam(match.teamB, userId);

  if (!managesTeamA && !managesTeamB) {
    throw new Error("You are not authorized to verify this match PIN.");
  }

  const requiredPin = managesTeamA ? match.teamBPin : match.teamAPin;

  if (!requiredPin) {
    return { valid: true };
  }

  return { valid: requiredPin === pin };
};

/*
|--------------------------------------------------------------------------
| Complete Match (Creator-only)
|--------------------------------------------------------------------------
*/

export const completeMatch = async (userId: string, matchId: string) => {
  await assertIsMatchOwner(matchId, userId);

  return await Match.findByIdAndUpdate(
    matchId,
    { status: "completed", endTime: new Date() },
    { new: true },
  );
};

/*
|--------------------------------------------------------------------------
| Update Match Result (either captain)
|--------------------------------------------------------------------------
*/

export const updateMatchResult = async (
  userId: string,
  matchId: string,
  winnerTeam: string,
  result: string,
  playerOfTheMatch?: string,
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  const canManage =
    (await canEditTeam(match.teamA, userId)) ||
    (await canEditTeam(match.teamB, userId));

  if (!canManage) {
    throw new Error("You are not authorized to set the result for this match.");
  }

  /*
  | Whether the result was ALREADY recorded, captured before the write.
  |
  | Saving a result is not naturally a once-only action - a captain can
  | correct a typo in the result text, or set the Player of the Match
  | afterwards. Without this check each correction would fan out to every
  | follower again, so followers would be told about the same match two or
  | three times.
  */

  const alreadyCompleted = match.status === "completed" && !!match.winnerTeam;

  const previousPlayerOfTheMatch = match.playerOfTheMatch
    ? String(match.playerOfTheMatch)
    : null;

  const update: Record<string, any> = {
    winnerTeam,
    result,
    status: "completed",
    endTime: new Date(),
  };

  /*
  | Only written when supplied, so an edit that just fixes the result text
  | does not wipe an award that was already recorded.
  */

  if (playerOfTheMatch) {
    update.playerOfTheMatch = playerOfTheMatch;
  }

  const updated = await Match.findByIdAndUpdate(matchId, update, {
    new: true,
  });

  /*
  |--------------------------------------------------------------------------
  | Follower Fan-Out
  |--------------------------------------------------------------------------
  */

  if (!alreadyCompleted) {
    void notifyFollowersMatchResult(updated, userId);
  }

  /*
  | The award fans out the first time it is set - including when it is
  | added later to a match whose result was already saved, which is why
  | this is checked separately from alreadyCompleted.
  */

  if (playerOfTheMatch && playerOfTheMatch !== previousPlayerOfTheMatch) {
    void notifyFollowersPlayerOfTheMatch(updated, playerOfTheMatch, userId);
  }

  return updated;
};

/*
|--------------------------------------------------------------------------
| Summary / Live / Scorecards
|--------------------------------------------------------------------------
*/

export const getMatchSummary = async (matchId: string) => {
  const innings = await Innings.find({ matchId });

  return innings.map((i) => ({
    inningsNumber: i.inningsNumber,
    runs: i.totalRuns,
    wickets: i.wickets,
    overs: `${Math.floor(i.balls / 6)}.${i.balls % 6}`,
  }));
};

/*
| The live payload used to be four numbers: runs, wickets, overs, run rate.
|
| That is a score, not a live page. It could not say WHICH side was batting,
| which innings it was, who was at the crease, who was bowling, or what the
| chase needed - so the Live tab could only draw two grey stat boxes.
|
| Everything added here is already in the database; it was simply never
| sent. The batter and bowler figures come from that innings' deliveries,
| the same source the scorecard uses, so the two always agree.
*/

export const getLiveMatch = async (matchId: string) => {
  const innings = await Innings.findOne({ matchId, isCompleted: false })
    .populate("currentStrikerId", "playerName")
    .populate("currentNonStrikerId", "playerName")
    .populate("currentBowlerId", "playerName");

  if (!innings) {
    throw new Error("No active innings found");
  }

  const balls = await Scoring.find({ inningsId: innings._id });

  const battingFigures = (playerId: any) => {
    if (!playerId) return { runs: 0, balls: 0 };

    const id = String(playerId);

    const faced = balls.filter((b: any) => String(b.batsmanId) === id);

    return {
      /*
      | Byes, leg byes and wides are the team's, not the batter's - counting
      | them here would inflate a not-out score against the scorecard's.
      | batsmanRuns already encodes that rule; the fallback applies it to
      | balls recorded before the field existed.
      */
      runs: faced.reduce(
        (sum: number, b: any) =>
          sum +
          (b.batsmanRuns ??
            (b.extraType === "bye" ||
            b.extraType === "legBye" ||
            b.extraType === "wide"
              ? 0
              : b.runs || 0)),
        0,
      ),

      // A wide is not a ball faced.
      balls: faced.filter((b: any) => b.extraType !== "wide").length,
    };
  };

  const bowlingFigures = (playerId: any) => {
    if (!playerId) return { overs: "0.0", runs: 0, wickets: 0 };

    const id = String(playerId);

    const bowled = balls.filter((b: any) => String(b.bowlerId) === id);

    const legal = bowled.filter((b: any) => b.isLegalDelivery !== false).length;

    return {
      overs: `${Math.floor(legal / 6)}.${legal % 6}`,
      runs: bowled.reduce(
        (sum: number, b: any) => sum + (b.teamRuns ?? b.runs ?? 0),
        0,
      ),
      // Run-outs are not the bowler's wicket.
      wickets: bowled.filter(
        (b: any) => b.isWicket && b.bowlerCredit !== false,
      ).length,
    };
  };

  const withFigures = (player: any, figures: any) =>
    player?._id
      ? { _id: player._id, playerName: player.playerName, ...figures }
      : null;

  /*
  | The target only exists in a second innings, and only once the first is
  | on record - so it is looked up rather than assumed.
  */

  let target: number | undefined;

  if (innings.inningsNumber === 2) {
    const first = await Innings.findOne({ matchId, inningsNumber: 1 });

    if (first) target = first.totalRuns + 1;
  }

  const striker: any = innings.currentStrikerId;
  const nonStriker: any = innings.currentNonStrikerId;
  const bowler: any = innings.currentBowlerId;

  return {
    inningsId: innings._id,
    inningsNumber: innings.inningsNumber,

    battingTeamId: innings.battingTeam,
    bowlingTeamId: innings.bowlingTeam,

    runs: innings.totalRuns,
    wickets: innings.wickets,
    balls: innings.balls,
    overs: `${Math.floor(innings.balls / 6)}.${innings.balls % 6}`,
    runRate:
      innings.balls > 0
        ? (innings.totalRuns / (innings.balls / 6)).toFixed(2)
        : "0",

    target,

    currentStriker: withFigures(striker, battingFigures(striker?._id)),
    currentNonStriker: withFigures(
      nonStriker,
      battingFigures(nonStriker?._id),
    ),
    currentBowler: withFigures(bowler, bowlingFigures(bowler?._id)),
  };
};

export const getBowlingScorecard = async (matchId: string) => {
  const balls = await Scoring.find({ matchId }).populate("bowlerId");

  const scorecard: any = {};

  balls.forEach((ball) => {
    if (!ball.bowlerId) return;

    const id = ball.bowlerId._id.toString();

    if (!scorecard[id]) {
      scorecard[id] = {
        player: ball.bowlerId,
        wickets: 0,
        runsConceded: 0,
        balls: 0,
      };
    }

    scorecard[id].balls++;
    scorecard[id].runsConceded += ball.runs;

    if (ball.isWicket) scorecard[id].wickets++;
  });

  return Object.values(scorecard);
};

export const getFallOfWickets = async (matchId: string) => {
  const wickets = await Scoring.find({ matchId, isWicket: true })
    .populate("dismissedPlayerId", "playerName")
    .sort({ createdAt: 1 });

  return wickets.map((wicket, index) => ({
    wicketNumber: index + 1,
    player: wicket.dismissedPlayerId,
    over: wicket.over,
    ball: wicket.ball,
    wicketType: wicket.wicketType,
  }));
};

export const getBattingScorecard = async (matchId: string) => {
  const balls = await Scoring.find({ matchId }).populate("batsmanId", "playerName");

  const scorecard: any = {};

  balls.forEach((ball: any) => {
    if (!ball.batsmanId) return;

    const playerId = ball.batsmanId._id.toString();

    if (!scorecard[playerId]) {
      scorecard[playerId] = {
        playerId,
        playerName: ball.batsmanId.playerName,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
      };
    }

    scorecard[playerId].runs += ball.runs;
    scorecard[playerId].balls += 1;

    if (ball.runs === 4) scorecard[playerId].fours += 1;
    if (ball.runs === 6) scorecard[playerId].sixes += 1;
  });

  return Object.values(scorecard).map((player: any) => ({
    ...player,
    strikeRate:
      player.balls > 0 ? ((player.runs / player.balls) * 100).toFixed(2) : "0.00",
  }));
};

export const getFullScorecard = async (matchId: string) => {
  const summary = await getMatchSummary(matchId);
  const batting = await getBattingScorecard(matchId);
  const bowling = await getBowlingScorecard(matchId);
  const fow = await getFallOfWickets(matchId);

  return { summary, batting, bowling, fow };
};

/*
|--------------------------------------------------------------------------
| Over-by-Over
|--------------------------------------------------------------------------
*/

export const getOverByOver = async (matchId: string) => {
  const balls = await Scoring.find({ matchId })
    .populate("batsmanId", "playerName")
    .populate("bowlerId", "playerName")
    .populate("fielderId", "playerName")
    .sort({ over: 1, ball: 1, createdAt: 1 });

  /*
  | The innings number lives on Innings, NOT on a ball.
  |
  | This function used to read `ball.inningsNumber`, which is always
  | undefined - so every over fell back to innings 1 and the second
  | innings' over 3 was merged into the first innings' over 3, silently
  | doubling its runs and its ball list.
  |
  | One lookup keyed by inningsId puts each ball in the right innings.
  */

  const inningsList = await Innings.find({ matchId })
    .select("_id inningsNumber battingTeam")
    .populate("battingTeam", "teamName teamLogo");

  const inningsById = new Map(
    inningsList.map((i: any) => [String(i._id), i]),
  );

  const oversMap: any = {};

  balls.forEach((ball: any) => {
    const innings = inningsById.get(String(ball.inningsId));

    const inningsNumber = innings?.inningsNumber || 1;

    const key = `${inningsNumber}-${ball.over}`;

    if (!oversMap[key]) {
      oversMap[key] = {
        inningsNumber,
        battingTeamName: innings?.battingTeam?.teamName || null,
        over: ball.over,
        bowler: null,
        balls: [],
        runs: 0,
        wickets: 0,
      };
    }

    // The bowler is the same for the whole over - named once, on the over.
    if (!oversMap[key].bowler && ball.bowlerId?.playerName) {
      oversMap[key].bowler = ball.bowlerId.playerName;
    }

    const runs = ball.teamRuns ?? ball.runs ?? 0;

    /*
    | This used to return six fields: ball, runs, isWicket, extraType and
    | the two names. Everything the commentary is made of - the shot, the
    | direction, the dismissal, the stored line - was dropped here, which
    | is why the match's Live tab rendered a badge with an empty sentence
    | beside it while the scoring pad showed the full text.
    |
    | The client rebuilds the sentence from these fields rather than
    | printing commentaryText, so a ball recorded before the shot fields
    | existed still reads with the right names.
    */

    oversMap[key].balls.push({
      _id: ball._id,
      over: ball.over,
      ball: ball.ball,
      runs,
      batRuns: ball.runs ?? 0,
      isWicket: !!ball.isWicket,
      wicketType: ball.wicketType || null,
      extraType: ball.extraType || null,
      isLegalDelivery: ball.isLegalDelivery !== false,
      batsman: ball.batsmanId?.playerName || null,
      bowler: ball.bowlerId?.playerName || null,
      fielder: ball.fielderId?.playerName || null,
      shotType: ball.shotType || "",
      wagonWheel: {
        angle: ball.wagonWheel?.angle ?? null,
        distance: ball.wagonWheel?.distance ?? null,
        region: ball.wagonWheel?.region || "",
      },
      commentaryText: ball.commentaryText || "",
      createdAt: ball.createdAt,
    });

    oversMap[key].runs += runs;
    if (ball.isWicket) oversMap[key].wickets += 1;
  });

  return Object.values(oversMap).sort(
    (a: any, b: any) => a.inningsNumber - b.inningsNumber || a.over - b.over,
  );
};

/*
|--------------------------------------------------------------------------
| Match Feed - Live / Upcoming / Recent
|--------------------------------------------------------------------------
*/

const getManagedTeamIds = async (userId: string): Promise<string[]> => {
  const player = await Player.findOne({ userId });

  const query: any[] = [{ userId }];

  if (player) {
    query.push({ players: player._id });
  }

  const teams = await Team.find({ $or: query }).select("_id");

  return teams.map((team) => String(team._id));
};

const attachCurrentInnings = async (matches: any[]) => {
  if (matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((match) => match._id);

  const allInnings = await Innings.find({
    matchId: { $in: matchIds },
  });

  const inningsByMatchId = new Map<string, any[]>();
  allInnings.forEach((innings) => {
    const key = String(innings.matchId);
    if (!inningsByMatchId.has(key)) inningsByMatchId.set(key, []);
    inningsByMatchId.get(key)!.push(innings);
  });

  return matches.map((match) => {
    const inns = inningsByMatchId.get(String(match._id)) || [];
    const active = inns.find((i) => !i.isCompleted);
    const first = inns.find((i) => i.inningsNumber === 1);

    const target =
      active && active.inningsNumber === 2 && first
        ? first.totalRuns + 1
        : undefined;

    let battingSquad: any[] = [];
    let bowlingSquad: any[] = [];
    if (active) {
      const battingTeamId = String(active.battingTeam);
      const isTeamABatting = String(match.teamA?._id) === battingTeamId;
      battingSquad = isTeamABatting ? match.teamASquad || [] : match.teamBSquad || [];
      bowlingSquad = isTeamABatting ? match.teamBSquad || [] : match.teamASquad || [];
    }

    return {
      ...match.toObject(),
      currentInnings: active
        ? {
            inningsId: active._id,
            inningsNumber: active.inningsNumber,
            runs: active.totalRuns,
            wickets: active.wickets,
            overs: `${Math.floor(active.balls / 6)}.${active.balls % 6}`,
            runRate:
              active.balls > 0
                ? (active.totalRuns / (active.balls / 6)).toFixed(2)
                : "0",

            /*
            | Which side the score belongs to. The payload carried the
            | batting SQUAD but not the batting TEAM, so a client showing a
            | live card had no way to put "58/1" against the team actually
            | batting - it could only show the score floating between the
            | two names.
            */
            battingTeamId: active.battingTeam,

            bowlingTeamId: active.bowlingTeam,

            battingSquad,
            bowlingSquad,
            target,
          }
        : null,
    };
  });
};

export const getLiveMatches = async (userId: string) => {
  const teamIds = await getManagedTeamIds(userId);

  const matches = await Match.find({
    status: "live",
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  })
    .populate("teamA")
    .populate("teamB")
    .populate("teamASquad", "playerName playerType")
    .populate("teamBSquad", "playerName playerType")
    .sort({ startTime: -1 });

  return await attachCurrentInnings(matches);
};

export const getUpcomingMatches = async (userId: string) => {
  const teamIds = await getManagedTeamIds(userId);

  const matches = await Match.find({
    status: "upcoming",
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  })
    .populate("teamA")
    .populate("teamB")
    .sort({ scheduledStartTime: 1, createdAt: 1 });

  const result: any[] = [];

  for (const match of matches) {
    const managesTeamA = await canEditTeam(match.teamA, userId);
    const managesTeamB = await canEditTeam(match.teamB, userId);
    const canManage = managesTeamA || managesTeamB;

    const isInviteSender = !!(
      match.inviteSenderUserId &&
      String(match.inviteSenderUserId) === String(userId)
    );

    const obj = match.toObject();

    result.push({
      ...obj,
      canManage,
      isInviteSender,
      matchPin: canManage
        ? managesTeamA
          ? obj.teamAPin
          : obj.teamBPin
        : undefined,
    });
  }

  return result;
};

export const getRecentMatches = async (userId: string, limit: number) => {
  const teamIds = await getManagedTeamIds(userId);

  const cappedLimit = Math.min(Math.max(limit || 20, 1), 50);

  return await Match.find({
    status: "completed",
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  })
    .populate("teamA")
    .populate("teamB")
    .populate("winnerTeam")
    .sort({ endTime: -1 })
    .limit(cappedLimit);
};

/*
|--------------------------------------------------------------------------
| Scorecard By Innings
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Full Scorecard, Per Innings
|--------------------------------------------------------------------------
|
| Extended to carry everything a printed scorecard shows, because the
| previous payload had only names and totals - no dismissals, no extras
| breakdown, no fall of wickets, no maidens - so the client could render a
| list of numbers but not an actual scorecard.
|
| Every added figure is derived from the same single pass over the balls
| that was already happening; nothing here costs an extra query.
|
*/

export const getScorecardByInnings = async (matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA", "teamName shortName")
    .populate("teamB", "teamName shortName")
    .populate("teamASquad", "playerName")
    .populate("teamBSquad", "playerName");

  const inningsList = await Innings.find({ matchId }).sort({ inningsNumber: 1 });

  const results = [];

  for (const innings of inningsList) {
    const balls = await Scoring.find({ inningsId: innings._id })
      .populate("batsmanId", "playerName")
      .populate("bowlerId", "playerName")
      .populate("dismissedPlayerId", "playerName")
      .populate("fielderId", "playerName")
      .sort({ over: 1, ball: 1, createdAt: 1 });

    const battingMap: any = {};
    const bowlingMap: any = {};

    /*
    | Extras are split by type because a scorecard states them separately -
    | "b 0, lb 0, w 3, nb 0" - and because only some of them count against
    | the bowler.
    */
    const extras = { byes: 0, legByes: 0, wides: 0, noBalls: 0, total: 0 };

    const fallOfWickets: any[] = [];

    // Per (bowler, over) run totals, to count maidens after the pass.
    const overRuns: Record<string, { runs: number; legal: number }> = {};

    let runningRuns = 0;

    let runningWickets = 0;

    balls.forEach((ball: any) => {
      const ballTeamRuns = ball.teamRuns ?? ball.runs ?? 0;

      runningRuns += ballTeamRuns;

      if (ball.extraType === "bye") extras.byes += ball.runs || 0;
      if (ball.extraType === "legBye") extras.legByes += ball.runs || 0;
      if (ball.extraType === "wide") extras.wides += (ball.runs || 0) + 1;
      if (ball.extraType === "noBall") extras.noBalls += 1;

      if (ball.bowlerId) {
        const key = `${ball.bowlerId._id}-${ball.over}`;

        if (!overRuns[key]) {
          overRuns[key] = { runs: 0, legal: 0 };
        }

        overRuns[key].runs += ballTeamRuns;

        if (ball.isLegalDelivery !== false) {
          overRuns[key].legal += 1;
        }
      }

      if (ball.isWicket) {
        runningWickets += 1;

        fallOfWickets.push({
          wicket: runningWickets,
          playerName:
            ball.dismissedPlayerId?.playerName ||
            ball.batsmanId?.playerName ||
            "Unknown",
          score: `${runningRuns}-${runningWickets}`,
          over: `${ball.over}.${ball.ball}`,
        });
      }

      if (ball.batsmanId) {
        const id = ball.batsmanId._id.toString();

        if (!battingMap[id]) {
          battingMap[id] = {
            playerId: id,
            playerName: ball.batsmanId.playerName,
            runs: 0,
            balls: 0,
            fours: 0,
            sixes: 0,
            dismissal: "not out",
            isOut: false,
          };
        }

        /*
        | batsmanRuns is what the batter actually scored - the server works
        | it out when the ball is recorded.
        |
        | This used to add `ball.runs` while excluding only byes and leg
        | byes, so runs RUN off a wide were credited to the batter as though
        | he had hit them: the innings total said 3 and the batting card plus
        | extras said 5.
        |
        | The fallback keeps balls recorded before batsmanRuns existed
        | reading correctly - by applying the same rule they were missing.
        */

        const notBatterRuns =
          ball.extraType === "bye" ||
          ball.extraType === "legBye" ||
          ball.extraType === "wide";

        const batterRuns =
          ball.batsmanRuns ?? (notBatterRuns ? 0 : ball.runs || 0);

        battingMap[id].runs += batterRuns;

        // Only a boundary off the bat is a four or a six on the card.
        if (batterRuns === 4) battingMap[id].fours += 1;
        if (batterRuns === 6) battingMap[id].sixes += 1;

        if (ball.extraType !== "wide") {
          battingMap[id].balls += 1;
        }
      }

      /*
      | The dismissal is attached to the batsman who was OUT, which is not
      | always the striker - on a run out it can be the non-striker. That is
      | why dismissedPlayerId exists and why it is preferred here.
      */
      if (ball.isWicket) {
        const outId = String(
          ball.dismissedPlayerId?._id || ball.batsmanId?._id || "",
        );

        if (outId && battingMap[outId]) {
          const type = (ball.wicketType || "").toLowerCase();

          const fielder = ball.fielderId?.playerName;

          const bowler = ball.bowlerId?.playerName;

          let text = ball.wicketType || "out";

          if (type.includes("caught") && fielder && bowler) {
            text = `c ${fielder} b ${bowler}`;
          } else if (type.includes("bowled") && bowler) {
            text = `b ${bowler}`;
          } else if (type.includes("lbw") && bowler) {
            text = `lbw b ${bowler}`;
          } else if (type.includes("stump") && fielder && bowler) {
            text = `st ${fielder} b ${bowler}`;
          } else if (type.includes("run") && fielder) {
            text = `run out (${fielder})`;
          }

          battingMap[outId].dismissal = text;

          battingMap[outId].isOut = true;
        }
      }

      if (ball.bowlerId) {
        const id = ball.bowlerId._id.toString();

        if (!bowlingMap[id]) {
          bowlingMap[id] = {
            playerId: id,
            playerName: ball.bowlerId.playerName,
            legalBalls: 0,
            runsConceded: 0,
            wickets: 0,
          };
        }

        if (ball.isLegalDelivery !== false) {
          bowlingMap[id].legalBalls += 1;
        }

        bowlingMap[id].runsConceded += ball.teamRuns ?? ball.runs;

        /*
        | A run out is not the bowler's wicket. Counting raw isWicket here
        | credited it to whoever happened to be bowling.
        */
        if (ball.isWicket && ball.bowlerCredit !== false) {
          bowlingMap[id].wickets += 1;
        }
      }
    });

    const batting = Object.values(battingMap).map((p: any) => ({
      ...p,
      strikeRate: p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(2) : "0.00",
    }));

    const bowling = Object.values(bowlingMap).map((p: any) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      overs: `${Math.floor(p.legalBalls / 6)}.${p.legalBalls % 6}`,
      runsConceded: p.runsConceded,
      wickets: p.wickets,
      economy:
        p.legalBalls > 0
          ? (p.runsConceded / (p.legalBalls / 6)).toFixed(2)
          : "0.00",
    }));

    extras.total =
      extras.byes + extras.legByes + extras.wides + extras.noBalls;

    /*
    | A maiden is a completed over (six legal deliveries) that conceded
    | nothing. Partial overs at the end of an innings are not maidens.
    */
    const maidensByBowler: Record<string, number> = {};

    Object.entries(overRuns).forEach(([key, value]) => {
      if (value.runs === 0 && value.legal === 6) {
        const bowlerId = key.split("-")[0];

        maidensByBowler[bowlerId] = (maidensByBowler[bowlerId] || 0) + 1;
      }
    });

    const bowlingWithMaidens = bowling.map((b: any) => ({
      ...b,
      maidens: maidensByBowler[b.playerId] || 0,
    }));

    /*
    | Team names, so the client does not have to resolve two ObjectIds
    | against the match it may not have loaded.
    */
    const teamA: any = match?.teamA;

    const teamB: any = match?.teamB;

    const isTeamABatting =
      String(innings.battingTeam) === String(teamA?._id);

    const battingTeamName = isTeamABatting ? teamA?.teamName : teamB?.teamName;

    const bowlingTeamName = isTeamABatting ? teamB?.teamName : teamA?.teamName;

    /*
    | Anyone in the batting squad who never faced a ball. Only meaningful
    | when a squad was actually picked.
    */
    const battingSquad: any[] = isTeamABatting
      ? (match?.teamASquad as any[]) || []
      : (match?.teamBSquad as any[]) || [];

    const battedIds = new Set(Object.keys(battingMap));

    const didNotBat = battingSquad
      .filter((p: any) => !battedIds.has(String(p._id)))
      .map((p: any) => p.playerName);

    results.push({
      inningsId: innings._id,
      inningsNumber: innings.inningsNumber,
      battingTeam: innings.battingTeam,
      bowlingTeam: innings.bowlingTeam,
      battingTeamName: battingTeamName || "",
      bowlingTeamName: bowlingTeamName || "",
      totalRuns: innings.totalRuns,
      wickets: innings.wickets,
      overs: `${Math.floor(innings.balls / 6)}.${innings.balls % 6}`,
      runRate:
        innings.balls > 0
          ? (innings.totalRuns / (innings.balls / 6)).toFixed(2)
          : "0.00",
      isCompleted: innings.isCompleted,
      batting,
      bowling: bowlingWithMaidens,
      extras,
      fallOfWickets,
      didNotBat,
    });
  }

  return results;
};

/*
|--------------------------------------------------------------------------
| Partnerships
|--------------------------------------------------------------------------
*/

export const getPartnerships = async (matchId: string) => {
  const inningsList = await Innings.find({ matchId }).sort({ inningsNumber: 1 });

  const results = [];

  for (const innings of inningsList) {
    const balls = await Scoring.find({ inningsId: innings._id })
      .populate("strikerIdBefore", "playerName")
      .populate("nonStrikerIdBefore", "playerName")
      .sort({ createdAt: 1 });

    const partnerships: any[] = [];
    let current: any = null;

    balls.forEach((ball: any) => {
      const striker = ball.strikerIdBefore;
      const nonStriker = ball.nonStrikerIdBefore;

      if (!striker || !nonStriker) return;

      const pairKey = [String(striker._id), String(nonStriker._id)]
        .sort()
        .join("-");

      if (!current || current.pairKey !== pairKey) {
        current = {
          pairKey,
          batsmen: [
            { playerId: String(striker._id), playerName: striker.playerName },
            { playerId: String(nonStriker._id), playerName: nonStriker.playerName },
          ],
          runs: 0,
          balls: 0,
        };

        partnerships.push(current);
      }

      current.runs += ball.teamRuns || 0;

      if (ball.isLegalDelivery !== false) {
        current.balls += 1;
      }
    });

    results.push({
      inningsId: innings._id,
      inningsNumber: innings.inningsNumber,
      partnerships: partnerships.map(({ pairKey, ...rest }) => rest),
    });
  }

  return results;
};

/*
|--------------------------------------------------------------------------
| Match Confirmation Gate
|--------------------------------------------------------------------------
*/

export const requestMatchConfirmation = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  if (String(match.userId) !== String(userId)) {
    throw new Error("Only the match creator can request confirmation.");
  }

  const teamA = match.teamA as any;
  const teamB = match.teamB as any;

  const [ownsTeamA, ownsTeamB] = await Promise.all([
    canManageTeam(teamA, userId),
    canManageTeam(teamB, userId),
  ]);

  if ((ownsTeamA && ownsTeamB) || match.confirmationStatus === "confirmed") {
    return match;
  }

  if (!ownsTeamA && !ownsTeamB) {
    throw new Error(
      "You must manage at least one of the two teams to request confirmation.",
    );
  }

  const otherTeam = ownsTeamA ? teamB : teamA;
  const ownedTeam = ownsTeamA ? teamA : teamB;

  match.confirmationStatus = "pending" as any;
  match.confirmationRequiredFrom = otherTeam._id;

  await match.save();

  try {
    await sendMatchConfirmationRequiredNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      teamId: otherTeam._id.toString(),
      creatorTeamName: ownedTeam.teamName,
    });

    const ownPin = ownsTeamA ? match.teamAPin : match.teamBPin;
    if (ownPin) {
      await sendMatchPinSharedNotification({
        receiverId: otherTeam.userId.toString(),
        actorId: userId,
        matchId: match._id.toString(),
        teamId: otherTeam._id.toString(),
        pin: ownPin,
        creatorTeamName: ownedTeam.teamName,
      });
    }
  } catch (notificationError) {
    console.error(
      "Failed to send match-confirmation-required notification:",
      notificationError,
    );
  }

  return match;
};

const resolveConfirmingTeam = async (match: any, userId: string) => {
  if (
    match.confirmationStatus !== "pending" ||
    !match.confirmationRequiredFrom
  ) {
    throw new Error("This match is not awaiting confirmation.");
  }

  const team = await Team.findById(match.confirmationRequiredFrom);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanEditTeam(team, userId);

  return team;
};

export const confirmMatchRequest = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  const confirmingTeam = await resolveConfirmingTeam(match, userId);

  match.confirmationStatus = "confirmed" as any;
  await match.save();

  try {
    await sendMatchConfirmedNotification({
      receiverId: match.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      confirmingTeamName: confirmingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-confirmed notification:",
      notificationError,
    );
  }

  return match;
};

export const rejectMatchConfirmation = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new Error("Match not found.");
  }

  const rejectingTeam = await resolveConfirmingTeam(match, userId);

  match.confirmationStatus = "rejected" as any;
  match.status = "cancelled" as any;

  await match.save();

  await Innings.deleteMany({ matchId: match._id });

  try {
    await sendMatchConfirmationRejectedNotification({
      receiverId: match.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      rejectingTeamName: rejectingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-confirmation-rejected notification:",
      notificationError,
    );
  }

  return match;
};

/*
|--------------------------------------------------------------------------
| Transfer Scoring
|--------------------------------------------------------------------------
*/

export const transferScoring = async (
  userId: string,
  matchId: string,
  targetUserId: string,
) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) throw new Error("Match not found.");
  if (match.status !== "live")
    throw new Error("Only a live match can be transferred.");

  const senderId = match.inviteSenderUserId || match.userId;
  const isInviteSender = senderId && String(senderId) === String(userId);
  const isCurrentScorer =
    match.scorerUserId && String(match.scorerUserId) === String(userId);

  if (!isInviteSender && !isCurrentScorer) {
    throw new Error(
      "Only the captain who sent the match invite can transfer scoring.",
    );
  }

  const target = await Player.findOne({ userId: targetUserId });
  if (!target) throw new Error("Target scorer not found.");

  const teamAId = String(match.teamA._id);
  const teamBId = String(match.teamB._id);
  const inA = (target.teams || []).some((t: any) => String(t) === teamAId);
  const inB = (target.teams || []).some((t: any) => String(t) === teamBId);

  if (!inA && !inB) {
    throw new Error("Scorer must be a member of one of the two teams.");
  }

  match.scorerUserId = new mongoose.Types.ObjectId(targetUserId);
  match.scorerTeamId = inA ? match.teamA._id : match.teamB._id;
  match.scorerName = target.playerName;
  await match.save();

  getIO().emit("scoring:transferred", { matchId, scorerUserId: targetUserId });

  return match;
};