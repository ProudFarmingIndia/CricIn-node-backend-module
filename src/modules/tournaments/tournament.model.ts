/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Tournaments
|
| File:
| tournament.model.ts
|
| Description:
| One tournament, from draft to winner.
|
| WHAT CHANGED FROM THE OLD MODEL
| The old one had a `teams` array of ObjectIds. That is gone. A team in a
| tournament is not a reference - it has an invite status, a seed, a
| registered squad and a running points total, and none of that fits in an
| array element. All of it now lives in TournamentTeam.
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import {
  TOURNAMENT_FORMATS,
  TOURNAMENT_STATUSES,
  PLAYOFF_SHAPE_KEYS,
  DEFAULT_POINTS,
  DEFAULT_MATCHES_PER_DAY,
  ALL_WEEK,
  MIN_TEAMS,
  MAX_TEAMS,
  AWARD_METRIC_KEYS,
} from "./tournament.constants";

/*
|--------------------------------------------------------------------------
| Prizes
|--------------------------------------------------------------------------
|
| An open list, not fixed fields. Some tournaments pay the top two, some
| pay four places plus Man of the Series plus best bowler - so `position`
| is a number the organizer sets and `label` is their own words.
|
| `amount` is a plain number that is DISPLAYED and nothing else. No money
| moves through the app: payments mean refunds, disputes and compliance,
| and that is a separate project. When the gateway does arrive, this
| sub-document is already the right shape to attach a payout to.
|
*/

