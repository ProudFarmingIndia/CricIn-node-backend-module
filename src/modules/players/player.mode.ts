import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    playerName: {
      type: String,
      required: true,
      trim: true,
    },

    playerType: {
      type: String,
      enum: [
        "Batsman",
        "Bowler",
        "All-Rounder",
        "Wicket Keeper",
      ],
      required: true,
    },

    battingStyle: {
      type: String,
      default: "",
    },

    bowlingStyle: {
      type: String,
      default: "",
    },

    jerseyNumber: {
      type: Number,
      default: null,
    },

    city: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const Player = mongoose.model(
  "Player",
  playerSchema
);

export default Player;