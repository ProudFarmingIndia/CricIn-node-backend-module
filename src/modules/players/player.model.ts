import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    playerName: {
      type: String,
      required: true,
      trim: true,
    },
    profileImage: {
      url: String,
      publicId: String,
    },

    bio: {
      type: String,
      default: "",
    },

    dob: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: "",
    },

    city: {
      type: String,
      default: "",
    },

    state: {
      type: String,
      default: "",
    },

    country: {
      type: String,
      default: "India",
    },

    playerType: {
      type: String,
      enum: ["Batsman", "Bowler", "All-Rounder", "Wicket Keeper"],
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

    favoriteCricketer: {
      type: String,
      default: "",
    },

    favoriteTeam: {
      type: String,
      default: "",
    },

    favoriteShot: {
      type: String,
      default: "",
    },

    favoriteBall: {
      type: String,
      default: "",
    },

    followers: {
      type: Number,
      default: 0,
    },

    following: {
      type: Number,
      default: 0,
    },

    profileCompletion: {
      type: Number,
      default: 0,
    },

    teams: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team",
      },
    ],

    achievements: [String],

    highlights: [String],

    gallery: [
      {
        type: {
          type: String,
          enum: ["IMAGE", "VIDEO"],
        },
        url: String,
        publicId: String,
        uploadedAt: Date,
      },
    ],

    ranking: {
      city: {
        type: Number,
        default: 0,
      },

      state: {
        type: Number,
        default: 0,
      },

      national: {
        type: Number,
        default: 0,
      },
    },

    stats: {
      totalMatches: {
        type: Number,
        default: 0,
      },

      innings: {
        type: Number,
        default: 0,
      },

      runs: {
        type: Number,
        default: 0,
      },

      ballsFaced: {
        type: Number,
        default: 0,
      },

      highestScore: {
        type: Number,
        default: 0,
      },

      strikeRate: {
        type: Number,
        default: 0,
      },

      average: {
        type: Number,
        default: 0,
      },

      fours: {
        type: Number,
        default: 0,
      },

      sixes: {
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

      economy: {
        type: Number,
        default: 0,
      },

      maidens: {
        type: Number,
        default: 0,
      },

      catches: {
        type: Number,
        default: 0,
      },

      stumpings: {
        type: Number,
        default: 0,
      },

      runOuts: {
        type: Number,
        default: 0,
      },

      playerOfMatch: {
        type: Number,
        default: 0,
      },

      bestBowling: {
        type: String,
        default: "",
      },
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Player", playerSchema);
