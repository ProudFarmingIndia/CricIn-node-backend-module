import mongoose from "mongoose";

import Team from "./team.model";
import Player from "../players/player.model";
import TeamBlockedDate from "./teamBlockedDate.model";
import TeamInvitation from "../teamInvitations/invitation.model";

import {
  computeTeamStats,
  withTeamRecord,
  withTeamRecords,
} from "./team.stats.service";
import ViceCaptainProposal from "../viceCaptain/viceCaptainProposal.model";
import TeamReview from "../teamReviews/teamReview.model";
import MatchChallenge from "../matchChallenges/matchChallenge.model";
import Match from "../matches/match.model";

import {
  sendPlayerLeftTeamNotification,
  sendCaptainAssignedNotification,
} from "../notifications/notification.helper";

/*
|--------------------------------------------------------------------------
| Permission Helpers
|--------------------------------------------------------------------------
|
| The vice-captain's rights are NOT automatic - captain/owner grants them
| individually via team.viceCaptainRights. Some actions (assigning
| captain, proposing a vice-captain, granting rights, deleting the team)
| are never delegable at all - they always require owner or captain.
|
*/

const getActorPlayer = async (userId: string) => {
  return await Player.findOne({ userId });
};

const isOwner = (team: any, userId: string) => team.userId.equals(userId);

const isCaptain = (team: any, actor: any) =>
  !!actor && !!team.captainId && team.captainId.equals(actor._id);

const isViceCaptain = (team: any, actor: any) =>
  !!actor && !!team.viceCaptainId && team.viceCaptainId.equals(actor._id);

/*
|--------------------------------------------------------------------------
| Owner Or Captain Only
|--------------------------------------------------------------------------
|
| For actions that can never be delegated to a vice-captain: assigning
| captain, proposing a new vice-captain, granting vice-captain rights.
|
*/

export const assertIsOwnerOrCaptain = async (
  team: any,
  userId: string,
): Promise<void> => {
  if (isOwner(team, userId)) return;

  const actor = await getActorPlayer(userId);

  if (isCaptain(team, actor)) return;

  throw new Error("Only the team owner or captain can perform this action.");
};

/*
|--------------------------------------------------------------------------
| Can Edit Team (Info / Logo / Settings)
|--------------------------------------------------------------------------
*/

export const assertCanEditTeam = async (
  team: any,
  userId: string,
): Promise<void> => {
  if (isOwner(team, userId)) return;

  const actor = await getActorPlayer(userId);

  if (isCaptain(team, actor)) return;

  if (isViceCaptain(team, actor) && team.viceCaptainRights?.canEditTeam) {
    return;
  }

  throw new Error(
    "You don't have permission to edit this team. Ask the captain to grant this right.",
  );
};

/*
|--------------------------------------------------------------------------
| Can Manage Players (Add / Remove Squad)
|--------------------------------------------------------------------------
*/

export const assertCanManagePlayers = async (
  team: any,
  userId: string,
): Promise<void> => {
  if (isOwner(team, userId)) return;

  const actor = await getActorPlayer(userId);

  if (isCaptain(team, actor)) return;

  if (isViceCaptain(team, actor) && team.viceCaptainRights?.canManagePlayers) {
    return;
  }

  throw new Error(
    "You don't have permission to manage players. Ask the captain to grant this right.",
  );
};

/*
|--------------------------------------------------------------------------
| Can Send Invitations
|--------------------------------------------------------------------------
*/

export const assertCanSendInvitations = async (
  team: any,
  userId: string,
): Promise<void> => {
  if (isOwner(team, userId)) return;

  const actor = await getActorPlayer(userId);

  if (isCaptain(team, actor)) return;

  if (
    isViceCaptain(team, actor) &&
    team.viceCaptainRights?.canSendInvitations
  ) {
    return;
  }

  throw new Error(
    "You don't have permission to send invitations. Ask the captain to grant this right.",
  );
};

/*
|--------------------------------------------------------------------------
| Create Team
|--------------------------------------------------------------------------
*/

