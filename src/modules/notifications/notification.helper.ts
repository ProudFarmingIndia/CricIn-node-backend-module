import { createNotification } from "./notification.service";

import { NOTIFICATION_TYPES } from "./notification.types";

/*
|--------------------------------------------------------------------------
| Team Invitation Received
|--------------------------------------------------------------------------
*/

export const sendTeamInvitationNotification = async ({
  receiverId,
  actorId,
  invitationId,
  teamId,
  playerId,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  invitationId: string;

  teamId: string;

  playerId: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.TEAM_INVITATION_RECEIVED,

    title: "Team Invitation",

    message: `${teamName} invited you to join the team.`,

    data: {
      invitationId,

      teamId,

      playerId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Invitation Accepted
|--------------------------------------------------------------------------
*/

export const sendInvitationAcceptedNotification = async ({
  receiverId,
  actorId,
  invitationId,
  teamId,
  playerId,
  playerName,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  invitationId: string;

  teamId: string;

  playerId: string;

  playerName: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.TEAM_INVITATION_ACCEPTED,

    title: "Invitation Accepted",

    message: `${playerName} accepted your team invitation.`,

    data: {
      invitationId,

      teamId,

      playerId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Invitation Rejected
|--------------------------------------------------------------------------
*/

export const sendInvitationRejectedNotification = async ({
  receiverId,
  actorId,
  invitationId,
  teamId,
  playerId,
  playerName,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  invitationId: string;

  teamId: string;

  playerId: string;

  playerName: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.TEAM_INVITATION_REJECTED,

    title: "Invitation Rejected",

    message: `${playerName} rejected your invitation.`,

    data: {
      invitationId,

      teamId,

      playerId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Invitation Cancelled
|--------------------------------------------------------------------------
*/

export const sendInvitationCancelledNotification = async ({
  receiverId,
  actorId,
  invitationId,
  teamId,
  playerId,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  invitationId: string;

  teamId: string;

  playerId: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.TEAM_INVITATION_CANCELLED,

    title: "Invitation Cancelled",

    message: `${teamName} cancelled your invitation.`,

    data: {
      invitationId,

      teamId,

      playerId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Team Created
|--------------------------------------------------------------------------
*/

export const sendTeamCreatedNotification = async ({
  receiverId,
  actorId,
  teamId,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  teamId: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.TEAM_CREATED,

    title: "Team Created",

    message: `${teamName} has been created successfully.`,

    data: {
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Player Joined Team
|--------------------------------------------------------------------------
*/

export const sendPlayerJoinedTeamNotification = async ({
  receiverId,
  actorId,
  teamId,
  playerId,
  playerName,
}: {
  receiverId: string;

  actorId: string;

  teamId: string;

  playerId: string;

  playerName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.PLAYER_JOINED_TEAM,

    title: "Player Joined",

    message: `${playerName} joined your team.`,

    data: {
      teamId,

      playerId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Player Left Team
|--------------------------------------------------------------------------
*/

export const sendPlayerLeftTeamNotification = async ({
  receiverId,
  actorId,
  teamId,
  playerId,
  playerName,
}: {
  receiverId: string;

  actorId: string;

  teamId: string;

  playerId: string;

  playerName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.PLAYER_LEFT_TEAM,

    title: "Player Left",

    message: `${playerName} left your team.`,

    data: {
      teamId,

      playerId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Vice-Captain Proposed (Actionable - Sent To Proposed Player)
|--------------------------------------------------------------------------
*/

export const sendViceCaptainProposedNotification = async ({
  receiverId,
  actorId,
  proposalId,
  teamId,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  proposalId: string;

  teamId: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.VICE_CAPTAIN_PROPOSED,

    title: "Vice-Captain Proposal",

    message: `${teamName} wants to make you Vice-Captain.`,

    data: {
      proposalId,

      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Vice-Captain Proposal Rejected (Sent To Captain)
|--------------------------------------------------------------------------
*/

export const sendViceCaptainCancelledNotification = async ({
  receiverId,
  actorId,
  proposalId,
  teamId,
  teamName,
}: {
  receiverId: string;
  actorId: string;
  proposalId: string;
  teamId: string;
  teamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.VICE_CAPTAIN_CANCELLED,
    title: "Proposal Withdrawn",
    message: `${teamName} withdrew their vice-captain proposal.`,
    data: {
      proposalId,
      teamId,
    },
  });
};

export const sendViceCaptainRejectedNotification = async ({
  receiverId,
  actorId,
  proposalId,
  teamId,
  playerName,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  proposalId: string;

  teamId: string;

  playerName: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.VICE_CAPTAIN_REJECTED,

    title: "Proposal Declined",

    message: `${playerName} declined to become Vice-Captain of ${teamName}.`,

    data: {
      proposalId,

      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Captain Assigned
|--------------------------------------------------------------------------
*/

export const sendCaptainAssignedNotification = async ({
  receiverId,
  actorId,
  teamId,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  teamId: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.CAPTAIN_ASSIGNED,

    title: "Captain Assigned",

    message: `You are now Captain of ${teamName}.`,

    data: {
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Vice Captain Assigned
|--------------------------------------------------------------------------
*/

export const sendViceCaptainAssignedNotification = async ({
  receiverId,
  actorId,
  teamId,
  teamName,
}: {
  receiverId: string;

  actorId: string;

  teamId: string;

  teamName: string;
}) => {
  return createNotification({
    receiverId,

    actorId,

    type: NOTIFICATION_TYPES.VICE_CAPTAIN_ASSIGNED,

    title: "Vice Captain Assigned",

    message: `You are now Vice Captain of ${teamName}.`,

    data: {
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Challenge Received (Actionable)
|--------------------------------------------------------------------------
*/

export const sendMatchChallengeReceivedNotification = async ({
  receiverId,
  actorId,
  challengeId,
  teamId,
  challengerTeamName,
}: {
  receiverId: string;
  actorId: string;
  challengeId: string;
  teamId: string;
  challengerTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CHALLENGE_RECEIVED,
    title: "Match Challenge",
    message: `${challengerTeamName} wants to schedule a match with your team.`,
    data: {
      challengeId,
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Challenge Accepted
|--------------------------------------------------------------------------
*/

export const sendMatchChallengeAcceptedNotification = async ({
  receiverId,
  actorId,
  challengeId,
  teamId,
  opponentTeamName,
}: {
  receiverId: string;
  actorId: string;
  challengeId: string;
  teamId: string;
  opponentTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CHALLENGE_ACCEPTED,
    title: "Challenge Accepted",
    message: `${opponentTeamName} accepted your match challenge.`,
    data: {
      challengeId,
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Challenge Rejected (Carries The Reason)
|--------------------------------------------------------------------------
*/

export const sendMatchChallengeRejectedNotification = async ({
  receiverId,
  actorId,
  challengeId,
  teamId,
  opponentTeamName,
  reason,
}: {
  receiverId: string;
  actorId: string;
  challengeId: string;
  teamId: string;
  opponentTeamName: string;
  reason: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CHALLENGE_REJECTED,
    title: "Challenge Declined",
    message: `${opponentTeamName} declined: ${reason}`,
    data: {
      challengeId,
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Challenge Modified (Actionable - It's The Other Team's Turn Now)
|--------------------------------------------------------------------------
*/

export const sendMatchChallengeModifiedNotification = async ({
  receiverId,
  actorId,
  challengeId,
  teamId,
  modifiedByTeamName,
}: {
  receiverId: string;
  actorId: string;
  challengeId: string;
  teamId: string;
  modifiedByTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CHALLENGE_MODIFIED,
    title: "Challenge Modified",
    message: `${modifiedByTeamName} proposed changes to the match details.`,
    data: {
      challengeId,
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Challenge Cancelled
|--------------------------------------------------------------------------
*/

export const sendMatchChallengeCancelledNotification = async ({
  receiverId,
  actorId,
  challengeId,
  teamId,
  teamName,
}: {
  receiverId: string;
  actorId: string;
  challengeId: string;
  teamId: string;
  teamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CHALLENGE_CANCELLED,
    title: "Challenge Cancelled",
    message: `${teamName} cancelled their match challenge.`,
    data: {
      challengeId,
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Cancelled (Post-Acceptance)
|--------------------------------------------------------------------------
*/

export const sendMatchCancelledNotification = async ({
  receiverId,
  actorId,
  matchId,
  teamName,
}: {
  receiverId: string;
  actorId: string;
  matchId: string;
  teamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CANCELLED,
    title: "Match Cancelled",
    message: `${teamName} cancelled the scheduled match.`,
    data: {
      matchId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Team Review Received
|--------------------------------------------------------------------------
*/

export const sendTeamReviewReceivedNotification = async ({
  receiverId,
  actorId,
  teamId,
  reviewerTeamName,
  rating,
}: {
  receiverId: string;
  actorId: string;
  teamId: string;
  reviewerTeamName: string;
  rating: number;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.TEAM_REVIEW_RECEIVED,
    title: "New Review",
    message: `${reviewerTeamName} rated your team ${rating}/5.`,
    data: {
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Confirmation Required (Actionable)
|--------------------------------------------------------------------------
*/

export const sendMatchConfirmationRequiredNotification = async ({
  receiverId,
  actorId,
  matchId,
  teamId,
  creatorTeamName,
}: {
  receiverId: string;
  actorId: string;
  matchId: string;
  teamId: string;
  creatorTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CONFIRMATION_REQUIRED,
    title: "Confirm This Match",
    message: `${creatorTeamName} added a match against your team and needs your confirmation before scoring can start.`,
    data: {
      matchId,
      teamId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Confirmed
|--------------------------------------------------------------------------
*/

export const sendMatchConfirmedNotification = async ({
  receiverId,
  actorId,
  matchId,
  confirmingTeamName,
}: {
  receiverId: string;
  actorId: string;
  matchId: string;
  confirmingTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CONFIRMED,
    title: "Match Confirmed",
    message: `${confirmingTeamName} confirmed the match. You can start scoring now.`,
    data: {
      matchId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Confirmation Rejected
|--------------------------------------------------------------------------
*/

export const sendMatchConfirmationRejectedNotification = async ({
  receiverId,
  actorId,
  matchId,
  rejectingTeamName,
}: {
  receiverId: string;
  actorId: string;
  matchId: string;
  rejectingTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_CONFIRMATION_REJECTED,
    title: "Match Declined",
    message: `${rejectingTeamName} declined to confirm this match. It cannot go live.`,
    data: {
      matchId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match PIN Shared (Sent To Opposing Captain)
|--------------------------------------------------------------------------
*/

export const sendMatchPinSharedNotification = async ({
  receiverId,
  actorId,
  matchId,
  teamId,
  pin,
  creatorTeamName,
}: {
  receiverId: string;
  actorId: string;
  matchId: string;
  teamId: string;
  pin: string;
  creatorTeamName: string;
}) => {
  return createNotification({
    receiverId,
    actorId,
    type: NOTIFICATION_TYPES.MATCH_PIN_SHARED,
    title: "Match PIN",
    message: `${creatorTeamName} scheduled a match against your team. Share this 4-digit PIN (${pin}) with the scorer to approve starting.`,
    data: {
      matchId,
      teamId,
      pin,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Match Reminder
|--------------------------------------------------------------------------
*/

export const sendMatchReminderNotification = async ({
  receiverId,
  matchId,
  title,
  message,
}: {
  receiverId: string;

  matchId: string;

  title: string;

  message: string;
}) => {
  return createNotification({
    receiverId,

    type: NOTIFICATION_TYPES.MATCH_REMINDER,

    title,

    message,

    data: {
      matchId,
    },
  });
};

/*
|--------------------------------------------------------------------------
| System Notification
|--------------------------------------------------------------------------
*/

export const sendSystemNotification = async ({
  receiverId,
  title,
  message,
}: {
  receiverId: string;

  title: string;

  message: string;
}) => {
  return createNotification({
    receiverId,

    type: NOTIFICATION_TYPES.SYSTEM,

    title,

    message,
  });
};
