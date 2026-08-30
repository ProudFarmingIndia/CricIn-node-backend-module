import mongoose from "mongoose";
import Invitation from "./invitation.model";
import Team from "../teams/team.model";
import Player from "../players/player.model";

import * as NotificationService from "../notifications/notification.service";

import { assertCanSendInvitations } from "../teams/team.service";

import {
  sendTeamInvitationNotification as createTeamInvitationNotification,
  sendInvitationAcceptedNotification as createInvitationAcceptedNotification,
  sendInvitationRejectedNotification as createInvitationRejectedNotification,
  sendInvitationCancelledNotification as createInvitationCancelledNotification,
} from "../notifications/notification.helper";

/*
|--------------------------------------------------------------------------
| Send Invitation
|--------------------------------------------------------------------------
*/

export const sendInvitation = async (userId: string, payload: any) => {
  const { teamId, playerId, message } = payload;

  /*
  |--------------------------------------------------------------------------
  | Captain Profile
  |--------------------------------------------------------------------------
  */

  const captain = await Player.findOne({
    userId,
  }).populate("userId");

  if (!captain) {
    throw new Error("Captain profile not found.");
  }

  /*
  |--------------------------------------------------------------------------
  | Team
  |--------------------------------------------------------------------------
  */

  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  /*
  |--------------------------------------------------------------------------
  | Permission
  |--------------------------------------------------------------------------
  |
  | Was a hardcoded owner-only check, which had two problems: the CAPTAIN
  | of a team could not invite anyone, and viceCaptainRights.canSendInvitations
  | was a schema field that granted nothing at all - assertCanSendInvitations
  | was written for exactly this call site and imported nowhere.
  |
  | Now: owner, captain, or a vice-captain who has been granted the right.
  |
  */

  await assertCanSendInvitations(team, userId);

  /*
  |--------------------------------------------------------------------------
  | Player
  |--------------------------------------------------------------------------
  */

  const player = await Player.findById(playerId).populate("userId");

  if (!player) {
    throw new Error("Player not found.");
  }

  /*
  |--------------------------------------------------------------------------
  | Local Players Cannot Be Invited
  |--------------------------------------------------------------------------
  |
  | A local player has userId: null - there is no account to notify. Without
  | this guard the invitation row was created first and the notification
  | then threw on (player.userId)._id, leaving a PENDING invitation behind
  | that nobody could ever accept, and surfacing to the caller as a raw
  | "Cannot read properties of null" message.
  |
  */

  if (!player.userId) {
    throw new Error(
      `${player.playerName} is a local player and has no CricIn account to invite. Ask them to sign up first.`,
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Already In Team
  |--------------------------------------------------------------------------
  */

  if (team.players.some((id) => id.equals(playerId))) {
    throw new Error("Player already exists in this team.");
  }

  /*
  |--------------------------------------------------------------------------
  | Existing Invitation
  |--------------------------------------------------------------------------
  */

  const exists = await Invitation.findOne({
    teamId,
    playerId,
    status: "PENDING",
  });

  if (exists) {
    throw new Error("Invitation already sent.");
  }

  /*
  |--------------------------------------------------------------------------
  | Create Invitation
  |--------------------------------------------------------------------------
  */

  const invitation = await Invitation.create({
    teamId,
    playerId,
    invitedBy: captain._id,
    message,
  });

  /*
  |--------------------------------------------------------------------------
  | Notification
  |--------------------------------------------------------------------------
  */

  await createTeamInvitationNotification({
    receiverId: (player.userId as any)._id.toString(),

    actorId: (captain.userId as any)._id.toString(),

    invitationId: invitation._id.toString(),

    teamId: team._id.toString(),

    playerId: player._id.toString(),

    teamName: team.teamName,
  });

  return await Invitation.findById(invitation._id)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "invitedBy",
      populate: {
        path: "userId",
      },
    });
};

/*
|--------------------------------------------------------------------------
| My Invitations
|--------------------------------------------------------------------------
*/

