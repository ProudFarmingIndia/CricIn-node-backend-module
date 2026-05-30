import Scoring from "./scoring.model";
import Innings from "./innings.model";

export const addBall = async (
  payload: any
) => {

  const ball = await Scoring.create(
    payload
  );

  await Innings.findByIdAndUpdate(
    payload.inningsId,
    {
      $inc: {
        totalRuns: payload.runs,
        balls: 1,
      },
    }
  );

  return ball;
};

export const getScorecard = async (
  inningsId: string
) => {

  const innings =
    await Innings.findById(inningsId);

  const balls =
    await Scoring.find({
      inningsId,
    });

  return {
    innings,
    balls,
  };
};