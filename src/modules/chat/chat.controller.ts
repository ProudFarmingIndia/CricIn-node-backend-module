import { Response } from "express";

import { AuthRequest }
from "../../shared/middleware/auth.middleware";

import * as ChatService
from "./chat.service";

export const createConversation =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await ChatService.createConversation(
      req.body
    );

  res.status(201).json({
    success: true,
    data,
  });
};

export const getConversations =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await ChatService.getConversations(
      req.user.userId
    );

  res.status(200).json({
    success: true,
    data,
  });
};

export const sendMessage =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await ChatService.sendMessage(
      req.user.userId,
      req.body
    );

  res.status(201).json({
    success: true,
    data,
  });
};

export const getMessages =
async (
  req: AuthRequest,
  res: Response
) => {

  const data =
    await ChatService.getMessages(
      req.params.conversationId as string
    );

  res.status(200).json({
    success: true,
    data,
  });
};

export const markMessagesRead =
async (
  req: AuthRequest,
  res: Response
) => {

  await ChatService.markMessagesRead(
    req.params.conversationId as string
  );

  res.status(200).json({
    success: true,
    message:
      "Messages marked read",
  });
};