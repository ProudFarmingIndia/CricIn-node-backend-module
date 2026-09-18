/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| muxWebhook.controller.ts
|
| Description:
| Mux tells us when a broadcaster actually connects, drops, or finishes -
| the app cannot know any of that on its own. Without it the LIVE badge
| is a guess, and a phone that died mid-over goes on saying "live" until
| someone notices.
|
| The signature is verified by hand rather than through the SDK helper so
| an SDK upgrade cannot quietly change how this behaves - this endpoint is
| public and anything that reaches it is untrusted until the HMAC says
| otherwise.
|
|--------------------------------------------------------------------------
*/

import { Request, Response } from "express";
import crypto from "crypto";

import LiveStream from "./liveStream.model";
import Match from "../matches/match.model";

import { notifyFollowersStreamLive } from "../follows/follow.fanout";

import mux, {
  KEEP_RECORDINGS,
  RECORDING_RETENTION_DAYS,
} from "../../config/mux";

import { emitToMatch } from "../../socket/socket";

/*
|--------------------------------------------------------------------------
| Signature
|--------------------------------------------------------------------------
|
| Header:  mux-signature: t=<unix>,v1=<hex>
| Signed:  `${t}.${rawBody}` under HMAC-SHA256 with the webhook secret.
|
| The five-minute age check is what stops a captured request being
| replayed later - the signature alone stays valid forever.
|
*/

