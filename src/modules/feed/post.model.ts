import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    content: {
      type: String,
      default: "",
    },

    mediaUrls: [
      {
        type: String,
      },
    ],

    postType: {
      type: String,
      enum: [
        "POST",
        "MATCH_HIGHLIGHT",
        "REEL",
      ],
      default: "POST",
    },

    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },

    totalLikes: {
      type: Number,
      default: 0,
    },

    totalComments: {
      type: Number,
      default: 0,
    },

    totalShares: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "Post",
  postSchema
);