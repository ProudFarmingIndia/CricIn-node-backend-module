import Notification from "./notification.model";
import TeamInvitation from "../teamInvitations/invitation.model";
import ViceCaptainProposal from "../viceCaptain/viceCaptainProposal.model";
import MatchChallenge from "../matchChallenges/matchChallenge.model";
import Match from "../matches/match.model";
import User from "../users/user.model";
import axios from "axios";

import { emitToUser } from "../../socket/socket";

import {
  NOTIFICATION_TYPES,
  NotificationType,
} from "./notification.types";

/*
|--------------------------------------------------------------------------
| Which Types Care About Which Status
|--------------------------------------------------------------------------
|
| The four enrichment passes below all wrote to the same `status` field,
| so a notification whose data carried two correlation ids got whichever
| pass ran last. That was live: the "Welcome to the Team" message carries
| an invitationId, so it was decorated with the invitation's ACCEPTED
| status, and MATCH_PIN_SHARED carries a matchId and picked up the match's
| confirmation status.
|
| Each pass is now scoped to the types the status actually belongs to.
|
*/

const INVITATION_STATUS_TYPES = new Set<string>([
  NOTIFICATION_TYPES.TEAM_INVITATION_RECEIVED,
  NOTIFICATION_TYPES.TEAM_INVITATION_ACCEPTED,
  NOTIFICATION_TYPES.TEAM_INVITATION_REJECTED,
  NOTIFICATION_TYPES.TEAM_INVITATION_CANCELLED,
  NOTIFICATION_TYPES.TEAM_INVITATION_EXPIRED,
]);

const PROPOSAL_STATUS_TYPES = new Set<string>([
  NOTIFICATION_TYPES.VICE_CAPTAIN_PROPOSED,
  NOTIFICATION_TYPES.VICE_CAPTAIN_REJECTED,
  NOTIFICATION_TYPES.VICE_CAPTAIN_CANCELLED,
]);

const CHALLENGE_STATUS_TYPES = new Set<string>([
  NOTIFICATION_TYPES.MATCH_CHALLENGE_RECEIVED,
  NOTIFICATION_TYPES.MATCH_CHALLENGE_ACCEPTED,
  NOTIFICATION_TYPES.MATCH_CHALLENGE_REJECTED,
  NOTIFICATION_TYPES.MATCH_CHALLENGE_CANCELLED,
  NOTIFICATION_TYPES.MATCH_CHALLENGE_MODIFIED,
]);

const MATCH_CONFIRMATION_STATUS_TYPES = new Set<string>([
  NOTIFICATION_TYPES.MATCH_CONFIRMATION_REQUIRED,
  NOTIFICATION_TYPES.MATCH_CONFIRMED,
  NOTIFICATION_TYPES.MATCH_CONFIRMATION_REJECTED,
]);

/*
|--------------------------------------------------------------------------
| Expo Push Helper
|--------------------------------------------------------------------------
|
| Fire-and-forget delivery of an Expo push notification. Wrapped so it can
| never throw into the caller - a failed push must not break the DB write
| or the socket emit.
|
*/

const sendExpoPushNotification = async (payload: {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}) => {
  try {
    await axios.post(
      "https://exp.host/--/api/v2/push/send",
      {
        to: payload.to,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        sound: "default",
      },
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
      },
    );
  } catch (pushError) {
    console.error("Failed to send Expo push notification:", pushError);
  }
};

/*
|--------------------------------------------------------------------------
| Create Notification
|--------------------------------------------------------------------------
*/

interface CreateNotificationPayload {
  receiverId: string;

  actorId?: string | null;

  type: NotificationType;

  title: string;

  message: string;

  data?: Record<string, any>;
}

export const createNotification =
  async ({
    receiverId,
    actorId = null,
    type,
    title,
    message,
    data = {},
  }: CreateNotificationPayload) => {
    const notification = await Notification.create({
      receiverId,

      actorId,

      type,

      title,

      message,

      data,
    });

    /*
    |--------------------------------------------------------------------------
    | Real-Time Delivery
    |--------------------------------------------------------------------------
    |
    | Push the notification to the receiver's personal socket room so the
    | app can update live without a refetch. Wrapped so a socket failure
    | never breaks the DB write above.
    |
    */

    try {
      emitToUser(receiverId, "notification", notification);
    } catch (socketError) {
      console.error("Failed to emit notification over socket:", socketError);
    }

    /*
    |--------------------------------------------------------------------------
    | Expo Push (If The User Registered A Device Token)
    |--------------------------------------------------------------------------
    */

    try {
      const receiver = await User.findById(receiverId).select("expoPushToken");

      if (receiver?.expoPushToken) {
        await sendExpoPushNotification({
          to: receiver.expoPushToken,
          title,
          body: message,
          data,
        });
      }
    } catch (pushLookupError) {
      console.error(
        "Failed to resolve/send Expo push notification:",
        pushLookupError,
      );
    }

    return notification;
  };

