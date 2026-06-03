import mongoose from "mongoose";

const notificationSchema =
  new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      type: {
        type: String,
        enum: [
          "MATCH_REMINDER",
          "MATCH_STARTED",
          "MATCH_RESULT",

          "CHAT_MESSAGE",

          "FOLLOW_REQUEST",
          "FOLLOW_ACCEPTED",

          "PLAYER_LIVE",

          "TOURNAMENT_INVITE",
          "TEAM_INVITE",

          "SYSTEM",
        ],
        required: true,
      },

      title: {
        type: String,
        required: true,
      },

      message: {
        type: String,
        required: true,
      },

      referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },

      isRead: {
        type: Boolean,
        default: false,
      },
    },
    {
      timestamps: true,
    }
  );

const Notification =
  mongoose.model(
    "Notification",
    notificationSchema
  );

export default Notification;