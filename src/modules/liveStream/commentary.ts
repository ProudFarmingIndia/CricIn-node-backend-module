/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| commentary.ts
|
| Description:
| Turns one scored delivery into the line a commentator would say.
|
| The Scoring schema has always had a `commentaryText` field and the app
| has always collected `shotType` and `wagonWheel.region` on every ball -
| so the raw material for real commentary was already being written down
| and then never read.
|
| Pure function, no database, no side effects. That matters for two
| reasons: it can be called from addBall to store the line permanently
| (so a scorer can correct it later), and it can be called at read time
| for the millions of balls already recorded before this existed. The
| overlay uses the stored text when there is one and falls back to
| generating it, so old matches get commentary too without a migration.
|
|--------------------------------------------------------------------------
*/

type CommentaryBall = {
  over?: number;
  ball?: number;
  runs?: number;
  batsmanRuns?: number;
  teamRuns?: number;
  extraType?: string | null;
  isWicket?: boolean;
  wicketType?: string | null;
  isLegalDelivery?: boolean;
  shotType?: string;
  penaltyReason?: string;
  wagonWheel?: { region?: string };
};

type CommentaryNames = {
  batsman?: string;
  bowler?: string;
  fielder?: string;
  dismissed?: string;
};

/*
| "caught" reads as "c Rahul" on a scorecard but as "taken by Rahul" out
| loud. These are the spoken forms.
*/

const dismissalPhrase = (
  type: string | null | undefined,
  fielder?: string,
): string => {
  switch ((type || "").toLowerCase()) {
    case "bowled":
      return "bowled, straight through the gate";

    case "caught":
      return fielder ? `caught by ${fielder}` : "caught";

    case "lbw":
      return "trapped in front, LBW";

    case "runout":
      return fielder ? `run out by ${fielder}` : "run out";

    case "stumped":
      return fielder ? `stumped by ${fielder}` : "stumped";

    case "hitwicket":
      return "hit wicket";

    default:
      return "out";
  }
};

const runPhrase = (runs: number, shot?: string, region?: string): string => {
  const where = region ? ` through ${region.toLowerCase()}` : "";

  const how = shot ? `${shot.toLowerCase()}` : "";

  if (runs === 6) {
    return how
      ? `SIX! ${how}, all the way${where}`
      : `SIX! that's gone all the way${where}`;
  }

  if (runs === 4) {
    return how ? `FOUR! ${how}${where}` : `FOUR!${where || " to the fence"}`;
  }

  if (runs === 0) {
    return how ? `no run, ${how}` : "no run";
  }

  if (runs === 1) return how ? `1 run, ${how}` : "1 run";

  return how ? `${runs} runs, ${how}` : `${runs} runs`;
};

export const buildCommentary = (
  ball: CommentaryBall,
  names: CommentaryNames = {},
): string => {
  const over = `${ball.over ?? 0}.${ball.ball ?? 0}`;

  const bowler = names.bowler || "The bowler";

  const batsman = names.batsman || "the batter";

  const head = `${over} ${bowler} to ${batsman},`;

  /*
  | Wicket first - it is the only thing anyone remembers about the ball.
  */

  if (ball.isWicket) {
    const who = names.dismissed || batsman;

    return `${head} OUT! ${who} ${dismissalPhrase(
      ball.wicketType,
      names.fielder,
    )}`;
  }

  const extra = (ball.extraType || "").toLowerCase();

  if (extra === "wide") {
    return `${head} wide down the side`;
  }

  if (extra === "noball" || extra === "no_ball") {
    const off = ball.batsmanRuns ?? 0;

    return off > 0
      ? `${head} NO BALL, and ${off} off it`
      : `${head} NO BALL`;
  }

  if (extra === "bye") {
    return `${head} ${ball.runs ?? 0} bye${
      (ball.runs ?? 0) === 1 ? "" : "s"
    }`;
  }

  if (extra === "legbye" || extra === "leg_bye") {
    return `${head} ${ball.runs ?? 0} leg bye${
      (ball.runs ?? 0) === 1 ? "" : "s"
    }`;
  }

  if (ball.penaltyReason) {
    return `${head} 5 penalty runs - ${ball.penaltyReason}`;
  }

  const runs = ball.batsmanRuns ?? ball.runs ?? 0;

  return `${head} ${runPhrase(
    runs,
    ball.shotType,
    ball.wagonWheel?.region,
  )}`;
};

export default buildCommentary;
