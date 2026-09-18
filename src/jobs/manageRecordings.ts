/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Jobs
|
| File:
| manageRecordings.ts
|
| Description:
| Makes sure no match recording is left sitting in Mux billing storage.
|
| PHASE 1 POLICY: KEEP NOTHING
| No post-match video is stored. Nobody has asked for a replay yet, so
| there is nothing to justify a bill that recurs every month forever.
| Revisited after real user feedback.
|
| Mux records every live stream whether we want it or not - there is no
| create-time flag to switch it off. The webhook deletes the asset the
| second it becomes ready; this job is the net underneath that, for the
| three ways the webhook misses:
|
| 1. NO WEBHOOK YET. Before the backend is deployed with a public URL,
|    MUX_WEBHOOK_SECRET is empty and nothing arrives at all. Every test
|    stream on a laptop would otherwise leave an asset behind.
| 2. THE DELETE FAILED. Mux was briefly down, or the process restarted
|    between the webhook and the API call.
| 3. THE WEBHOOK WAS MISSED. Deploy, restart, network - it happens.
|
| So this job does not trust the database's idea of what exists. It ASKS
| MUX which assets belong to each of our live streams, and deletes what it
| finds. That is the only version of this that cannot leak.
|
| WHY DELETING IMMEDIATELY IS ACTUALLY FREE
| Mux does not offer basic quality for live streams - only plus and
| premium - and plus-quality storage has no one-month minimum and is
| prorated. An asset that exists for a minute bills a minute. On basic
| quality this would have cost a full month per match no matter how fast
| we deleted it.
|
| WHEN KEEP_RECORDINGS=true
| The old retention path runs instead: the recording lives for
| RECORDING_RETENTION_DAYS, a warning goes out RECORDING_WARN_DAYS_BEFORE
| the delete, and nothing is swept early.
|
|--------------------------------------------------------------------------
*/

import mux, {
  KEEP_RECORDINGS,
  RECORDING_WARN_DAYS_BEFORE,
} from "../config/mux";

import LiveStream from "../modules/liveStream/liveStream.model";
import Match from "../modules/matches/match.model";

import { createNotification } from "../modules/notifications/notification.service";
import { NOTIFICATION_TYPES } from "../modules/notifications/notification.types";

const DAY = 24 * 60 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Delete One Asset
|--------------------------------------------------------------------------
|
| 404 counts as success - already gone at Mux is exactly the end state
| this job is trying to reach.
|
*/

const deleteAsset = async (assetId: string): Promise<boolean> => {
  try {
    await mux.video.assets.delete(assetId);

    return true;
  } catch (error: any) {
    if (error?.status === 404) return true;

    console.error(
      "[recordings] could not delete asset",
      assetId,
      error.message,
    );

    return false;
  }
};

/*
|--------------------------------------------------------------------------
| Sweep - phase 1, keep nothing
|--------------------------------------------------------------------------
|
| Only looks at streams that are no longer live. Deleting an asset while
| the broadcast is still running would cut the recording Mux is actively
| writing, and on a reconnect that is the live session itself.
|
| The window is deliberate: streams that ended in the last three days.
| Older than that has been swept many times already, and re-asking Mux
| about every match ever played would be a growing number of API calls an
| hour for nothing.
|
*/

