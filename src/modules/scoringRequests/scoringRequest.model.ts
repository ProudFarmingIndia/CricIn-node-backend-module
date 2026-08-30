import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Scoring Request
|--------------------------------------------------------------------------
|
| A Quick Score setup that is waiting for the captains to agree.
|
| WHY THIS EXISTS SEPARATELY FROM MatchChallenge
| A challenge is one team asking another to play: one sender, one
| responder, and accepting it creates the match. Quick Score is a different
| shape - the person setting it up may be neither team, and then BOTH
| captains have to agree before anything exists. That is two approvals on
| one document, which the challenge model has no room for.
|
| It is a separate collection rather than extra fields on MatchChallenge
| specifically so the Add Match flow keeps working untouched. Bolting a
| second approval and a neutral requester onto the challenge model is how
| you break the feature that already works.
|
| WHY NOT JUST CREATE THE MATCH AND ASK AFTERWARDS
| Because then every abandoned or refused setup leaves a real Match behind,
| and matches feed stats and team records. Holding the setup here until
| both captains say yes means a match document only ever exists for a match
| both teams agreed to.
|
| The Match is created from this document the moment the last approval
| lands - and the PINs are generated then, exactly as they are when a
| challenge is accepted.
|
*/

const approvalSchema = {
  /*
  | not_required - the requester manages this team, so there is nobody
  |                separate to ask
  | pending      - waiting on this team's captain
  | approved     - captain agreed
  | rejected     - captain refused; one rejection sinks the whole request
  */

  status: {
    type: String,
    enum: ["not_required", "pending", "approved", "rejected"],
    default: "pending",
  },

  respondedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  respondedAt: {
    type: Date,
    default: null,
  },
};

const scoringRequestSchema = new mongoose.Schema(
  {
    /*
    | Whoever is going to score. May manage both teams, one, or neither -
    | that is what decides how many approvals are needed.
    */

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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

    /*
    |--------------------------------------------------------------------------
    | Match Setup
    |--------------------------------------------------------------------------
    |
    | Copied onto the Match verbatim when the request is approved. Held here
    | rather than re-collected afterwards so the captains are approving the
    | actual fixture - this ground, this format, this start time - and not a
    | blank cheque the scorer can fill in later.
    |
    | Squads and toss are deliberately NOT here. They are chosen after the
    | match exists, on the real matchId, exactly as they are in Add Match.
    |
    */

    matchTitle: {
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

    /*
    | Quick Match sends "now"; Scheduled Match sends the chosen date and
    | time. The request itself does not care which - it just carries it.
    */

    startTime: {
      type: Date,
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Approvals
    |--------------------------------------------------------------------------
    */

    approvals: {
      teamA: approvalSchema,

      teamB: approvalSchema,
    },

    /*
    | Overall state, derived from the two approvals above and written by the
    | service. Kept as its own field so the Scoring Requests list can be
    | filtered and sorted without inspecting both sides of every row.
    */

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },

    /*
    | Set once, when the final approval lands and the Match is created.
    | Its presence is what makes approval idempotent: a duplicate approve
    | cannot create a second match.
    */

    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
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

// The scorer's own list, newest first.
scoringRequestSchema.index({
  requestedBy: 1,
  createdAt: -1,
});

// "Which requests is my team being asked about?" - both sides, one index each.
scoringRequestSchema.index({
  teamA: 1,
  status: 1,
});

scoringRequestSchema.index({
  teamB: 1,
  status: 1,
});

const ScoringRequest = mongoose.model("ScoringRequest", scoringRequestSchema);

export default ScoringRequest;
