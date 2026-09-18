/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Config
|
| File:
| mux.ts
|
| Description:
| Mux Video client. Used for live stream ingest (RTMPS), HLS playback
| and match recordings.
|
| Fails loudly at boot if credentials are missing - a silent failure here
| means every "Go Live" in production returns a 500 with no clue why.
|
|--------------------------------------------------------------------------
*/

import Mux from "@mux/mux-node";

if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
  throw new Error(
    "MUX_TOKEN_ID / MUX_TOKEN_SECRET missing in .env",
  );
}

/*
|--------------------------------------------------------------------------
| Signed Playback
|--------------------------------------------------------------------------
|
| A "public" playback ID means the .m3u8 URL works for ANYONE who has the
| string - in a browser, in VLC, embedded on someone else's website. That
| is not "in-app only", it is a public URL that happens to be long.
|
| "signed" means the URL is useless without a short-lived JWT that only
| this backend can mint, and only for a logged-in user who passed the
| visibility check. Shared outside the app it dies within the hour.
|
| The signing key is a SEPARATE credential from the API token - Mux
| Settings -> Signing Keys. It is an RSA private key, so it arrives
| base64-encoded; keep it that way in .env, on one line.
|
| WHY THIS IS A FLAG AND NOT JUST ON
| Without a signing key configured, signed playback would make every
| stream unplayable - a worse failure than the one it fixes, and one that
| only shows up at the ground. So the code reads the key: present means
| signed, absent means public with a loud warning at boot. Testing works
| today; production turns it on by adding two lines to .env.
|
*/

const SIGNING_KEY_ID = process.env.MUX_SIGNING_KEY_ID || "";

const SIGNING_KEY_PRIVATE = process.env.MUX_SIGNING_KEY_PRIVATE || "";

export const SIGNED_PLAYBACK = !!(SIGNING_KEY_ID && SIGNING_KEY_PRIVATE);

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,

  /*
  | The SDK reads these for jwt.signPlaybackId. Null rather than "" so it
  | fails with "no signing key" instead of "invalid key".
  */

  jwtSigningKey: SIGNING_KEY_ID || null,
  jwtPrivateKey: SIGNING_KEY_PRIVATE || null,
});

if (!SIGNED_PLAYBACK) {
  console.warn(
    "[mux] MUX_SIGNING_KEY_ID / MUX_SIGNING_KEY_PRIVATE not set - " +
      "streams will be created with PUBLIC playback. Anyone with the " +
      "playback URL can watch outside the app. Fine for testing, not for " +
      "production.",
  );
}

export default mux;

export const RTMPS_URL = "rtmps://global-live.mux.com:443/app";

/*
|--------------------------------------------------------------------------
| Playback Token Lifetime
|--------------------------------------------------------------------------
|
| Short enough that a URL pasted into WhatsApp is dead before anyone taps
| it; long enough that the player does not have to re-authenticate in the
| middle of an over. The app refreshes it well before expiry.
|
*/

export const PLAYBACK_TOKEN_MINUTES = Number(
  process.env.PLAYBACK_TOKEN_MINUTES || 40,
);

/*
|--------------------------------------------------------------------------
| Concurrent Viewer Cap
|--------------------------------------------------------------------------
|
| Delivery is billed per viewer per minute. A three-hour match watched by
| one person costs 180 minutes; watched by two hundred it costs 36,000 -
| a third of the entire monthly free tier, on one match.
|
| This is not a feature, it is insurance. Nothing in phase one is expected
| to reach it; it exists so that one match going unexpectedly viral cannot
| produce a bill nobody approved. Raise it in .env once the real numbers
| are known, or set it to 0 to switch the cap off.
|
*/

export const MAX_VIEWERS_PER_MATCH = Number(
  process.env.MAX_VIEWERS_PER_MATCH || 200,
);

export type StreamAngle = "front" | "third";

export const ANGLES: StreamAngle[] = ["front", "third"];

