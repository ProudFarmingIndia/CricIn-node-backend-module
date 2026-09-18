/*
|--------------------------------------------------------------------------
| CricIn
|--------------------------------------------------------------------------
|
| Module:
| Series
|
| File:
| series.model.ts
|
| Description:
| One bilateral series: two teams, N matches, a scoreline.
|
| WHY BOTH TEAMS LIVE ON THIS DOCUMENT
| A tournament keeps its teams in their own collection because there are
| up to thirty-two of them, each with an invite lifecycle, a squad and a
| standings row that changes after every match.
|
| A series has two, and one of them is the organizer's own. There is one
| invite, and the "standings" are two integers. Putting that in a separate
| collection would mean a join on every read to fetch two rows that never
| change independently of each other - all of the cost of the tournament
| arrangement and none of the reason for it.
|
| WHY THE SCORELINE IS STORED AND THE POINTS TABLE IS NOT
| The tournament's table is recomputed on every read, because NRR depends
| on every ball of every match and an incremented copy drifts the moment a
| scorer undoes a delivery.
|
| A scoreline is just "how many completed matches did each team win", which
| is a two-line count over at most fifteen documents. It is recomputed the
| same way - see recomputeScoreline in the service - and the fields here
| are a cache for the list card, so a feed of ten series does not run ten
| aggregations to print "2-1".
|
|--------------------------------------------------------------------------
*/

import mongoose from "mongoose";

import {
  SERIES_STATUSES,
  OPPONENT_STATUSES,
  MIN_MATCHES,
  MAX_MATCHES,
  DEFAULT_MATCHES,
  DEFAULT_MATCHES_PER_DAY,
  ALL_WEEK,
  AWARD_METRIC_KEYS,
} from "./series.constants";

/*
| Position prizes and player awards, same shapes as the tournament's.
| Duplicated rather than imported because a Mongoose sub-schema is bound
| to the parent it was declared in, and sharing one instance across two
| models is a documented way to get confusing validation errors.
*/

const prizeSchema = new mongoose.Schema(
  {
    position: { type: Number, required: true, min: 1 },
    label: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    description: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const awardSchema = new mongoose.Schema(
  {
    metric: { type: String, required: true, enum: AWARD_METRIC_KEYS },
    label: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    description: { type: String, trim: true, default: "" },

    /* The organizer's pick. Empty means the counter decides. */
    winnerPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    decidedAt: { type: Date, default: null },
  },
  { _id: false },
);

const groundSchema = new mongoose.Schema(
  {
    /*
    | Optional on purpose: most local cricket is played on a maidan that
    | is not in the Grounds module and never will be. Forcing a real
    | ground record would block half the series ever created.
    */
    groundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ground",
      default: null,
    },

    name: { type: String, required: true, trim: true },

    address: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const seriesSchema = new mongoose.Schema(
  {
    seriesName: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 80,
    },

    description: { type: String, trim: true, default: "" },

    bannerImage: { type: String, trim: true, default: "" },

    city: { type: String, trim: true, default: "" },

    /* The organizer. Same single-owner model as a tournament. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | The two teams
    |--------------------------------------------------------------------------
    |
    | teamA is the organizer's side and is required from the start - you
    | cannot organize a series without saying who you are.
    |
    | teamB is the invited opponent and is null while the series is a
    | draft, because the whole point of the draft state is setting up the
    | thing before anyone has agreed to it.
    |
    | opponentCaptainUserId is stored rather than looked up because
    | captaincy changes, and an invite sent to yesterday's captain should
    | not silently become an invite to today's. The tournament module
    | stores it for the same reason.
    |
    */

    teamA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    teamB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
      index: true,
    },

    opponentCaptainUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    opponentStatus: {
      type: String,
      enum: OPPONENT_STATUSES,
      default: "pending",
    },

    opponentRespondedAt: { type: Date, default: null },

    /*
    |--------------------------------------------------------------------------
    | Shape
    |--------------------------------------------------------------------------
    */

    totalMatches: {
      type: Number,
      default: DEFAULT_MATCHES,
      min: MIN_MATCHES,
      max: MAX_MATCHES,
    },

    matchType: { type: String, trim: true, default: "T20" },

    overs: { type: Number, default: 20, min: 1, max: 90 },

    ballType: { type: String, trim: true, default: "Tennis" },

    /*
    |--------------------------------------------------------------------------
    | Where and when
    |--------------------------------------------------------------------------
    |
    | At least one ground, as many as the organizer wants - the generator
    | deals them out across matches in rotation, and any single fixture can
    | be overridden afterwards. A three-match series played at one ground
    | and a five-match series that moves every game are both normal.
    |
    | The minimum is enforced only once the series leaves draft, so an
    | organizer can save a half-filled form and come back to it.
    |
    */

    grounds: {
      type: [groundSchema],
      default: [],
      validate: {
        validator(this: any, value: any[]) {
          if (this.status === "draft") return true;

          return Array.isArray(value) && value.length >= 1;
        },
        message: "Kam se kam ek ground add karo.",
      },
    },

    startDate: { type: Date, default: null },

    endDate: { type: Date, default: null },

    playDays: {
      type: [Number],
      default: ALL_WEEK,
    },

    matchesPerDay: {
      type: Number,
      default: DEFAULT_MATCHES_PER_DAY,
      min: 1,
      max: 4,
    },

    /*
    |--------------------------------------------------------------------------
    | Money (display only)
    |--------------------------------------------------------------------------
    |
    | No payment gateway. These are shown on the banner and nothing moves
    | through the app.
    */

    prizes: { type: [prizeSchema], default: [] },

    awards: { type: [awardSchema], default: [] },

    prizePool: { type: Number, default: 0 },

    /*
    |--------------------------------------------------------------------------
    | Visibility
    |--------------------------------------------------------------------------
    |
    | One switch, not two. A tournament has publicParticipation because
    | strangers can ask to enter it; a series has exactly two teams and
    | there is nothing for an outsider to join.
    */

    isPublished: { type: Boolean, default: false },

    status: {
      type: String,
      enum: SERIES_STATUSES,
      default: "draft",
      index: true,
    },

    fixturesGeneratedAt: { type: Date, default: null },

    /*
    |--------------------------------------------------------------------------
    | Scoreline
    |--------------------------------------------------------------------------
    |
    | A cache of the count over completed matches, so a feed of ten series
    | can print "2-1" without ten aggregations. Rewritten from scratch by
    | recomputeScoreline after every result - never incremented, for the
    | same reason the points table is never incremented: a scorer undoes
    | balls, and a drifted counter never tells you it has drifted.
    */

    teamAWins: { type: Number, default: 0, min: 0 },

    teamBWins: { type: Number, default: 0, min: 0 },

    drawnMatches: { type: Number, default: 0, min: 0 },

    /*
    | The moment one side went beyond reach - 2-0 in a three-match series.
    | Recorded rather than used as a stopping rule: the remaining matches
    | are still played, because the ground is booked and both teams turned
    | up. It is what lets the app say "series won, dead rubber to come".
    */

    decidedAt: { type: Date, default: null },

    winnerTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
  },
  { timestamps: true },
);

/*
| The feed queries. Published series ordered by date is the list screen and
| the home section; the organizer's own is the "Mine" filter.
*/

seriesSchema.index({ isPublished: 1, status: 1, startDate: -1 });

seriesSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.Series ||
  mongoose.model("Series", seriesSchema);
