import MatchChallenge, {
  REJECTION_REASONS,
  MATCH_TYPES,
  BALL_TYPES,
  PITCH_TYPES,
} from "./matchChallenge.model";
import Team from "../teams/team.model";
import Match from "../matches/match.model";
import Player from "../players/player.model";

import { assertCanEditTeam } from "../teams/team.service";
import { isTeamAvailable, startOfDay } from "../teams/teamAvailability.service";

import {
  sendMatchChallengeReceivedNotification,
  sendMatchChallengeAcceptedNotification,
  sendMatchChallengeRejectedNotification,
  sendMatchChallengeCancelledNotification,
  sendMatchChallengeModifiedNotification,
  sendMatchCancelledNotification,
} from "../notifications/notification.helper";

/*
|--------------------------------------------------------------------------
| Shared Types
|--------------------------------------------------------------------------
*/

type BallType = "Leather" | "Tennis" | "Other";
type PitchType = "Turf" | "Matting" | "Concrete";

/*
|--------------------------------------------------------------------------
| Whose Turn Is It
|--------------------------------------------------------------------------
*/

const assertIsPendingResponder = async (challenge: any, userId: string) => {
  const pendingTeam =
    String(challenge.pendingResponseFrom) ===
    String(challenge.challengerTeamId._id || challenge.challengerTeamId)
      ? challenge.challengerTeamId
      : challenge.challengedTeamId;

  const team = pendingTeam._id ? pendingTeam : await Team.findById(pendingTeam);

  if (!team) {
    throw new Error("Team not found.");
  }

  try {
    await assertCanEditTeam(team, userId);
  } catch {
    throw new Error("It's the other team's turn to respond to this challenge.");
  }

  return team;
};

/*
|--------------------------------------------------------------------------
| Send Challenge
|--------------------------------------------------------------------------
*/