/*
|--------------------------------------------------------------------------
| Get Notifications
|--------------------------------------------------------------------------
*/

export const getNotifications =
  async (
    receiverId: string,
    filters?: {
      type?: string;

      isRead?: boolean;
    }
  ) => {
    const query: any = {
      receiverId,

      isDeleted: false,
    };

    if (filters?.type) {
      query.type = filters.type;
    }

    if (
      typeof filters?.isRead ===
      "boolean"
    ) {
      query.isRead =
        filters.isRead;
    }

    const notifications = await Notification.find(
      query
    )
      .populate(
        "actorId",
        "fullName profileImage"
      )
      .sort({
        createdAt: -1,
      })
      .lean();

    /*
    |--------------------------------------------------------------------------
    | Attach Live Invitation Status
    |--------------------------------------------------------------------------
    |
    | A Notification document is a one-time record of "something happened" -
    | it has no concept of PENDING/ACCEPTED/REJECTED on its own. That state
    | lives on the TeamInvitation document and can change after the
    | notification was created. Without this, the client has no reliable
    | way to know whether to render Accept/Reject buttons or a result badge.
    |
    */

    const invitationIds = notifications
      .filter((n: any) => INVITATION_STATUS_TYPES.has(n.type))
      .map((notification: any) => notification.data?.invitationId)
      .filter(Boolean);

    if (invitationIds.length > 0) {
      const invitations = await TeamInvitation.find({
        _id: { $in: invitationIds },
      }).select("status");

      const statusByInvitationId = new Map(
        invitations.map((invitation) => [
          invitation._id.toString(),
          invitation.status,
        ]),
      );

      notifications.forEach((notification: any) => {
        if (
          INVITATION_STATUS_TYPES.has(notification.type) &&
          notification.data?.invitationId
        ) {
          notification.status =
            statusByInvitationId.get(
              notification.data.invitationId.toString(),
            ) || null;
        }
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Attach Live Vice-Captain Proposal Status
    |--------------------------------------------------------------------------
    |
    | Same reasoning as invitations above - the accept/reject state lives
    | on the ViceCaptainProposal document, not the notification.
    |
    */

    const proposalIds = notifications
      .filter((n: any) => PROPOSAL_STATUS_TYPES.has(n.type))
      .map((notification: any) => notification.data?.proposalId)
      .filter(Boolean);

    if (proposalIds.length > 0) {
      const proposals = await ViceCaptainProposal.find({
        _id: { $in: proposalIds },
      }).select("status");

      const statusByProposalId = new Map(
        proposals.map((proposal) => [
          proposal._id.toString(),
          proposal.status,
        ]),
      );

      notifications.forEach((notification: any) => {
        if (
          PROPOSAL_STATUS_TYPES.has(notification.type) &&
          notification.data?.proposalId
        ) {
          notification.status =
            statusByProposalId.get(
              notification.data.proposalId.toString(),
            ) || null;
        }
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Attach Live Match Challenge Status
    |--------------------------------------------------------------------------
    */

    const challengeIds = notifications
      .filter((n: any) => CHALLENGE_STATUS_TYPES.has(n.type))
      .map((notification: any) => notification.data?.challengeId)
      .filter(Boolean);

    if (challengeIds.length > 0) {
      const challenges = await MatchChallenge.find({
        _id: { $in: challengeIds },
      }).select("status pendingResponseFrom");

      const statusByChallengeId = new Map(
        challenges.map((challenge) => [
          challenge._id.toString(),
          challenge.status,
        ]),
      );

      const pendingResponseFromByChallengeId = new Map(
        challenges.map((challenge) => [
          challenge._id.toString(),
          challenge.pendingResponseFrom,
        ]),
      );

      notifications.forEach((notification: any) => {
        if (
          CHALLENGE_STATUS_TYPES.has(notification.type) &&
          notification.data?.challengeId
        ) {
          notification.status =
            statusByChallengeId.get(
              notification.data.challengeId.toString(),
            ) || null;

          notification.pendingResponseFrom =
            pendingResponseFromByChallengeId.get(
              notification.data.challengeId.toString(),
            ) || null;
        }
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Attach Live Match Confirmation Status
    |--------------------------------------------------------------------------
    |
    | Same reasoning as invitations/proposals/challenges above - a match's
    | confirmationStatus lives on the Match document and can change after
    | the notification was created. Without this, NotificationActionButtons
    | never receives a `status` prop for these notifications and silently
    | renders no Accept/Reject buttons at all.
    |
    */

    const matchIds = notifications
      .filter((n: any) => MATCH_CONFIRMATION_STATUS_TYPES.has(n.type))
      .map((notification: any) => notification.data?.matchId)
      .filter(Boolean);

    if (matchIds.length > 0) {
      const matches = await Match.find({
        _id: { $in: matchIds },
      }).select("confirmationStatus");

      const CONFIRMATION_STATUS_MAP: Record<string, string> = {
        pending: "PENDING",
        confirmed: "ACCEPTED",
        rejected: "REJECTED",
      };

      const statusByMatchId = new Map(
        matches.map((match: any) => [
          match._id.toString(),
          CONFIRMATION_STATUS_MAP[match.confirmationStatus] || null,
        ]),
      );

      notifications.forEach((notification: any) => {
        if (
          MATCH_CONFIRMATION_STATUS_TYPES.has(notification.type) &&
          notification.data?.matchId
        ) {
          notification.status =
            statusByMatchId.get(notification.data.matchId.toString()) || null;
        }
      });
    }

    return notifications;
  };

/*
|--------------------------------------------------------------------------
| Get Unread Count
|--------------------------------------------------------------------------
*/

export const getUnreadCount =
  async (
    receiverId: string
  ) => {
    return await Notification.countDocuments(
      {
        receiverId,

        isDeleted: false,

        isRead: false,
      }
    );
  };

/*
|--------------------------------------------------------------------------
| Mark As Read
|--------------------------------------------------------------------------
*/

export const markAsRead = async (
  notificationId: string,
  receiverId: string,
) => {
  /*
  | Scoped by receiverId. This used to take the id alone, so any
  | authenticated user could mark - or, below, delete - anyone else's
  | notification just by knowing its _id.
  */
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, receiverId },
    { isRead: true },
    { new: true },
  );

  if (!notification) {
    throw new Error("Notification not found.");
  }

  return notification;
};

/*
|--------------------------------------------------------------------------
| Mark Many As Read
|--------------------------------------------------------------------------
*/

export const markManyAsRead = async (
  receiverId: string,
  notificationIds: string[],
) => {
  if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
    throw new Error("No notifications were selected.");
  }

  await Notification.updateMany(
    { _id: { $in: notificationIds }, receiverId, isDeleted: false },
    { isRead: true },
  );

  return { updated: notificationIds.length };
};

/*
|--------------------------------------------------------------------------
| Mark All As Read
|--------------------------------------------------------------------------
*/

export const markAllAsRead =
  async (
    receiverId: string
  ) => {
    return await Notification.updateMany(
      {
        receiverId,

        isDeleted: false,

        isRead: false,
      },

      {
        isRead: true,
      }
    );
  };

/*
|--------------------------------------------------------------------------
| Delete Notification
|--------------------------------------------------------------------------
|
| Soft Delete
|
*/

export const deleteNotification = async (
  notificationId: string,
  receiverId: string,
) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, receiverId },
    { isDeleted: true },
    { new: true },
  );

  if (!notification) {
    throw new Error("Notification not found.");
  }

  return notification;
};

/*
|--------------------------------------------------------------------------
| Delete Many
|--------------------------------------------------------------------------
*/

export const deleteMany = async (
  receiverId: string,
  notificationIds: string[],
) => {
  if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
    throw new Error("No notifications were selected.");
  }

  await Notification.updateMany(
    { _id: { $in: notificationIds }, receiverId },
    { isDeleted: true },
  );

  return { deleted: notificationIds.length };
};

/*
|--------------------------------------------------------------------------
| Delete All Notifications
|--------------------------------------------------------------------------
*/

export const deleteAllNotifications =
  async (
    receiverId: string
  ) => {
    return await Notification.updateMany(
      {
        receiverId,
      },

      {
        isDeleted: true,
      }
    );
  };

/*
|--------------------------------------------------------------------------
| Get Notification By Id
|--------------------------------------------------------------------------
*/

export const getNotificationById =
  async (
    notificationId: string
  ) => {
    return await Notification.findById(
      notificationId
    ).populate(
      "actorId",
      "fullName profileImage"
    );
  };