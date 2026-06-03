import mongoose from "mongoose";

const tournamentSchema =
  new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      tournamentName: {
        type: String,
        required: true,
        trim: true,
      },

      format: {
        type: String,
        enum: [
          "Knockout",
          "League",
          "League+Knockout",
        ],
        default: "League",
      },

      teams: [
        {
          type:
            mongoose.Schema.Types.ObjectId,
          ref: "Team",
        },
      ],

      startDate: {
        type: Date,
        default: null,
      },

      endDate: {
        type: Date,
        default: null,
      },

      winnerTeam: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "Team",
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

      description: {
        type: String,
        default: "",
      },
    },
    {
      timestamps: true,
    }
  );

const Tournament =
  mongoose.model(
    "Tournament",
    tournamentSchema
  );

export default Tournament;