export const sendChallenge = async (
  userId: string,
  payload: {
    challengerTeamId: string;
    challengedTeamId: string;
    proposedDate?: Date | string;
    proposedTime?: string;
    groundId?: string;
    venueName?: string;
    matchType?: string;
    overs?: number;
    message?: string;
    matchTitle?: string;
    tournament?: string;
    ballType?: string;
    pitchType?: string;
    umpire1?: string;
    umpire2?: string;
    scorer?: string;
  },
) => {
  const {
    challengerTeamId,
    challengedTeamId,
    proposedDate,
    proposedTime,
    groundId,
    venueName,
    matchType,
    overs,
    message,
    matchTitle,
    tournament,
    ballType,
    pitchType,
    umpire1,
    umpire2,
    scorer,
  } = payload;

  if (String(challengerTeamId) === String(challengedTeamId)) {
    throw new Error("A team cannot challenge itself.");
  }

  const challengerTeam = await Team.findById(challengerTeamId);

  if (!challengerTeam) {
    throw new Error("Your team was not found.");
  }

  await assertCanEditTeam(challengerTeam, userId);

  const challengedTeam = await Team.findById(challengedTeamId);

  if (!challengedTeam) {
    throw new Error("Challenged team not found.");
  }

  // Quick matches have no date — skip availability checks in that case.
  const day = proposedDate ? startOfDay(proposedDate) : null;

  if (day) {
    const [challengerAvailability, challengedAvailability] = await Promise.all([
      isTeamAvailable(challengerTeamId, day),
      isTeamAvailable(challengedTeamId, day),
    ]);

    if (!challengerAvailability.available) {
      throw new Error(
        `Your team is not available that day: ${challengerAvailability.reason}`,
      );
    }

    if (!challengedAvailability.available) {
      throw new Error(
        `${challengedTeam.teamName} is not available that day: ${challengedAvailability.reason}`,
      );
    }
  }

  const creator = await Player.findOne({ userId });

  if (!creator) {
    throw new Error("Please complete your player profile first.");
  }

  const resolvedMatchType = matchType || "T20";

  if (!MATCH_TYPES.includes(resolvedMatchType as any)) {
    throw new Error(`Match type must be one of: ${MATCH_TYPES.join(", ")}.`);
  }

  const challenge = await MatchChallenge.create({
    challengerTeamId,
    challengedTeamId,
    proposedDate: day,
    proposedTime: proposedTime || "",
    groundId: groundId || null,
    venueName: venueName || "",
    matchType: resolvedMatchType as (typeof MATCH_TYPES)[number],
    overs: overs || 20,
    message: message || "",
    matchTitle: matchTitle || "",
    tournament: tournament || "",
    ballType: (ballType || "Leather") as (typeof BALL_TYPES)[number],
    pitchType: (pitchType || "Turf") as (typeof PITCH_TYPES)[number],
    umpire1: umpire1 || "",
    umpire2: umpire2 || "",
    scorer: scorer || "",
    createdBy: creator._id,
    pendingResponseFrom: challengedTeamId,
  });

  try {
    await sendMatchChallengeReceivedNotification({
      receiverId: challengedTeam.userId.toString(),
      actorId: userId,
      challengeId: challenge._id.toString(),
      teamId: challengedTeam._id.toString(),
      challengerTeamName: challengerTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-challenge-received notification:",
      notificationError,
    );
  }

  return await MatchChallenge.findById(challenge._id)
    .populate("challengerTeamId")
    .populate("challengedTeamId")
    .populate("groundId");
};

/*
|--------------------------------------------------------------------------
| Get Challenges For A Team
|--------------------------------------------------------------------------
*/

export const getChallengesForTeam = async (
  userId: string,
  teamId: string,
  direction: "received" | "sent",
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanEditTeam(team, userId);

  const query =
    direction === "sent"
      ? { challengerTeamId: teamId }
      : { challengedTeamId: teamId };

  return await MatchChallenge.find(query)
    .populate("challengerTeamId")
    .populate("challengedTeamId")
    .populate("groundId")
    .sort({ createdAt: -1 });
};

/*
|--------------------------------------------------------------------------
| Get Challenge By Id
|--------------------------------------------------------------------------
*/

export const getChallengeById = async (challengeId: string) => {
  const challenge = await MatchChallenge.findById(challengeId)
    .populate("challengerTeamId")
    .populate("challengedTeamId")
    .populate("groundId")
    .populate("matchId");

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  return challenge;
};

/*
|--------------------------------------------------------------------------
| Accept Challenge
|--------------------------------------------------------------------------
*/

export const acceptChallenge = async (userId: string, challengeId: string) => {
  const challenge = await MatchChallenge.findById(challengeId)
    .populate("challengerTeamId")
    .populate("challengedTeamId");

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  if (challenge.status !== "PENDING") {
    throw new Error("This challenge has already been responded to.");
  }

  const challengedTeam = challenge.challengedTeamId as any;
  const challengerTeam = challenge.challengerTeamId as any;

  const respondingTeam = await assertIsPendingResponder(challenge, userId);
  const otherTeam =
    String(respondingTeam._id) === String(challengerTeam._id)
      ? challengedTeam
      : challengerTeam;

  /*
  |--------------------------------------------------------------------------
  | Re-Check Availability (only when a date was proposed)
  |--------------------------------------------------------------------------
  */

  if (challenge.proposedDate) {
    const [challengerAvailability, challengedAvailability] = await Promise.all([
      isTeamAvailable(challengerTeam._id, challenge.proposedDate),
      isTeamAvailable(challengedTeam._id, challenge.proposedDate),
    ]);

    if (
      !challengerAvailability.available ||
      !challengedAvailability.available
    ) {
      challenge.status = "EXPIRED";
      await challenge.save();

      throw new Error(
        "This date is no longer available for one of the teams. The challenge has been marked expired.",
      );
    }
  }

  const generateMatchPin = (): string => {
      return String(Math.floor(1000 + Math.random() * 9000));
    };

    const teamAPin = generateMatchPin();
    const teamBPin = generateMatchPin();

    const match = await Match.create({
      userId,
      inviteSenderUserId: challengerTeam.userId,
      matchTitle: challenge.matchTitle || `${challengerTeam.teamName} vs ${challengedTeam.teamName}`,
      matchType: challenge.matchType,
      teamA: challengerTeam._id,
      teamB: challengedTeam._id,
      overs: challenge.overs,
      ballType: challenge.ballType,
      pitchType: challenge.pitchType,
      umpire1: challenge.umpire1,
      umpire2: challenge.umpire2,
      scorer: challenge.scorer,
      startTime: challenge.proposedDate,
      groundId: challenge.groundId || null,
      venueName: challenge.venueName || "",
      challengeId: challenge._id,
      teamAPin,
      teamBPin,
    });

  challenge.status = "ACCEPTED";
  challenge.respondedAt = new Date();
  challenge.matchId = match._id;
  await challenge.save();

  try {
    await sendMatchChallengeAcceptedNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      challengeId: challenge._id.toString(),
      teamId: respondingTeam._id.toString(),
      opponentTeamName: respondingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-challenge-accepted notification:",
      notificationError,
    );
  }

  return await MatchChallenge.findById(challenge._id)
    .populate("challengerTeamId")
    .populate("challengedTeamId")
    .populate("matchId");
};

/*
|--------------------------------------------------------------------------
| Reject Challenge
|--------------------------------------------------------------------------
*/

