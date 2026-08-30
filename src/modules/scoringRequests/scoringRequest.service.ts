import mongoose from "mongoose";

import ScoringRequest from "./scoringRequest.model";
import Match from "../matches/match.model";
import Team from "../teams/team.model";

import { assertCanEditTeam } from "../teams/team.service";

import { createNotification } from "../notifications/notification.service";
import { NOTIFICATION_TYPES } from "../notifications/notification.types";

/*
|--------------------------------------------------------------------------
| Scoring Request Service
|--------------------------------------------------------------------------
|
| The Quick Score consent flow.
|
| ONE RULE RUNS THROUGH ALL OF IT:
|
|   For each of the two teams the requester does NOT manage, that team's
|   captain must approve, and later that team's PIN must be entered to
|   start scoring.
|
|   manages both teams   -> 0 approvals, 0 PINs, match created immediately
|   manages one team     -> 1 approval,  1 PIN   (same as Add Match)
|   manages neither      -> 2 approvals, 2 PINs
|
| Approval and PIN answer different questions and that is why both exist:
| approval says "we agreed to play this match", the PIN says "we are at the
| ground and it is starting now".
|
| The knockabout case needs no special handling. Someone scoring a casual
| game has to create both teams first, which makes them the owner of both -
| the top row - so no approvals and no PINs, without a bypass flag that
| would let anyone skip consent on a real fixture.
|
*/

const canManageTeam = async (team: any, userId: string): Promise<boolean> => {
  try {
    await assertCanEditTeam(team, userId);

    return true;
  } catch {
    return false;
  }
};

const generateMatchPin = (): string =>
  String(Math.floor(1000 + Math.random() * 9000));

/*
|--------------------------------------------------------------------------
| Create The Match From An Approved Request
|--------------------------------------------------------------------------
|
| Mirrors the Match.create in matchChallenge.service.ts so a Quick Score
| match and a challenge match are the same shape - same PIN pair, same
| fields - and everything downstream (scoring, scorecards, stats) treats
| them identically.
|
| Guarded on request.matchId so two approvals landing at the same moment
| cannot produce two matches.
|
*/

const createMatchFromRequest = async (request: any) => {
  if (request.matchId) {
    return await Match.findById(request.matchId);
  }

  const [teamA, teamB] = await Promise.all([
    Team.findById(request.teamA).select("teamName userId"),
    Team.findById(request.teamB).select("teamName userId"),
  ]);

  const match = await Match.create({
    userId: request.requestedBy,

    /*
    | The requester is the scorer, so they are the invite sender too - that
    | is the field startMatch and transferScoring read to decide who may
    | score.
    */
    inviteSenderUserId: request.requestedBy,

    scorerUserId: request.requestedBy,

    matchTitle:
      request.matchTitle ||
      `${teamA?.teamName || "Team A"} vs ${teamB?.teamName || "Team B"}`,

    matchType: request.matchType,

    teamA: request.teamA,

    teamB: request.teamB,

    overs: request.overs,

    ballType: request.ballType,

    pitchType: request.pitchType,

    umpire1: request.umpire1,

    umpire2: request.umpire2,

    scorer: request.scorer,

    startTime: request.startTime,

    scheduledStartTime: request.startTime,

    groundId: request.groundId || null,

    venueName: request.venueName || "",

    teamAPin: generateMatchPin(),

    teamBPin: generateMatchPin(),
  });

  request.matchId = match._id;

  return match;
};

/*
|--------------------------------------------------------------------------
| Deliver Each Captain Their PIN
|--------------------------------------------------------------------------
|
| Sent only to the captains whose approval was actually required. A captain
| whose team the requester manages already has scoring rights and is not
| being asked to prove anything.
|
| The message says explicitly that handing the PIN over is the consent -
| the PIN is worth nothing as a security measure if people read it out
| without understanding that.
|
*/

