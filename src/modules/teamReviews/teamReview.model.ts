import mongoose from "mongoose";

/*
|--------------------------------------------------------------------------
| Team Review
|--------------------------------------------------------------------------
|
| One team rating/reviewing another, optionally tied to a specific
| completed match between them. Team.rating/reviewCount (see
| teams/team.model.ts) are a running average recomputed from these
| whenever one is added - never edited directly.
|
*/

const teamReviewSchema = new mongoose.Schema(
  {
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    reviewedByTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },

    reviewedByPlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },

    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
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

teamReviewSchema.index({
  teamId: 1,
  createdAt: -1,
});

const TeamReview = mongoose.model("TeamReview", teamReviewSchema);

export default TeamReview;