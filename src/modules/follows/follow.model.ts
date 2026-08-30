import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Follow
|--------------------------------------------------------------------------
|
| One document per (follower, target) pair.
|
| The previous version had no unique index and the service created blindly,
| so tapping Follow twice - or a double-tap, or a retried request - wrote a
| second, third, fourth identical row. Every follower count derived from
| this collection was therefore wrong, and unfollow only removed one of
| them. The compound unique index below makes a duplicate follow impossible
| at the database level rather than relying on the service to check first.
|
| targetType is part of the key because a Player id and a Team id come from
| different collections and could theoretically collide; it also lets
| "teams I follow" and "players I follow" be one query each.
|
*/

const followSchema = new mongoose.Schema(
  {
    /*
    | The User doing the following - not their Player profile. Auth gives us
    | a userId, and local players (who have no account) can never follow
    | anything, so User is the right anchor.
    */

    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    targetType: {
      type: String,
      enum: ["USER", "PLAYER", "TEAM", "TOURNAMENT"],
      required: true,
    },

    /*
    | Deliberately un-`ref`d: the collection it points at depends on
    | targetType, so there is no single ref Mongoose could populate. The
    | service resolves it explicitly against the right model.
    */

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    /*
    | Kept for the private-profile flow, but every follow is created
    | ACCEPTED today - following is instant. When request/approve is turned
    | on, only the creation path changes; everything that reads follows
    | already filters on status.
    */

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED"],
      default: "ACCEPTED",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

/*
| The one that matters: makes a duplicate follow a write error instead of a
| silent second row.
|
| NOTE: if the existing collection already has duplicates from the old
| behaviour, this index will fail to build. Clear them first:
|
|   db.follows.aggregate([
|     { $group: {
|         _id: { f: "$followerId", t: "$targetType", i: "$targetId" },
|         ids: { $push: "$_id" }, n: { $sum: 1 } } },
|     { $match: { n: { $gt: 1 } } }
|   ]).forEach(d => { d.ids.shift(); db.follows.deleteMany({ _id: { $in: d.ids } }); })
|
*/

followSchema.index(
  {
    followerId: 1,
    targetType: 1,
    targetId: 1,
  },
  {
    unique: true,
  },
);

// "Who follows this player/team?" - the followers list.
followSchema.index({
  targetType: 1,
  targetId: 1,
  status: 1,
});

// "Who does this user follow?" - the following list, and the fan-out lookup.
followSchema.index({
  followerId: 1,
  status: 1,
  createdAt: -1,
});

const Follow = mongoose.model("Follow", followSchema);

export default Follow;
