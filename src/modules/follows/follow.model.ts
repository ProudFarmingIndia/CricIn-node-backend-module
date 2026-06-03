import mongoose from "mongoose";

const followSchema =
  new mongoose.Schema(
    {
      followerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      targetType: {
        type: String,
        enum: [
          "USER",
          "PLAYER",
          "TEAM",
          "TOURNAMENT",
        ],
        required: true,
      },

      targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },

      status: {
        type: String,
        enum: [
          "PENDING",
          "ACCEPTED",
        ],
        default: "ACCEPTED",
      },
    },
    {
      timestamps: true,
    }
  );

const Follow =
  mongoose.model(
    "Follow",
    followSchema
  );

export default Follow;