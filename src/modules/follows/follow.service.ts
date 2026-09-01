import mongoose from "mongoose";

import Follow from "./follow.model";
import Player from "../players/player.model";
import Team from "../teams/team.model";
import User from "../users/user.model";

import { createNotification } from "../notifications/notification.service";
import { NOTIFICATION_TYPES } from "../notifications/notification.types";

/*
|--------------------------------------------------------------------------
| Follow Service
|--------------------------------------------------------------------------
|
| Rewritten. The previous version was four one-line wrappers around raw
| Mongoose calls, and every one of them had a hole:
|
|   follow()   spread req.body straight into Follow.create(), so a client
|              could set targetType to anything, set status itself, or
|              overwrite followerId and create a follow on someone else's
|              behalf. It also never checked for an existing follow.
|
|   unfollow() matched on targetId alone, ignoring targetType.
|
|   getFollowers() returned bare follow documents - two ObjectIds and a
|              timestamp - so the client had no name or photo to render and
|              would have needed one request per row to build a list.
|
|   acceptFollowRequest() took a followId and accepted it with no check
|              that the caller was the person being followed. Anyone who
|              could guess an id could accept a follow request addressed to
|              someone else.
|
| Counts are denormalised onto Player.followers / Player.following and
| Team.followersCount so a search result can show them without a count
| query per row. They are adjusted only when a follow is genuinely created
| or genuinely deleted, so a repeated tap cannot inflate them.
|
*/

export const FOLLOWABLE_TYPES = ["PLAYER", "TEAM"] as const;

export type FollowableType = (typeof FOLLOWABLE_TYPES)[number];

/*
|--------------------------------------------------------------------------
| Target Type Narrowing
|--------------------------------------------------------------------------
|
| Mongoose infers targetType from the schema enum as the literal union
| "USER" | "PLAYER" | "TEAM" | "TOURNAMENT", NOT as string. So a plain
| `string` cannot be used in a filter - tsc rejects it with TS2769 ("no
| overload matches this call"), which is what this module hit on startup.
|
| Every public function here still ACCEPTS a string, because that is what
| arrives from req.params and req.body. It is narrowed once, here, and the
| narrowed value is what goes into the query. That keeps the cast in one
| place instead of scattered through a dozen call sites, and it means an
| unknown type is rejected with a clear message rather than silently
| querying for a targetType nothing can ever match.
|
*/

const asFollowable = (value: string): FollowableType => {
  if (!FOLLOWABLE_TYPES.includes(value as FollowableType)) {
    throw new Error("targetType must be PLAYER or TEAM.");
  }

  return value as FollowableType;
};

/*
|--------------------------------------------------------------------------
| Target Resolution
|--------------------------------------------------------------------------
|
| Confirms the target exists before writing a follow - otherwise a typo'd
| id creates a follow pointing at nothing, which then shows up in the
| user's Following list forever as an unrenderable row.
|
| Returns the owning userId too, since that is who gets the "started
| following you" notification.
|
*/

const resolveTarget = async (
  targetType: FollowableType,
  targetId: string,
) => {
  if (targetType === "PLAYER") {
    const player = await Player.findById(targetId).select(
      "playerName userId isLocal",
    );

    if (!player) {
      throw new Error("Player not found.");
    }

    /*
    | Local players are squad entries created by a captain for someone with
    | no CricIn account. There is nobody to notify and no profile to follow
    | for updates, so following them is refused rather than silently
    | creating a dead subscription.
    */

    if (player.isLocal || !player.userId) {
      throw new Error("This player has not joined CricIn yet.");
    }

    return {
      name: player.playerName,
      ownerUserId: String(player.userId),
    };
  }

  const team = await Team.findById(targetId).select("teamName userId isActive");

  if (!team || team.isActive === false) {
    throw new Error("Team not found.");
  }

  return {
    name: team.teamName,
    ownerUserId: String(team.userId),
  };
};

/*
|--------------------------------------------------------------------------
| Count Maintenance
|--------------------------------------------------------------------------
|
| $inc rather than a recount: a recount is a full collection scan per
| follow, and these fire on a tap. Drift is corrected by
| recalculateFollowCounts() below, which the counts endpoint can call if a
| number ever looks wrong.
|
| $max-style clamping is not available on $inc, so every read guards
| against a negative by treating anything below zero as zero at the
| presentation layer - and the delete path only decrements when a document
| was actually removed.
|
*/

