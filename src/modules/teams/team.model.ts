import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Owner
    |--------------------------------------------------------------------------
    */

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Basic Information
    |--------------------------------------------------------------------------
    */

    teamName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    shortName: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 6,
    },

    logo: {
      url: {
        type: String,
        default: "",
      },

      publicId: {
        type: String,
        default: "",
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Cover Photo
    |--------------------------------------------------------------------------
    |
    | Wide banner image for the Team Profile / Preview screens - distinct
    | from the square logo used as the team's small avatar everywhere else.
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

    teamType: {
      type: String,
      enum: ["Club", "Corporate", "Academy", "Friends", "School", "College"],
      default: "Club",
    },

    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },

    /*
    |--------------------------------------------------------------------------
    | Location
    |--------------------------------------------------------------------------
    */

    country: {
      type: String,
      default: "India",
      trim: true,
    },

    state: {
      type: String,
      default: "",
      trim: true,
    },

    city: {
      type: String,
      default: "",
      trim: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Leadership
    |--------------------------------------------------------------------------
    */

    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    viceCaptainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Vice-Captain Rights
    |--------------------------------------------------------------------------
    |
    | The vice-captain does NOT automatically have captain-level rights.
    | Captain (or owner) explicitly grants specific permissions here.
    | Everything defaults to false - a vice-captain with no rights granted
    | can still be a vice-captain, they just can't manage anything yet.
    |
    | NOTE: assigning captain/vice-captain, granting these rights, and
    | deleting the team are intentionally NEVER delegable through this
    | object - a vice-captain can never grant themselves more power.
    |
    */

    viceCaptainRights: {
      canEditTeam: {
        type: Boolean,
        default: false,
      },

      canManagePlayers: {
        type: Boolean,
        default: false,
      },

      canSendInvitations: {
        type: Boolean,
        default: false,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Squad
    |--------------------------------------------------------------------------
    */

    players: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Player",
      },
    ],

    /*
    |--------------------------------------------------------------------------
    | Statistics
    |--------------------------------------------------------------------------
    */

    totalMatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    wins: {
      type: Number,
      default: 0,
      min: 0,
    },

    losses: {
      type: Number,
      default: 0,
      min: 0,
    },

    draws: {
      type: Number,
      default: 0,
      min: 0,
    },

    winPercentage: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Rating & Reviews
    |--------------------------------------------------------------------------
    |
    | rating is a running average, recomputed by teamReviews/teamReview.service.ts
    | whenever a review is added - never edited directly here.
    |
    */

    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Followers
    |--------------------------------------------------------------------------
    |
    | Denormalised count of Follow documents targeting this team, so a
    | search result can render "1.2k followers" without a count query per
    | row.
    |
    | Named followersCount rather than followers because Player already
    | uses `followers` for the same idea, and a future "followers" array
    | on Team would collide with it. Maintained by follow.service.ts;
    | POST /api/follows/recalculate/TEAM/:id repairs it if it drifts.
    |
    */

    followersCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Standard Availability
    |--------------------------------------------------------------------------
    |
    | A general, informational statement of when the team is usually free
    | to play - shown to other teams browsing/considering a challenge, so
    | they don't have to check the specific-date calendar just to get a
    | rough sense of fit. This is NOT enforced against challenge
    | validation (that still only checks real booked dates via
    | teamAvailability.service.ts) - it's a description, not a rule.
    |
    */

    standardAvailability: {
      weekdays: {
        enabled: {
          type: Boolean,
          default: false,
        },

        startTime: {
          type: String, // "16:00"
          default: "16:00",
        },

        endTime: {
          type: String,
          default: "20:00",
        },
      },

      weekends: {
        enabled: {
          type: Boolean,
          default: false,
        },

        startTime: {
          type: String,
          default: "09:00",
        },

        endTime: {
          type: String,
          default: "18:00",
        },
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Match Preferences
    |--------------------------------------------------------------------------
    |
    | Also informational - shown on the team's profile, and used to
    | pre-fill the Send Challenge form when another team challenges this
    | one. Doesn't restrict what can actually be proposed.
    |
    */

    matchPreferences: {
      formats: {
        type: [String], // subset of ["T5", "T10", "T20", "ODI", "Test"]
        default: ["T20"],
      },

      preferredOvers: {
        type: Number,
        default: 20,
        min: 5,
        max: 50,
      },
    },

    /*
    |--------------------------------------------------------------------------
    | Rankings
    |--------------------------------------------------------------------------
    */

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

    /*
    |--------------------------------------------------------------------------
    | Status
    |--------------------------------------------------------------------------
    */

    isVerified: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

teamSchema.index({
  teamName: 1,
});

teamSchema.index({
  city: 1,
});

teamSchema.index({
  visibility: 1,
});

teamSchema.index({
  userId: 1,
});

const Team = mongoose.model("Team", teamSchema);

export default Team;