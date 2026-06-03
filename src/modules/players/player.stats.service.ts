import Scoring from "../scoring/scoring.model";

export const getPlayerStats = async (
  playerId: string
) => {

  const battingBalls =
    await Scoring.find({
      batsmanId: playerId,
    });

  const bowlingBalls =
    await Scoring.find({
      bowlerId: playerId,
    });

  const runs =
    battingBalls.reduce(
      (sum, ball) => sum + ball.runs,
      0
    );

  const ballsFaced =
    battingBalls.length;

  const fours =
    battingBalls.filter(
      ball => ball.runs === 4
    ).length;

  const sixes =
    battingBalls.filter(
      ball => ball.runs === 6
    ).length;

  const wickets =
    bowlingBalls.filter(
      ball => ball.isWicket
    ).length;

  const runsConceded =
    bowlingBalls.reduce(
      (sum, ball) => sum + ball.runs,
      0
    );

  const ballsBowled =
    bowlingBalls.length;

  return {
    runs,
    ballsFaced,
    fours,
    sixes,

    strikeRate:
      ballsFaced > 0
        ? (
            (runs / ballsFaced) *
            100
          ).toFixed(2)
        : "0",

    wickets,

    runsConceded,

    ballsBowled,

    economy:
      ballsBowled > 0
        ? (
            runsConceded /
            (ballsBowled / 6)
          ).toFixed(2)
        : "0",
  };
};