const adjustTargetFollowerCount = async (
  targetType: FollowableType,
  targetId: string,
  delta: number,
) => {
  if (targetType === "PLAYER") {
    await Player.updateOne(
      { _id: targetId },
      { $inc: { followers: delta } },
    );

    return;
  }

  await Team.updateOne(
    { _id: targetId },
    { $inc: { followersCount: delta } },
  );
};

const adjustFollowerFollowingCount = async (
  followerUserId: string,
  delta: number,
) => {
  /*
  | "following" lives on the Player document, but the follower is a User.
  | A user who has not created a player profile yet simply has no counter
  | to move - updateOne matching nothing is not an error.
  */

  await Player.updateOne(
    { userId: followerUserId },
    { $inc: { following: delta } },
  );
};

/*
|--------------------------------------------------------------------------
| Follow
|--------------------------------------------------------------------------
|
| Idempotent: following something already followed returns the existing
| document and changes no counts, so a double tap or a retried request is
| harmless.
|
*/

export const follow = async (
  followerUserId: string,
  payload: { targetType?: string; targetId?: string },
) => {
  /*
  | Explicit allow-list. The old code took targetType from the body
  | unchecked, so a client could write "USER" or "TOURNAMENT" follows that
  | nothing in the app knows how to render or count.
  */

  const targetType = asFollowable(payload?.targetType || "");

  const targetId = payload?.targetId;

  if (!targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
    throw new Error("A valid targetId is required.");
  }

  const target = await resolveTarget(targetType, targetId);

  /*
  | Self-follow guard. For a player this means the caller's own profile;
  | for a team it does NOT mean the team they own - captains following
  | their own team is legitimate and useful.
  */

  if (targetType === "PLAYER" && target.ownerUserId === String(followerUserId)) {
    throw new Error("You cannot follow yourself.");
  }

  const existing = await Follow.findOne({
    followerId: followerUserId,
    targetType,
    targetId,
  });

  if (existing) {
    return {
      follow: existing,

      created: false,
    };
  }

  let created;

  try {
    created = await Follow.create({
      followerId: followerUserId,

      targetType,

      targetId,

      status: "ACCEPTED",
    });
  } catch (error: any) {
    /*
    | 11000 = duplicate key. Two taps racing each other both passed the
    | findOne above; the index caught the loser. That is a success from the
    | user's point of view, so return the winner instead of an error.
    */

    if (error?.code === 11000) {
      const raced = await Follow.findOne({
        followerId: followerUserId,
        targetType,
        targetId,
      });

      return {
        follow: raced,

        created: false,
      };
    }

    throw error;
  }

  await Promise.all([
    adjustTargetFollowerCount(targetType, targetId, 1),

    adjustFollowerFollowingCount(followerUserId, 1),
  ]);

  /*
  |--------------------------------------------------------------------------
  | Notify The Person Followed
  |--------------------------------------------------------------------------
  |
  | Never fails the follow itself: the follow is already written and the
  | counts already moved, so a notification problem must not surface as
  | "Follow failed" to someone who is now definitely following.
  |
  */

  try {
    if (target.ownerUserId && target.ownerUserId !== String(followerUserId)) {
      const followerPlayer = await Player.findOne({
        userId: followerUserId,
      }).select("playerName");

      const followerUser = await User.findById(followerUserId).select(
        "fullName",
      );

      const followerName =
        followerPlayer?.playerName || followerUser?.fullName || "Someone";

      await createNotification({
        receiverId: target.ownerUserId,

        actorId: followerUserId,

        type: NOTIFICATION_TYPES.NEW_FOLLOWER,

        title: "New Follower",

        message:
          targetType === "TEAM"
            ? `${followerName} started following ${target.name}.`
            : `${followerName} started following you.`,

        data: {
          targetType,

          targetId,

          followerUserId,
        },
      });
    }
  } catch (notifyError) {
    console.error("Failed to send new-follower notification:", notifyError);
  }

  return {
    follow: created,

    created: true,
  };
};

