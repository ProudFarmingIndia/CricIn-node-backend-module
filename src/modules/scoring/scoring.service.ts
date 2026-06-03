import { getIO } from "../../socket/socket";
import Scoring from "./scoring.model";
import Innings from "./innings.model";

export const addBall = async (payload: any) => {
  const ball = await Scoring.create(payload);

  getIO().emit("score:update", ball);

  const updateData: any = {
    totalRuns: payload.runs,
    balls: 1,
  };

  if (payload.isWicket) {
    updateData.wickets = 1;
  }

  await Innings.findByIdAndUpdate(payload.inningsId, {
    $inc: updateData,
  });

  return ball;
};

export const getScorecard = async (inningsId: string) => {
  const innings = await Innings.findById(inningsId);

  const balls = await Scoring.find({
    inningsId,
  });

  return {
    innings,
    balls,
  };
};
