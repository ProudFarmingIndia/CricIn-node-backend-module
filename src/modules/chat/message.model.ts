import mongoose from "mongoose";

const messageSchema =
  new mongoose.Schema(
    {
      conversationId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
      },

      senderId: {
        type:
          mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      message: {
        type: String,
        required: true,
      },

      messageType: {
        type: String,
        enum: [
          "TEXT",
          "IMAGE",
          "VIDEO",
          "FILE",
        ],
        default: "TEXT",
      },

      mediaUrl: {
        type: String,
        default: "",
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

const Message =
  mongoose.model(
    "Message",
    messageSchema
  );

export default Message;