import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    matchTitle: {
      type: String,
      required: true,
    },

    matchType: {
      type: String,
      enum: ["T5", "T10", "T20", "ODI", "Test"],
      default: "T20",
    },

    ballType: {
      type: String,
      enum: ["Leather", "Tennis", "Other"],
      default: "Leather",
    },

    pitchType: {
      type: String,
      enum: ["Turf", "Matting", "Concrete"],
      default: "Turf",
    },

    umpire1: {
      type: String,
      trim: true,
      default: "",
    },

    umpire2: {
      type: String,
      trim: true,
      default: "",
    },

    scorer: {
      type: String,
      trim: true,
      default: "",
    },

    scheduledStartTime: {
      type: Date,
      default: null,
    },

    teamA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    teamB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    confirmationStatus: {
      type: String,
      enum: ["not_required", "pending", "confirmed", "rejected"],
      default: "not_required",
    },

    confirmationRequiredFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Two-PIN System (Opponent Approval)
    |--------------------------------------------------------------------------
    |
    | Each team gets its OWN 4-digit PIN, generated at match creation.
    |   • teamAPin — shown only to Team A's captain
    |   • teamBPin — shown only to Team B's captain
    |
    | To start live scoring, a captain must enter the OPPONENT's PIN.
    | Captain A enters teamBPin; Captain B enters teamAPin. This proves
    | both captains are real and agree to the match.
    |
    */

    teamAPin: {
      type: String,
      default: null,
    },

    teamBPin: {
      type: String,
      default: null,
    },

    tournament: {
      type: String,
      trim: true,
      default: "",
    },

    teamASquad: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Player",
      },
    ],

    teamBSquad: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Player",
      },
    ],

    overs: {
      type: Number,
      default: 20,
    },

    tossWinner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    tossDecision: {
      type: String,
      enum: ["Bat", "Bowl"],
      default: null,
    },

    status: {
      type: String,
      enum: ["upcoming", "live", "completed", "cancelled"],
      default: "upcoming",
    },

    scorerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    scorerTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    // which team the scorer belongs to
    scorerName: { type: String, default: "" }, // display name

    /*
    |--------------------------------------------------------------------------
    | Invite Sender (Who Sent The Match Challenge)
    |--------------------------------------------------------------------------
    |
    | The captain who SENT the match challenge (or created a QuickScore
    | match). Only this user can score, unless they transfer scoring to
    | a teammate or an opponent player via transferScoring.
    |
    */

    inviteSenderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      default: null,
    },

    venueName: {
      type: String,
      trim: true,
      default: "",
    },

    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MatchChallenge",
      default: null,
    },

    startTime: {
      type: Date,
      default: null,
    },

    endTime: {
      type: Date,
      default: null,
    },

    winnerTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    result: {
      type: String,
      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Player Of The Match
    |--------------------------------------------------------------------------
    |
    | There was nowhere to record this, so the award existed only in
    | conversation after the game. Set alongside the result by whichever
    | captain saves it; when it is set, everyone following that player is
    | notified and the player themselves gets the award notification.
    |
    | Nullable because plenty of matches - abandoned, casual, or just not
    | bothered with - never name one.
    |
    */

    playerOfTheMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    /*
    | What they did, as one line - "82 (41) & 2/24".
    |
    | Stored rather than recomputed on every read, because it is settled the
    | moment the match ends and re-deriving it means re-reading every ball of
    | the match to render one card. A name with no numbers under it invites
    | the exact argument the card exists to settle.
    */

    playerOfTheMatchStats: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,

    /*
    |--------------------------------------------------------------------------
    | The PINs Are Never Serialised
    |--------------------------------------------------------------------------
    |
    | res.json() calls toJSON on the document, so every endpoint that returned
    | a match returned BOTH raw PINs with it - including to the opposing
    | captain, who is the one person the PIN is supposed to prove something
    | to. They could read it out of the payload and start the match without
    | ever being given it.
    |
    | Stripping it here means no route can leak it by forgetting to, however
    | the match is fetched or wrapped.
    |
    | This does not affect the server's own checks: startMatch and
    | verifyMatchPin compare match.teamAPin / match.teamBPin on the document
    | itself, which is untouched. The only PIN that reaches a client is the
    | `matchPin` that match.service.ts computes deliberately - that user's own
    | side's PIN, and only while the match is still upcoming.
    */

    toJSON: {
      transform: (_doc, ret: any) => {
        delete ret.teamAPin;
        delete ret.teamBPin;
        return ret;
      },
    },
  },
);

const Match = mongoose.model("Match", matchSchema);

export default Match;
