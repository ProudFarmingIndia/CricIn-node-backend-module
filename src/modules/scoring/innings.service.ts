import Innings from "./innings.model";

export const createInnings = async (
  payload: any
) => {
  return await Innings.create(payload);
};

export const getInningsById = async (
  inningsId: string
) => {
  return await Innings.findById(inningsId)
    .populate("matchId")
    .populate("battingTeam")
    .populate("bowlingTeam");
};

export const endInnings = async (
  inningsId: string
) => {
  return await Innings.findByIdAndUpdate(
    inningsId,
    {
      isCompleted: true,
      completedAt: new Date(),
    },
    {
      new: true,
    }
  );
};