export const createTeam = async (userId: string, payload: any) => {
  const existingTeam = await Team.findOne({
    teamName: payload.teamName.trim(),
    isActive: true,
  });

  if (existingTeam) {
    throw new Error("Team name already exists.");
  }

  /*
  |--------------------------------------------------------------------------
  | Creator's Player Profile
  |--------------------------------------------------------------------------
  |
  | Whoever creates a team is the captain by default. Captain is stored
  | as a Player reference (captainId), not a User reference, so we need
  | the creator's Player profile - not just their userId - to set it.
  |
  */

  const creatorPlayer = await Player.findOne({ userId });

  if (!creatorPlayer) {
    throw new Error(
      "Please complete your player profile before creating a team.",
    );
  }

  return await Team.create({
    ...payload,
    userId,
    captainId: creatorPlayer._id,
    players: [creatorPlayer._id],
  });
};

/*
|--------------------------------------------------------------------------
| Get My Teams
|--------------------------------------------------------------------------
*/

export const getTeams = async (userId: string) => {
  return await Team.find({ userId })
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players")
    .sort({
      createdAt: -1,
    });
};

/*
|--------------------------------------------------------------------------
| Get My Teams
|--------------------------------------------------------------------------
|
| Returns:
| 1. Teams Created By Me
| 2. Teams I Joined
|
*/

