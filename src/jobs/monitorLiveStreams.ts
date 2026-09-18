/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Jobs
|
| File:
| monitorLiveStreams.ts
|
| Description:
| Ends streams that nobody is going to end themselves.
|
| The scorer marking a match complete is the tidy path and it is not the
| common one. What actually happens is the last ball is scored, the phones
| go in pockets, and the app is closed - the match is never marked
| complete and the stream runs until Mux's own twelve-hour ceiling,
| recording the inside of a bag and billing every minute of it.
|
| The opposite mistake is worse though, so this job is deliberately
| reluctant. It never ends a stream while balls are still being scored, it
| warns before it acts, and a scorer who says "still going" is believed.
| Rain stops play for half an hour all the time; a feature that kills the
| stream during a shower is one nobody trusts with a real match again.
|
|--------------------------------------------------------------------------
*/

import mux, {
  MATCH_COMPLETE_GRACE_MINUTES,
  IDLE_WARN_MINUTES,
  IDLE_END_MINUTES,
  HARD_CAP_HOURS,
} from "../config/mux";

import LiveStream from "../modules/liveStream/liveStream.model";
import Match from "../modules/matches/match.model";
import Scoring from "../modules/scoring/scoring.model";

import { emitToMatch } from "../socket/socket";

const MINUTE = 60 * 1000;

const endStream = async (stream: any, reason: string) => {
  try {
    /*
    | complete() rather than disable(): it closes the recording cleanly and
    | tells every player the stream is over, but leaves the live stream
    | itself usable - a second innings after a long break can start again
    | on the same key.
    */

    await mux.video.liveStreams.complete(stream.muxLiveStreamId);
  } catch (error: any) {
    if (error?.status !== 404) {
      console.error(
        "[monitor] could not complete stream",
        stream.muxLiveStreamId,
        error.message,
      );

      return;
    }
  }

  stream.status = "completed";
  stream.endedAt = new Date();
  stream.endedReason = reason;

  await stream.save();

  emitToMatch(String(stream.matchId), "stream:status", {
    angle: stream.angle,
    status: "ended",
    reason,
  });

  console.log(
    `[monitor] ended ${stream.angle} on match ${stream.matchId} (${reason})`,
  );
};

/*
|--------------------------------------------------------------------------
| Reconcile Status From Mux
|--------------------------------------------------------------------------
|
| The webhook is the FAST path for "a broadcaster connected". This is the
| safety net underneath it, and it is not optional polish - without it the
| entire feature is invisible in three real situations:
|
|   NO PUBLIC URL YET. On a laptop, Mux cannot reach the backend at all,
|   so no webhook ever arrives. The stream row stays "idle" forever: no
|   LIVE badge, no playback token (the app only asks for one on a live
|   angle), nothing in the Live Streaming feed, and the scorer's panel
|   reads "accepted, not connected yet" while the camera is plainly
|   broadcasting. Everything looks broken and nothing is.
|
|   THE WEBHOOK WAS MISSED. A deploy, a restart, a dropped delivery.
|
|   THE SECRET IS WRONG. Signature check fails, we return 401, and Mux
|   gives up after its retries.
|
| So this asks Mux directly what each stream is doing and writes the
| answer down. Sixty to ninety seconds behind the webhook, which is
| invisible on a three-hour match and is the difference between "the
| feature works" and "the feature does nothing" while testing.
|
| Only streams that have a broadcaster assigned and accepted are checked -
| there is no point asking Mux about a stream nobody has been given yet,
| and it keeps the number of API calls proportional to matches actually
| being filmed.
|
*/

const MUX_STATUS_MAP: Record<string, string> = {
  active: "active",
  idle: "idle",
  disabled: "disabled",
};

const reconcileFromMux = async () => {
  const candidates = await LiveStream.find({
    status: { $in: ["idle", "disconnected", "active"] },
    assignmentStatus: "accepted",
  }).limit(40);

  for (const stream of candidates as any[]) {
    if (!stream.muxLiveStreamId) continue;

    try {
      const remote = await mux.video.liveStreams.retrieve(
        String(stream.muxLiveStreamId),
      );

      const mapped = MUX_STATUS_MAP[String(remote?.status || "")];

      if (!mapped || mapped === stream.status) continue;

      const wasLive = stream.status === "active";

      stream.status = mapped;

      if (mapped === "active" && !wasLive) {
        stream.startedAt = stream.startedAt || new Date();
        stream.endedAt = null;
      }

      if (mapped !== "active" && wasLive) {
        stream.endedAt = new Date();
      }

      await stream.save();

      /*
      | Same event the webhook emits, so the app cannot tell which path
      | told it - and a viewer sitting on the match sees the badge flip
      | without pulling to refresh.
      */

      emitToMatch(String(stream.matchId), "stream:status", {
        angle: stream.angle,
        status:
          mapped === "active"
            ? "active"
            : mapped === "disabled"
              ? "ended"
              : "ended",
      });

      console.log(
        `[streams] ${stream.angle} reconciled from Mux -> ${mapped}`,
      );
    } catch (error: any) {
      /*
      | 404 means the stream was deleted at Mux but the row survived -
      | left alone rather than guessed at, because deleteStream is the
      | only thing that should be removing rows.
      */

      if (error?.status !== 404) {
        console.error(
          "[streams] could not reconcile",
          stream.muxLiveStreamId,
          error.message,
        );
      }
    }
  }
};