export const verifyMuxSignature = (
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean => {
  if (!signatureHeader || !secret) return false;

  const parts: Record<string, string> = {};

  for (const chunk of String(signatureHeader).split(",")) {
    const idx = chunk.indexOf("=");
    if (idx > 0) {
      parts[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim();
    }
  }

  const t = parts.t;
  const v1 = parts.v1;

  if (!t || !v1) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(t));

  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

const processEvent = async (event: any) => {
  const { type, data } = event;

  if (!type || !data) return;

  switch (type) {
    /*
    | The broadcaster connected - this is the only trustworthy moment to
    | put a LIVE badge on the match.
    */

    case "video.live_stream.active": {
      const doc = await LiveStream.findOneAndUpdate(
        { muxLiveStreamId: data.id },
        { status: "active", startedAt: new Date(), endedAt: null },
        { new: true },
      );

      if (doc) {
        emitToMatch(String(doc.matchId), "stream:status", {
          angle: doc.angle,
          status: "active",
        });

        /*
        |--------------------------------------------------------------------------
        | Tell The Followers
        |--------------------------------------------------------------------------
        |
        | Watching is open to everyone; the push goes only to people who
        | follow one of the two teams. That split is the visibility model
        | in one place.
        |
        | GUARDED, AND THE GUARD IS THE POINT
        | Three ways this would otherwise fire more than once for one
        | match: the second camera connecting, a reconnect after a dropped
        | signal, and Mux redelivering an event it did not get a 200 for.
        | On a rainy afternoon with a flaky phone, that is a follower's
        | notification tray filled with the same match.
        |
        | The flag is set with a conditional update on the MATCH, not on
        | the stream - two angles are two stream rows but one fixture, and
        | the notification is about the fixture. matchedCount === 0 means
        | someone else already claimed it, so this one stays quiet.
        |
        */

        const claimed = await Match.updateOne(
          { _id: doc.matchId, streamLiveNotifiedAt: null },
          { streamLiveNotifiedAt: new Date() },
        );

        if (claimed.modifiedCount > 0) {
          const match: any = await Match.findById(doc.matchId)
            .select("teamA teamB userId scorerUserId status")
            .lean();

          /*
          | A draft has no teams yet, so there is nobody to notify and
          | nothing to name the match. Skipped rather than sent with two
          | blank team names.
          */

          if (match && match.status !== "draft") {
            await notifyFollowersStreamLive(match);
          }
        }
      }

      break;
    }

    case "video.live_stream.idle": {
      const doc = await LiveStream.findOneAndUpdate(
        { muxLiveStreamId: data.id },
        { status: "idle", endedAt: new Date() },
        { new: true },
      );

      if (doc) {
        emitToMatch(String(doc.matchId), "stream:status", {
          angle: doc.angle,
          status: "ended",
        });
      }

      break;
    }

    /*
    | Dropped, but still inside reconnect_window. Worth surfacing as
    | "reconnecting" rather than "ended" - on a ground connection this
    | fires constantly and recovers on its own.
    */

    case "video.live_stream.disconnected": {
      const doc = await LiveStream.findOneAndUpdate(
        { muxLiveStreamId: data.id },
        { status: "disconnected" },
        { new: true },
      );

      if (doc) {
        emitToMatch(String(doc.matchId), "stream:status", {
          angle: doc.angle,
          status: "reconnecting",
        });
      }

      break;
    }

    case "video.live_stream.disabled": {
      await LiveStream.findOneAndUpdate(
        { muxLiveStreamId: data.id },
        { status: "disabled" },
      );

      break;
    }

    /*
    | The recording finished processing - and, in phase one, this is where
    | it dies.
    |
    | Mux records every live stream whether we want it or not, so this is
    | the earliest moment the asset exists to be deleted. Deleting it here
    | rather than on a nightly sweep is the whole point: plus-quality
    | storage is prorated with no monthly minimum, so an asset that lives
    | for seconds bills for seconds.
    |
    | The playback id is deliberately never stored in this mode. If it
    | were, the app would show a replay button for a video that is already
    | gone.
    */

    case "video.asset.ready": {
      if (!data.live_stream_id) break; // an upload, not a live recording

      if (!KEEP_RECORDINGS) {
        try {
          await mux.video.assets.delete(data.id);
        } catch (error: any) {
          /*
          | Already gone is the desired end state. Anything else is left
          | for the sweeper in jobs/manageRecordings, which retries - so
          | assetId IS written down even on failure. Losing the id is how
          | an asset ends up billing quietly forever with nothing in the
          | database pointing at it.
          */

          if (error?.status !== 404) {
            console.error(
              "[mux-webhook] asset delete failed, sweeper will retry",
              data.id,
              error.message,
            );

            await LiveStream.findOneAndUpdate(
              { muxLiveStreamId: data.live_stream_id },
              { assetId: data.id },
            );

            break;
          }
        }

        await LiveStream.findOneAndUpdate(
          { muxLiveStreamId: data.live_stream_id },
          {
            assetId: null,
            recordingPlaybackId: null,
            recordingExpiresAt: null,
            recordingDeletedAt: new Date(),
          },
        );

        break;
      }

      /*
      | KEEP_RECORDINGS=true - the replay path, off by default. The
      | retention clock starts here rather than at match end, because this
      | is the first moment the recording actually exists and has a size.
      */

      await LiveStream.findOneAndUpdate(
        { muxLiveStreamId: data.live_stream_id },
        {
          assetId: data.id,
          recordingPlaybackId: data.playback_ids?.[0]?.id || null,
          recordingExpiresAt: new Date(
            Date.now() + RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      );

      break;
    }

    default:
      break;
  }
};

export const handleMuxWebhook = async (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : String(req.body);

  const ok = verifyMuxSignature(
    rawBody,
    req.headers["mux-signature"] as string | undefined,
    process.env.MUX_WEBHOOK_SECRET,
  );

  if (!ok) {
    console.warn("[mux-webhook] signature rejected");
    return res.status(401).send("Invalid signature");
  }

  let event: any;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  /*
  | Acknowledge before processing. Mux retries anything it considers slow,
  | and a retry storm during a live match is the last thing the database
  | needs.
  */

  res.status(200).send("ok");

  try {
    await processEvent(event);
  } catch (error: any) {
    console.error("[mux-webhook]", event?.type, error.message);
  }
};