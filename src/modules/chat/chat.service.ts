import { getIO }
from "../../socket/socket";
import Conversation from "./conversation.model";
import Message from "./message.model";

export const createConversation =
async (
  payload: any
) => {

  return await Conversation.create(
    payload
  );
};

export const getConversations =
async (
  userId: string
) => {

  return await Conversation.find({
    participants: userId,
  });
};

export const sendMessage =
async (
  senderId: string,
  payload: any
) => {

  const message =
    await Message.create({
      ...payload,
      senderId,
    });

  const populatedMessage =
    await Message.findById(
      message._id
    ).populate(
      "senderId",
      "fullName profileImage"
    );

  getIO().emit(
    "chat:new-message",
    populatedMessage
  );

  return populatedMessage;
};

export const getMessages =
async (
  conversationId: string
) => {

  return await Message.find({
    conversationId,
  })
    .populate(
      "senderId",
      "fullName"
    )
    .sort({
      createdAt: 1,
    });
};

export const markMessagesRead =
async (
  conversationId: string
) => {

  return await Message.updateMany(
    {
      conversationId,
      isRead: false,
    },
    {
      isRead: true,
    }
  );
};