/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Jobs
|
| File:
| cleanupDraftMatches.ts
|
| Description:
| "Go Live" creates a draft match before anything else exists. Most of
| those become real matches. Some do not - the user taps it, gets
| distracted, and closes the app.
|
| Each abandoned one leaves a live Mux stream behind, and a Mux stream
| that ever recorded bills storage every month forever, attached to a
| match nothing in the app links to. Nobody would ever find it to delete
| it by hand.
|
| Anything that actually streamed or had a ball scored against it is left
| alone - that is a real match whose details were never filled in, not
| rubbish.
|
|--------------------------------------------------------------------------
*/

import mux from "../config/mux";

import LiveStream from "../modules/liveStream/liveStream.model";
import Match from "../modules/matches/match.model";
import Scoring from "../modules/scoring/scoring.model";

const DRAFT_TTL_HOURS = 24;

const cleanupDraftMatches = async (): Promise<void> => {
  const cutoff = new Date(
    Date.now() - DRAFT_TTL_HOURS * 60 * 60 * 1000,
  );

  try {
    const drafts = await Match.find({
      status: "draft",
      createdAt: { $lt: cutoff },
    } as any).select("_id");

    if (!drafts.length) return;

    let cleaned = 0;

    for (const match of drafts) {
      const [everLive, ballCount] = await Promise.all([
        LiveStream.exists({
          matchId: match._id,
          startedAt: { $ne: null },
        }),
        Scoring.countDocuments({ matchId: match._id }),
      ]);

      if (everLive || ballCount > 0) continue;

      const streams = await LiveStream.find({ matchId: match._id });

      for (const stream of streams) {
        try {
          await mux.video.liveStreams.delete(
            stream.muxLiveStreamId as string,
          );
        } catch (error: any) {
          if (error?.status !== 404) {
            console.error(
              "[cleanup] could not delete Mux stream",
              stream.muxLiveStreamId,
              error.message,
            );
          }
        }
      }

      await LiveStream.deleteMany({ matchId: match._id });

      await Match.updateOne(
        { _id: match._id },
        { status: "cancelled" },
      );

      cleaned++;
    }

    if (cleaned) {
      console.log(`[cleanup] ${cleaned} abandoned draft match(es) removed`);
    }
  } catch (error: any) {
    console.error("[cleanup]", error.message);
  }
};

export default cleanupDraftMatches;