/*
|--------------------------------------------------------------------------
| Reconnect Window
|--------------------------------------------------------------------------
|
| How long Mux holds a live session open after the encoder disappears,
| before deciding the stream is over.
|
| Two things make this matter more than it looks:
|
| 1. REDUCED LATENCY DEFAULTS TO ZERO. Standard-latency streams get 60s
|    for free; reduced and low latency get none at all unless it is set
|    explicitly. Without this line, one dropped packet on ground 4G ends
|    the match's stream permanently and the recording is cut in two.
|
| 2. IT IS ALSO THE HANDOVER WINDOW. When the scorer moves a camera to a
|    different player mid-match, the old phone stops and the new one has
|    to open Larix, paste a fresh key and connect. Inside this window that
|    is ONE continuous session - same recording, viewers see slate for a
|    few seconds rather than "stream ended". Outside it, the match becomes
|    two separate recordings and every viewer's player gives up.
|
| 180s is chosen for the human on the ground, not the network: sixty
| seconds is not enough time to walk over, unlock a phone and paste a key.
|
| Raise it via .env after the real ground test says what drops look like.
|
*/

export const RECONNECT_WINDOW_SECONDS = Number(
  process.env.MUX_RECONNECT_WINDOW || 180,
);

/*
|--------------------------------------------------------------------------
| When A Stream Ends By Itself
|--------------------------------------------------------------------------
|
| A stream nobody stops runs until Mux's own 12-hour ceiling, billing
| delivery to whoever is still watching and recording a phone in someone's
| pocket. But cutting it too eagerly is worse: the minutes right after the
| last ball - the win, the celebration, the trophy - are the ones families
| actually stay for.
|
| So none of these fire while a match is being scored. They only look at
| how long it has been since ANYTHING happened.
|
| GRACE - after the scorer marks the match complete. Long enough for the
| presentation, short enough that a forgotten phone is caught the same
| evening. The scorer can extend it or end it now.
|
| IDLE - no ball scored for this long while still live. Set at 30 minutes
| deliberately: rain stops play for 20-40 minutes all the time, and ending
| someone's stream during a shower they were about to come back from is
| the version of this that makes people stop trusting the feature. The
| warning at 20 gives whoever is there a chance to say "still going".
|
| HARD CAP - the backstop for the case none of the above catches: the
| scorer never marks the match complete and simply closes the app. Six
| hours covers any real cricket match including delays.
|
*/

export const MATCH_COMPLETE_GRACE_MINUTES = Number(
  process.env.STREAM_GRACE_MINUTES || 10,
);

export const IDLE_WARN_MINUTES = Number(
  process.env.STREAM_IDLE_WARN_MINUTES || 20,
);

export const IDLE_END_MINUTES = Number(
  process.env.STREAM_IDLE_END_MINUTES || 30,
);

export const HARD_CAP_HOURS = Number(
  process.env.STREAM_HARD_CAP_HOURS || 6,
);

/*
|--------------------------------------------------------------------------
| Recording Retention - PHASE 1: KEEP NOTHING
|--------------------------------------------------------------------------
|
| Storage is the only line on the Mux bill that recurs and accumulates.
| Delivery is billed once, when somebody watches; storage is billed every
| month, for every recording, forever. Twenty matches a month does not
| cost the same each month - it costs that much MORE each month.
|
| For phase one the answer is that no post-match video is kept at all.
| Nobody has asked for a replay yet, so there is nothing to justify a
| recurring bill. This is revisited after real user feedback.
|
| Mux ALWAYS records a live stream - there is no create-time flag to turn
| it off (checked against the API: LiveStreamCreateParams has no such
| option). So the recording is deleted the moment Mux says it is ready.
|
| THE ONE THING THAT MAKES THIS FREE
| Mux does not offer basic quality for live streams - only plus and
| premium - and plus quality storage has NO one-month minimum charge and
| is prorated. So an asset created and deleted within the same minute
| bills a minute of storage, not a month. Had live streams been basic
| quality, "record then delete" would still have cost a full month per
| match and this whole approach would have been pointless.
|
| WHAT SURVIVES
| Highlights. They are timestamps against the ball data, not files - see
| videoHighlights.service. With no recording they come back with
| `hasVideo: false` and still carry the over, the commentary and the
| players, which is what the moments feed shows anyway.
|
| TO TURN REPLAYS BACK ON LATER
| Set KEEP_RECORDINGS=true in .env. The retention path below then applies:
| the recording lives for RECORDING_RETENTION_DAYS and a warning goes out
| RECORDING_WARN_DAYS_BEFORE the delete. No code change needed.
|
*/

export const KEEP_RECORDINGS =
  String(process.env.KEEP_RECORDINGS || "false").toLowerCase() === "true";

export const RECORDING_RETENTION_DAYS = Number(
  process.env.RECORDING_RETENTION_DAYS || 7,
);

export const RECORDING_WARN_DAYS_BEFORE = Number(
  process.env.RECORDING_WARN_DAYS_BEFORE || 2,
);