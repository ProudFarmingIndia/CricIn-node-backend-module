import Player from "./player.model";
import Team from "../teams/team.model";

import {
  getCareerStats,
  getPlayerMatchHistory,
} from "./player.stats.service";

import { assertCanManagePlayers } from "../teams/team.service";

/*
|--------------------------------------------------------------------------
| Permission: Can Modify Player
|--------------------------------------------------------------------------
|
| A real player can only be modified by the user it actually belongs to.
| A local player (no linked account) can be modified by whoever created
| them, OR by anyone currently managing a team that player belongs to -
| that second path matters because captaincy can change hands after the
| local player was originally added.
|
*/

const assertCanModifyPlayer = async (player: any, userId: string) => {
  if (player.userId && String(player.userId) === String(userId)) {
    return;
  }

  if (player.isLocal) {
    if (player.createdBy && String(player.createdBy) === String(userId)) {
      return;
    }

    if (player.teams && player.teams.length > 0) {
      const teams = await Team.find({ _id: { $in: player.teams } });

      for (const team of teams) {
        try {
          await assertCanManagePlayers(team, userId);
          return;
        } catch {
          // not this team - keep checking the others
        }
      }
    }
  }

  throw new Error("You don't have permission to modify this player.");
};

/*
|--------------------------------------------------------------------------
| Create Player Profile
|--------------------------------------------------------------------------
*/

export const createPlayer = async (userId: string, payload: any) => {
  const existingPlayer = await Player.findOne({
    userId,
  });

  if (existingPlayer) {
    throw new Error("Player profile already exists");
  }

  return await Player.create({
    ...payload,

    userId,

    profileImage: payload.profileImage || null,

    gallery: payload.gallery || [],
  });
};

/*
|--------------------------------------------------------------------------
| Get Logged In Player
|--------------------------------------------------------------------------
*/

export const getPlayers = async (userId: string) => {
  return await Player.find({
    userId,
  });
};

/*
|--------------------------------------------------------------------------
| Get All Players
|--------------------------------------------------------------------------
*/

export const getAllPlayers = async () => {
  return await Player.find()
    .populate("userId", "fullName phone")
    .populate({
  path: "teams",

  populate: [
    {
      path: "captainId",

      select:
        "playerName profileImage",
    },

    {
      path: "viceCaptainId",

      select:
        "playerName profileImage",
    },

    {
      path: "players",

      select:
        "playerName profileImage",
    },
  ],
})
};

/*
|--------------------------------------------------------------------------
| Get Player By Id
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Fresh Career Stats On Every Profile Read
|--------------------------------------------------------------------------
|
| Player.stats is written when a match completes, but reading the STORED
| value alone would have two problems, and the second is the one the user
| hit today.
|
|   1. Anything that changes after the fact - an undo that reopens a match,
|      a corrected result - leaves the stored figure behind until that
|      player's next match ends.
|
|   2. Every match completed BEFORE the stats writer existed left nothing
|      behind at all. Reading the stored value would show zeroes for a whole
|      season of cricket until each of those players happened to play again.
|
| Computing on read costs one indexed match query and one ball query for
| that player's completed matches, and removes staleness as a category of
| bug. The stored copy stays, for leaderboards and sorting later.
|
| Never throws: a profile must still open if the stats query fails.
*/

const withCareerStats = async (player: any) => {
  if (!player) return player;

  try {
    const [stats, matches] = await Promise.all([
      getCareerStats(player._id),
      getPlayerMatchHistory(player._id),
    ]);

    const plain = typeof player.toObject === "function"
      ? player.toObject()
      : player;

    /*
    | `matches` is what the profile's Matches tab reads. It was never set by
    | anything, on any schema, so that tab said "No Matches Found" for every
    | player who had ever played.
    */

    return { ...plain, stats, matches };
  } catch {
    return player;
  }
};

export const getPlayerById = async (playerId: string) => {
  const player = await Player.findById(playerId)
    .select("-mobile")
    .populate({
  path: "teams",

  populate: [
    {
      path: "captainId",

      select:
        "playerName profileImage",
    },

    {
      path: "viceCaptainId",

      select:
        "playerName profileImage",
    },

    {
      path: "players",

      select:
        "playerName profileImage",
    },
  ],
});

  return await withCareerStats(player);
};

/*
|--------------------------------------------------------------------------
| Get My Player Profile
|--------------------------------------------------------------------------
*/

export const getMyPlayerProfile = async (
  userId: string,
) => {
  const player = await Player.findOne({
    userId,
  })

    .populate({
  path: "teams",

  select:
    `
      teamName
      shortName
      logo
      city
      state
      country
      teamType
      visibility
      totalMatches
      wins
      losses
      draws
      winPercentage
      captainId
      viceCaptainId
      players
      ranking
      createdAt
    `,

  populate: [
    {
      path: "captainId",
      select: "playerName profileImage",
    },
    {
      path: "viceCaptainId",
      select: "playerName profileImage",
    },
    {
      path: "players",
      select: "playerName profileImage",
    },
  ],
});

  return await withCareerStats(player);
};

/*
|--------------------------------------------------------------------------
| Update My Profile
|--------------------------------------------------------------------------
*/

export const updateMyPlayerProfile = async (userId: string, payload: any) => {
  return await Player.findOneAndUpdate(
    {
      userId,
    },

    {
      ...payload,

      ...(payload.profileImage && {
        profileImage: payload.profileImage,
      }),

      ...(payload.gallery && {
        gallery: payload.gallery,
      }),
    },

    {
      new: true,
      runValidators: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Update Player
|--------------------------------------------------------------------------
*/

export const updatePlayer = async (userId: string, playerId: string, payload: any) => {
  const player = await Player.findById(playerId);

  if (!player) {
    throw new Error("Player not found.");
  }

  await assertCanModifyPlayer(player, userId);

  return await Player.findByIdAndUpdate(
    playerId,

    {
      ...payload,
    },

    {
      new: true,
      runValidators: true,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Delete Player
|--------------------------------------------------------------------------
*/

export const deletePlayer = async (userId: string, playerId: string) => {
  const player = await Player.findById(playerId);

  if (!player) {
    throw new Error("Player not found.");
  }

  await assertCanModifyPlayer(player, userId);

  return await Player.findByIdAndDelete(playerId);
};