export const rejectChallenge = async (
  userId: string,
  challengeId: string,
  payload: { reason: string; message?: string },
) => {
  const challenge = await MatchChallenge.findById(challengeId)
    .populate("challengerTeamId")
    .populate("challengedTeamId");

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  if (challenge.status !== "PENDING") {
    throw new Error("This challenge has already been responded to.");
  }

  const challengedTeam = challenge.challengedTeamId as any;
  const challengerTeam = challenge.challengerTeamId as any;

  const respondingTeam = await assertIsPendingResponder(challenge, userId);
  const otherTeam =
    String(respondingTeam._id) === String(challengerTeam._id)
      ? challengedTeam
      : challengerTeam;

  if (!payload.reason) {
    throw new Error("A rejection reason is required.");
  }

  if (!REJECTION_REASONS.includes(payload.reason as any)) {
    throw new Error(`Reason must be one of: ${REJECTION_REASONS.join(", ")}.`);
  }

  challenge.status = "REJECTED";
  challenge.rejectionReason =
    payload.reason as (typeof REJECTION_REASONS)[number];
  challenge.rejectionMessage = payload.message || "";
  challenge.respondedAt = new Date();
  await challenge.save();

  const displayReason =
    payload.reason === "Other" && payload.message
      ? payload.message
      : payload.reason;

  try {
    await sendMatchChallengeRejectedNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      challengeId: challenge._id.toString(),
      teamId: respondingTeam._id.toString(),
      opponentTeamName: respondingTeam.teamName,
      reason: displayReason,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-challenge-rejected notification:",
      notificationError,
    );
  }

  return await MatchChallenge.findById(challenge._id)
    .populate("challengerTeamId")
    .populate("challengedTeamId");
};

/*
|--------------------------------------------------------------------------
| Modify Challenge (Counter-Proposal)
|--------------------------------------------------------------------------
*/

export const modifyChallenge = async (
  userId: string,
  challengeId: string,
  updates: {
    proposedDate?: Date | string;
    proposedTime?: string;
    groundId?: string;
    venueName?: string;
    matchType?: string;
    overs?: number;
    message?: string;
    matchTitle?: string;
    tournament?: string;
    ballType?: string;
    pitchType?: string;
    umpire1?: string;
    umpire2?: string;
    scorer?: string;
  },
) => {
  const challenge = await MatchChallenge.findById(challengeId)
    .populate("challengerTeamId")
    .populate("challengedTeamId");

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  if (challenge.status !== "PENDING") {
    throw new Error("This challenge has already been responded to.");
  }

  const challengedTeam = challenge.challengedTeamId as any;
  const challengerTeam = challenge.challengerTeamId as any;

  const respondingTeam = await assertIsPendingResponder(challenge, userId);
  const otherTeam =
    String(respondingTeam._id) === String(challengerTeam._id)
      ? challengedTeam
      : challengerTeam;

  const nextDate = updates.proposedDate
    ? startOfDay(updates.proposedDate)
    : (challenge.proposedDate as Date);

  /*
  |--------------------------------------------------------------------------
  | Re-Check Availability For The New Date
  |--------------------------------------------------------------------------
  */

  if (updates.proposedDate) {
    const newDate = startOfDay(updates.proposedDate);

    const [challengerAvailability, challengedAvailability] = await Promise.all([
      isTeamAvailable(challengerTeam._id, newDate),
      isTeamAvailable(challengedTeam._id, newDate),
    ]);

    if (!challengerAvailability.available) {
      throw new Error(
        `${challengerTeam.teamName} is not available that day: ${challengerAvailability.reason}`,
      );
    }

    if (!challengedAvailability.available) {
      throw new Error(
        `${challengedTeam.teamName} is not available that day: ${challengedAvailability.reason}`,
      );
    }
  }

  if (updates.matchType && !MATCH_TYPES.includes(updates.matchType as any)) {
    throw new Error(`Match type must be one of: ${MATCH_TYPES.join(", ")}.`);
  }

  /*
  |--------------------------------------------------------------------------
  | Record What Changed, Then Apply It
  |--------------------------------------------------------------------------
  */

  challenge.modificationHistory.push({
    modifiedBy: respondingTeam._id,
    proposedDate: nextDate,
    proposedTime: updates.proposedTime ?? challenge.proposedTime,
    groundId: updates.groundId ?? challenge.groundId,
    venueName: updates.venueName ?? challenge.venueName,
    matchType: updates.matchType ?? challenge.matchType,
    overs: updates.overs ?? challenge.overs,
    message: updates.message ?? challenge.message,
    matchTitle: updates.matchTitle ?? challenge.matchTitle,
    tournament: updates.tournament ?? challenge.tournament,
    ballType: updates.ballType ?? challenge.ballType,
    pitchType: updates.pitchType ?? challenge.pitchType,
    umpire1: updates.umpire1 ?? challenge.umpire1,
    umpire2: updates.umpire2 ?? challenge.umpire2,
    scorer: updates.scorer ?? challenge.scorer,
    modifiedAt: new Date(),
  } as any);

  challenge.proposedDate = nextDate;
  if (updates.proposedTime !== undefined)
    challenge.proposedTime = updates.proposedTime;
  if (updates.groundId !== undefined)
    challenge.groundId = updates.groundId as any;
  if (updates.venueName !== undefined) challenge.venueName = updates.venueName;
  if (updates.matchType !== undefined)
    challenge.matchType = updates.matchType as any;
  if (updates.overs !== undefined) challenge.overs = updates.overs;
  if (updates.message !== undefined) challenge.message = updates.message;
  if (updates.matchTitle !== undefined) challenge.matchTitle = updates.matchTitle;
  if (updates.tournament !== undefined) challenge.tournament = updates.tournament;
  if (updates.ballType !== undefined)
    challenge.ballType = updates.ballType as (typeof BALL_TYPES)[number];
  if (updates.pitchType !== undefined)
    challenge.pitchType = updates.pitchType as (typeof PITCH_TYPES)[number];
  if (updates.umpire1 !== undefined) challenge.umpire1 = updates.umpire1;
  if (updates.umpire2 !== undefined) challenge.umpire2 = updates.umpire2;
  if (updates.scorer !== undefined) challenge.scorer = updates.scorer;

  challenge.pendingResponseFrom = otherTeam._id;

  await challenge.save();

  try {
    await sendMatchChallengeModifiedNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      challengeId: challenge._id.toString(),
      teamId: respondingTeam._id.toString(),
      modifiedByTeamName: respondingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-challenge-modified notification:",
      notificationError,
    );
  }

  return await MatchChallenge.findById(challenge._id)
    .populate("challengerTeamId")
    .populate("challengedTeamId")
    .populate("groundId")
    .populate("pendingResponseFrom");
};

