import { Router } from "express";

import {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "./notification.controller";

import { authMiddleware }
from "../../shared/middleware/auth.middleware";

const router = Router();

router.post(
  "/",
  authMiddleware,
  createNotification
);

router.get(
  "/",
  authMiddleware,
  getNotifications
);

router.put(
  "/:id/read",
  authMiddleware,
  markAsRead
);

router.put(
  "/read-all",
  authMiddleware,
  markAllAsRead
);

router.delete(
  "/:id",
  authMiddleware,
  deleteNotification
);

export default router;