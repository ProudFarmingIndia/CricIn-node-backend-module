import Player from "./player.model";
import Team from "../teams/team.model";

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

export const getPlayerById = async (playerId: string) => {
  return await Player.findById(playerId)
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
};

/*
|--------------------------------------------------------------------------
| Get My Player Profile
|--------------------------------------------------------------------------
*/

export const getMyPlayerProfile = async (
  userId: string,
) => {
  return await Player.findOne({
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