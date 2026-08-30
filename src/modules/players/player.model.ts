import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    /*
|--------------------------------------------------------------------------
| Identity
|--------------------------------------------------------------------------
*/

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",

      /*
  Registered Players only.

  Local Players will not have a User account.
  */

      default: null,

      unique: true,

      sparse: true,
    },

    /*
|--------------------------------------------------------------------------
| Local Player
|--------------------------------------------------------------------------
*/

    isLocal: {
      type: Boolean,
      default: false,
    },

    /*
|--------------------------------------------------------------------------
| Creator
|--------------------------------------------------------------------------
|
| User who created this Local Player.
| Used later for ownership & claiming.
|
*/

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /*
|--------------------------------------------------------------------------
| Mobile
|--------------------------------------------------------------------------
*/

    mobile: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
    },

    /*
|--------------------------------------------------------------------------
| Claim Status
|--------------------------------------------------------------------------
|
| Future:
| Local player installs CricIn and claims this profile.
|
*/

    isClaimed: {
      type: Boolean,
      default: false,
    },

    /*
|--------------------------------------------------------------------------
| Basic Information
|--------------------------------------------------------------------------
*/

    playerName: {
      type: String,
      required: true,
      trim: true,
    },

    profileImage: {
      url: String,
      publicId: String,
    },

    /*
    |--------------------------------------------------------------------------
    | Cover Photo
    |--------------------------------------------------------------------------
    |
    | The banner behind the avatar on the profile header. Same
    | { url, publicId } shape as profileImage and as Team.coverPhoto -
    | publicId is kept so the previous image can be removed from
    | Cloudinary when it is replaced.
    |
    | Defaults to "" rather than being absent, so the client can read
    | coverPhoto.url without an existence check.
    |
    */

    coverPhoto: {
      url: {
        type: String,
        default: "",
      },

      publicId: {
        type: String,
        default: "",
      },
    },

    bio: {
      type: String,
      default: "",
    },

    dob: {
      type: Date,
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Gender
    |--------------------------------------------------------------------------
    |
    | default was "" - which is NOT one of the enum values, so Mongoose's
    | enum validator rejected it and any player saved without an explicit
    | gender failed validation on create and on update.
    |
    | null is the correct "not set" value here: Mongoose skips enum
    | validation for null/undefined on a field that isn't required.
    |
    */

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: null,
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