export const getMyTeams = async (userId: string) => {
  /*
  |--------------------------------------------------------------------------
  | Player Profile
  |--------------------------------------------------------------------------
  */

  const player = await Player.findOne({
    userId,
  });

  /*
  |--------------------------------------------------------------------------
  | Owner Teams
  |--------------------------------------------------------------------------
  */

  const query: any[] = [
    {
      userId,
    },
  ];

  /*
  |--------------------------------------------------------------------------
  | Joined Teams
  |--------------------------------------------------------------------------
  */

  if (player) {
    query.push({
      players: player._id,
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Fetch Teams
  |--------------------------------------------------------------------------
  */

  const teams = await Team.find({
    $or: query,
  })
    .populate({
      path: "captainId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "viceCaptainId",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "players",
      populate: {
        path: "userId",
      },
    })
    .sort({
      createdAt: -1,
    });

  /*
  | Played / won / lost / drawn, attached fresh - see team.stats.service.
  | The stored fields were never written by anything, so every team card in
  | the app showed a blank record.
  */

  return await withTeamRecords(teams);
};

/*
|--------------------------------------------------------------------------
| Get All Teams
|--------------------------------------------------------------------------
*/

export const getAllTeams = async () => {
  const teams = await Team.find()
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players")
    .sort({
      createdAt: -1,
    });

  return await withTeamRecords(teams);
};

/*
|--------------------------------------------------------------------------
| Get Team By Id
|--------------------------------------------------------------------------
*/

export const getTeamById = async (teamId: string) => {
  const team = await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");

  if (!team) {
    throw new Error("Team not found.");
  }

  return await withTeamRecord(team);
};

/*
|--------------------------------------------------------------------------
| Update Team
|--------------------------------------------------------------------------
*/

export const updateTeam = async (
  userId: string,
  teamId: string,
  payload: any,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanEditTeam(team, userId);

  const updated = await Team.findByIdAndUpdate(teamId, payload, {
    new: true,
    runValidators: true,
  })
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");

  return updated;
};

/*
|--------------------------------------------------------------------------
| Delete Team
|--------------------------------------------------------------------------
*/

export const deleteTeam = async (userId: string, teamId: string) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  if (!team.userId.equals(userId)) {
    throw new Error("You are not allowed to delete this team.");
  }

  /*
  |--------------------------------------------------------------------------
  | Refuse While A Match Is In Flight
  |--------------------------------------------------------------------------
  |
  | Deleting a team mid-fixture would strand the opponent with a match
  | pointing at a team that no longer exists - and there is no way to score
  | or resolve it afterwards. Make the owner deal with the match first.
  |
  */

  const activeMatch = await Match.findOne({
    $or: [{ teamA: team._id }, { teamB: team._id }],
    status: { $in: ["live", "upcoming"] },
  }).select("_id status");

  if (activeMatch) {
    throw new Error(
      activeMatch.status === "live"
        ? "This team is in a live match. Finish the match before deleting the team."
        : "This team has an upcoming match. Cancel the match before deleting the team.",
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Cascade
  |--------------------------------------------------------------------------
  |
  | team.deleteOne() on its own left every related record pointing at a
  | team that no longer existed: invitations and proposals that could still
  | be accepted, blocked dates, reviews, and a stale team id inside every
  | member's player.teams array (which then broke the populate on their
  | profile).
  |
  | Reviews are removed in both directions - those written ABOUT this team
  | and those this team wrote about others, since neither has meaning once
  | the team is gone.
  |
  | Pending challenges are CANCELLED rather than deleted, so the other
  | captain keeps a record of what happened instead of the challenge
  | silently vanishing from their inbox. Completed matches are left alone -
  | they are history, and the opponent's record depends on them.
  |
  */

  await Promise.all([
    TeamInvitation.deleteMany({ teamId: team._id }),

    ViceCaptainProposal.deleteMany({ teamId: team._id }),

    TeamBlockedDate.deleteMany({ teamId: team._id }),

    TeamReview.deleteMany({
      $or: [{ teamId: team._id }, { reviewedByTeamId: team._id }],
    }),

    MatchChallenge.updateMany(
      {
        $or: [
          { challengerTeamId: team._id },
          { challengedTeamId: team._id },
        ],
        status: "PENDING",
      },
      {
        status: "CANCELLED",
        respondedAt: new Date(),
      },
    ),

    Player.updateMany(
      { teams: team._id },
      { $pull: { teams: team._id } },
    ),
  ]);

  await team.deleteOne();

  return team;
};

/*
|--------------------------------------------------------------------------
| Add Player
|--------------------------------------------------------------------------
*/

export const addPlayerToTeam = async (
  userId: string,
  teamId: string,
  playerId: string,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanManagePlayers(team, userId);

  if (team.players.some((id) => id.equals(playerId))) {
    throw new Error("Player already exists in team.");
  }

  team.players.push(playerId as any);

  await team.save();

  return await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

/*
|--------------------------------------------------------------------------
| Remove Player
|--------------------------------------------------------------------------
*/

export const removePlayerFromTeam = async (
  userId: string,
  teamId: string,
  playerId: string,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertCanManagePlayers(team, userId);

  team.players = team.players.filter((id) => !id.equals(playerId));

  await team.save();

  return await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

/*
|--------------------------------------------------------------------------
| Set Captain
|--------------------------------------------------------------------------
*/

export const setCaptain = async (
  userId: string,
  teamId: string,
  captainId: string,
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertIsOwnerOrCaptain(team, userId);

  team.captainId = captainId as any;

  await team.save();

  return await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

/*
|--------------------------------------------------------------------------
| Revoke Vice Captain
|--------------------------------------------------------------------------
|
| Removing a vice-captain is instant and never needs their approval -
| only GRANTING the role does (see viceCaptainProposal module). This
| also resets any rights that had been granted to them.
|
*/

export const revokeViceCaptain = async (userId: string, teamId: string) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertIsOwnerOrCaptain(team, userId);

  team.viceCaptainId = null as any;

  team.viceCaptainRights = {
    canEditTeam: false,
    canManagePlayers: false,
    canSendInvitations: false,
  } as any;

  await team.save();

  return await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

/*
|--------------------------------------------------------------------------
| Update Vice-Captain Rights
|--------------------------------------------------------------------------
|
| Only owner/captain can grant or revoke individual rights - the
| vice-captain can never adjust their own permissions.
|
*/

export const updateViceCaptainRights = async (
  userId: string,
  teamId: string,
  rights: {
    canEditTeam?: boolean;
    canManagePlayers?: boolean;
    canSendInvitations?: boolean;
  },
) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  await assertIsOwnerOrCaptain(team, userId);

  if (!team.viceCaptainId) {
    throw new Error("This team doesn't have a vice-captain yet.");
  }

  team.viceCaptainRights = {
    canEditTeam: !!rights.canEditTeam,
    canManagePlayers: !!rights.canManagePlayers,
    canSendInvitations: !!rights.canSendInvitations,
  } as any;

  await team.save();

  return await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

/*
|--------------------------------------------------------------------------
| Leave Team
|--------------------------------------------------------------------------
|
| Any member (including captain/vice-captain) can remove themselves from
| a team. The owner cannot leave their own team - they can only delete
| it - since a team must always have exactly one owner.
|
*/

export const leaveTeam = async (userId: string, teamId: string) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  const player = await Player.findOne({ userId });

  if (!player) {
    throw new Error("Player profile not found.");
  }

  const isLeavingOwner = team.userId.equals(userId);

  /*
  |--------------------------------------------------------------------------
  | Owner Handover
  |--------------------------------------------------------------------------
  |
  | The owner used to be refused outright ("Delete the team instead"),
  | which left them with no way out of a team they had handed over in
  | practice - their only exit was destroying a team other people were
  | using.
  |
  | Now leaving as owner transfers the team instead of blocking. The
  | successor is picked in the order a squad would expect: vice-captain
  | first, then the captain if that isn't the person leaving, then the
  | longest-standing remaining member.
  |
  | A successor must have a real account - team.userId is a User
  | reference, and a local player (userId: null) has none to own it. If
  | nobody qualifies, the owner is the only real member and deleting is
  | genuinely the right action, so we say that plainly.
  |
  */

  let successor: any = null;

  if (isLeavingOwner) {
    const remainingIds = team.players.filter((id) => !id.equals(player._id));

    if (remainingIds.length === 0) {
      throw new Error(
        "You're the only member of this team. Delete the team instead.",
      );
    }

    const candidates = await Player.find({
      _id: { $in: remainingIds },
      userId: { $ne: null },
    });

    const byId = (id: any) =>
      candidates.find((candidate) => candidate._id.equals(id));

    successor =
      (team.viceCaptainId && byId(team.viceCaptainId)) ||
      (team.captainId &&
        !team.captainId.equals(player._id) &&
        byId(team.captainId)) ||
      candidates.find((candidate) =>
        remainingIds.some((id) => id.equals(candidate._id)),
      ) ||
      null;

    if (!successor) {
      throw new Error(
        "No one else in this squad has a CricIn account to take the team over. Delete the team instead.",
      );
    }
  }

  const wasMember = team.players.some((id) => id.equals(player._id));

  team.players = team.players.filter((id) => !id.equals(player._id));

  const NO_RIGHTS = {
    canEditTeam: false,
    canManagePlayers: false,
    canSendInvitations: false,
  };

  const isLeavingCaptain = !!(
    team.captainId && team.captainId.equals(player._id)
  );

  const isLeavingViceCaptain = !!(
    team.viceCaptainId && team.viceCaptainId.equals(player._id)
  );

  /*
  |--------------------------------------------------------------------------
  | Captain Succession
  |--------------------------------------------------------------------------
  |
  | A team with no captain is effectively unmanageable: assertCanEditTeam
  | and assertCanManagePlayers both key off captainId, so a captain
  | walking out used to leave the squad unable to edit the team, create
  | matches, score, or accept challenges until the owner stepped in.
  |
  | So when the captain leaves and a vice-captain is in place, the
  | vice-captain is promoted to captain and the vice-captain seat is
  | vacated. Rights are reset in that case because a captain holds them
  | inherently - leaving the flags set would silently re-grant them to
  | whoever fills the vice-captain seat next.
  |
  | With no vice-captain to promote, captainId is cleared as before and
  | the owner has to assign someone.
  |
  */

  if (isLeavingCaptain) {
    if (team.viceCaptainId) {
      team.captainId = team.viceCaptainId;

      team.viceCaptainId = null as any;
    } else {
      team.captainId = null as any;
    }

    team.viceCaptainRights = NO_RIGHTS as any;
  } else if (isLeavingViceCaptain) {
    team.viceCaptainId = null as any;

    team.viceCaptainRights = NO_RIGHTS as any;
  }

  /*
  |--------------------------------------------------------------------------
  | Apply The Handover
  |--------------------------------------------------------------------------
  |
  | Runs after the captain/vice-captain shuffle above so it has the final
  | say. The successor becomes owner AND captain - a team whose owner is
  | not in the leadership has no one who can act on it - and if they were
  | the vice-captain, that seat is vacated and its rights cleared, since a
  | captain holds them inherently.
  |
  */

  if (isLeavingOwner && successor) {
    team.userId = successor.userId;

    team.captainId = successor._id;

    if (team.viceCaptainId && team.viceCaptainId.equals(successor._id)) {
      team.viceCaptainId = null as any;
    }

    team.viceCaptainRights = NO_RIGHTS as any;
  }

  await team.save();

  player.teams = player.teams.filter((id) => !id.equals(team._id));

  await player.save();

  /*
  |--------------------------------------------------------------------------
  | Notify Owner (Best-Effort)
  |--------------------------------------------------------------------------
  */

  try {
    if (isLeavingOwner && successor) {
      /*
      | The successor did not ask for this, so telling them is the whole
      | point of the notification here - the "someone left your team"
      | message would go to the person who just left.
      */
      await sendCaptainAssignedNotification({
        receiverId: successor.userId.toString(),
        actorId: userId,
        teamId: team._id.toString(),
        teamName: team.teamName,
      });
    } else if (wasMember) {
      await sendPlayerLeftTeamNotification({
        receiverId: team.userId.toString(),
        actorId: userId,
        teamId: team._id.toString(),
        playerId: player._id.toString(),
        playerName: player.playerName,
      });
    }
  } catch (notificationError) {
    console.error("Failed to send leave-team notification:", notificationError);
  }

  return team;
};

/*
|--------------------------------------------------------------------------
| Update Team Statistics
|--------------------------------------------------------------------------
*/

export const updateTeamStats = async (teamId: string) => {
  const team = await Team.findById(teamId);

  if (!team) {
    throw new Error("Team not found.");
  }

  /*
  | This used to read `team.wins / team.totalMatches` and save the result.
  | Both fields were permanently zero because nothing ever wrote to them, so
  | it faithfully computed 0% and stored it - a function that appeared to
  | maintain a team's record while guaranteeing it stayed empty.
  |
  | It now derives the whole record from completed matches, which is the same
  | rule the team leaderboard in stats.service.ts already used.
  */

  const stats = await computeTeamStats([teamId]);

  const record = stats.get(String(teamId));

  if (record) {
    Object.assign(team, record);
    await team.save();
  }

  return team;
};

/*
|--------------------------------------------------------------------------
| Create Local Player & Add To Team
|--------------------------------------------------------------------------
*/

export const createLocalPlayer = async (
  userId: string,
  teamId: string,
  payload: any,
) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    /*
    |--------------------------------------------------------------------------
    | Team
    |--------------------------------------------------------------------------
    */

    const team = await Team.findById(teamId).session(session);

    if (!team) {
      throw new Error("Team not found.");
    }

    await assertCanManagePlayers(team, userId);

    /*
    |--------------------------------------------------------------------------
    | Squad Limit
    |--------------------------------------------------------------------------
    */

    if (team.players.length >= 15) {
      throw new Error("Maximum 15 players allowed.");
    }

    /*
    |--------------------------------------------------------------------------
    | Duplicate Mobile (Optional)
    |--------------------------------------------------------------------------
    */

    if (payload.mobile) {
      const existingPlayer = await Player.findOne({
        mobile: payload.mobile,
      }).session(session);

      if (existingPlayer) {
        throw new Error("Player already exists. Invite the player instead.");
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Create Local Player
    |--------------------------------------------------------------------------
    */

    const player = await Player.create(
      [
        {
          playerName: payload.playerName,

          mobile: payload.mobile || "",

          playerType: payload.playerType,

          battingStyle: payload.battingStyle,

          bowlingStyle: payload.bowlingStyle,

          jerseyNumber: payload.jerseyNumber || null,

          isLocal: true,

          createdBy: userId,

          teams: [team._id],
        },
      ],
      {
        session,
      },
    );

    /*
    |--------------------------------------------------------------------------
    | Add Into Team
    |--------------------------------------------------------------------------
    */

    team.players.push(player[0]._id);

    await team.save({
      session,
    });

    await session.commitTransaction();

    session.endSession();

    return await Team.findById(teamId)
      .populate("captainId")
      .populate("viceCaptainId")
      .populate("players");
  } catch (error) {
    await session.abortTransaction();

    session.endSession();

    throw error;
  }
};
