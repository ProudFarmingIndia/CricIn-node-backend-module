import mongoose from "mongoose";

const inningsSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
    },

    battingTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    bowlingTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    inningsNumber: {
      type: Number,
      required: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Current Players
    |--------------------------------------------------------------------------
    |
    | Who's actually facing/bowling right now - set at creation (opening
    | pair + opening bowler) and updated by addBall (strike rotation,
    | incoming batsman on a wicket) and setNextBowler (new over).
    |
    */

    currentStrikerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    currentNonStrikerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    currentBowlerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    totalRuns: {
      type: Number,
      default: 0,
    },

    wickets: {
      type: Number,
      default: 0,
    },

    overs: {
      type: Number,
      default: 0,
    },

    balls: {
      type: Number,
      default: 0,
    },
    isCompleted: {
      type: Boolean,
      default: false,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "Innings",
  inningsSchema
);