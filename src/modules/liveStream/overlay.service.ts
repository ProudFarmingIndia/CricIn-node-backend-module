/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| overlay.service.ts
|
| Description:
| The broadcast overlay - the score strip under the video, and the player
| card that slides in when a new batter walks out or a wicket falls.
|
| The whole file exists because of one problem: the video is 12-20
| seconds behind real life. The scorecard is not. Rendered against "now",
| the overlay announces a wicket while the viewer is still watching the
| bowler run in - the score spoils its own broadcast, every single time.
|
| So nothing here reads current state. Everything is reconstructed as of
| a timestamp the player supplies (EXT-X-PROGRAM-DATE-TIME, the wall
| clock Mux stamps into the HLS manifest), from the Scoring rows already
| being written ball by ball. No new collection, no second source of
| truth for the score - just the same balls, read with a cutoff.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import Scoring from "../scoring/scoring.model";
import Innings from "../scoring/innings.model";
import Player from "../players/player.model";

import { buildCommentary } from "./commentary";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

/*
| How long a card stays on screen, and therefore how far back to look for
| an event worth showing one for. Six seconds is about two deliveries -
| long enough to read, short enough that it is gone before the next ball.
*/

const CARD_WINDOW_MS = 6000;

type AnyBall = Record<string, any>;

/*
|--------------------------------------------------------------------------
| Batting Figures
|--------------------------------------------------------------------------
|
| Byes, leg byes and wides belong to the team, not the batter. batsmanRuns
| already encodes that; the fallback applies the same rule to rows written
| before that field existed. Kept identical to match.service's version on
| purpose - two different answers for "how many has he got" is exactly the
| argument the overlay is supposed to settle.
|
*/

const battingFigures = (balls: AnyBall[], playerId: any) => {
  if (!playerId) return { runs: 0, balls: 0, fours: 0, sixes: 0 };

  const id = String(playerId);

  const faced = balls.filter((b) => String(b.batsmanId) === id);

  const runs = faced.reduce(
    (sum, b) =>
      sum +
      (b.batsmanRuns ??
        (b.extraType === "bye" ||
        b.extraType === "legBye" ||
        b.extraType === "wide"
          ? 0
          : b.runs || 0)),
    0,
  );

  return {
    runs,

    // A wide is not a ball faced.
    balls: faced.filter((b) => b.extraType !== "wide").length,

    fours: faced.filter((b) => (b.batsmanRuns ?? b.runs) === 4).length,

    sixes: faced.filter((b) => (b.batsmanRuns ?? b.runs) === 6).length,
  };
};

const bowlingFigures = (balls: AnyBall[], playerId: any) => {
  if (!playerId) {
    return { overs: "0.0", runs: 0, wickets: 0, maidens: 0 };
  }

  const id = String(playerId);

  const bowled = balls.filter((b) => String(b.bowlerId) === id);

  const legal = bowled.filter((b) => b.isLegalDelivery !== false).length;

  return {
    overs: `${Math.floor(legal / 6)}.${legal % 6}`,

    runs: bowled.reduce((sum, b) => sum + (b.teamRuns ?? b.runs ?? 0), 0),

    // A run-out is not the bowler's wicket.
    wickets: bowled.filter((b) => b.isWicket && b.bowlerCredit !== false)
      .length,

    maidens: 0,
  };
};

const ballText = (b: AnyBall): string => {
  if (b.isWicket) return "W";
  if (b.extraType === "wide") return "Wd";
  if (b.extraType === "noBall" || b.extraType === "noball") return "Nb";
  return String(b.teamRuns ?? b.runs ?? 0);
};

/*
|--------------------------------------------------------------------------
| Career Card
|--------------------------------------------------------------------------
|
| Read straight off Player.stats, which is already maintained after each
| match. Deliberately not recomputed from ball history here - the overlay
| refreshes every second or two during a live match and cannot be doing
| aggregate work per request.
|
| A missing player is not an error: the card still renders with this
| innings' numbers and no career line, which is the right outcome for a
| local player who has no profile yet.
|
*/