export const getMyInvitations = async (userId: string) => {
  const player = await Player.findOne({
    userId,
  });

  if (!player) {
    throw new Error("Player profile not found.");
  }

  return await Invitation.find({
    playerId: player._id,
    status: "PENDING",
  })
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "invitedBy",
      populate: {
        path: "userId",
      },
    })
    .sort({
      createdAt: -1,
    });
};

/*
|--------------------------------------------------------------------------
| Accept Invitation
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Accept Invitation
|--------------------------------------------------------------------------
*/

export const acceptInvitation = async (
  invitationId: string,
) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    /*
    |--------------------------------------------------------------------------
    | Invitation
    |--------------------------------------------------------------------------
    */

    const invitation = await Invitation.findById(invitationId)
      .session(session)
      .populate("teamId")
      .populate({
        path: "playerId",
        populate: {
          path: "userId",
        },
      })
      .populate({
        path: "invitedBy",
        populate: {
          path: "userId",
        },
      });

    if (!invitation) {
      throw new Error("Invitation not found.");
    }

    if (invitation.status !== "PENDING") {
      throw new Error("Invitation already processed.");
    }

    /*
    |--------------------------------------------------------------------------
    | Expired
    |--------------------------------------------------------------------------
    */

    if (
      invitation.expiresAt &&
      invitation.expiresAt < new Date()
    ) {
      invitation.status = "EXPIRED";

      await invitation.save({ session });

      throw new Error("Invitation expired.");
    }

    /*
    |--------------------------------------------------------------------------
    | Team
    |--------------------------------------------------------------------------
    */

    const team = await Team.findById(
      invitation.teamId,
    ).session(session);

    if (!team) {
      throw new Error("Team not found.");
    }

    /*
    |--------------------------------------------------------------------------
    | Player
    |--------------------------------------------------------------------------
    */

    const player = await Player.findById(
      invitation.playerId,
    )
      .session(session)
      .populate("userId");

    if (!player) {
      throw new Error("Player not found.");
    }

    /*
    |--------------------------------------------------------------------------
    | Update Invitation
    |--------------------------------------------------------------------------
    */

    invitation.status = "ACCEPTED";

    invitation.respondedAt = new Date();

    await invitation.save({
      session,
    });

    /*
    |--------------------------------------------------------------------------
    | Add Player Into Team
    |--------------------------------------------------------------------------
    */

    if (
      !team.players.some((id) =>
        id.equals(player._id),
      )
    ) {
      team.players.push(player._id as any);

      await team.save({
        session,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Add Team Into Player
    |--------------------------------------------------------------------------
    */

    if (
      !player.teams.some((id) =>
        id.equals(team._id),
      )
    ) {
      player.teams.push(team._id as any);

      await player.save({
        session,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Commit
    |--------------------------------------------------------------------------
    */

    await session.commitTransaction();

    session.endSession();

    /*
    |--------------------------------------------------------------------------
    | Notifications (Best-Effort, Outside The Transaction)
    |--------------------------------------------------------------------------
    |
    | IMPORTANT
    | The invitation + team + player writes above have already been
    | committed at this point. Notifications are a side-effect, not part
    | of the core operation, so a failure here must NEVER:
    |
    | 1. Roll back or appear to roll back the accept (there is nothing
    |    left to abort - the transaction session is already closed).
    | 2. Cause the API call to return an error when the actual accept
    |    already succeeded.
    |
    | This is wrapped in its own try/catch so a notification bug can
    | never hide a successful team join from the client.
    |
    */

    try {
      await createInvitationAcceptedNotification({
        receiverId:
          team.userId.toString(),

        actorId:
          (player.userId as any)._id.toString(),

        invitationId:
          invitation._id.toString(),

        teamId:
          team._id.toString(),

        playerId:
          player._id.toString(),

        playerName:
          player.playerName,

        teamName:
          team.teamName,
      });

      await NotificationService.createNotification({
        receiverId:
          (player.userId as any)._id.toString(),

        actorId:
          team.userId.toString(),

        type:
          "PLAYER_JOINED_TEAM",

        title:
          "Welcome to the Team",

        message:
          `You joined ${team.teamName}.`,

        data: {
          invitationId:
            invitation._id,

          teamId:
            team._id,

          playerId:
            player._id,
        },
      });
    } catch (notificationError) {
      console.error(
        "Failed to send invitation-accepted notifications:",
        notificationError,
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Return Updated Invitation
    |--------------------------------------------------------------------------
    */

    return await Invitation.findById(
      invitation._id,
    )
      .populate({
        path: "teamId",

        populate: [
          {
            path: "captainId",

            select:
              "playerName profileImage playerType",
          },

          {
            path: "viceCaptainId",

            select:
              "playerName profileImage playerType",
          },

          {
            path: "players",

            select:
              "playerName profileImage playerType",
          },
        ],
      })
      .populate({
        path: "playerId",

        populate: {
          path: "userId",
        },
      })
      .populate({
        path: "invitedBy",

        populate: {
          path: "userId",
        },
      });

  } catch (error) {

    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    session.endSession();

    throw error;

  }
};

/*
|--------------------------------------------------------------------------
| Reject Invitation
|--------------------------------------------------------------------------
*/

export const rejectInvitation = async (invitationId: string) => {
  const invitation = await Invitation.findById(invitationId)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "invitedBy",
      populate: {
        path: "userId",
      },
    });

  if (!invitation) {
    throw new Error("Invitation not found.");
  }

  if (invitation.status !== "PENDING") {
    throw new Error("Invitation already processed.");
  }

  /*
  |--------------------------------------------------------------------------
  | Update Invitation
  |--------------------------------------------------------------------------
  */

  invitation.status = "REJECTED";

  invitation.respondedAt = new Date();

  await invitation.save();

  /*
  |--------------------------------------------------------------------------
  | Team
  |--------------------------------------------------------------------------
  */

  const team = await Team.findById(invitation.teamId);

  /*
  |--------------------------------------------------------------------------
  | Player
  |--------------------------------------------------------------------------
  */

  const player = await Player.findById(invitation.playerId).populate("userId");

  /*
  |--------------------------------------------------------------------------
  | Notify Captain
  |--------------------------------------------------------------------------
  */

  if (team && player) {
    await createInvitationRejectedNotification({
      receiverId: team.userId.toString(),

      actorId: (player.userId as any)._id.toString(),

      invitationId: invitation._id.toString(),

      teamId: team._id.toString(),

      playerId: player._id.toString(),

      playerName: player.playerName,

      teamName: team.teamName,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Return Updated Invitation
  |--------------------------------------------------------------------------
  */

  return await Invitation.findById(invitation._id)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "invitedBy",
      populate: {
        path: "userId",
      },
    });
};

/*
|--------------------------------------------------------------------------
| Cancel Invitation
|--------------------------------------------------------------------------
*/

export const cancelInvitation = async (invitationId: string) => {
  const invitation = await Invitation.findById(invitationId)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "invitedBy",
      populate: {
        path: "userId",
      },
    });

  if (!invitation) {
    throw new Error("Invitation not found.");
  }

  if (invitation.status !== "PENDING") {
    throw new Error("Only pending invitation can be cancelled.");
  }

  /*
  |--------------------------------------------------------------------------
  | Update Invitation
  |--------------------------------------------------------------------------
  */

  invitation.status = "CANCELLED";

  invitation.respondedAt = new Date();

  await invitation.save();

  /*
  |--------------------------------------------------------------------------
  | Team
  |--------------------------------------------------------------------------
  */

  const team = await Team.findById(invitation.teamId);

  /*
  |--------------------------------------------------------------------------
  | Player
  |--------------------------------------------------------------------------
  */

  const player = await Player.findById(invitation.playerId).populate("userId");

  /*
  |--------------------------------------------------------------------------
  | Notify Player
  |--------------------------------------------------------------------------
  */

  if (team && player) {
    await createInvitationCancelledNotification({
      receiverId: (player.userId as any)._id.toString(),

      actorId: team.userId.toString(),

      invitationId: invitation._id.toString(),

      teamId: team._id.toString(),

      playerId: player._id.toString(),

      teamName: team.teamName,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Return
  |--------------------------------------------------------------------------
  */

  return await Invitation.findById(invitation._id)
    .populate("teamId")
    .populate({
      path: "playerId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "invitedBy",
      populate: {
        path: "userId",
      },
    });
};
