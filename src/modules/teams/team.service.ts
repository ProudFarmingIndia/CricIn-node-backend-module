import mongoose from "mongoose";

import Team from "./team.model";
import Player from "../players/player.model";
import User from "../users/user.model";

import { checkPhone, isPhoneOk } from "../../shared/constants/phone";
import TeamBlockedDate from "./teamBlockedDate.model";
import TeamInvitation from "../teamInvitations/invitation.model";

/* Same model, aliased for readability inside createLocalPlayer. */
import Invitation from "../teamInvitations/invitation.model";

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

/*
|--------------------------------------------------------------------------
| Team Name / Short Name Availability
|--------------------------------------------------------------------------
|
| WHY THIS EXISTS AS A SERVICE AND NOT JUST A CHECK IN THE APP
|
| The app asks this endpoint while the user types so it can disable the
| Continue button and show the error under the field, rather than letting
| them fill in a whole form and rejecting it on submit. That is UX.
|
| The SAME functions run inside createTeam and updateTeam, because the app
| cannot be trusted: anyone can POST to /api/teams with curl. A check that
| only lives in the client is decoration.
|
| CASE INSENSITIVITY WAS A REAL HOLE
|
| The previous check was:
|
|     Team.findOne({ teamName: payload.teamName.trim(), isActive: true })
|
| An exact string match. "Delhi Warriors" and "delhi warriors" and
| "DELHI WARRIORS" were three different teams, which is not what any user
| means by "that name is taken" - and it makes teamName useless as a way to
| find a team by name.
|
| Collation strength 2 compares case-insensitively (and accent-
| insensitively) in the database rather than pulling rows back and
| lowercasing in Node.
|
| SHORT NAME WAS NOT CHECKED AT ALL
|
| shortName appears on every scorecard. Two teams sharing "DW" makes a
| scoreboard ambiguous at exactly the moment it matters. It is uppercased
| by the schema, so a plain match is already case-insensitive - but the
| collation is applied anyway so the two behave identically.
|
| NOTE ON THE INDEX
|
| There is deliberately no `unique: true` on either field. Adding one to a
| collection that already contains duplicates fails to build the index and
| the deploy dies. Dedupe the existing rows first, then add:
|
|     teamSchema.index(
|       { teamName: 1 },
|       { unique: true, collation: { locale: "en", strength: 2 } },
|     );
|
| Until then this service check is the only guard, which means two people
| creating the same name in the same second can both succeed. Rare, and
| survivable - a wrong error message on a form is worse than a rare race.
*/

const CI = { locale: "en", strength: 2 } as const;

type NameCheck = {
  available: boolean;
  message: string;
};

const checkOneName = async (
  field: "teamName" | "shortName",
  rawValue: string,
  excludeTeamId?: string,
): Promise<NameCheck> => {
  const value = String(rawValue || "").trim();

  const label = field === "teamName" ? "Team name" : "Short name";

  if (!value) {
    return { available: false, message: `${label} is required.` };
  }

  if (field === "shortName" && value.length > 6) {
    return { available: false, message: "Short name can be at most 6 characters." };
  }

  if (field === "teamName" && value.length > 50) {
    return { available: false, message: "Team name can be at most 50 characters." };
  }

  const query: any = {
    [field]: field === "shortName" ? value.toUpperCase() : value,
    isActive: true,
  };

  /*
  | Editing a team must not collide with itself - otherwise saving any other
  | field on the edit screen reports the team's own name as taken.
  */
  if (excludeTeamId && mongoose.Types.ObjectId.isValid(excludeTeamId)) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeTeamId) };
  }

  const clash = await Team.findOne(query).collation(CI).select("_id").lean();

  return clash
    ? {
        available: false,
        message: `${label} “${value}” is already taken. Try another.`,
      }
    : { available: true, message: "" };
};

/*
| Both names in one round trip. The app calls this on a debounce while the
| user types, so it answers about both fields at once rather than making
| the client fire two requests per keystroke.
*/

export const checkNameAvailability = async (
  teamName?: string,
  shortName?: string,
  excludeTeamId?: string,
) => {
  const [name, short] = await Promise.all([
    /*
    | An empty field is "not yet answered", not "unavailable" - the user is
    | still typing and an error under an untouched field is noise.
    */
    teamName === undefined
      ? Promise.resolve(null)
      : checkOneName("teamName", teamName, excludeTeamId),

    shortName === undefined
      ? Promise.resolve(null)
      : checkOneName("shortName", shortName, excludeTeamId),
  ]);

  return {
    teamName: name,
    shortName: short,
    available: (!name || name.available) && (!short || short.available),
  };
};

/*
| The write-side guard. Throws the first problem it finds so the message
| reaching the client names the actual field.
*/

const assertNamesAvailable = async (
  teamName: string,
  shortName: string,
  excludeTeamId?: string,
) => {
  const result = await checkNameAvailability(teamName, shortName, excludeTeamId);

  if (result.teamName && !result.teamName.available) {
    throw new Error(result.teamName.message);
  }

  if (result.shortName && !result.shortName.available) {
    throw new Error(result.shortName.message);
  }
};