/*
|--------------------------------------------------------------------------
| Unfollow
|--------------------------------------------------------------------------
|
| targetType is now part of the match. Without it, unfollowing a team whose
| id happened to match a followed player's id would have deleted the wrong
| subscription.
|
*/

export const unfollow = async (
  followerUserId: string,
  targetType: string,
  targetId: string,
) => {
  const type = asFollowable(targetType);

  const removed = await Follow.findOneAndDelete({
    followerId: followerUserId,

    targetType: type,

    targetId,
  });

  // Nothing was following - counts must not move.
  if (!removed) {
    return { removed: false };
  }

  await Promise.all([
    adjustTargetFollowerCount(type, targetId, -1),

    adjustFollowerFollowingCount(followerUserId, -1),
  ]);

  return { removed: true };
};

/*
|--------------------------------------------------------------------------
| Is Following (Single)
|--------------------------------------------------------------------------
*/

export const isFollowing = async (
  followerUserId: string,
  targetType: string,
  targetId: string,
) => {
  const existing = await Follow.exists({
    followerId: followerUserId,

    targetType: asFollowable(targetType),

    targetId,

    status: "ACCEPTED",
  });

  return Boolean(existing);
};

/*
|--------------------------------------------------------------------------
| Is Following (Batch)
|--------------------------------------------------------------------------
|
| Search returns up to MAX_SEARCH_RESULTS rows and every one needs a Follow
| / Following button in the correct state. Done per row that is one query
| each; this resolves the whole page in one.
|
| Returns a Set of "TYPE:id" keys.
|
*/

export const getFollowedTargetKeys = async (
  followerUserId: string,
  targets: { targetType: string; targetId: string }[],
) => {
  if (!followerUserId || targets.length === 0) {
    return new Set<string>();
  }

  const follows = await Follow.find({
    followerId: followerUserId,

    status: "ACCEPTED",

    /*
    | Narrowed per entry: an array of { targetType: string } is not a
    | valid $or for a schema whose enum is a literal union.
    */
    $or: targets.map((t) => ({
      targetType: asFollowable(t.targetType),
      targetId: t.targetId,
    })),
  }).select("targetType targetId");

  return new Set(
    follows.map((f) => `${f.targetType}:${String(f.targetId)}`),
  );
};

/*
|--------------------------------------------------------------------------
| Followers Of A Target
|--------------------------------------------------------------------------
|
| Returns renderable rows - name, photo, player id - rather than raw follow
| documents, so the followers list is one request instead of one per row.
|
| A follower who has not created a player profile still appears, using
| their User name; they just have no player profile to open.
|
*/

export const getFollowers = async (
  targetType: string,
  targetId: string,
  viewerUserId?: string,
) => {
  const follows = await Follow.find({
    targetType: asFollowable(targetType),

    targetId,

    status: "ACCEPTED",
  })
    .sort({ createdAt: -1 })
    .select("followerId createdAt");

  const followerUserIds = follows.map((f) => f.followerId);

  const [players, users] = await Promise.all([
    Player.find({ userId: { $in: followerUserIds } }).select(
      "playerName profileImage playerType city userId",
    ),

    User.find({ _id: { $in: followerUserIds } }).select("fullName"),
  ]);

  const playerByUserId = new Map(
    players.map((p) => [String(p.userId), p]),
  );

  const userById = new Map(users.map((u) => [String(u._id), u]));

  /*
  | So the viewer sees the right button state on each row without a second
  | round trip - "Following" next to the people they already follow.
  */

  const followedKeys = viewerUserId
    ? await getFollowedTargetKeys(
        viewerUserId,
        players.map((p) => ({
          targetType: "PLAYER",
          targetId: String(p._id),
        })),
      )
    : new Set<string>();

  return follows.map((f) => {
    const player = playerByUserId.get(String(f.followerId));

    const user = userById.get(String(f.followerId));

    return {
      userId: f.followerId,

      playerId: player?._id || null,

      name: player?.playerName || user?.fullName || "CricIn user",

      profileImage: player?.profileImage || null,

      playerType: player?.playerType || null,

      city: player?.city || null,

      isSelf: String(f.followerId) === String(viewerUserId),

      isFollowedByViewer: player
        ? followedKeys.has(`PLAYER:${String(player._id)}`)
        : false,

      followedAt: f.createdAt,
    };
  });
};