const careerFor = async (playerId: any) => {
  if (!playerId) return null;

  try {
    const p: any = await Player.findById(playerId)
      .select("playerName stats profileImage jerseyNumber")
      .lean();

    if (!p) return null;

    const s = p.stats || {};

    return {
      name: p.playerName,
      image: p.profileImage?.url || null,
      jersey: p.jerseyNumber ?? null,
      matches: s.totalMatches ?? 0,
      runs: s.runs ?? 0,
      average: s.average ?? 0,
      strikeRate: s.strikeRate ?? 0,
      highestScore: s.highestScore ?? 0,
      fours: s.fours ?? 0,
      sixes: s.sixes ?? 0,
      wickets: s.wickets ?? 0,
      economy: s.economy ?? 0,
      bestBowling: s.bestBowling || "",
    };
  } catch {
    return null;
  }
};

/*
|--------------------------------------------------------------------------
| Which Card, If Any
|--------------------------------------------------------------------------
|
| Only events inside the card window produce one, and only the most
| recent - so a wicket and the new batter that follows it do not both try
| to occupy the screen.
|
| Priority is deliberate: a wicket is the moment, a new batter is the
| consequence. Showing the incoming player's card over the dismissal
| reads as though the app missed what just happened.
|
*/

const buildCard = async (
  balls: AnyBall[],
  at: Date,
): Promise<any | null> => {
  const windowStart = at.getTime() - CARD_WINDOW_MS;

  const recent = balls.filter(
    (b) => new Date(b.createdAt).getTime() >= windowStart,
  );

  if (!recent.length) return null;

  /*
  | 1. Wicket - highest priority.
  */

  const wicketBall = [...recent].reverse().find((b) => b.isWicket);

  if (wicketBall) {
    const outId = wicketBall.dismissedPlayerId || wicketBall.batsmanId;

    const upToWicket = balls.filter(
      (b) =>
        new Date(b.createdAt).getTime() <=
        new Date(wicketBall.createdAt).getTime(),
    );

    return {
      type: "wicket",
      role: "batsman",
      dismissal: wicketBall.wicketType || null,
      thisMatch: battingFigures(upToWicket, outId),
      career: await careerFor(outId),
      showForMs: CARD_WINDOW_MS,
    };
  }

  const last = balls[balls.length - 1];

  if (!last) return null;

  /*
  | 2. New batter - the striker changed and has faced almost nothing.
  |    The ball-count check is what separates "someone walked out" from
  |    ordinary strike rotation, which changes the striker constantly.
  */

  const strikerFigures = battingFigures(balls, last.batsmanId);

  const previousStriker = balls
    .slice(0, -1)
    .reverse()
    .find((b) => String(b.batsmanId) !== String(last.batsmanId));

  if (previousStriker && strikerFigures.balls <= 1) {
    return {
      type: "new_batsman",
      role: "batsman",
      thisMatch: strikerFigures,
      career: await careerFor(last.batsmanId),
      showForMs: CARD_WINDOW_MS,
    };
  }

  /*
  | 3. New bowler - first ball of a fresh spell.
  */

  const prevBall = balls[balls.length - 2];

  if (prevBall && String(prevBall.bowlerId) !== String(last.bowlerId)) {
    return {
      type: "new_bowler",
      role: "bowler",
      thisMatch: bowlingFigures(balls, last.bowlerId),
      career: await careerFor(last.bowlerId),
      showForMs: CARD_WINDOW_MS,
    };
  }

  return null;
};

/*
|--------------------------------------------------------------------------
| Match State At A Moment
|--------------------------------------------------------------------------
|
| `at` omitted means "now", which is what a scorecard screen with no video
| next to it wants. The video player always passes one.
|
*/

