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

    dismissedPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "Scoring",
  scoringSchema
);