const monitorLiveStreams = async (): Promise<void> => {
  try {
    /*
    | Reconcile FIRST, then apply the lifecycle rules below - otherwise a
    | stream that only just became active according to Mux would be judged
    | on a status this run already knows is stale.
    */

    await reconcileFromMux();

    const live = await LiveStream.find({
      status: { $in: ["active", "disconnected"] },
    });

    if (!live.length) return;

    const now = Date.now();

    for (const stream of live as any[]) {
      /*
      | The scorer has explicitly said to keep it running. Nothing below
      | overrides that until the window they asked for has passed.
      */

      if (
        stream.keepAliveUntil &&
        new Date(stream.keepAliveUntil).getTime() > now
      ) {
        continue;
      }

      const startedAt = stream.startedAt
        ? new Date(stream.startedAt).getTime()
        : now;

      /*
      | 1. Hard cap. The backstop for a match that was never marked
      |    complete and never scored again - nothing else would ever catch
      |    it.
      */

      if (now - startedAt > HARD_CAP_HOURS * 60 * MINUTE) {
        await endStream(stream, "hard_cap");
        continue;
      }

      const match: any = await Match.findById(stream.matchId)
        .select("status endTime updatedAt")
        .lean();

      if (!match) continue;

      /*
      | 2. Match complete. The grace period is the presentation, the
      |    handshakes and the man of the match - cutting at the last ball
      |    removes the part families stay for.
      */

      if (["completed", "cancelled"].includes(match.status)) {
        const finishedAt = new Date(
          match.endTime || match.updatedAt,
        ).getTime();

        if (now - finishedAt > MATCH_COMPLETE_GRACE_MINUTES * MINUTE) {
          await endStream(stream, "match_complete");
        } else if (!stream.autoEndWarnedAt) {
          stream.autoEndWarnedAt = new Date();
          await stream.save();

          emitToMatch(String(stream.matchId), "stream:ending", {
            angle: stream.angle,
            reason: "match_complete",
            endsAt: new Date(
              finishedAt + MATCH_COMPLETE_GRACE_MINUTES * MINUTE,
            ),
          });
        }

        continue;
      }

      /*
      | 3. Idle. Measured from the last ball, not from the start - a long
      |    innings is not idle, and a rain break is.
      */

      const lastBall: any = await Scoring.findOne({
        matchId: stream.matchId,
      })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean();

      const lastActivity = lastBall
        ? new Date(lastBall.createdAt).getTime()
        : startedAt;

      const idleMinutes = (now - lastActivity) / MINUTE;

      if (idleMinutes > IDLE_END_MINUTES) {
        await endStream(stream, "idle");
        continue;
      }

      /*
      | The warning is the whole reason this is safe during rain: whoever
      | is at the ground gets asked, and answering resets the clock.
      */

      if (idleMinutes > IDLE_WARN_MINUTES && !stream.autoEndWarnedAt) {
        stream.autoEndWarnedAt = new Date();
        await stream.save();

        emitToMatch(String(stream.matchId), "stream:ending", {
          angle: stream.angle,
          reason: "idle",
          idleMinutes: Math.round(idleMinutes),
          endsAt: new Date(
            lastActivity + IDLE_END_MINUTES * MINUTE,
          ),
          message:
            "Kaafi der se koi ball nahi hui. Stream chalu rakhni hai?",
        });
      }

      /*
      | Scoring resumed after a warning - forget it happened, so the next
      | genuine idle spell warns again.
      */

      if (idleMinutes < IDLE_WARN_MINUTES && stream.autoEndWarnedAt) {
        stream.autoEndWarnedAt = null;
        await stream.save();
      }
    }
  } catch (error: any) {
    console.error("[monitor]", error.message);
  }
};

export default monitorLiveStreams;