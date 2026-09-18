import mongoose from "mongoose";

const scoringSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
    },

    inningsId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Innings",
      required: true,
    },

    batsmanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
    },

    bowlerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
    },

    over: Number,

    ball: Number,

    runs: {
      type: Number,
      default: 0,
    },

    isWicket: {
      type: Boolean,
      default: false,
    },

    extraType: {
      type: String,
      default: null,
    },

    wicketType: {
      type: String,
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Penalty Reason
    |--------------------------------------------------------------------------
    |
    | Why five runs were awarded - illegal fielding, deliberate distraction,
    | damaging the pitch, ball tampering, other. Stored because "5 penalty
    | runs" with no reason is unarguable-with after the fact, and a scorer
    | being questioned about it needs the note more than the number.
    |
    | Empty on every row that is not a penalty.
    */

    penaltyReason: {
      type: String,
      default: "",
      trim: true,
    },

    dismissedPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Legal Delivery
    |--------------------------------------------------------------------------
    |
    | Wides and no-balls don't count toward the 6-ball over - everything
    | else (including byes/leg-byes, which happen off a normal delivery)
    | does. Drives over/ball numbering and over-completion.
    |
    */

    isLegalDelivery: {
      type: Boolean,
      default: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Team Runs Contributed
    |--------------------------------------------------------------------------
    |
    | What this ball actually added to the innings total - distinct from
    | `runs` (which stays "runs off the bat / picked in the extras
    | picker", the value every existing batting-figures calculation on
    | the frontend already expects). For a wide/no-ball this is `runs + 1`
    | for the mandatory penalty; otherwise it's the same as `runs`. Kept
    | so undoLastBall can reverse the innings total exactly, without
    | re-deriving the wide/no-ball rule at undo time.
    |
    */

    teamRuns: {
      type: Number,
      default: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Strike Snapshot (Before This Ball)
    |--------------------------------------------------------------------------
    |
    | Who was on strike/non-strike immediately before this delivery -
    | lets undoLastBall restore the exact prior state instead of trying
    | to reverse-engineer strike rotation after the fact.
    |
    */

    strikerIdBefore: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    nonStrikerIdBefore: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    commentaryText: {
      type: String,
      default: "",
    },

    fielderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    bowlerCredit: {
      type: Boolean,
      default: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Shot & Wagon Wheel
    |--------------------------------------------------------------------------
    |
    | The app has ALWAYS asked for these - ShotSelectionModal collects the
    | shot and WagonWheelModal collects the direction, and addBall sends
    | both - but neither field existed on this schema. Mongoose runs in
    | strict mode, so it silently dropped them on every single delivery.
    |
    | That means the wagon wheel, one of the headline features, was asking
    | the scorer for data on every ball and then throwing it away: nothing
    | could ever be plotted, and the commentary had nothing to describe.
    |
    | angle is degrees clockwise from straight down the ground; distance is
    | the normalised 0-1 reach from the batsman used to place the dot.
    | region is the human name for the angle ("Cover", "Square Leg") and is
    | stored rather than recomputed so a later change to the zone
    | boundaries cannot silently rewrite the past.
    |
    */

    /*
    |--------------------------------------------------------------------------
    | Batter Runs
    |--------------------------------------------------------------------------
    |
    | What the BATTER scored, as opposed to `runs`, which is what the scorer
    | pressed, and `teamRuns`, which includes the extras penalty.
    |
    | These three are genuinely different numbers and treating `runs` as all
    | of them is how two runs taken off a wide ended up on the batter's
    | scorecard: the innings said 3, the batting card and extras together
    | said 5.
    |
    | Computed once on the server so every consumer reads the same answer.
    */

    batsmanRuns: {
      type: Number,
      default: 0,
    },

    /*
    | The bowler at the crease BEFORE this delivery, so undo can put him
    | back. Undo restored the totals and both batters but not the bowler.
    */

    bowlerIdBefore: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    shotType: {
      type: String,
      default: "",
    },

    wagonWheel: {
      angle: {
        type: Number,
        default: null,
      },

      distance: {
        type: Number,
        default: null,
      },

      region: {
        type: String,
        default: "",
      },
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Timestamp Indexes - For The Broadcast Overlay
|--------------------------------------------------------------------------
|
| The live video runs 12-20 seconds behind real life, so the overlay can
| never render the current score - it would announce a wicket while the
| viewer is still watching the bowler run in. Instead it asks, roughly
| once a second, "what was the state at THIS moment", and that question is
| answered by reading these rows with a createdAt cutoff.
|
| Every ball already carries createdAt from `timestamps: true` above, so
| no new field and no second collection was needed - but without an index
| on it, every one of those requests is a collection scan on the one
| collection that grows with every delivery of every match ever played.
|
| Both compound: inningsId for the overlay itself, matchId for the
| draft-cleanup job and anything that counts a match's balls without
| knowing its innings.
|
*/

scoringSchema.index({ inningsId: 1, createdAt: 1 });

scoringSchema.index({ matchId: 1, createdAt: 1 });

export default mongoose.model("Scoring", scoringSchema);