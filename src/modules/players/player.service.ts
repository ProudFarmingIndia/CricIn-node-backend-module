import Player from "./player.model";

/*
|--------------------------------------------------------------------------
| Create Player Profile
|--------------------------------------------------------------------------
*/

export const createPlayer = async (
  userId: string,
  payload: any
) => {
  const existingPlayer = await Player.findOne({
    userId,
  });

  if (existingPlayer) {
    throw new Error(
      "Player profile already exists"
    );
  }

  return await Player.create({
    ...payload,

    userId,

    profileImage:
      payload.profileImage || null,

    gallery:
      payload.gallery || [],
  });
};

/*
|--------------------------------------------------------------------------
| Get Logged In Player
|--------------------------------------------------------------------------
*/

export const getPlayers = async (
  userId: string
) => {
  return await Player.find({
    userId,
  });
};

/*
|--------------------------------------------------------------------------
| Get All Players
|--------------------------------------------------------------------------
*/

export const getAllPlayers =
  async () => {
    return await Player.find()
      .populate(
        "userId",
        "fullName phone"
      )
      .populate(
        "teams",
        "teamName logo"
      );
  };

/*
|--------------------------------------------------------------------------
| Get Player By Id
|--------------------------------------------------------------------------
*/

export const getPlayerById =
  async (
    playerId: string
  ) => {
    return await Player.findById(
      playerId
    )
      .populate(
        "teams",
        "teamName logo"
      );
  };

/*
|--------------------------------------------------------------------------
| Get My Profile
|--------------------------------------------------------------------------
*/

export const getMyPlayerProfile =
  async (
    userId: string
  ) => {
    return await Player.findOne({
      userId,
    }).populate(
      "teams",
      "teamName logo"
    );
  };

/*
|--------------------------------------------------------------------------
| Update My Profile
|--------------------------------------------------------------------------
*/

export const updateMyPlayerProfile =
  async (
    userId: string,
    payload: any
  ) => {
    return await Player.findOneAndUpdate(
      {
        userId,
      },

      {
        ...payload,

        ...(payload.profileImage && {
          profileImage:
            payload.profileImage,
        }),

        ...(payload.gallery && {
          gallery:
            payload.gallery,
        }),
      },

      {
        new: true,
        runValidators: true,
      }
    );
  };

/*
|--------------------------------------------------------------------------
| Update Player
|--------------------------------------------------------------------------
*/

export const updatePlayer =
  async (
    playerId: string,
    payload: any
  ) => {
    return await Player.findByIdAndUpdate(
      playerId,

      {
        ...payload,
      },

      {
        new: true,
        runValidators: true,
      }
    );
  };

/*
|--------------------------------------------------------------------------
| Delete Player
|--------------------------------------------------------------------------
*/

export const deletePlayer =
  async (
    playerId: string
  ) => {
    return await Player.findByIdAndDelete(
      playerId
    );
  };