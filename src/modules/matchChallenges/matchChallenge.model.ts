import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Match Challenge
|--------------------------------------------------------------------------
|
| The proposal stage between two independently-owned teams - separate
| from the real Match record, which only gets created once this is
| ACCEPTED. This is what "send a challenge" / "accept or reject with a
| reason" actually operates on.
|
*/

const REJECTION_REASONS = [
  "Date not suitable",
  "Team unavailable",
  "Prefer different venue",
  "Squad not ready",
  "Other",
] as const;

const MATCH_TYPES = ["T5", "T10", "T20", "ODI", "Test"] as const;
const BALL_TYPES = ["Leather", "Tennis", "Other"] as const;
const PITCH_TYPES = ["Turf", "Matting", "Concrete"] as const;

const matchChallengeSchema = new mongoose.Schema(
  {
    challengerTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    challengedTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Proposed Match Details
    |--------------------------------------------------------------------------
    */

    proposedDate: {
      type: Date,
      default: null,
    },

    proposedTime: {
      type: String, // e.g. "06:00 AM" - display string, actual scheduling uses proposedDate
      default: "",
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

    matchType: {
      type: String,
      enum: ["T5", "T10", "T20", "ODI", "Test"],
      default: "T20",
    },

    overs: {
      type: Number,
      default: 20,
    },

    message: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },

    matchTitle: {
      type: String,
      trim: true,
      default: "",
    },

    tournament: {
      type: String,
      trim: true,
      default: "",
    },

    ballType: {
      type: String,
      enum: [...BALL_TYPES],
      default: "Leather",
    },

    pitchType: {
      type: String,
      enum: [...PITCH_TYPES],
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

    /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    |
    | Status stays PENDING through any number of modification rounds -
    | it only ever moves to ACCEPTED/REJECTED/CANCELLED/EXPIRED as a final
    | outcome. pendingResponseFrom is what actually tracks whose turn it
    | is to act, since either side can be the one waiting on a response
    | after a modification flips it back and forth.
    |
    */

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"],
      default: "PENDING",
    },

    pendingResponseFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Modification History
    |--------------------------------------------------------------------------
    |
    | Every time either side proposes a change instead of accepting/
    | rejecting outright, a snapshot of what changed is appended here -
    | so both captains can see the negotiation trail, not just the
    | current state.
    |
    */

    modificationHistory: [
      {
        modifiedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Team",
          required: true,
        },

        proposedDate: {
          type: Date,
          default: null,
        },
        proposedTime: {
          type: String,
          default: "",
        },
        groundId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Ground",
        },
        venueName: String,
        matchType: String,
        overs: Number,
        message: String,
        matchTitle: {
          type: String,
          trim: true,
          default: "",
        },
        tournament: {
          type: String,
          trim: true,
          default: "",
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
        modifiedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    rejectionReason: {
      type: String,
      enum: [...REJECTION_REASONS, ""],
      default: "",
    },

    rejectionMessage: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },

    /*
    |--------------------------------------------------------------------------
    | Result Of Acceptance
    |--------------------------------------------------------------------------
    |
    | Filled in once ACCEPTED - the real Match created from this challenge.
    |
    */

    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },

    respondedAt: {
      type: Date,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 Days
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

matchChallengeSchema.index({
  challengedTeamId: 1,
  status: 1,
});

matchChallengeSchema.index({
  challengerTeamId: 1,
  status: 1,
});

const MatchChallenge = mongoose.model("MatchChallenge", matchChallengeSchema);

export default MatchChallenge;
export { REJECTION_REASONS, MATCH_TYPES, BALL_TYPES, PITCH_TYPES };