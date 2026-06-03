import { Router } from "express";

import {
  createConversation,
  getConversations,
  sendMessage,
  getMessages,
  markMessagesRead,
} from "./chat.controller";

import { authMiddleware }
from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/conversation",
  authMiddleware,
  createConversation
);

router.get(
  "/conversation",
  authMiddleware,
  getConversations
);

router.post(
  "/message",
  authMiddleware,
  sendMessage
);

router.get(
  "/messages/:conversationId",
  authMiddleware,
  getMessages
);

router.put(
  "/messages/:conversationId/read",
  authMiddleware,
  markMessagesRead
);

export default router;