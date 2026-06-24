import Player from "./player.model";

export const createPlayer = async (
  userId: string,
  payload: any
) => {
  const existingPlayer =
    await Player.findOne({
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
  });
};

export const getPlayers = async (
  userId: string
) => {
  return await Player.find({
    userId,
  });
};

export const getAllPlayers = async () => {
  return await Player.find()
    .populate(
      "userId",
      "fullName phone"
    );
};

export const getPlayerById = async (
  playerId: string
) => {
  return await Player.findById(
    playerId
  );
};

export const getMyPlayerProfile =
  async (userId: string) => {
    return await Player.findOne({
      userId,
    }).populate(
      "teams",
      "teamName logo"
    );
  };

export const updateMyPlayerProfile =
  async (
    userId: string,
    payload: any
  ) => {
    return await Player.findOneAndUpdate(
      {
        userId,
      },
      payload,
      {
        new: true,
      }
    );
  };

export const updatePlayer = async (
  playerId: string,
  payload: any
) => {
  return await Player.findByIdAndUpdate(
    playerId,
    payload,
    {
      new: true,
    }
  );
};

export const deletePlayer = async (
  playerId: string
) => {
  return await Player.findByIdAndDelete(
    playerId
  );
};