export const createTeam = async (userId: string, payload: any) => {
  await assertNamesAvailable(payload.teamName, payload.shortName);

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

  /*
  | Only checked when the payload actually carries a name. An edit that
  | changes only the bio must not be rejected because some OTHER team was
  | created with a clashing name since - and `excludeTeamId` stops the team
  | colliding with itself.
  */
  if (payload.teamName !== undefined || payload.shortName !== undefined) {
    await assertNamesAvailable(payload.teamName, payload.shortName, teamId);
  }

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

/*
|--------------------------------------------------------------------------
| Create Local Player - and the User account behind them
|--------------------------------------------------------------------------
|
| A captain at a ground types a team-mate's name and number. That person is
| not on CricIn. Before this change they became a Player row with
| `userId: null` - a record of a human that the human themselves could
| never reach.
|
| The problem showed up the day they signed up. OTP login does
| `User.findOne({ phone })`, found nothing, created a BRAND NEW user, and
| gave them an empty profile - while their real one, with their matches and
| their team membership, sat orphaned under a different id. Their history
| was in the database and invisible to them, permanently.
|
| So the User is created now, at the same moment as the Player, with the
| phone number as the link. When that person finally logs in, OTP finds the
| existing User, and the Player already attached to it is their profile -
| squad membership, past matches and all.
|
| WHAT THIS DOES NOT DO
|
| It does not verify the number, and it does not log anyone in. The User is
| created with isVerified:false and no OTP; the only way into that account
| is still an OTP sent to that handset. Creating the row is not creating a
| session.
|
| MOBILE IS NOW REQUIRED
|
| It used to be optional, which was the whole problem - a player with no
| number can never be linked to anybody, so the record is write-only. The
| number IS the identity here.
|
| Validated through the same shared/constants/phone.ts the OTP flow uses,
| so "9876543210" and "+91 98765 43210" normalise to the same thing and a
| landline is rejected before it becomes an account nobody can sign into.
*/

export const createLocalPlayer = async (
  userId: string,
  teamId: string,
  payload: any,
) => {
  /*
  |------------------------------------------------------------------------
  | Validate before opening a transaction
  |------------------------------------------------------------------------
  |
  | Cheap checks first. Starting a session to immediately abort it costs a
  | round trip to the primary for nothing.
  */

  const playerName = String(payload.playerName || "").trim();

  if (!playerName) {
    throw new Error("Player name is required.");
  }

  const check = checkPhone(payload.mobile, payload.countryCode);

  if (!isPhoneOk(check)) {
    throw new Error(check.message);
  }

  const { phone, rule } = check;

  /*
  | playerType is `required: true` on the Player schema with a fixed enum.
  | Checked here so the failure is a readable sentence rather than a raw
  | Mongoose ValidationError - which is what the captain used to see when
  | the app did not send it at all.
  */

  /*
  | `as const` so the literal union survives, and the variable is typed as
  | that union. Without it playerType is a plain `string`, which the schema
  | typing rejects: Player.playerType is the four literals, not any string.
  */

  const PLAYER_TYPES = [
    "Batsman",
    "Bowler",
    "All-Rounder",
    "Wicket Keeper",
  ] as const;

  type PlayerType = (typeof PLAYER_TYPES)[number];

  const playerType = String(payload.playerType || "").trim() as PlayerType;

  if (!playerType) {
    throw new Error("Please choose a player type.");
  }

  if (!PLAYER_TYPES.includes(playerType)) {
    throw new Error(
      `Player type must be one of: ${PLAYER_TYPES.join(", ")}.`,
    );
  }

  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const team = await Team.findById(teamId).session(session);

    if (!team) {
      throw new Error("Team not found.");
    }

    await assertCanManagePlayers(team, userId);

    /*
    | The inviter's own Player profile - invitation.invitedBy is a Player
    | reference, not a User one.
    */
    const actor = await Player.findOne({ userId }).session(session);

    if (!actor) {
      throw new Error(
        "Complete your own player profile before adding players.",
      );
    }

    if (team.players.length >= 15) {
      throw new Error("Maximum 15 players allowed.");
    }

    /*
    |----------------------------------------------------------------------
    | Does this person already exist?
    |----------------------------------------------------------------------
    |
    | Three cases, and they are genuinely different:
    |
    |   A PLAYER PROFILE EXISTS. Whether local or registered, this human is
    |   already in CricIn. Creating a second profile splits their career
    |   stats across two records that can never be merged - so refuse, and
    |   point at the invite flow, which adds the EXISTING player.
    |
    |   A USER EXISTS BUT HAS NO PLAYER. Someone signed up and never
    |   finished their profile. Reuse that account rather than colliding
    |   with the unique index on phone - and the profile the captain is
    |   filling in becomes theirs when they next log in.
    |
    |   NEITHER EXISTS. Create both.
    */

    const existingPlayer = await Player.findOne({ mobile: phone }).session(
      session,
    );

    if (existingPlayer) {
      /*
      | Already in THIS squad is a different, friendlier message than
      | already on CricIn - the captain has simply added them twice.
      */
      const alreadyInSquad = team.players.some((id: any) =>
        id.equals(existingPlayer._id),
      );

      throw new Error(
        alreadyInSquad
          ? `${existingPlayer.playerName} is already in this squad.`
          : `${existingPlayer.playerName} is already on CricIn with this number. Use "Invite CricIn Player" instead.`,
      );
    }

    let user: any = await User.findOne({ phone }).session(session);

    if (user) {
      const linked = await Player.findOne({ userId: user._id }).session(session);

      if (linked) {
        throw new Error(
          `${linked.playerName} is already on CricIn with this number. Use "Invite CricIn Player" instead.`,
        );
      }
    } else {
      const created = await User.create(
        [
          {
            phone,
            countryCode: rule.code,
            fullName: playerName,

            /*
            | NOT verified. This account has never proved it owns the
            | number - only an OTP to that handset can do that, and that
            | has not happened. isVerified flips on first successful login.
            */
            isVerified: false,
          },
        ],
        { session },
      );

      user = created[0];
    }

    /*
    |----------------------------------------------------------------------
    | The player profile
    |----------------------------------------------------------------------
    |
    | isLocal stays TRUE. It no longer means "has no User account" - it
    | means "this profile was filled in by somebody else and the person it
    | describes has not confirmed it". Flip it to false when they log in
    | and complete their own profile.
    |
    | Everything except the name is optional on purpose. The captain is
    | standing on a field with eleven people waiting; batting style and
    | jersey number are for the player to fill in later.
    */

    const player = await Player.create(
      [
        {
          userId: user._id,

          playerName,

          mobile: phone,

          playerType,

          /*
          |------------------------------------------------------------------
          | Optional details
          |------------------------------------------------------------------
          |
          | Every one of these is a field the Player schema really has, in
          | the shape it really wants. An earlier version passed `age`,
          | `countryCode` and a `profileImage` STRING - the schema has `dob`,
          | no countryCode, and profileImage as { url, publicId } - so
          | Mongoose dropped all three silently in strict mode and the
          | captain saw "Success" with nothing saved.
          |
          | gender is `|| null`, NOT `|| ""`. Its enum is
          | ["Male","Female","Other"] and "" is not in it, so an empty string
          | fails validation on every save. Mongoose skips enum checks for
          | null on a non-required field, which is what "not set" has to be.
          |
          | dob and jerseyNumber are null rather than "" for the same class
          | of reason - a Date and a Number field will not take an empty
          | string.
          */

          gender: payload.gender || null,

          dob: payload.dob || null,

          country: payload.country || "IN",

          state: payload.state || "",

          city: payload.city || "",

          battingStyle: payload.battingStyle || "",

          bowlingStyle: payload.bowlingStyle || "",

          jerseyNumber:
            payload.jerseyNumber === "" ||
            payload.jerseyNumber === undefined ||
            payload.jerseyNumber === null
              ? null
              : Number(payload.jerseyNumber),

          isLocal: true,

          createdBy: userId,

          teams: [team._id],
        },
      ],
      { session },
    );

    /*
    |----------------------------------------------------------------------
    | An INVITATION, not a squad membership
    |----------------------------------------------------------------------
    |
    | The player is NOT pushed into team.players. Adding somebody to a team
    | without asking them is the thing this whole flow exists to stop: a
    | captain could previously put any phone number into a squad, and the
    | person it belonged to had no say and no way to leave a team they
    | never joined.
    |
    | So the profile is created, the account behind it is created, and a
    | PENDING invitation is raised. They join when they log in and accept.
    |
    | Created here in the same transaction as the Player, so there is never
    | a profile sitting without the invitation that explains why it exists.
    */

    const invitation = await Invitation.create(
      [
        {
          teamId: team._id,
          playerId: player[0]._id,

          /*
          | invitedBy is a PLAYER reference, not a User. The captain's own
          | player profile is required for it - which every captain has, or
          | they could not have created the team.
          */
          invitedBy: actor?._id,

          message: `${team.teamName} added you to their squad. Accept to join.`,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    session.endSession();

    /*
    |----------------------------------------------------------------------
    | Tell them they exist
    |----------------------------------------------------------------------
    |
    | AFTER the commit, never inside it. An SMS cannot be rolled back, so
    | sending before the transaction lands risks telling somebody about an
    | account that then failed to save.
    |
    | Not wired up yet - deliberately. SMS delivery is still being sorted
    | out with MSG91, and this would need its own DLT-approved template
    | ("You have been added to <team> on CricIn. Log in with this number to
    | complete your profile."). When that template is approved, send it
    | here and let a failure log rather than throw: the player was created
    | successfully whether or not the message went.
    */

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[team] ${playerName} (${rule.dialCode} ${phone}) - user ${user._id}, ` +
          `invitation ${invitation[0]._id} PENDING`,
      );
    }

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
