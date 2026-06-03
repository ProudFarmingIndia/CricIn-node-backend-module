import Player from "./player.mode";

export const createPlayer = async (
  userId: string,
  payload: any
) => {
  const player = await Player.create({
    ...payload,
    userId,
  });

  return player;
};

export const getPlayers = async (
  userId: string
) => {
  return await Player.find({
    userId,
  });
};

export const getPlayerById = async (
  playerId: string
) => {
  return await Player.findById(playerId);
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

export const getAllPlayers = async () => {
  return await Player.find()
    .populate("userId", "fullName phone");
};