const sendPinNotifications = async (request: any, match: any) => {
  const [teamA, teamB] = await Promise.all([
    Team.findById(request.teamA).select("teamName userId"),
    Team.findById(request.teamB).select("teamName userId"),
  ]);

  const sides = [
    { key: "teamA", team: teamA, pin: match.teamAPin },
    { key: "teamB", team: teamB, pin: match.teamBPin },
  ];

  for (const side of sides) {
    if (request.approvals?.[side.key]?.status !== "approved") {
      continue;
    }

    if (!side.team?.userId) {
      continue;
    }

    try {
      await createNotification({
        receiverId: String(side.team.userId),

        actorId: String(request.requestedBy),

        type: NOTIFICATION_TYPES.MATCH_PIN_SHARED,

        title: "Your Match PIN",

        message: `PIN ${side.pin} for ${teamA?.teamName || "Team A"} vs ${
          teamB?.teamName || "Team B"
        }. Give it to the scorer only when you are ready to start.`,

        data: {
          matchId: String(match._id),

          teamId: String(side.team._id),

          pin: side.pin,
        },
      });
    } catch (error) {
      console.error("Failed to send match PIN notification:", error);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Create A Scoring Request
|--------------------------------------------------------------------------
*/

export const createScoringRequest = async (userId: string, payload: any) => {
  const { teamA: teamAId, teamB: teamBId } = payload || {};

  if (!teamAId || !mongoose.Types.ObjectId.isValid(teamAId)) {
    throw new Error("A valid Team A is required.");
  }

  if (!teamBId || !mongoose.Types.ObjectId.isValid(teamBId)) {
    throw new Error("A valid Team B is required.");
  }

  if (String(teamAId) === String(teamBId)) {
    throw new Error("A team cannot play itself.");
  }

  const [teamA, teamB] = await Promise.all([
    Team.findById(teamAId),
    Team.findById(teamBId),
  ]);

  if (!teamA || teamA.isActive === false) {
    throw new Error("Team A not found.");
  }

  if (!teamB || teamB.isActive === false) {
    throw new Error("Team B not found.");
  }

  const [managesA, managesB] = await Promise.all([
    canManageTeam(teamA, userId),
    canManageTeam(teamB, userId),
  ]);

  const request = new ScoringRequest({
    requestedBy: userId,

    teamA: teamA._id,

    teamB: teamB._id,

    matchTitle: payload.matchTitle || "",

    matchType: payload.matchType || "T20",

    overs: payload.overs || 20,

    ballType: payload.ballType || "Leather",

    pitchType: payload.pitchType || "Turf",

    umpire1: payload.umpire1 || "",

    umpire2: payload.umpire2 || "",

    scorer: payload.scorer || "",

    groundId: payload.groundId || null,

    venueName: payload.venueName || "",

    /*
    | Quick Match sends the current time; Scheduled Match sends the chosen
    | one. Falling back to now rather than null keeps the fixture concrete
    | for the captain being asked to approve it.
    */
    startTime: payload.startTime ? new Date(payload.startTime) : new Date(),

    approvals: {
      teamA: { status: managesA ? "not_required" : "pending" },

      teamB: { status: managesB ? "not_required" : "pending" },
    },
  });

  /*
  |--------------------------------------------------------------------------
  | Nobody To Ask
  |--------------------------------------------------------------------------
  |
  | The requester manages both teams, so there is no third party whose
  | consent is missing. The match is created immediately and the flow goes
  | straight on to squad selection - no waiting, no PIN.
  |
  */

  if (managesA && managesB) {
    request.status = "APPROVED" as any;

    const match = await createMatchFromRequest(request);

    await request.save();

    return {
      request,

      match,

      readyToScore: true,
    };
  }

  await request.save();

  /*
  |--------------------------------------------------------------------------
  | Ask The Captains Who Have Not Agreed
  |--------------------------------------------------------------------------
  */

  const pendingSides = [
    { key: "teamA", team: teamA, opponent: teamB },
    { key: "teamB", team: teamB, opponent: teamA },
  ].filter((side) => (request.approvals as any)?.[side.key]?.status === "pending");

  for (const side of pendingSides) {
    if (!side.team?.userId) {
      continue;
    }

    try {
      await createNotification({
        receiverId: String(side.team.userId),

        actorId: userId,

        type: NOTIFICATION_TYPES.SCORING_REQUEST_RECEIVED,

        title: "Scoring Request",

        message: `Someone wants to score ${teamA.teamName} vs ${teamB.teamName}${
          request.venueName ? ` at ${request.venueName}` : ""
        }. Approve if your team agreed to this match.`,

        data: {
          scoringRequestId: String(request._id),

          teamId: String(side.team._id),

          opponentTeamName: side.opponent.teamName,
        },
      });
    } catch (error) {
      console.error("Failed to send scoring-request notification:", error);
    }
  }

  return {
    request,

    match: null,

    readyToScore: false,
  };
};

/*
|--------------------------------------------------------------------------
| Approve Or Reject
|--------------------------------------------------------------------------
|
| The side being answered for is resolved from the CALLER's permissions,
| never from the request body - otherwise a captain of Team A could approve
| on Team B's behalf, which would defeat the whole mechanism.
|
*/

export const respondToScoringRequest = async (
  userId: string,
  requestId: string,
  decision: "approve" | "reject",
) => {
  const request = await ScoringRequest.findById(requestId);

  if (!request) {
    throw new Error("Scoring request not found.");
  }

  if (request.status === "CANCELLED") {
    throw new Error("This request was cancelled.");
  }

  if (request.status === "REJECTED") {
    throw new Error("This request was already declined.");
  }

  const [teamA, teamB] = await Promise.all([
    Team.findById(request.teamA),
    Team.findById(request.teamB),
  ]);

  const [managesA, managesB] = await Promise.all([
    teamA ? canManageTeam(teamA, userId) : Promise.resolve(false),
    teamB ? canManageTeam(teamB, userId) : Promise.resolve(false),
  ]);

  const approvals = request.approvals as any;

  /*
  | Whichever side this user can answer for AND that is still pending. A
  | captain who manages both teams in the fixture answers for whichever one
  | is outstanding.
  */

  let side: "teamA" | "teamB" | null = null;

  if (managesA && approvals?.teamA?.status === "pending") {
    side = "teamA";
  } else if (managesB && approvals?.teamB?.status === "pending") {
    side = "teamB";
  }

  if (!side) {
    if (!managesA && !managesB) {
      throw new Error("You do not manage either team in this match.");
    }

    throw new Error("Your team has already responded to this request.");
  }

  approvals[side].status = decision === "approve" ? "approved" : "rejected";

  approvals[side].respondedBy = userId as any;

  approvals[side].respondedAt = new Date();

  /*
  |--------------------------------------------------------------------------
  | Rejected - One No Is Enough
  |--------------------------------------------------------------------------
  */

  if (decision === "reject") {
    request.status = "REJECTED" as any;

    await request.save();

    try {
      const decliningTeam = side === "teamA" ? teamA : teamB;

      await createNotification({
        receiverId: String(request.requestedBy),

        actorId: userId,

        type: NOTIFICATION_TYPES.SCORING_REQUEST_REJECTED,

        title: "Scoring Request Declined",

        message: `${decliningTeam?.teamName || "A team"} declined the request to score ${
          teamA?.teamName || "Team A"
        } vs ${teamB?.teamName || "Team B"}.`,

        data: {
          scoringRequestId: String(request._id),
        },
      });
    } catch (error) {
      console.error("Failed to send scoring-request-rejected notification:", error);
    }

    return { request, match: null, readyToScore: false };
  }

  /*
  |--------------------------------------------------------------------------
  | Approved - Is Everyone In?
  |--------------------------------------------------------------------------
  */

  const stillWaiting =
    approvals.teamA.status === "pending" || approvals.teamB.status === "pending";

  if (stillWaiting) {
    await request.save();

    return { request, match: null, readyToScore: false };
  }

  request.status = "APPROVED" as any;

  const match = await createMatchFromRequest(request);

  await request.save();

  // PINs go out only now - there is no match, and no PIN, before this point.
  if (match) {
    await sendPinNotifications(request, match);
  }

  try {
    await createNotification({
      receiverId: String(request.requestedBy),

      actorId: userId,

      type: NOTIFICATION_TYPES.SCORING_REQUEST_APPROVED,

      title: "Both Teams Approved",

      message: `${teamA?.teamName || "Team A"} vs ${
        teamB?.teamName || "Team B"
      } is ready. Ask each captain for their PIN to start scoring.`,

      data: {
        scoringRequestId: String(request._id),

        matchId: match ? String(match._id) : null,
      },
    });
  } catch (error) {
    console.error("Failed to send scoring-request-approved notification:", error);
  }

  return { request, match, readyToScore: true };
};

/*
|--------------------------------------------------------------------------
| The Scorer's List
|--------------------------------------------------------------------------
|
| What the sidebar's "Scoring Requests" screen renders. Each row carries
| both teams and the per-side status, so the list can say exactly who is
| still being waited on rather than a bare "pending".
|
*/

export const getMyScoringRequests = async (userId: string) => {
  return await ScoringRequest.find({
    requestedBy: userId,
  })
    .populate("teamA", "teamName shortName logo city")
    .populate("teamB", "teamName shortName logo city")
    .populate("matchId", "status startTime")
    .sort({ createdAt: -1 });
};

/*
|--------------------------------------------------------------------------
| Requests Awaiting My Teams
|--------------------------------------------------------------------------
|
| A captain's own inbox. The notification is the prompt, but a captain who
| cleared it still needs somewhere to find outstanding requests.
|
*/

export const getScoringRequestsForMyTeams = async (userId: string) => {
  const myTeams = await Team.find({ userId }).select("_id");

  const teamIds = myTeams.map((t) => t._id);

  if (teamIds.length === 0) {
    return [];
  }

  return await ScoringRequest.find({
    status: "PENDING",

    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  })
    .populate("teamA", "teamName shortName logo city")
    .populate("teamB", "teamName shortName logo city")
    .populate("requestedBy", "fullName")
    .sort({ createdAt: -1 });
};

/*
|--------------------------------------------------------------------------
| Cancel
|--------------------------------------------------------------------------
|
| The requester withdrawing their own request. Refused once the match
| exists - at that point it is a real fixture and cancelling belongs to the
| match, not to this document.
|
*/

export const cancelScoringRequest = async (
  userId: string,
  requestId: string,
) => {
  const request = await ScoringRequest.findById(requestId);

  if (!request) {
    throw new Error("Scoring request not found.");
  }

  if (String(request.requestedBy) !== String(userId)) {
    throw new Error("Only the person who created this request can cancel it.");
  }

  if (request.matchId) {
    throw new Error(
      "This match has already been created. Cancel the match instead.",
    );
  }

  request.status = "CANCELLED" as any;

  await request.save();

  return request;
};