/*
|--------------------------------------------------------------------------
| What A User Follows
|--------------------------------------------------------------------------
|
| Players and teams in one response, each already resolved to something the
| list can render.
|
*/

export const getFollowing = async (userId: string) => {
  const follows = await Follow.find({
    followerId: userId,

    status: "ACCEPTED",
  })
    .sort({ createdAt: -1 })
    .select("targetType targetId createdAt");

  const playerIds = follows
    .filter((f) => f.targetType === "PLAYER")
    .map((f) => f.targetId);

  const teamIds = follows
    .filter((f) => f.targetType === "TEAM")
    .map((f) => f.targetId);

  const [players, teams] = await Promise.all([
    Player.find({ _id: { $in: playerIds } }).select(
      "playerName profileImage playerType city followers",
    ),

    Team.find({ _id: { $in: teamIds } }).select(
      "teamName shortName logo teamType city followersCount",
    ),
  ]);

  const playerById = new Map(players.map((p) => [String(p._id), p]));

  const teamById = new Map(teams.map((t) => [String(t._id), t]));

  /*
  | Follows whose target has since been deleted are dropped rather than
  | returned as empty rows.
  */

  return {
    players: follows
      .filter((f) => f.targetType === "PLAYER")
      .map((f) => playerById.get(String(f.targetId)))
      .filter(Boolean),

    teams: follows
      .filter((f) => f.targetType === "TEAM")
      .map((f) => teamById.get(String(f.targetId)))
      .filter(Boolean),
  };
};

/*
|--------------------------------------------------------------------------
| Follow Stats For One Target
|--------------------------------------------------------------------------
|
| Counted live rather than read off the denormalised field, so the profile
| header - the one place the number is looked at closely - is always right
| even if an $inc was lost.
|
*/

export const getFollowStats = async (
  targetType: string,
  targetId: string,
  viewerUserId?: string,
) => {
  const followers = await Follow.countDocuments({
    targetType: asFollowable(targetType),

    targetId,

    status: "ACCEPTED",
  });

  /*
  | "Following" only means something for a player: it is that person's own
  | subscriptions. A team does not follow anything.
  */

  let following = 0;

  if (targetType === "PLAYER") {
    const player = await Player.findById(targetId).select("userId");

    if (player?.userId) {
      following = await Follow.countDocuments({
        followerId: player.userId,

        status: "ACCEPTED",
      });
    }
  }

  const viewerIsFollowing = viewerUserId
    ? await isFollowing(viewerUserId, targetType, targetId)
    : false;

  return {
    followers,

    following,

    isFollowing: viewerIsFollowing,
  };
};

/*
|--------------------------------------------------------------------------
| Recalculate Denormalised Counts
|--------------------------------------------------------------------------
|
| Repair path for drift between the $inc counters and the collection - a
| lost increment, or rows left behind by the old duplicate-creating code.
| Safe to run at any time.
|
*/

export const recalculateFollowCounts = async (
  targetType: string,
  targetId: string,
) => {
  const followers = await Follow.countDocuments({
    targetType: asFollowable(targetType),

    targetId,

    status: "ACCEPTED",
  });

  if (targetType === "PLAYER") {
    const player = await Player.findById(targetId).select("userId");

    const following = player?.userId
      ? await Follow.countDocuments({
          followerId: player.userId,
          status: "ACCEPTED",
        })
      : 0;

    await Player.updateOne(
      { _id: targetId },
      { $set: { followers, following } },
    );

    return { followers, following };
  }

  await Team.updateOne(
    { _id: targetId },
    { $set: { followersCount: followers } },
  );

  return { followers, following: 0 };
};

/*
|--------------------------------------------------------------------------
| Follower User Ids (For Notification Fan-Out)
|--------------------------------------------------------------------------
*/

export const getFollowerUserIds = async (
  targetType: string,
  targetId: string,
) => {
  const follows = await Follow.find({
    targetType: asFollowable(targetType),

    targetId,

    status: "ACCEPTED",
  }).select("followerId");

  return follows.map((f) => String(f.followerId));
};
