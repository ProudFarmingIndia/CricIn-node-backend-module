/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| videoHighlights.service.ts
|
| Description:
| Turns the ball-by-ball data into "watch this moment" markers into the
| match recording.
|
| PHASE 1 NOTE
| No recording is kept (see config/mux - KEEP_RECORDINGS), so this comes
| back with `hasVideo: false`, `videoUrl: null` and every moment's
| startSeconds/endSeconds null. The moments themselves are still real -
| kind, over, commentary, batsman, bowler - which is exactly the state of
| every match scored without a camera, and what the moments feed renders.
| Flip KEEP_RECORDINGS on later and the same endpoint starts returning
| offsets with no change here.
|
| NOT the same thing as modules/highlights, and deliberately separate.
| That module answers "who had a great game" across many matches - a
| hundred, a five-for, ranked into a feed. This one answers "show me that
| six" inside ONE recording, and only exists once there is video.
|
| WHY THESE ARE TIMESTAMPS AND NOT CLIPS
| A clip is a new Mux asset: it is encoded, it is stored, and it is billed
| every month for as long as it exists. A timestamp is a number. For
| everything that happens inside the app - tap a four, jump to it - the
| number is enough, and the whole feature costs nothing.
|
| Real clips are worth cutting for exactly one thing: a file the player can
| post outside CricIn. That is a deliberate, paid-for action, not something
| to generate speculatively for every boundary of every match.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import Scoring from "../scoring/scoring.model";
import Player from "../players/player.model";
import LiveStream from "./liveStream.model";

import { buildCommentary } from "./commentary";

import AppError from "../../shared/errors/AppError";
import { HTTP_STATUS } from "../../shared/constants/httpStatus";

/*
|--------------------------------------------------------------------------
| Clip Shape
|--------------------------------------------------------------------------
|
| PRE_ROLL is the run-up. Starting the clip on the delivery itself gives a
| ball already halfway down the pitch, which reads as a mistake rather than
| a highlight.
|
| SCORER_LAG is the gap between the thing happening and the scorer's thumb
| landing on the button - they watch the shot, then tap. Without subtracting
| it every clip starts a beat late, and on a wicket that beat is the
| dismissal itself.
|
*/

const PRE_ROLL_SECONDS = 8;

const POST_ROLL_SECONDS = 7;

const SCORER_LAG_SECONDS = 3;

type Moment = {
  kind: "four" | "six" | "wicket" | "fifty" | "hundred";
  weight: number;
};

const classify = (ball: any): Moment | null => {
  if (ball.isWicket) return { kind: "wicket", weight: 100 };

  const runs = ball.batsmanRuns ?? ball.runs ?? 0;

  if (runs === 6) return { kind: "six", weight: 60 };

  if (runs === 4) return { kind: "four", weight: 40 };

  return null;
};

/*
|--------------------------------------------------------------------------
| Match Video Highlights
|--------------------------------------------------------------------------
|
| `playerId` narrows it to one player's own moments - the personal reel.
|
*/

export const getVideoHighlights = async (
  matchId: string,
  playerId?: string,
) => {
  if (!mongoose.isValidObjectId(matchId)) {
    throw new AppError("Invalid match id.", HTTP_STATUS.BAD_REQUEST);
  }

  const streams = await LiveStream.find({ matchId }).lean();

  /*
  | The front camera is the broadcast angle, so clips are cut against it.
  | Falling back to whatever exists keeps single-camera matches working.
  */

  const source =
    streams.find((s) => s.angle === "front" && s.recordingPlaybackId) ||
    streams.find((s) => s.recordingPlaybackId);

  const balls: any[] = await Scoring.find({ matchId })
    .sort({ createdAt: 1 })
    .lean();

  if (!balls.length) {
    return {
      matchId,
      hasVideo: false,
      recordingExpiresAt: null,
      count: 0,
      moments: [],
    };
  }

  const ids = new Set<string>();

  for (const b of balls) {
    for (const id of [b.batsmanId, b.bowlerId, b.fielderId, b.dismissedPlayerId]) {
      if (id) ids.add(String(id));
    }
  }

  const players: any[] = await Player.find({ _id: { $in: [...ids] } })
    .select("playerName")
    .lean();

  const nameOf = (id: any) =>
    id
      ? players.find((p) => String(p._id) === String(id))?.playerName
      : undefined;

  const streamStart = source?.startedAt
    ? new Date(source.startedAt).getTime()
    : null;

  const moments = balls
    .map((b) => {
      const moment = classify(b);

      if (!moment) return null;

      if (
        playerId &&
        String(b.batsmanId) !== String(playerId) &&
        String(b.bowlerId) !== String(playerId) &&
        String(b.dismissedPlayerId) !== String(playerId)
      ) {
        return null;
      }

      /*
      | Offset into the recording. Null when there is no video - the moment
      | is still a real highlight, it just cannot be watched, which is
      | exactly the state of every match scored without a camera.
      */

      let startSeconds: number | null = null;
      let endSeconds: number | null = null;

      if (streamStart) {
        const ballAt = new Date(b.createdAt).getTime();

        const offset =
          (ballAt - streamStart) / 1000 - SCORER_LAG_SECONDS;

        startSeconds = Math.max(0, Math.round(offset - PRE_ROLL_SECONDS));

        endSeconds = Math.round(
          offset + POST_ROLL_SECONDS,
        );
      }

      return {
        kind: moment.kind,
        weight: moment.weight,
        over: `${b.over ?? 0}.${b.ball ?? 0}`,
        ts: b.createdAt,

        text:
          b.commentaryText && String(b.commentaryText).trim()
            ? b.commentaryText
            : buildCommentary(b, {
                batsman: nameOf(b.batsmanId),
                bowler: nameOf(b.bowlerId),
                fielder: nameOf(b.fielderId),
                dismissed: nameOf(b.dismissedPlayerId),
              }),

        batsman: { id: b.batsmanId, name: nameOf(b.batsmanId) ?? null },
        bowler: { id: b.bowlerId, name: nameOf(b.bowlerId) ?? null },

        startSeconds,
        endSeconds,
      };
    })
    .filter(Boolean) as any[];

  return {
    matchId,

    hasVideo: !!source?.recordingPlaybackId,

    /*
    | Surfaced so the app can say "watch or download before Sunday" rather
    | than the recording simply vanishing one day.
    */

    recordingExpiresAt: (source as any)?.recordingExpiresAt ?? null,

    videoUrl: source?.recordingPlaybackId
      ? `https://stream.mux.com/${source.recordingPlaybackId}.m3u8`
      : null,

    count: moments.length,

    moments: moments.sort((a, b) => b.weight - a.weight || 0),
  };
};