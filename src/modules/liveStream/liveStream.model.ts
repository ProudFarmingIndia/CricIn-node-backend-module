/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| LiveStream
|
| File:
| liveStream.model.ts
|
| Description:
| One row per (match, camera angle). A match streamed from two phones -
| behind the bowler's arm and square of the run-out line - has two rows
| and the viewer switches between their playback URLs.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

const liveStreamSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Camera Angle
    |--------------------------------------------------------------------------
    |
    | front - behind the bowler's arm, the main broadcast view
    | third - square of the pitch on the run-out line, the "third umpire" view
    |
    */

    angle: {
      type: String,
      enum: ["front", "third"],
      required: true,
    },

    muxLiveStreamId: {
      type: String,
      required: true,
      unique: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Stream Key - Encrypted, Never Serialised
    |--------------------------------------------------------------------------
    |
    | Whoever holds this can broadcast onto this match. It is encrypted at
    | rest (AES-256-GCM) and select:false so no query returns it by
    | accident - the one endpoint that hands it out decrypts it
    | deliberately, and only for the match's own scorer/creator.
    |
    */

    streamKeyEnc: {
      type: String,
      required: true,
      select: false,
    },

    /*
    | Public by design - this is what viewers play.
    */

    playbackId: {
      type: String,
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Assigned Broadcaster
    |--------------------------------------------------------------------------
    |
    | Who is actually holding the phone for THIS angle.
    |
    | Scoring and filming are different jobs done by different people: the
    | captain scores, two teammates film. So the stream key cannot simply
    | be gated on "can this user score" - the two players who need it
    | usually cannot score, and the captain who can score is not filming.
    |
    | Assignment is per angle rather than a pool of two, because two
    | devices pushing the same stream key fight each other at the ingest
    | and the picture flickers between them. One key, one phone, named.
    |
    | Only the scorer/creator assigns; the assigned player can then fetch
    | their own key and nothing else.
    |
    */

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Assignment Has To Be Accepted
    |--------------------------------------------------------------------------
    |
    | The key is issued on `accepted`, not on `pending`.
    |
    | Anyone on CricIn can be asked to film - the person holding the camera
    | is usually in neither squad. That openness is correct, but it means a
    | scorer can type the wrong name and hand broadcast rights to a stranger
    | who never even opens the app.
    |
    | Requiring an answer closes that: a mis-typed invite sits pending and
    | expires with the match, having granted nothing. It also gives the
    | scorer a real answer before the toss - "yes I'm here" - instead of
    | assuming.
    |
    */

    assignmentStatus: {
      type: String,
      enum: ["none", "pending", "accepted", "declined"],
      default: "none",
    },

    /*
    | Who did the assigning. The invite is open to any user, so the audit
    | trail is what keeps it accountable - every key traces back to the
    | scorer who handed it out.
    */

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "idle",
        "active",
        "disconnected",
        "disabled",
        "completed",
      ],
      default: "idle",
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Recording
    |--------------------------------------------------------------------------
    |
    | Set by the video.asset.ready webhook once Mux finishes the recording.
    | This is what powers replays and, later, auto-generated highlight clips
    | cut from the ball-by-ball timestamps.
    |
    */

    assetId: {
      type: String,
      default: null,
    },

    recordingPlaybackId: {
      type: String,
      default: null,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    endedAt: {
      type: Date,
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Auto-End Bookkeeping
    |--------------------------------------------------------------------------
    |
    | keepAliveUntil - the scorer answered "still going" to an idle warning
    | (rain, an injury, a long drinks break). Nothing auto-ends before this.
    |
    | autoEndWarnedAt - so the warning is sent once rather than every time
    | the monitor runs.
    |
    */

    keepAliveUntil: {
      type: Date,
      default: null,
    },

    autoEndWarnedAt: {
      type: Date,
      default: null,
    },

    endedReason: {
      type: String,
      enum: [
        "scorer",
        "match_complete",
        "idle",
        "hard_cap",
        "broadcaster",
        null,
      ],
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Recording Lifecycle
    |--------------------------------------------------------------------------
    |
    | Set when the recording becomes ready. The full match is kept for a
    | week; the highlight clips cut from it are kept indefinitely, because
    | two and a half minutes of clips costs almost nothing and is what
    | anyone actually opens again.
    |
    */

    recordingExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    recordingWarnedAt: {
      type: Date,
      default: null,
    },

    recordingDeletedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,

    /*
    | Belt and braces alongside select:false - even a lean() or an
    | aggregate that picked the field up cannot serialise it out.
    */

    toJSON: {
      transform: (_doc, ret: any) => {
        delete ret.streamKeyEnc;
        return ret;
      },
    },
  },
);

/*
| One stream per angle per match. Without this, a double-tap on "Go Live"
| creates two Mux streams and the second one silently bills storage forever.
*/

liveStreamSchema.index({ matchId: 1, angle: 1 }, { unique: true });

export default mongoose.model("LiveStream", liveStreamSchema);
