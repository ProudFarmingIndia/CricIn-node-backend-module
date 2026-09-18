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
| WHY THIS FILE NO LONGER THROWS AT IMPORT TIME
|
| It used to. The reasoning was sound - a silent failure means every
| "Go Live" returns a 500 with no clue why - but the blast radius was
| not. `throw` at module scope runs the moment anything imports this
| file, and the import chain reaches it before a single route is
| registered:
|
|     server.ts -> app.ts -> liveStream.routes -> liveStream.service
|                                                       -> config/mux
|
| server.ts also imports monitorLiveStreams and manageRecordings
| directly, and both pull in this file too. So a missing MUX_TOKEN_ID
| did not break live streaming - it stopped the process from booting at
| all. Login, teams, tournaments, scoring, notifications: nothing ran.
| That is exactly what happened on the first Render deploy.
|
| viewerRegistry.ts makes the point best. It imports ONE number from
| here - MAX_VIEWERS_PER_MATCH - and used to inherit a credential check
| along with it.
|
| So the failure is now scoped to the thing that actually failed. The
| constants below are plain values that anyone can import safely. The
| client is built on first use, and only a call that genuinely needs Mux
| raises an error - a 503 through the normal error handler, with a
| message that says what is missing.
|
|--------------------------------------------------------------------------
*/

import Mux from "@mux/mux-node";

import AppError from "../shared/errors/AppError";

/*
|--------------------------------------------------------------------------
| Reading Numbers From The Environment
|--------------------------------------------------------------------------
|
| `Number(process.env.X || 40)` has a quiet failure mode: a typo makes it
| NaN, and NaN passes through every comparison as false. MAX_VIEWERS_PER_MATCH
| is the one that matters - its whole job is to stop an unexpected bill, and
| `viewers > NaN` is false forever, so a mistyped cap is the same as no cap
| and nothing says so.
|
| This reads the same way but says something when the value is unusable, and
| still lets an explicit 0 through (the documented way to switch the cap off).
|
*/

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    console.warn(
      `[mux] ${name}="${raw}" is not a number - falling back to ${fallback}.`,
    );

    return fallback;
  }

  return parsed;
};

/*
|--------------------------------------------------------------------------
| Credentials
|--------------------------------------------------------------------------
|
| Exported so callers can answer "is streaming available here?" without
| triggering anything. A route can return a clean "not configured on this
| server" instead of letting a request fail deep inside the SDK.
|
*/

export const MUX_CONFIGURED = !!(
  process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET
);

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

/*
|--------------------------------------------------------------------------
| The Client
|--------------------------------------------------------------------------
|
| Built on first property access rather than at import.
|
| The Proxy is what keeps this a drop-in change: every call site already
| reads `import mux from "../../config/mux"` and then `mux.video.liveStreams
| .create(...)`. Exporting a getMux() function instead would have meant
| editing liveStream.service, muxWebhook.controller and both jobs, and each
| of those edits is a chance to miss one.
|
| The error is an AppError so it travels through the global handler as
| { success, message } with a 503, the same shape the app parses everywhere
| else - not an unhandled crash.
|
*/

let client: Mux | null = null;

const getClient = (): Mux => {
  if (client) return client;

  if (!MUX_CONFIGURED) {
    throw new AppError(
      "Live streaming is not configured on this server. " +
        "MUX_TOKEN_ID and MUX_TOKEN_SECRET are missing from the " +
        "environment (.env locally, the host's environment settings when " +
        "deployed).",
      503,
    );
  }

  client = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,

    /*
    | The SDK reads these for jwt.signPlaybackId. Null rather than "" so it
    | fails with "no signing key" instead of "invalid key".
    */

    jwtSigningKey: SIGNING_KEY_ID || null,
    jwtPrivateKey: SIGNING_KEY_PRIVATE || null,
  });

  return client;
};

const mux = new Proxy({} as Mux, {
  get: (_target, prop, receiver) => {
    const value = Reflect.get(getClient() as object, prop, receiver);

    /* Methods need their original `this`, so hand back a bound copy. */
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});

export default mux;

/*
|--------------------------------------------------------------------------
| Boot Diagnostics
|--------------------------------------------------------------------------
|
| Said once, at boot, rather than discovered at the ground. Neither line
| stops the server - they describe what streaming will and will not do.
|
*/

if (!MUX_CONFIGURED) {
  console.warn(
    "[mux] MUX_TOKEN_ID / MUX_TOKEN_SECRET not set - live streaming is " +
      "DISABLED. Every other feature works normally; streaming endpoints " +
      "will answer 503 until the credentials are added.",
  );
} else if (!SIGNED_PLAYBACK) {
  console.warn(
    "[mux] MUX_SIGNING_KEY_ID / MUX_SIGNING_KEY_PRIVATE not set - " +
      "streams will be created with PUBLIC playback. Anyone with the " +
      "playback URL can watch outside the app. Fine for testing, not for " +
      "production.",
  );
}

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

export const PLAYBACK_TOKEN_MINUTES = num("PLAYBACK_TOKEN_MINUTES", 40);

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

export const MAX_VIEWERS_PER_MATCH = num("MAX_VIEWERS_PER_MATCH", 200);

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

export const RECONNECT_WINDOW_SECONDS = num("MUX_RECONNECT_WINDOW", 180);

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

export const MATCH_COMPLETE_GRACE_MINUTES = num("STREAM_GRACE_MINUTES", 10);

export const IDLE_WARN_MINUTES = num("STREAM_IDLE_WARN_MINUTES", 20);

export const IDLE_END_MINUTES = num("STREAM_IDLE_END_MINUTES", 30);

export const HARD_CAP_HOURS = num("STREAM_HARD_CAP_HOURS", 6);

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

export const RECORDING_RETENTION_DAYS = num("RECORDING_RETENTION_DAYS", 7);

export const RECORDING_WARN_DAYS_BEFORE = num("RECORDING_WARN_DAYS_BEFORE", 2);