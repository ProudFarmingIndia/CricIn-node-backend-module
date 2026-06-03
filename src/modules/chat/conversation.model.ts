import mongoose from "mongoose";

const conversationSchema =
  new mongoose.Schema(
    {
      type: {
        type: String,
        enum: [
          "DIRECT",
          "TEAM",
          "TOURNAMENT",
          "MATCH",
        ],
        required: true,
      },

      name: {
        type: String,
        default: "",
      },

      participants: [
        {
          type:
            mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
    },
    {
      timestamps: true,
    }
  );

const Conversation =
  mongoose.model(
    "Conversation",
    conversationSchema
  );

export default Conversation;