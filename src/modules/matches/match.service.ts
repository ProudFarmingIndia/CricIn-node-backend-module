import Match from "./match.model";
import Innings from "../scoring/innings.model";
import Scoring from "../scoring/scoring.model";

export const createMatch = async (userId: string, payload: any) => {
  return await Match.create({
    ...payload,
    userId,
  });
};

export const getMatches = async (userId: string) => {
  return await Match.find({
    userId,
  })
    .populate("teamA")
    .populate("teamB")
    .populate("tossWinner");
};

export const getMatchById = async (matchId: string) => {
  return await Match.findById(matchId)
    .populate("teamA")
    .populate("teamB")
    .populate("tossWinner");
};

export const updateMatch = async (matchId: string, payload: any) => {
  return await Match.findByIdAndUpdate(matchId, payload, {
    new: true,
  });
};

export const deleteMatch = async (matchId: string) => {
  return await Match.findByIdAndDelete(matchId);
};

export const startMatch = async (matchId: string) => {
  return await Match.findByIdAndUpdate(
    matchId,
    {
      status: "live",
      startTime: new Date(),
    },
    {
      new: true,
    },
  );
};

export const completeMatch = async (matchId: string) => {
  return await Match.findByIdAndUpdate(
    matchId,
    {
      status: "completed",
      endTime: new Date(),
    },
    {
      new: true,
    },
  );
};

export const updateMatchResult = async (
  matchId: string,
  winnerTeam: string,
  result: string,
) => {
  return await Match.findByIdAndUpdate(
    matchId,
    {
      winnerTeam,
      result,
      status: "completed",
      endTime: new Date(),
    },
    {
      new: true,
    },
  );
};

export const getMatchSummary = async (matchId: string) => {
  const innings = await Innings.find({
    matchId,
  });

  return innings.map((i) => ({
    inningsNumber: i.inningsNumber,
    runs: i.totalRuns,
    wickets: i.wickets,
    overs: `${Math.floor(i.balls / 6)}.${i.balls % 6}`,
  }));
};

export const getLiveMatch = async (matchId: string) => {
  const innings = await Innings.findOne({
    matchId,
    isCompleted: false,
  });

  if (!innings) {
    throw new Error("No active innings found");
  }

  return {
    runs: innings.totalRuns,
    wickets: innings.wickets,

    overs: `${Math.floor(innings.balls / 6)}.${innings.balls % 6}`,

    runRate:
      innings.balls > 0
        ? (innings.totalRuns / (innings.balls / 6)).toFixed(2)
        : "0",
  };
};

export const getBowlingScorecard = async (matchId: string) => {
  const balls = await Scoring.find({
    matchId,
  }).populate("bowlerId");

  const scorecard: any = {};

  balls.forEach((ball) => {
    if (!ball.bowlerId) return;

    const id = ball.bowlerId._id.toString();

    if (!scorecard[id]) {
      scorecard[id] = {
        player: ball.bowlerId,
        wickets: 0,
        runsConceded: 0,
        balls: 0,
      };
    }

    scorecard[id].balls++;

    scorecard[id].runsConceded += ball.runs;

    if (ball.isWicket) scorecard[id].wickets++;
  });

  return Object.values(scorecard);
};

export const getFallOfWickets = async (matchId: string) => {
  const wickets = await Scoring.find({
    matchId,
    isWicket: true,
  })
    .populate("dismissedPlayerId", "playerName")
    .sort({
      createdAt: 1,
    });

  return wickets.map((wicket, index) => ({
    wicketNumber: index + 1,

    player: wicket.dismissedPlayerId,

    over: wicket.over,

    ball: wicket.ball,

    wicketType: wicket.wicketType,
  }));
};

export const getBattingScorecard = async (matchId: string) => {
  const balls = await Scoring.find({
    matchId,
  }).populate("batsmanId", "playerName");

  const scorecard: any = {};

  balls.forEach((ball: any) => {
    if (!ball.batsmanId) return;

    const playerId = ball.batsmanId._id.toString();

    if (!scorecard[playerId]) {
      scorecard[playerId] = {
        playerId,
        playerName: ball.batsmanId.playerName,

        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
      };
    }

    scorecard[playerId].runs += ball.runs;

    scorecard[playerId].balls += 1;

    if (ball.runs === 4) {
      scorecard[playerId].fours += 1;
    }

    if (ball.runs === 6) {
      scorecard[playerId].sixes += 1;
    }
  });

  return Object.values(scorecard).map((player: any) => ({
    ...player,

    strikeRate:
      player.balls > 0
        ? ((player.runs / player.balls) * 100).toFixed(2)
        : "0.00",
  }));
};

export const getFullScorecard = async (matchId: string) => {
  const summary = await getMatchSummary(matchId);

  const batting = await getBattingScorecard(matchId);

  const bowling = await getBowlingScorecard(matchId);

  const fow = await getFallOfWickets(matchId);

  return {
    summary,
    batting,
    bowling,
    fow,
  };
};
