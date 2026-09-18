import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Draft Matches Are Exempt From The Required Fields
    |--------------------------------------------------------------------------
    |
    | "Go Live" can be pressed before a match exists at all - someone
    | arrives at the ground, opens the app and starts filming. The stream
    | still needs a match to hang off from the first second, so one is
    | created immediately in `draft` status with none of this filled in.
    |
    | Making these unconditionally required would mean either inventing
    | placeholder teams, or letting the stream exist unattached and joining
    | it to a match later - which is nullable foreign keys everywhere and a
    | migration the first time someone streams an hour before entering the
    | line-ups.
    |
    | The moment the draft is completed its status moves to upcoming/live
    | and all three become compulsory again, so nothing half-filled can
    | ever reach a real match listing.
    |
    */

    matchTitle: {
      type: String,
      required: function (this: any) {
        return this.status !== "draft";
      },
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

    // Optional only while the match is still a draft - see matchTitle above.

    teamA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: function (this: any) {
        return this.status !== "draft";
      },
    },

    teamB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: function (this: any) {
        return this.status !== "draft";
      },
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

    /*
    |--------------------------------------------------------------------------
    | Tournament
    |--------------------------------------------------------------------------
    |
    | `tournament` was a free-text String and stays for backwards
    | compatibility with matches created before tournaments existed. Nothing
    | new should write to it.
    |
    | `tournamentId` is the real link. Without it a match cannot be grouped,
    | a points table cannot be built, and "is tournament ke saare match"
    | cannot be asked - which is why every tournament feature depends on
    | this one field.
    |
    */

    tournament: {
      type: String,
      trim: true,
      default: "",
    },

    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
      index: true,
    },

    /*
    | Where this fixture sits in the draw.
    |
    | dependsOnMatchA / B are how a knockout bracket is expressed before
    | anybody has qualified: "the winner of match 3 plays here". They hold a
    | matchNumber within this tournament, not an ObjectId, because the whole
    | bracket is planned in one pass before any of it is saved.
    */

    tournamentRound: {
      stage: {
        type: String,
        enum: ["league", "knockout", "playoff", null],
        default: null,
      },
      roundNumber: { type: Number, default: null },
      matchNumber: { type: Number, default: null },
      label: { type: String, default: null },
      dependsOnMatchA: { type: Number, default: null },
      dependsOnMatchB: { type: Number, default: null },
    },

    /*
    |--------------------------------------------------------------------------
    | Series
    |--------------------------------------------------------------------------
    |
    | The same idea as tournamentId, one level simpler. A series fixture IS
    | an ordinary Match - which is the whole reason the toss, the squads,
    | the PIN, the scoring pad, live streaming and career stats all work on
    | it without a line of change in any of those modules.
    |
    | A match belongs to a tournament OR a series, never both: a game
    | cannot be the third ODI and a group-stage fixture at the same time.
    | Nothing enforces that at the schema level because a compound
    | validator here would fire on every match ever saved to check a
    | condition that only two creation paths can produce - both of which
    | set exactly one of the two.
    |
    | `seriesMatchNumber` is 1-based and is what makes "3rd T20" a real
    | label rather than a guess from the date.
    |
    */

    seriesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Series",
      default: null,
      index: true,
    },

    seriesMatchNumber: {
      type: Number,
      default: null,
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

    /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    |
    | `draft` is a match that exists only because someone pressed "Go Live"
    | before entering any details. It is deliberately NOT a listable state:
    | any query that does not filter on a specific status must exclude it,
    | or half-filled matches surface in browse and search.
    |
    | Drafts that are never completed, never streamed and never scored are
    | swept up 24 hours later by jobs/cleanupDraftMatches - along with the
    | Mux stream behind them, which would otherwise bill storage every month
    | attached to a match nothing links to.
    |
    */

    status: {
      type: String,
      enum: ["draft", "upcoming", "live", "completed", "cancelled"],
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

    /*
    |--------------------------------------------------------------------------
    | Stream Live Notification Guard
    |--------------------------------------------------------------------------
    |
    | Stamped the first time a camera connects on this match, and never
    | again. Its only job is to stop the "X vs Y is live on camera" push
    | going out more than once.
    |
    | It is needed because there are three separate ways the same match
    | reaches that moment twice: the second angle connecting, a phone
    | reconnecting after a signal drop, and Mux redelivering a webhook.
    | Without the guard, a rainy afternoon on a weak 4G connection sends a
    | follower the same notification a dozen times, and they turn the
    | whole category off.
    |
    | On the MATCH rather than on the LiveStream row because two angles
    | are two rows but one fixture, and the notification is about the
    | fixture.
    |
    */

    streamLiveNotifiedAt: {
      type: Date,
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