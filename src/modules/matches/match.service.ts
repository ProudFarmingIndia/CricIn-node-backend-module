import Match from "./match.model";

export const createMatch = async (
  userId: string,
  payload: any
) => {
  return await Match.create({
    ...payload,
    userId,
  });
};

export const getMatches = async (
  userId: string
) => {
  return await Match.find({
    userId,
  })
    .populate("teamA")
    .populate("teamB")
    .populate("tossWinner");
};

export const getMatchById = async (
  matchId: string
) => {
  return await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB")
    .populate("tossWinner");
};

export const updateMatch = async (
  matchId: string,
  payload: any
) => {
  return await Match.findByIdAndUpdate(
    matchId,
    payload,
    {
      new: true,
    }
  );
};

export const deleteMatch = async (
  matchId: string
) => {
  return await Match.findByIdAndDelete(
    matchId
  );
};

export const startMatch = async (
  matchId: string
) => {
  return await Match.findByIdAndUpdate(
    matchId,
    {
      status: "live",
      startTime: new Date(),
    },
    {
      new: true,
    }
  );
};

export const completeMatch = async (
  matchId: string
) => {
  return await Match.findByIdAndUpdate(
    matchId,
    {
      status: "completed",
      endTime: new Date(),
    },
    {
      new: true,
    }
  );
};