const sweepUnwanted = async (now: number) => {
  const streams = await LiveStream.find({
    status: { $in: ["idle", "disabled", "completed"] },
    recordingDeletedAt: null,
    updatedAt: { $gte: new Date(now - 3 * DAY) },
  });

  let deleted = 0;

  for (const stream of streams as any[]) {
    const assetIds = new Set<string>();

    if (stream.assetId) assetIds.add(String(stream.assetId));

    /*
    | Ask Mux directly rather than trusting assetId. This is what catches
    | the recordings created while no webhook existed - the database never
    | heard about them, so nothing else ever would.
    */

    if (stream.muxLiveStreamId) {
      try {
        const page = await mux.video.assets.list({
          live_stream_id: String(stream.muxLiveStreamId),
          limit: 25,
        });

        for (const asset of page.data || []) {
          if (asset?.id) assetIds.add(String(asset.id));
        }
      } catch (error: any) {
        if (error?.status !== 404) {
          console.error(
            "[recordings] could not list assets for stream",
            stream.muxLiveStreamId,
            error.message,
          );

          continue;
        }
      }
    }

    if (!assetIds.size) {
      /*
      | Mux has nothing for this stream. Mark it swept so the job stops
      | asking about it every hour for the next three days.
      */

      stream.recordingDeletedAt = new Date();
      stream.assetId = null;
      stream.recordingPlaybackId = null;

      await stream.save();

      continue;
    }

    let allGone = true;

    for (const assetId of assetIds) {
      const ok = await deleteAsset(assetId);

      if (ok) deleted++;
      else allGone = false;
    }

    if (!allGone) continue; // leave it for the next run

    stream.recordingDeletedAt = new Date();
    stream.assetId = null;
    stream.recordingPlaybackId = null;
    stream.recordingExpiresAt = null;

    await stream.save();
  }

  if (deleted) {
    console.log(`[recordings] ${deleted} recording(s) deleted`);
  }
};

/*
|--------------------------------------------------------------------------
| Warn Before Deleting - only when KEEP_RECORDINGS=true
|--------------------------------------------------------------------------
|
| Sent to whoever ran the match. A recording that disappears without
| notice reads as data loss; the same deletion announced two days early
| reads as a policy, and gives anyone who wanted the full game a chance to
| save it.
|
*/

const warnExpiring = async (now: number) => {
  const warnBefore = new Date(now + RECORDING_WARN_DAYS_BEFORE * DAY);

  const soon = await LiveStream.find({
    recordingPlaybackId: { $ne: null },
    recordingDeletedAt: null,
    recordingWarnedAt: null,
    recordingExpiresAt: { $ne: null, $lte: warnBefore },
  });

  for (const stream of soon as any[]) {
    const match: any = await Match.findById(stream.matchId)
      .select("matchTitle userId scorerUserId")
      .lean();

    if (!match) continue;

    const receiver = match.userId || match.scorerUserId;

    if (receiver) {
      await createNotification({
        receiverId: String(receiver),
        actorId: String(receiver),
        type: NOTIFICATION_TYPES.RECORDING_EXPIRING,
        title: "Match recording expiring",
        message: `${match.matchTitle || "Your match"} ki poori recording ${RECORDING_WARN_DAYS_BEFORE} din mein delete ho jaayegi. Highlights hamesha rahenge.`,
        data: {
          matchId: String(stream.matchId),
          angle: stream.angle,
          expiresAt: stream.recordingExpiresAt,
        },
      }).catch(() => undefined);
    }

    stream.recordingWarnedAt = new Date();

    await stream.save();
  }
};

const deleteExpired = async (now: number) => {
  const expired = await LiveStream.find({
    recordingPlaybackId: { $ne: null },
    recordingDeletedAt: null,
    recordingExpiresAt: { $ne: null, $lte: new Date(now) },
  });

  let deleted = 0;

  for (const stream of expired as any[]) {
    if (!stream.assetId) continue;

    const ok = await deleteAsset(String(stream.assetId));

    /*
    | Not marked deleted on failure - marking it would stop us ever
    | retrying, and the asset would bill quietly forever.
    */

    if (!ok) continue;

    stream.recordingDeletedAt = new Date();
    stream.recordingPlaybackId = null;
    stream.assetId = null;

    await stream.save();

    deleted++;
  }

  if (deleted) {
    console.log(`[recordings] ${deleted} expired recording(s) deleted`);
  }
};

const manageRecordings = async (): Promise<void> => {
  const now = Date.now();

  try {
    if (!KEEP_RECORDINGS) {
      await sweepUnwanted(now);

      return;
    }

    await warnExpiring(now);
    await deleteExpired(now);
  } catch (error: any) {
    console.error("[recordings]", error.message);
  }
};

export default manageRecordings;