/*
|--------------------------------------------------------------------------
| Cancel Challenge (By Whoever Is Currently Waiting)
|--------------------------------------------------------------------------
*/

export const cancelChallenge = async (userId: string, challengeId: string) => {
  const challenge = await MatchChallenge.findById(challengeId)
    .populate("challengerTeamId")
    .populate("challengedTeamId");

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  if (challenge.status !== "PENDING") {
    throw new Error("Only a pending challenge can be cancelled.");
  }

  const challengerTeam = challenge.challengerTeamId as any;
  const challengedTeam = challenge.challengedTeamId as any;

  const waitingTeam =
    String(challenge.pendingResponseFrom) === String(challengerTeam._id)
      ? challengedTeam
      : challengerTeam;

  const otherTeam =
    String(waitingTeam._id) === String(challengerTeam._id)
      ? challengedTeam
      : challengerTeam;

  await assertCanEditTeam(waitingTeam, userId);

  challenge.status = "CANCELLED";
  challenge.respondedAt = new Date();
  await challenge.save();

  try {
    await sendMatchChallengeCancelledNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      challengeId: challenge._id.toString(),
      teamId: waitingTeam._id.toString(),
      teamName: waitingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-challenge-cancelled notification:",
      notificationError,
    );
  }

  return challenge;
};

/*
|--------------------------------------------------------------------------
| Cancel A Confirmed Match (Post-Acceptance)
|--------------------------------------------------------------------------
*/

export const cancelConfirmedMatch = async (userId: string, matchId: string) => {
  const match = await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB");

  if (!match) {
    throw new Error("Match not found.");
  }

  if (match.status !== "upcoming") {
    throw new Error("Only an upcoming match can be cancelled.");
  }

  const teamA = match.teamA as any;
  const teamB = match.teamB as any;

  let actingTeam;
  let otherTeam;

  try {
    await assertCanEditTeam(teamA, userId);
    actingTeam = teamA;
    otherTeam = teamB;
  } catch {
    await assertCanEditTeam(teamB, userId);
    actingTeam = teamB;
    otherTeam = teamA;
  }

  match.status = "cancelled";
  await match.save();

  try {
    await sendMatchCancelledNotification({
      receiverId: otherTeam.userId.toString(),
      actorId: userId,
      matchId: match._id.toString(),
      teamName: actingTeam.teamName,
    });
  } catch (notificationError) {
    console.error(
      "Failed to send match-cancelled notification:",
      notificationError,
    );
  }

  return match;
};