export const getStateAt = async (matchId: string, atInput?: string) => {
  if (!mongoose.isValidObjectId(matchId)) {
    throw new AppError("Invalid match id.", HTTP_STATUS.BAD_REQUEST);
  }

  const at = atInput ? new Date(atInput) : new Date();

  if (Number.isNaN(at.getTime())) {
    throw new AppError(
      "`at` must be a valid ISO timestamp.",
      HTTP_STATUS.BAD_REQUEST,
    );
  }

  /*
  | The innings that was in progress at `at`, not simply the open one -
  | during a chase the video may still be showing the first innings.
  */

  const innings: any = await Innings.findOne({
    matchId,
    createdAt: { $lte: at },
  })
    .sort({ inningsNumber: -1 })
    .lean();

  if (!innings) {
    return { at, hasData: false, score: null, card: null };
  }

  const balls: AnyBall[] = await Scoring.find({
    inningsId: innings._id,
    createdAt: { $lte: at },
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!balls.length) {
    return {
      at,
      hasData: true,
      inningsNumber: innings.inningsNumber,
      score: { runs: 0, wickets: 0, overs: "0.0" },
      striker: null,
      nonStriker: null,
      bowler: null,
      lastSix: [],
      card: null,
    };
  }

  const last = balls[balls.length - 1];

  const totalRuns = balls.reduce(
    (sum, b) => sum + (b.teamRuns ?? b.runs ?? 0),
    0,
  );

  const wickets = balls.filter((b) => b.isWicket).length;

  const legal = balls.filter((b) => b.isLegalDelivery !== false).length;

  /*
  | The non-striker is whoever was at the other end on the last ball. Taken
  | from the snapshot the scorer already writes rather than re-deriving
  | strike rotation, which is the kind of thing that is right until a
  | leg-bye off the last ball of an over.
  */

  const nonStrikerId =
    String(last.nonStrikerIdBefore) === String(last.batsmanId)
      ? last.strikerIdBefore
      : last.nonStrikerIdBefore;

  const [strikerName, nonStrikerName, bowlerName] = await Promise.all([
    Player.findById(last.batsmanId).select("playerName").lean(),
    Player.findById(nonStrikerId).select("playerName").lean(),
    Player.findById(last.bowlerId).select("playerName").lean(),
  ]);

  return {
    at,

    hasData: true,

    inningsNumber: innings.inningsNumber,

    score: {
      runs: totalRuns,
      wickets,
      overs: `${Math.floor(legal / 6)}.${legal % 6}`,
    },

    striker: {
      playerId: last.batsmanId,
      name: (strikerName as any)?.playerName || "",
      ...battingFigures(balls, last.batsmanId),
    },

    nonStriker: nonStrikerId
      ? {
          playerId: nonStrikerId,
          name: (nonStrikerName as any)?.playerName || "",
          ...battingFigures(balls, nonStrikerId),
        }
      : null,

    bowler: {
      playerId: last.bowlerId,
      name: (bowlerName as any)?.playerName || "",
      ...bowlingFigures(balls, last.bowlerId),
    },

    lastSix: balls.slice(-6).map(ballText),

    /*
    | Commentary for the last few deliveries. Uses the scorer's own
    | commentaryText when there is one - they can correct a line and it
    | stays corrected - and generates it from the ball otherwise, which is
    | what every ball recorded before this feature existed will hit.
    */

    commentary: await buildCommentaryFeed(balls.slice(-5)),

    card: await buildCard(balls, at),
  };
};

/*
|--------------------------------------------------------------------------
| Commentary Feed
|--------------------------------------------------------------------------
|
| One batched name lookup for every player mentioned across the whole
| window, rather than a populate per ball - this runs on the same
| once-a-second path as the score strip.
|
*/

const buildCommentaryFeed = async (balls: AnyBall[]) => {
  if (!balls.length) return [];

  const ids = new Set<string>();

  for (const b of balls) {
    for (const id of [
      b.batsmanId,
      b.bowlerId,
      b.fielderId,
      b.dismissedPlayerId,
    ]) {
      if (id) ids.add(String(id));
    }
  }

  const players: any[] = await Player.find({
    _id: { $in: Array.from(ids) },
  })
    .select("playerName")
    .lean();

  const nameOf = (id: any): string | undefined => {
    if (!id) return undefined;

    return players.find((p) => String(p._id) === String(id))?.playerName;
  };

  return balls
    .map((b) => ({
      ts: b.createdAt,

      over: `${b.over ?? 0}.${b.ball ?? 0}`,

      text:
        b.commentaryText && String(b.commentaryText).trim()
          ? b.commentaryText
          : buildCommentary(b, {
              batsman: nameOf(b.batsmanId),
              bowler: nameOf(b.bowlerId),
              fielder: nameOf(b.fielderId),
              dismissed: nameOf(b.dismissedPlayerId),
            }),

      isWicket: !!b.isWicket,

      runs: b.batsmanRuns ?? b.runs ?? 0,
    }))
    .reverse();
};