const prizeSchema = new mongoose.Schema(
  {
    position: {
      type: Number,
      required: true,
      min: 1,
    },

    label: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /* "Trophy + kit bag", "Man of the Series" - anything not a number. */
    description: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

/*
|--------------------------------------------------------------------------
| Awards
|--------------------------------------------------------------------------
|
| A prize attached to a PLAYER rather than a finishing position - Most
| Runs, Most Sixes, Man of the Series.
|
| `metric` is what makes the award mean something. For a countable one it
| tells awards.service which leaderboard decides the winner; for the rest
| it is just an identity, and the organizer picks.
|
| `label` is stored rather than looked up from the metric, because the
| organizer renames things - "Most Runs" becomes "Chhakka King Trophy" and
| the sponsor expects to see that on the banner.
|
| `winnerPlayerId` is the organizer's pick. Empty means the counter
| decides, which is the normal state for a countable award and stays empty
| for the whole tournament unless somebody overrides it.
|
| Two awards cannot share a metric - "Most Runs" twice with different
| amounts is always a mistake, and letting it through means two rows
| fighting over the same winner. `custom` is exempt: that is the whole
| point of it.
|
*/

const awardSchema = new mongoose.Schema(
  {
    metric: {
      type: String,
      required: true,
      enum: AWARD_METRIC_KEYS,
    },

    label: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      default: 0,
      min: 0,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    winnerPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    decidedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

/*
|--------------------------------------------------------------------------
| Grounds
|--------------------------------------------------------------------------
|
| At least one, as many as the organizer wants. The fixture generator deals
| them out across matches in rotation, and the organizer can override any
| single fixture afterwards.
|
| groundId is optional on purpose: most local tournaments are played on a
| maidan that is not in the Grounds module and never will be. Forcing a
| lookup would block the common case to serve the rare one.
|
*/

const groundSchema = new mongoose.Schema(
  {
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      default: null,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

const tournamentSchema = new mongoose.Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Organizer
    |--------------------------------------------------------------------------
    |
    | Whoever created it. Every control in the feature checks against this
    | one field - publishing, inviting, locking, generating fixtures,
    | assigning a scorer to any match. Same shape as the live-stream owner
    | rule: one person, named, and no committee.
    |
    */

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tournamentName: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 60,
    },

    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },

    bannerImage: {
      type: String,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Format
    |--------------------------------------------------------------------------
    |
    | Locked once fixtures exist - the whole schedule is derived from these
    | four values, so changing one afterwards would describe a tournament
    | that does not match the fixtures already sitting in the database.
    |
    */

    format: {
      type: String,
      enum: TOURNAMENT_FORMATS,
      default: "League",
    },

    playoffShape: {
      type: String,
      enum: [...PLAYOFF_SHAPE_KEYS, "none"],
      default: "none",
    },

    maxTeams: {
      type: Number,
      default: 8,
      min: MIN_TEAMS,
      max: MAX_TEAMS,
    },

    overs: {
      type: Number,
      default: 20,
      min: 1,
    },

    matchType: {
      type: String,
      enum: ["T5", "T10", "T20", "ODI", "Test"],
      default: "T20",
    },

    ballType: {
      type: String,
      enum: ["Leather", "Tennis", "Other"],
      default: "Tennis",
    },

    /*
    |--------------------------------------------------------------------------
    | Where and when
    |--------------------------------------------------------------------------
    */

    grounds: {
      type: [groundSchema],
      default: [],
      validate: {
        validator(this: any, value: any[]) {
          /* A draft may have none; anything published needs at least one. */
          return this.status === "draft" || (value && value.length >= 1);
        },
        message: "Kam se kam ek ground add karo.",
      },
    },

    startDate: { type: Date, default: null },

    endDate: { type: Date, default: null },

    registrationDeadline: { type: Date, default: null },

    /*
    | Which days matches can be played on, and how many fit in a day. The
    | organizer sets this and can change it later - regenerating the
    | schedule redistributes the same fixtures over the new days without
    | touching results.
    */

    playDays: {
      type: [Number],
      default: ALL_WEEK,
    },

    matchesPerDay: {
      type: Number,
      default: DEFAULT_MATCHES_PER_DAY,
      min: 1,
      max: 10,
    },

    /*
    |--------------------------------------------------------------------------
    | Money (display only)
    |--------------------------------------------------------------------------
    */

    entryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    prizes: {
      type: [prizeSchema],
      default: [],
    },

    /*
    | Player awards, kept apart from position prizes because they are
    | decided by a different thing entirely - see awardSchema above.
    */

    awards: {
      type: [awardSchema],
      default: [],
    },

    /*
    | Sum of every prize AND award amount, kept here so the banner and the
    | list card can print "₹25,000 prize pool" without pulling both arrays.
    | Written by the service on every prize or award edit.
    |
    | Awards are included on purpose: a player reading "₹25,000 prize pool"
    | is being told what is on the table, and ₹5,000 of it being for Most
    | Wickets does not make it less on the table.
    */

    prizePool: {
      type: Number,
      default: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Points rules
    |--------------------------------------------------------------------------
    |
    | Editable until the first match completes. After that the standings
    | people have already read were built with these numbers, and changing
    | them rewrites history without saying so.
    |
    */

    pointsWin: { type: Number, default: DEFAULT_POINTS.win },
    pointsLoss: { type: Number, default: DEFAULT_POINTS.loss },
    pointsTie: { type: Number, default: DEFAULT_POINTS.tie },
    pointsNoResult: { type: Number, default: DEFAULT_POINTS.noResult },

    /*
    |--------------------------------------------------------------------------
    | Visibility
    |--------------------------------------------------------------------------
    |
    | isPublished          on the home page and Matches tab of every user
    | publicParticipation  any captain may request to join; organizer approves
    |
    | Two switches rather than one because they are genuinely separate: a
    | tournament can be public to watch and closed to entries, which is the
    | normal state once the field is full.
    |
    */

    isPublished: { type: Boolean, default: false, index: true },

    publicParticipation: { type: Boolean, default: false },

    status: {
      type: String,
      enum: TOURNAMENT_STATUSES,
      default: "draft",
      index: true,
    },

    /*
    | Stamped when the schedule is built. Its presence is what locks format,
    | maxTeams, overs and playoffShape - and what stops a second generation
    | wiping matches that already have scores against them.
    */

    fixturesGeneratedAt: { type: Date, default: null },

    winnerTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    runnerUpTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/*
| The two lists the app asks for constantly: "what is on right now" and
| "what is coming up", both filtered to published only.
*/

tournamentSchema.index({ isPublished: 1, status: 1, startDate: -1 });

tournamentSchema.index({ tournamentName: "text", city: "text" });

const Tournament = mongoose.model("Tournament", tournamentSchema);

export default Tournament;
