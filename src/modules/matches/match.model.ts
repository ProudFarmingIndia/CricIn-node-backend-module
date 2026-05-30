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
      enum: ["T10", "T20", "ODI", "Test"],
      default: "T20",
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
      enum: [
        "upcoming",
        "live",
        "completed",
      ],
      default: "upcoming",
    },

    startTime: {
      type: Date,
      default: null,
    },

    endTime: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Match = mongoose.model(
  "Match",
  matchSchema
);

export default Match;